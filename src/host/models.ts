// Model discovery and projection (spec ADR-10): agy models output ->
// DSH catalog entries. Gemini slugs fold into a base model plus selectable
// reasoning efforts; non-Gemini slugs (claude-*, gpt-oss-* size variants)
// stay verbatim with no effort toggle, matching observed agy behavior
// (agy rejects --effort for Claude/GPT-OSS). Discovery failure falls back to
// a bundled catalog so the /model picker is never empty.
import { DEFAULT_FALLBACK_MODELS, type FallbackModelDef, type PluginConfig } from '../common/types.ts'

export interface RawModel { slug: string; label: string }

export interface DiscoveredModelEntry {
  quotaInfo?: {
    remainingFraction?: number
    resetTime?: string
  }
  displayName?: string
  modelName?: string
}

export interface DiscoveredModelsResponse {
  models?: Record<string, DiscoveredModelEntry>
}

export interface CatalogEntry {
  id: string
  name: string
  /** null = fixed-thinking model (no effort flag). */
  efforts: readonly string[] | null
}

export interface Catalog {
  source: 'discovered' | 'fallback'
  models: readonly CatalogEntry[]
  discoveredAt: number
  /** Last discovery error, surfaced by /agy models and doctor. */
  lastError?: string
}

/** Parse `agy models` stdout: JSON shapes first, then two-column text. */
export function parseModelsOutput(stdout: string): RawModel[] {
  const text = stdout.trim()
  if (text === '') return []
  try {
    const parsed: unknown = JSON.parse(text)
    const list = extractModelList(parsed)
    if (list) return dedupeBySlug(list)
  } catch {
    // fall through to text parsing
  }
  const out: RawModel[] = []
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('Fetching') || t.startsWith('Error') || /^(please sign in|warning|tip:)/i.test(t)) continue
    // agy 1.1.15 prints a TAB-separated two-column table; older builds and
    // some locales use two-or-more spaces.
    const m = t.match(/^(\S+)(?:\t+|\s{2,})(.+)$/)
    if (m && m[1] !== undefined && m[2] !== undefined) out.push({ slug: m[1], label: m[2].trim() });
    else if (/^\S+$/.test(t)) out.push({ slug: t, label: t });
  }
  return dedupeBySlug(out);
}

/** First occurrence wins: duplicate raw slugs would become duplicate catalog ids. */
function dedupeBySlug(raw: readonly RawModel[]): RawModel[] {
  const seen = new Set<string>()
  const out: RawModel[] = []
  for (const r of raw) {
    if (!r.slug || typeof r.slug !== 'string') continue
    const slug = r.slug.trim()
    if (slug === '' || seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, label: (typeof r.label === 'string' && r.label.trim() !== '') ? r.label.trim() : slug })
  }
  return out
}

function extractModelList(parsed: unknown): RawModel[] | null {
  let arr: unknown[] | null = null;
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    if (o.models && typeof o.models === 'object' && !Array.isArray(o.models)) {
      const out: RawModel[] = []
      for (const [key, val] of Object.entries(o.models as Record<string, unknown>)) {
        if (!key || typeof key !== 'string') continue
        const v = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>
        const label =
          (typeof v.displayName === 'string' && v.displayName.trim() !== '') ? v.displayName.trim()
          : (typeof v.display_name === 'string' && v.display_name.trim() !== '') ? v.display_name.trim()
          : (typeof v.modelName === 'string' && v.modelName.trim() !== '') ? v.modelName.trim()
          : (typeof v.name === 'string' && v.name.trim() !== '') ? v.name.trim()
          : key
        out.push({ slug: key.trim(), label })
      }
      return out
    }
    for (const k of ['models', 'items', 'data', 'result']) {
      if (Array.isArray(o[k])) {
        arr = o[k] as unknown[];
        break;
      }
    }
  }
  if (!arr) return null;
  const out: RawModel[] = []
  for (const item of arr) {
    if (typeof item === 'string') {
      out.push({ slug: item, label: item });
      continue;
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const slugV = o.slug ?? o.id ?? o.name ?? o.model;
    const labelV = o.label ?? o.display_name ?? o.displayName ?? o.title ?? slugV;
    if (typeof slugV === 'string' && slugV !== '') {
      out.push({ slug: slugV, label: typeof labelV === 'string' ? labelV : slugV });
    }
  }
  return out;
}

const EFFORT_SUFFIXES = ['low', 'medium', 'high']

export function deriveEffortsForModel(modelId: string): string[] | null {
  const id = modelId.toLowerCase()
  if (id === 'gemini-3.1-pro' || id.startsWith('gemini-3.1-pro')) {
    return ['low', 'high']
  }
  if (id.startsWith('gemini-3.')) {
    return ['low', 'medium', 'high']
  }
  return null
}

function stripTieredLabel(label: string): string {
  return label.replace(/\s*\((?:Tiered|tiered)\)\s*$/i, '').replace(/\s+(?:Tiered|tiered)\s*$/i, '').trim()
}

/** Fold Gemini effort variants into base + effort set (spec ADR-10). */
export function foldEfforts(raw: readonly RawModel[]): CatalogEntry[] {
  const bases = new Map<string, { label: string; efforts: Set<string> }>()
  const verbatim: CatalogEntry[] = []
  const slugSet = new Set(raw.map((r) => r.slug))
  for (const r of raw) {
    if (!r.slug.startsWith('gemini')) {
      verbatim.push({ id: r.slug, name: r.label, efforts: null });
      continue;
    }

    if (r.slug.endsWith('-tiered')) {
      const base = r.slug.slice(0, -7)
      const inferredEfforts = deriveEffortsForModel(base)
      const cleanLabel = stripTieredLabel(r.label)
      const entry = bases.get(base) ?? {
        label: cleanLabel !== '' ? cleanLabel : base,
        efforts: new Set<string>(),
      }
      if (inferredEfforts) {
        for (const eff of inferredEfforts) entry.efforts.add(eff)
      }
      bases.set(base, entry)
      continue
    }

    let folded = false
    for (const eff of EFFORT_SUFFIXES) {
      const suffix = '-' + eff;
      if (r.slug.endsWith(suffix)) {
        const base = r.slug.slice(0, -suffix.length)
        // Only fold when the base is a real catalog member (either listed
        // bare or via another variant); gpt-oss-120b-medium never reaches here
        // (not gemini), but a lone gemini-x-medium with no siblings stays
        // verbatim rather than inventing a base.
        const hasBare = slugSet.has(base)
        const hasSibling = raw.some(
          (x) => x.slug.startsWith(base + '-') && EFFORT_SUFFIXES.some((e) => x.slug.endsWith('-' + e)) && x.slug !== r.slug,
        );
        if (hasBare || hasSibling) {
        const entry = bases.get(base) ?? { label: stripEffortLabel(r.label, eff), efforts: new Set<string>() };
          entry.efforts.add(eff)
          bases.set(base, entry)
          folded = true;
          break;
        }
      }
    }
    if (!folded) verbatim.push({ id: r.slug, name: r.label, efforts: null });
  }
  const folded: CatalogEntry[] = []
  for (const [id, v] of bases) {
    const efforts = EFFORT_SUFFIXES.filter((e) => v.efforts.has(e));
    folded.push({ id, name: v.label !== '' ? v.label : id, efforts: efforts.length > 0 ? efforts : null });
  }
  // Folded bases first, then verbatim, both stable by original order.
  const rawOrder = new Map(raw.map((r, i) => [r.slug, i] as const))
  const rank = (e: CatalogEntry): number => {
    let best = Infinity;
    for (const r of raw) if (r.slug === e.id || r.slug.startsWith(e.id + '-')) best = Math.min(best, rawOrder.get(r.slug) ?? Infinity)
    return best;
  };
  folded.sort((a, b) => rank(a) - rank(b));
  verbatim.sort((a, b) => rank(a) - rank(b));
  // A bare base listed alongside its variants (agy 1.1.13 shape) is already
  // represented by its folded entry; emitting it verbatim too would duplicate
  // the id and DSH's llm.listModels would reject the whole provider catalog
  // (INVALID_CATALOG), dropping every Antigravity model from the picker.
  return [...folded, ...verbatim.filter((e) => !bases.has(e.id))];
}

function stripEffortLabel(label: string, eff: string): string {
  const re = new RegExp('\\s*\\(?'+ eff +'\\)?\\s*$', 'i')
  return label.replace(re, '').trim()
}

export function buildFallbackCatalog(defs: readonly FallbackModelDef[]): CatalogEntry[] {
  return defs
    .filter((d) => Boolean(d && typeof d.id === 'string' && d.id.trim() !== ''))
    .map((d) => ({
      id: d.id.trim(),
      name: (typeof d.name === 'string' && d.name.trim() !== '') ? d.name.trim() : d.id.trim(),
      efforts: Array.isArray(d.efforts) && d.efforts.length > 0 ? d.efforts.filter((e) => typeof e === 'string' && e.trim() !== '') : null,
    }));
}

// ---------------------------------------------------------------------------
// Catalog cache with TTL + stale-while-revalidate (pi-bridge pattern).

export type DiscoverResult =
  | DiscoveredModelsResponse
  | RawModel[]
  | { stdout: string; stderr?: string }
  | null
  | undefined

export type DiscoverFn = (signal?: AbortSignal) => Promise<DiscoverResult>

export function mergeDiscoveredWithFallback(
  discovered: readonly CatalogEntry[],
  fallbackDefs: readonly FallbackModelDef[] = DEFAULT_FALLBACK_MODELS,
): CatalogEntry[] {
  const fallbackEntries = buildFallbackCatalog(fallbackDefs)
  if (discovered.length === 0) return fallbackEntries

  const existingIds = new Set<string>()
  for (const e of discovered) {
    existingIds.add(e.id.toLowerCase())
    const resolved = resolveModelSlug(e.id).toLowerCase()
    existingIds.add(resolved)
  }

  const result = [...discovered]
  for (const fb of fallbackEntries) {
    const fbId = fb.id.toLowerCase()
    const resolvedFbId = resolveModelSlug(fb.id).toLowerCase()
    if (!existingIds.has(fbId) && !existingIds.has(resolvedFbId)) {
      result.push(fb)
      existingIds.add(fbId)
      existingIds.add(resolvedFbId)
    }
  }
  return result
}

export class ModelCatalog {
  private current: Catalog;
  private refreshing: Promise<void> | null = null;
  private readonly discover?: DiscoverFn;
  private readonly fallbackDefs: readonly FallbackModelDef[];
  private readonly ttlMs: number;

  constructor(
    discover?: DiscoverFn,
    fallbackDefs: readonly FallbackModelDef[] = DEFAULT_FALLBACK_MODELS,
    ttlMs: number = 300_000,
  ) {
    this.discover = discover;
    this.fallbackDefs = fallbackDefs;
    this.ttlMs = ttlMs;
    this.current = {
      source: 'fallback',
      models: buildFallbackCatalog(fallbackDefs),
      discoveredAt: 0,
    };
  }

  get(): Catalog {
    return this.current;
  }

  /** Refresh if stale; never throws — failures keep the previous catalog. */
  async refreshIfNeeded(): Promise<void> {
    if (!this.discover) return;
    if (this.refreshing) return this.refreshing;
    const age = Date.now() - this.current.discoveredAt;
    if (this.current.source === 'discovered' && age < this.ttlMs) return;
    this.refreshing = this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async forceRefresh(): Promise<Catalog> {
    if (!this.discover) return this.current;
    await this.refresh();
    return this.current;
  }

  private async refresh(): Promise<void> {
    if (!this.discover) return;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30_000);
      try {
        const res = await this.discover(ac.signal);
        if (res == null) {
          if (this.current.source === 'fallback') {
            const { lastError: _, ...rest } = this.current;
            this.current = rest;
          }
          return;
        }

        let raw: RawModel[] = []
        if (typeof res === 'object' && 'stdout' in res && typeof res.stdout === 'string') {
          raw = parseModelsOutput(res.stdout);
        } else if (Array.isArray(res)) {
          raw = dedupeBySlug(res);
        } else if (typeof res === 'object' && 'models' in res) {
          const list = extractModelList(res);
          if (list) raw = dedupeBySlug(list);
        }

        if (raw.length > 0) {
          const folded = foldEfforts(raw);
          const merged = mergeDiscoveredWithFallback(folded, this.fallbackDefs);
          this.current = { source: 'discovered', models: merged, discoveredAt: Date.now() };
          return;
        }
        if (this.current.source === 'fallback') {
          const { lastError: _, ...rest } = this.current;
          this.current = rest;
          return;
        }
        this.current = { ...this.current, lastError: 'models discovery returned no entries' };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      this.current = { ...this.current, lastError: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function resolveModelSlug(id: string): string {
  const s = id.trim().toLowerCase()
  if (
    s === 'claude-opus-4-6' ||
    s === 'claude-opus-4-8' ||
    s === 'claude-opus' ||
    s === 'claude-opus-4.6' ||
    s === 'claude-opus-4-5' ||
    s === 'opus'
  ) {
    return 'claude-opus-4-6-thinking'
  }
  if (
    s === 'claude-sonnet' ||
    s === 'claude-sonnet-4.6' ||
    s === 'claude-sonnet-4-5' ||
    s === 'sonnet'
  ) {
    return 'claude-sonnet-4-6'
  }
  if (s === 'gpt-oss-120b' || s === 'gpt-oss-20b' || s === 'gpt-oss') {
    return 'gpt-oss-120b-medium'
  }
  return id.trim()
}

export function findEntry(catalog: Catalog, id: string): CatalogEntry | undefined {
  const direct = catalog.models.find((m) => m.id === id);
  if (direct) return direct;
  const resolved = resolveModelSlug(id);
  if (resolved !== id) {
    const directResolved = catalog.models.find((m) => m.id === resolved);
    if (directResolved) return directResolved;
  }
  if (id.endsWith('-tiered')) {
    const base = id.slice(0, -7);
    const baseEntry = catalog.models.find((m) => m.id === base);
    if (baseEntry) return baseEntry;
  }
  return undefined;
}

export function defaultEffortFor(entry: CatalogEntry, cfg: PluginConfig): string | undefined {
  if (!entry.efforts || entry.efforts.length === 0) return undefined
  if (cfg.defaultEffort !== '' && entry.efforts.includes(cfg.defaultEffort)) return cfg.defaultEffort
  // Default to the highest reasoning effort (high), then fall back down.
  for (const pref of ['high', 'medium', 'low']) {
    if (entry.efforts.includes(pref)) return pref
  }
  return entry.efforts[entry.efforts.length - 1];
}

export const ANTIGRAVITY_MODEL_ENUM: Record<string, string> = {
  'gemini-3.5-flash-extra-low': 'MODEL_PLACEHOLDER_M187',
  'gemini-3.5-flash-low': 'MODEL_PLACEHOLDER_M20',
  'gemini-3-flash-agent': 'MODEL_PLACEHOLDER_M132',
  'gemini-3.1-pro-low': 'MODEL_PLACEHOLDER_M36',
  'gemini-pro-agent': 'MODEL_PLACEHOLDER_M16',
}

export interface AntigravityRouting {
  off?: string
  routing?: Partial<Record<'minimal' | 'low' | 'medium' | 'high' | 'xhigh', string>>
  defaultRequestId?: string
}

export const ANTIGRAVITY_ROUTING: Record<string, AntigravityRouting> = {
  'claude-opus-4-6': {
    routing: {
      minimal: 'claude-opus-4-6-thinking',
      low: 'claude-opus-4-6-thinking',
      medium: 'claude-opus-4-6-thinking',
      high: 'claude-opus-4-6-thinking',
    },
    defaultRequestId: 'claude-opus-4-6-thinking',
  },
  'claude-sonnet-4-6': {
    off: 'claude-sonnet-4-6',
    routing: {
      minimal: 'claude-sonnet-4-6',
      low: 'claude-sonnet-4-6',
      medium: 'claude-sonnet-4-6',
      high: 'claude-sonnet-4-6',
      xhigh: 'claude-sonnet-4-6',
    },
    defaultRequestId: 'claude-sonnet-4-6',
  },
  'gemini-3.1-pro': {
    off: 'gemini-3.1-pro-low',
    routing: {
      minimal: 'gemini-3.1-pro-low',
      low: 'gemini-3.1-pro-low',
      medium: 'gemini-3.1-pro-low',
      high: 'gemini-pro-agent',
      xhigh: 'gemini-pro-agent',
    },
    defaultRequestId: 'gemini-3.1-pro-low',
  },
  'gemini-3.8-flash': {
    off: 'gemini-3.8-flash-low',
    routing: {
      minimal: 'gemini-3.8-flash-low',
      low: 'gemini-3.8-flash-low',
      medium: 'gemini-3.8-flash-medium',
      high: 'gemini-3.8-flash-high',
      xhigh: 'gemini-3.8-flash-high',
    },
    defaultRequestId: 'gemini-3.8-flash-low',
  },
  'gemini-3.7-flash': {
    off: 'gemini-3.7-flash-low',
    routing: {
      minimal: 'gemini-3.7-flash-low',
      low: 'gemini-3.7-flash-low',
      medium: 'gemini-3.7-flash-medium',
      high: 'gemini-3.7-flash-high',
      xhigh: 'gemini-3.7-flash-high',
    },
    defaultRequestId: 'gemini-3.7-flash-low',
  },
  'gemini-3.6-flash': {
    off: 'gemini-3.6-flash-low',
    routing: {
      minimal: 'gemini-3.6-flash-low',
      low: 'gemini-3.6-flash-low',
      medium: 'gemini-3.6-flash-medium',
      high: 'gemini-3.6-flash-high',
      xhigh: 'gemini-3.6-flash-high',
    },
    defaultRequestId: 'gemini-3.6-flash-low',
  },
  'gemini-3.5-flash': {
    off: 'gemini-3.5-flash-extra-low',
    routing: {
      minimal: 'gemini-3.5-flash-extra-low',
      low: 'gemini-3.5-flash-extra-low',
      medium: 'gemini-3.5-flash-low',
      high: 'gemini-3-flash-agent',
      xhigh: 'gemini-3-flash-agent',
    },
    defaultRequestId: 'gemini-3.5-flash-extra-low',
  },
  'gpt-oss-120b': {
    off: 'gpt-oss-120b-medium',
    routing: {
      minimal: 'gpt-oss-120b-medium',
      low: 'gpt-oss-120b-medium',
      medium: 'gpt-oss-120b-medium',
      high: 'gpt-oss-120b-medium',
    },
    defaultRequestId: 'gpt-oss-120b-medium',
  },
}

export const RUNTIME_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'gemini-3.8-flash': 65536,
  'gemini-3.8-flash-tiered': 65536,
  'gemini-3.8-flash-low': 65536,
  'gemini-3.8-flash-medium': 65536,
  'gemini-3.8-flash-high': 65536,
  'gemini-3.7-flash': 65536,
  'gemini-3.7-flash-tiered': 65536,
  'gemini-3.7-flash-low': 65536,
  'gemini-3.7-flash-medium': 65536,
  'gemini-3.7-flash-high': 65536,
  'gemini-3.6-flash': 65536,
  'gemini-3.6-flash-low': 65536,
  'gemini-3.6-flash-medium': 65536,
  'gemini-3.6-flash-high': 65536,
  'gemini-3.5-flash': 65536,
  'gemini-3.5-flash-extra-low': 65536,
  'gemini-3.5-flash-low': 65536,
  'gemini-3-flash-agent': 65536,
  'gemini-3.1-pro': 65535,
  'gemini-3.1-pro-low': 65535,
  'gemini-3.1-pro-high': 65535,
  'gemini-pro-agent': 65535,
  'claude-opus-4-6': 64000,
  'claude-opus-4-6-thinking': 64000,
  'claude-sonnet-4-6': 64000,
  'gpt-oss-120b': 32768,
  'gpt-oss-120b-medium': 32768,
}

export function getMaxOutputTokens(modelId: string, runtimeModel?: string): number {
  if (runtimeModel && RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel]!
  }
  if (RUNTIME_MAX_OUTPUT_TOKENS[modelId] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[modelId]!
  }
  if (runtimeModel) {
    if (runtimeModel.startsWith('claude-')) return 64000
    if (runtimeModel.startsWith('gpt-oss-')) return 32768
    if (runtimeModel.startsWith('gemini-3.1-pro') || runtimeModel === 'gemini-pro-agent') return 65535
    if (runtimeModel.startsWith('gemini-')) return 65536
  }
  return 8192
}

export function getAntigravityRequestModelId(modelId: string, effort?: string): string {
  const resolvedId = resolveModelSlug(modelId)
  const r = ANTIGRAVITY_ROUTING[resolvedId] ?? ANTIGRAVITY_ROUTING[modelId]
  if (!r) {
    const isWireModel =
      resolvedId.endsWith('-low') ||
      resolvedId.endsWith('-medium') ||
      resolvedId.endsWith('-high') ||
      resolvedId.endsWith('-tiered') ||
      resolvedId.endsWith('-extra-low') ||
      resolvedId.endsWith('-thinking')
    if (resolvedId.startsWith('gemini-3.') && !isWireModel) {
      if (effort && effort !== 'off' && ['low', 'medium', 'high', 'xhigh'].includes(effort.toLowerCase())) {
        const eff = effort.toLowerCase() === 'xhigh' ? 'high' : effort.toLowerCase()
        return `${resolvedId}-${eff}`
      }
      return `${resolvedId}-low`
    }
    return resolvedId
  }

  if (effort === undefined || effort === 'off' || effort === '') {
    return r.off ?? r.routing?.minimal ?? r.routing?.low ?? r.defaultRequestId ?? resolvedId
  }

  const effortKey = effort.toLowerCase() as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  return (
    r.routing?.[effortKey] ??
    r.routing?.high ??
    r.routing?.low ??
    r.routing?.minimal ??
    r.off ??
    r.defaultRequestId ??
    resolvedId
  )
}

export function getFallbackRuntimeModel(runtimeModel: string, effort?: string): string | undefined {
  if (runtimeModel === 'gemini-3.8-flash-tiered') {
    return getAntigravityRequestModelId('gemini-3.7-flash', effort)
  }
  if (runtimeModel.startsWith('gemini-3.8-flash-')) {
    return runtimeModel.replace('gemini-3.8-flash-', 'gemini-3.7-flash-')
  }
  if (runtimeModel === 'gemini-3.8-flash') {
    return 'gemini-3.7-flash-low'
  }
  if (runtimeModel === 'gemini-3.7-flash-tiered') {
    return getAntigravityRequestModelId('gemini-3.6-flash', effort)
  }
  if (runtimeModel.startsWith('gemini-3.7-flash-')) {
    return runtimeModel.replace('gemini-3.7-flash-', 'gemini-3.6-flash-')
  }
  if (runtimeModel === 'gemini-3.7-flash') {
    return 'gemini-3.6-flash-low'
  }
  return undefined
}

export type GeminiThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'

export interface ThinkingWire {
  includeThoughts?: boolean
  thinkingLevel?: GeminiThinkingLevel
  thinkingBudget?: number
}

function googleLevel(effort: string | undefined): GeminiThinkingLevel {
  if (effort === 'high' || effort === 'xhigh') return 'HIGH'
  if (effort === 'medium') return 'MEDIUM'
  return 'LOW'
}

export function getThinkingConfig(modelId: string, effort?: string): ThinkingWire | undefined {
  if (
    modelId === 'gemini-3.8-flash' ||
    modelId === 'gemini-3.7-flash' ||
    modelId === 'gemini-3.6-flash' ||
    (modelId.startsWith('gemini-3.') &&
      !modelId.startsWith('gemini-3.5') &&
      !modelId.startsWith('gemini-3.1'))
  ) {
    return { includeThoughts: true, thinkingLevel: googleLevel(effort) }
  }
  if (modelId === 'gemini-3.5-flash') {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 }
    const thinkingBudget =
      effort === 'high' || effort === 'xhigh' ? 10_000 : effort === 'medium' ? 4_000 : 1_000
    return { includeThoughts: true, thinkingBudget }
  }
  if (modelId === 'gemini-3.1-pro') {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 }
    return {
      includeThoughts: true,
      thinkingBudget: effort === 'high' || effort === 'xhigh' ? 10_001 : 1_001,
    }
  }
  return undefined
}


