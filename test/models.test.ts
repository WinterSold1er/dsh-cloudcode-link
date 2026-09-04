import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ModelCatalog,
  buildFallbackCatalog,
  defaultEffortFor,
  findEntry,
  foldEfforts,
  getAntigravityRequestModelId,
  getThinkingConfig,
  parseModelsOutput,
  resolveModelSlug,
} from '../src/host/models.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import { DEFAULT_FALLBACK_MODELS, defaultConfig, type PluginConfig } from '../src/common/types.ts'

test('parseModelsOutput reads the JSON array shape', () => {
  const raw = JSON.stringify([
    { id: 'gemini-3-6-flash', display_name: 'Gemini 3.6 Flash' },
    { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
  ])
  const out = parseModelsOutput(raw)
  assert.equal(out.length, 2)
  assert.equal(out[0]?.slug, 'gemini-3-6-flash')
  assert.equal(out[0]?.label, 'Gemini 3.6 Flash')
})

test('parseModelsOutput reads the TAB-separated agy 1.1.15 table and folds efforts', () => {
  // Captured verbatim from a live `agy models` (1.1.15, signed in)
  const table = [
    'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
    'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
    'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
    'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  ].join('\n')
  const out = parseModelsOutput(table)
  assert.equal(out.length, 5)
  assert.equal(out[0]?.slug, 'gemini-3.7-flash-high')
  assert.equal(out[0]?.label, 'Gemini 3.7 Flash (High)')
  const folded = foldEfforts(out)
  const base = findEntry({ source: 'discovered', models: folded, discoveredAt: 0 }, 'gemini-3.7-flash')
  assert.ok(base, 'gemini-3.7-flash base exists after folding')
  assert.deepEqual(base?.efforts, ['low', 'medium', 'high'])
})

test('parseModelsOutput reads the two-column text shape', () => {
  const out = parseModelsOutput('gemini-3-6-flash    Gemini 3.6 Flash\nclaude-sonnet-4-6    Claude Sonnet 4.6\n')
  assert.equal(out.length, 2)
  assert.equal(out[1]?.slug, 'claude-sonnet-4-6')
})

test('parseModelsOutput handles dotted current-gen slugs', () => {
  // agy 1.1.13 prints gemini-3.7-flash(-medium) etc. (dots, not dashes)
  const out = parseModelsOutput('gemini-3.7-flash    Gemini 3.7 Flash\ngemini-3.7-flash-medium    Gemini 3.7 Flash (Medium)\ngemini-3.6-flash    Gemini 3.6 Flash\n')
  assert.deepEqual(out.map((r) => r.slug), ['gemini-3.7-flash', 'gemini-3.7-flash-medium', 'gemini-3.6-flash'])
  const folded = foldEfforts(out)
  const base = findEntry({ source: 'discovered', models: folded, discoveredAt: 0 }, 'gemini-3.7-flash')
  assert.ok(base, 'gemini-3.7-flash base exists after folding')
  assert.deepEqual(base?.efforts, ['medium'])
})

test('fallback catalog carries the current model line-up incl. 3.8 and 3.7', () => {
  const cat = buildFallbackCatalog(DEFAULT_FALLBACK_MODELS)
  const ids = cat.map((e) => e.id)
  assert.ok(ids.includes('gemini-3.8-flash'), '3.8 flash present')
  assert.ok(ids.includes('gemini-3.7-flash'), '3.7 flash present')
  assert.ok(ids.includes('gemini-3.6-flash'))
  assert.ok(ids.includes('claude-opus-4-6-thinking'))
  assert.ok(ids.includes('gpt-oss-120b-medium'))
  const f38 = findEntry({ source: 'fallback', models: cat, discoveredAt: 0 }, 'gemini-3.8-flash')
  assert.deepEqual(f38?.efforts, ['low', 'medium', 'high'])
  const f37 = findEntry({ source: 'fallback', models: cat, discoveredAt: 0 }, 'gemini-3.7-flash')
  assert.deepEqual(f37?.efforts, ['low', 'medium', 'high'])
})

test('parseModelsOutput skips banners and error lines', () => {
  const out = parseModelsOutput('Fetching models...\nError: hmm\ngemini-3-6-flash    Flash\n')
  assert.equal(out.length, 1)
})

test('foldEfforts folds gemini effort suffixes into a base entry', () => {
  const folded = foldEfforts([
    { slug: 'gemini-3-6-flash', label: 'Gemini 3.6 Flash' },
    { slug: 'gemini-3-6-flash-high', label: 'Gemini 3.6 Flash High' },
    { slug: 'gemini-3-6-flash-low', label: 'Gemini 3.6 Flash Low' },
    { slug: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ])
  const ids = folded.map((e) => e.id)
  assert.ok(ids.includes('gemini-3-6-flash'))
  assert.ok(!ids.includes('gemini-3-6-flash-high'))
  const base = findEntry({ source: 'discovered', models: folded, discoveredAt: 0 }, 'gemini-3-6-flash')
  assert.deepEqual(base?.efforts, ['low', 'high'])
  const claude = findEntry({ source: 'discovered', models: folded, discoveredAt: 0 }, 'claude-sonnet-4-6')
  assert.equal(claude?.efforts, null)
})

test('foldEfforts emits no duplicate ids when agy lists the bare base plus one variant (issue #1)', () => {
  // agy 1.1.13 shape: the bare base IS a catalog member next to its
  // variants. Folding must absorb the bare entry into the folded base
  // instead of emitting the id twice — DSH's llm.listModels rejects the
  // whole provider catalog on any duplicate id (INVALID_CATALOG), which
  // drops the entire Antigravity group from the model picker.
  const folded = foldEfforts([
    { slug: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { slug: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { slug: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  ])
  const ids = folded.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'catalog ids must be unique')
  const base = folded.filter((e) => e.id === 'gemini-3.7-flash')
  assert.equal(base.length, 1, 'folded base appears exactly once')
  assert.deepEqual(base[0]?.efforts, ['medium'])
  // Unrelated bare entries stay verbatim.
  assert.ok(ids.includes('gemini-3.6-flash'))
})

test('foldEfforts emits no duplicate ids when the bare base is listed alongside every variant', () => {
  const folded = foldEfforts([
    { slug: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { slug: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { slug: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { slug: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
    { slug: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  ])
  const ids = folded.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'catalog ids must be unique')
  const base = folded.filter((e) => e.id === 'gemini-3.7-flash')
  assert.equal(base.length, 1)
  assert.deepEqual(base[0]?.efforts, ['low', 'medium', 'high'])
  assert.ok(ids.includes('claude-sonnet-4-6'))
})

test('parseModelsOutput dedupes repeated slugs', () => {
  // Some agy builds print the same row twice (e.g. overlapping sections);
  // duplicate raw slugs would become duplicate catalog ids downstream.
  const out = parseModelsOutput([
    'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
    'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  ].join('\n'))
  assert.deepEqual(out.map((r) => r.slug), ['gemini-3.7-flash-high', 'claude-sonnet-4-6'])
})

test('bare gemini base without siblings gets no efforts', () => {
  const folded = foldEfforts([{ slug: 'gemini-3-1-pro', label: 'Gemini 3.1 Pro' }])
  assert.equal(folded[0]?.efforts, null)
})

test('buildFallbackCatalog carries configurable efforts', () => {
  const cat = buildFallbackCatalog(DEFAULT_FALLBACK_MODELS)
  assert.equal(cat.length, 8)
  const flash38 = cat.find((e) => e.id === 'gemini-3.8-flash')
  assert.deepEqual(flash38?.efforts, ['low', 'medium', 'high'])
  const flash = cat.find((e) => e.id === 'gemini-3.7-flash')
  assert.deepEqual(flash?.efforts, ['low', 'medium', 'high'])
  const claude = cat.find((e) => e.id === 'claude-sonnet-4-6')
  assert.equal(claude?.efforts, null)
})

test('defaultEffortFor prefers config override then high first', () => {
  const cfg: PluginConfig = { ...defaultConfig(), defaultEffort: 'low' }
  const cat = buildFallbackCatalog(DEFAULT_FALLBACK_MODELS)
  const flash = findEntry({ source: 'discovered', models: cat, discoveredAt: 0 }, 'gemini-3.7-flash')
  assert.equal(flash && defaultEffortFor(flash, cfg), 'low')
  // No config override: default is the highest available effort.
  const cfg2: PluginConfig = { ...defaultConfig(), defaultEffort: '' }
  assert.equal(flash && defaultEffortFor(flash, cfg2), 'high')
  // pro line-up has no medium; high still wins.
  const pro = findEntry({ source: 'discovered', models: cat, discoveredAt: 0 }, 'gemini-3.1-pro')
  assert.equal(pro && defaultEffortFor(pro, cfg2), 'high')
})

test('effort suffix ids still resolve to their base entry', () => {
  const folded = foldEfforts([
    { slug: 'gemini-3-6-flash', label: 'F' },
    { slug: 'gemini-3-6-flash-high', label: 'FH' },
  ])
  const cat = { source: 'discovered' as const, models: folded, discoveredAt: 0 }
  assert.equal(findEntry(cat, 'gemini-3-6-flash')?.id, 'gemini-3-6-flash')
})

test('findEntry resolves aliases via resolveModelSlug', () => {
  const cat = { source: 'fallback' as const, models: buildFallbackCatalog(DEFAULT_FALLBACK_MODELS), discoveredAt: 0 }
  assert.equal(findEntry(cat, 'claude-opus-4-6')?.id, 'claude-opus-4-6-thinking')
  assert.equal(findEntry(cat, 'claude-opus')?.id, 'claude-opus-4-6-thinking')
  assert.equal(findEntry(cat, 'opus')?.id, 'claude-opus-4-6-thinking')
  assert.equal(findEntry(cat, 'sonnet')?.id, 'claude-sonnet-4-6')
  assert.equal(findEntry(cat, 'claude-sonnet')?.id, 'claude-sonnet-4-6')
  assert.equal(findEntry(cat, 'gpt-oss-120b')?.id, 'gpt-oss-120b-medium')
  assert.equal(findEntry(cat, 'gpt-oss')?.id, 'gpt-oss-120b-medium')
})

test('getAntigravityRequestModelId resolves aliases to wire models', () => {
  assert.equal(getAntigravityRequestModelId('sonnet'), 'claude-sonnet-4-6')
  assert.equal(getAntigravityRequestModelId('claude-sonnet'), 'claude-sonnet-4-6')
  assert.equal(getAntigravityRequestModelId('opus'), 'claude-opus-4-6-thinking')
  assert.equal(getAntigravityRequestModelId('claude-opus'), 'claude-opus-4-6-thinking')
  assert.equal(getAntigravityRequestModelId('gpt-oss'), 'gpt-oss-120b-medium')
  assert.equal(getAntigravityRequestModelId('gpt-oss-120b'), 'gpt-oss-120b-medium')
  assert.equal(getAntigravityRequestModelId('gemini-3.7-flash', 'high'), 'gemini-3.7-flash-high')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', 'high'), 'gemini-3.8-flash-high')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', 'medium'), 'gemini-3.8-flash-medium')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', 'low'), 'gemini-3.8-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', 'off'), 'gemini-3.8-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash'), 'gemini-3.8-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash-tiered'), 'gemini-3.8-flash-tiered')
})

test('ModelCatalog with undefined discoverer stays on fallback with no lastError', async () => {
  const catalog = new ModelCatalog(undefined, DEFAULT_FALLBACK_MODELS, 60_000)
  assert.equal(catalog.get().source, 'fallback')
  assert.equal(catalog.get().lastError, undefined)
  assert.ok(catalog.get().models.length > 0)

  await catalog.refreshIfNeeded()
  assert.equal(catalog.get().lastError, undefined)

  const refreshed = await catalog.forceRefresh()
  assert.equal(refreshed.source, 'fallback')
  assert.equal(refreshed.lastError, undefined)
})

test('ModelCatalog with empty discoverer output does not set phantom lastError on fallback', async () => {
  const catalog = new ModelCatalog(
    async () => ({ stdout: '', stderr: '' }),
    DEFAULT_FALLBACK_MODELS,
    60_000,
  )
  assert.equal(catalog.get().source, 'fallback')
  assert.equal(catalog.get().lastError, undefined)

  const refreshed = await catalog.forceRefresh()
  assert.equal(refreshed.source, 'fallback')
  assert.equal(refreshed.lastError, undefined)
})



test('getAntigravityRequestModelId and resolveModelSlug robustness on unknown, uppercase, and versioned model strings', () => {
  // Uppercase & whitespace aliases
  assert.equal(resolveModelSlug('SONNET'), 'claude-sonnet-4-6')
  assert.equal(resolveModelSlug('  sonnet  '), 'claude-sonnet-4-6')
  assert.equal(resolveModelSlug('OPUS'), 'claude-opus-4-6-thinking')
  assert.equal(resolveModelSlug('Claude-Sonnet-4.6'), 'claude-sonnet-4-6')
  assert.equal(resolveModelSlug('claude-opus-4-8'), 'claude-opus-4-6-thinking')
  assert.equal(resolveModelSlug('gpt-oss-20b'), 'gpt-oss-120b-medium')

  // Unknown models passthrough cleanly
  assert.equal(resolveModelSlug('custom-gemini-v1'), 'custom-gemini-v1')
  assert.equal(getAntigravityRequestModelId('custom-gemini-v1'), 'custom-gemini-v1')

  // Uppercase routing
  assert.equal(getAntigravityRequestModelId('SONNET'), 'claude-sonnet-4-6')
  assert.equal(getAntigravityRequestModelId('gemini-3.7-flash', 'HIGH'), 'gemini-3.7-flash-high')
  assert.equal(getAntigravityRequestModelId('gemini-3.7-flash', 'LOW'), 'gemini-3.7-flash-low')

  // Non-standard / invalid effort falls back safely to high/default without throwing
  assert.equal(getAntigravityRequestModelId('gemini-3.7-flash', 'invalid_effort'), 'gemini-3.7-flash-high')
  assert.equal(getAntigravityRequestModelId('gemini-3.7-flash', 'off'), 'gemini-3.7-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.7-flash', ''), 'gemini-3.7-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', 'invalid_effort'), 'gemini-3.8-flash-high')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', 'off'), 'gemini-3.8-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.8-flash', ''), 'gemini-3.8-flash-low')
})

test('getThinkingConfig handles 3.8, future 3.x and preserves legacy budgets', () => {
  assert.deepEqual(getThinkingConfig('gemini-3.8-flash', 'high'), {
    includeThoughts: true,
    thinkingLevel: 'HIGH',
  })
  assert.deepEqual(getThinkingConfig('gemini-3.8-flash', 'medium'), {
    includeThoughts: true,
    thinkingLevel: 'MEDIUM',
  })
  assert.deepEqual(getThinkingConfig('gemini-3.8-flash', 'low'), {
    includeThoughts: true,
    thinkingLevel: 'LOW',
  })
  assert.deepEqual(getThinkingConfig('gemini-3.8-flash'), {
    includeThoughts: true,
    thinkingLevel: 'LOW',
  })
  // Generalized future 3.x prefix
  assert.deepEqual(getThinkingConfig('gemini-3.9-flash', 'high'), {
    includeThoughts: true,
    thinkingLevel: 'HIGH',
  })
  // Preserved 3.5 & 3.1 budget behavior
  assert.deepEqual(getThinkingConfig('gemini-3.5-flash', 'high'), {
    includeThoughts: true,
    thinkingBudget: 10_000,
  })
  assert.deepEqual(getThinkingConfig('gemini-3.1-pro', 'high'), {
    includeThoughts: true,
    thinkingBudget: 10_001,
  })
  // Claude / other non-gemini returns undefined
  assert.equal(getThinkingConfig('claude-sonnet-4-6'), undefined)
})

test('resolveModel preserves 3.8 efforts, context window and max output tokens', async () => {
  const catalog = new ModelCatalog(undefined, DEFAULT_FALLBACK_MODELS, 60_000)
  const adapter = new AgyAdapter({
    getConfig: () => defaultConfig(),
    catalog,
  })

  const resolved = await adapter.resolveModel('antigravity', 'gemini-3.8-flash')
  assert.equal(resolved.provider, 'antigravity')
  assert.equal(resolved.id, 'gemini-3.8-flash')
  assert.equal(resolved.name, 'Gemini 3.8 Flash')
  assert.equal(resolved.context?.contextWindow, 1_048_576)
  assert.equal(resolved.defaultMaxTokens, 65536)
  assert.deepEqual(
    resolved.reasoning?.efforts?.map((e) => e.name),
    ['low', 'medium', 'high'],
  )
  assert.equal(resolved.reasoning?.defaultEffort, 'high')
})

test('ModelCatalog discovers models from CloudCode DiscoveredModelsResponse and merges with fallback', async () => {
  let callCount = 0
  const mockDiscover = async () => {
    callCount++
    return {
      models: {
        'gemini-3.8-flash-tiered': {
          displayName: 'Gemini 3.8 Flash (Tiered)',
          quotaInfo: { remainingFraction: 1, resetTime: '2026-04-10T12:00:00Z' },
        },
        'gemini-3.7-flash-tiered': {
          displayName: 'Gemini 3.7 Flash (Tiered)',
          quotaInfo: { remainingFraction: 0.8 },
        },
        'gemini-3.9-flash-tiered': {
          displayName: 'Gemini 3.9 Flash (Tiered)',
          quotaInfo: { remainingFraction: 1 },
        },
      },
    }
  }

  const catalog = new ModelCatalog(mockDiscover, DEFAULT_FALLBACK_MODELS, 60_000)
  assert.equal(catalog.get().source, 'fallback')

  await catalog.refreshIfNeeded()
  assert.equal(callCount, 1)
  const cat = catalog.get()
  assert.equal(cat.source, 'discovered')
  assert.equal(cat.lastError, undefined)

  // Discovered models are present with folded IDs & inferred efforts
  const ids = cat.models.map((m) => m.id)
  assert.ok(ids.includes('gemini-3.8-flash'), 'gemini-3.8-flash present')
  assert.ok(ids.includes('gemini-3.7-flash'), 'gemini-3.7-flash present')
  assert.ok(ids.includes('gemini-3.9-flash'), 'gemini-3.9-flash present')

  const f38 = cat.models.find((m) => m.id === 'gemini-3.8-flash')
  assert.equal(f38?.name, 'Gemini 3.8 Flash')
  assert.deepEqual(f38?.efforts, ['low', 'medium', 'high'])

  const f39 = cat.models.find((m) => m.id === 'gemini-3.9-flash')
  assert.equal(f39?.name, 'Gemini 3.9 Flash')
  assert.deepEqual(f39?.efforts, ['low', 'medium', 'high'])

  // Fallback models not returned by discovery (Claude, GPT-OSS) are merged
  assert.ok(ids.includes('claude-sonnet-4-6'), 'claude-sonnet-4-6 merged from fallback')
  assert.ok(ids.includes('claude-opus-4-6-thinking'), 'claude-opus merged from fallback')
  assert.ok(ids.includes('gpt-oss-120b-medium'), 'gpt-oss merged from fallback')

  // No duplicate IDs
  assert.equal(new Set(ids).size, ids.length, 'all catalog IDs must be unique')

  // TTL: second refresh within TTL does not invoke discover
  await catalog.refreshIfNeeded()
  assert.equal(callCount, 1, 'TTL cache prevents redundant API calls')

  // forceRefresh bypasses TTL
  await catalog.forceRefresh()
  assert.equal(callCount, 2, 'forceRefresh triggers discover')
})

test('ModelCatalog gracefully handles discover returning null or throwing error', async () => {
  // 1. Discover returns null (e.g. not logged in)
  const nullCatalog = new ModelCatalog(async () => null, DEFAULT_FALLBACK_MODELS, 60_000)
  await nullCatalog.refreshIfNeeded()
  assert.equal(nullCatalog.get().source, 'fallback')
  assert.equal(nullCatalog.get().lastError, undefined)
  assert.equal(nullCatalog.get().models.length, DEFAULT_FALLBACK_MODELS.length)

  // 2. Discover throws error (e.g. network failure)
  const errorCatalog = new ModelCatalog(
    async () => {
      throw new Error('Network timeout')
    },
    DEFAULT_FALLBACK_MODELS,
    60_000,
  )
  await errorCatalog.refreshIfNeeded()
  assert.equal(errorCatalog.get().source, 'fallback')
  assert.equal(errorCatalog.get().lastError, 'Network timeout')
  assert.equal(errorCatalog.get().models.length, DEFAULT_FALLBACK_MODELS.length)
})

test('AgyAdapter listModels and resolveModel with dynamic discovery', async () => {
  const mockDiscover = async () => ({
    models: {
      'gemini-3.9-flash-tiered': {
        displayName: 'Gemini 3.9 Flash (Tiered)',
      },
      'gemini-3.1-pro-tiered': {
        displayName: 'Gemini 3.1 Pro (Tiered)',
      },
    },
  })

  const catalog = new ModelCatalog(mockDiscover, DEFAULT_FALLBACK_MODELS, 60_000)
  const adapter = new AgyAdapter({
    getConfig: () => defaultConfig(),
    catalog,
  })

  const models = await adapter.listModels('antigravity')
  assert.ok(models.some((m) => m.id === 'gemini-3.9-flash'))
  assert.ok(models.some((m) => m.id === 'claude-sonnet-4-6'))

  // Resolve dynamic gemini-3.9-flash
  const resolved39 = await adapter.resolveModel('antigravity', 'gemini-3.9-flash')
  assert.equal(resolved39.id, 'gemini-3.9-flash')
  assert.equal(resolved39.name, 'Gemini 3.9 Flash')
  assert.equal(resolved39.context?.contextWindow, 1_048_576)
  assert.equal(resolved39.defaultMaxTokens, 65536)
  assert.deepEqual(
    resolved39.reasoning?.efforts?.map((e) => e.name),
    ['low', 'medium', 'high'],
  )

  // Resolve dynamic gemini-3.1-pro
  const resolvedPro = await adapter.resolveModel('antigravity', 'gemini-3.1-pro')
  assert.deepEqual(
    resolvedPro.reasoning?.efforts?.map((e) => e.name),
    ['low', 'high'],
  )

  // Dynamic routing for 3.9
  assert.equal(getAntigravityRequestModelId('gemini-3.9-flash', 'high'), 'gemini-3.9-flash-high')
  assert.equal(getAntigravityRequestModelId('gemini-3.9-flash', 'low'), 'gemini-3.9-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.9-flash', 'off'), 'gemini-3.9-flash-low')
  assert.equal(getAntigravityRequestModelId('gemini-3.9-flash'), 'gemini-3.9-flash-low')

  // findEntry handles -tiered query
  const entry = findEntry(catalog.get(), 'gemini-3.9-flash-tiered')
  assert.equal(entry?.id, 'gemini-3.9-flash')
})


