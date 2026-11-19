// Why the model picker offered 13 ids while the pool's own persisted model lists contain 35.
//
// `QuotaService.discoverAvailableModels` used to merge only the accounts that answered *this
// round*, and `ModelCatalog.refresh()` replaced the whole catalog with that snapshot. One account
// timing out therefore deleted every model only that account serves. The catalog is now the union
// over every usable account's last-known model list, and an id leaves only when an account that
// *answered* stopped listing it.
//
// These tests pin: the union, its per-account provenance, the failure semantics (transient failure
// never removes), the successful-refresh removal rule, routability + `MODEL_NOT_AVAILABLE`,
// effort folding across accounts, the TTL behaviour, and the untouched 429 / entitlement semantics.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountPoolManager, modelEntitlementOf } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'
import {
  ModelCatalog,
  mergeDiscoveredWithFallback,
  type Catalog,
  type CatalogEntry,
  type ModelUnionSnapshot,
} from '../src/host/models.ts'
import { AgyAdapter, classifyPoolFailure, type AttemptFailure } from '../src/host/adapter.ts'
import { DEFAULT_FALLBACK_MODELS, defaultConfig } from '../src/common/types.ts'
import { modelFamilyOf } from '../src/common/pool-types.ts'
import type { DiscoveredModelsResponse, FamilyQuotaInfo, ManagedAccount, ModelFamily } from '../src/common/pool-types.ts'

// Two effort variants of one base: they fold into a single selectable model.
const NEON_LOW = 'gemini-4-neon-low'
const NEON_HIGH = 'gemini-4-neon-high'
const NEON = 'gemini-4-neon'
// A variant nothing else lists a sibling for: it stays selectable exactly as it is.
const SOLO = 'gemini-4-cobalt-xhigh'
// Served by both accounts, so its provenance must name two owners.
const SHARED = 'claude-sonnet-5-5-low'
const HYDRO_BASE = 'gemini-4-hydrogen'

// The pool under test must not inherit a token from the ambient environment: that would send
// discovery down the single-token path instead of the pool path. This file's process is its own,
// so nothing has to be restored.
delete process.env.ANTIGRAVITY_TOKEN

function freshPool(tag: string): AccountPoolManager {
  const pool = new AccountPoolManager(mkdtempSync(join(tmpdir(), `ccl-catalog-union-${tag}-`)))
  // Drop the bootstrapped accounts so the pool is exactly the one under test.
  for (const acc of pool.getAccounts()) pool.deleteAccount(acc.id)
  return pool
}

/**
 * Build a pool of exactly `aliases.length` accounts and hand back their ids positionally, so a
 * test that names three accounts is checked against a pool that only has two.
 */
function makePool<const T extends readonly string[]>(
  tag: string,
  aliases: T,
): { pool: AccountPoolManager; ids: { [K in keyof T]: string } } {
  const pool = freshPool(tag)
  const created = aliases.map((alias) => pool.createAccountSlot(alias).id)
  const ids = created as { [K in keyof T]: string }
  pool.setPrimaryAccount(created[0]!)
  for (const id of created) pool.setMemoryToken(id, `tok-${id}`, Date.now() + 60_000)
  return { pool, ids }
}

/**
 * Simulate what past quota refreshes left in pool.json: the per-family model breakdown
 * `updateAccountQuotas` persists and `accountModelRoster` seeds a last-known list from.
 */
function persistModelList(pool: AccountPoolManager, accountId: string, modelIds: readonly string[]): void {
  const quotas: Partial<Record<ModelFamily, FamilyQuotaInfo>> = {}
  for (const modelId of modelIds) {
    const family = modelFamilyOf(modelId)
    const prev = quotas[family]
    quotas[family] = {
      ...(prev ?? { remainingFraction: 0.9, updatedAt: Date.now() }),
      models: [...(prev?.models ?? []), { modelId, remainingFraction: 0.9 }],
    }
  }
  pool.updateAccountQuotas(accountId, quotas)
}

/** QuotaService with the credential + model-endpoint seams replaced; a token maps to a payload. */
class ScriptedQuota extends QuotaService {
  script: Record<string, ScriptEntry>
  /** How many times an account was actually asked for its model list. */
  tokensRequested: string[] = []

  constructor(pool: AccountPoolManager, script: Record<string, ScriptEntry>) {
    super(pool)
    this.script = script
  }

  get probeCount(): number {
    return this.tokensRequested.length
  }

  /** Catalog wired to this service: discovery when the TTL expires, local union fold inside it. */
  catalog(ttlMs = 300_000, withUnionSource = true): ModelCatalog {
    return new ModelCatalog(
      () => this.discoverAvailableModels(),
      DEFAULT_FALLBACK_MODELS,
      ttlMs,
      withUnionSource ? () => this.composeAvailableModels() : undefined,
    )
  }

  override async getValidAccessToken(account: ManagedAccount): Promise<string | null> {
    const token = `tok-${account.id}`
    this.tokensRequested.push(token)
    return token
  }

  override async fetchAvailableModels(accessToken: string) {
    const behaviour = this.script[accessToken]
    if (behaviour === undefined || behaviour === 'empty') return null
    if (behaviour === 'throw') throw new Error('upstream 500 for a pooled account')
    if ('hangMs' in behaviour) {
      await new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('account never answers before its budget')), behaviour.hangMs)
        timer.unref()
      })
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    return behaviour
  }
}

type ScriptEntry = DiscoveredModelsResponse | 'throw' | 'empty' | { hangMs: number }

function answered(models: Record<string, { displayName?: string; remainingFraction?: number }>): DiscoveredModelsResponse {
  return {
    models: Object.fromEntries(
      Object.entries(models).map(([modelId, info]) => [
        modelId,
        {
          ...(info.displayName ? { displayName: info.displayName } : {}),
          ...(info.remainingFraction !== undefined ? { quotaInfo: { remainingFraction: info.remainingFraction } } : {}),
        },
      ]),
    ),
  }
}

function catalogIds(cat: Catalog): string[] {
  return cat.models.map((m) => m.id)
}

function entryOf(cat: Catalog, id: string): CatalogEntry {
  const found = cat.models.find((m) => m.id === id)
  assert.ok(found, `catalog entry '${id}' missing from ${JSON.stringify(catalogIds(cat))}`)
  return found
}

function ownersOf(cat: Catalog, id: string): readonly string[] {
  assert.ok(cat.providers, `catalog carries no per-account provenance for '${id}'`)
  return cat.providers[id] ?? []
}

function effortsOf(cat: Catalog, id: string): string[] {
  return [...(entryOf(cat, id).efforts ?? [])].sort()
}

// ---------------------------------------------------------------------------
// 1. The catalog is a cross-account union, with provenance.

test('catalog is the union of every usable account model list, not a snapshot of who answered', async () => {
  const { pool, ids } = makePool('union', ['primary-acc', 'secondary-acc'])
  const [primary, secondary] = ids
  const svc = new ScriptedQuota(pool, {
    [`tok-${primary}`]: answered({ [NEON_LOW]: { remainingFraction: 1 }, [NEON_HIGH]: { remainingFraction: 1 }, [SHARED]: { displayName: 'Claude Sonnet 5.5 (Low)', remainingFraction: 0.6 } }),
    [`tok-${secondary}`]: answered({ [SHARED]: { displayName: 'Claude Sonnet 5.5 (Low)' }, [SOLO]: { remainingFraction: 1 } }),
  })

  const res = await svc.discoverAvailableModels()
  assert.ok(res, 'discovery must answer when accounts replied')
  assert.deepEqual(Object.keys(res.models!).sort(), [SHARED, SOLO, NEON_HIGH, NEON_LOW])
  assert.equal(res.discoveredFromAccounts, 2)
  assert.equal(res.unionAccounts, 2)
  assert.deepEqual(res.modelProviders![SOLO], [secondary], 'a model only one account lists names that account as its only provider')
  assert.deepEqual([...res.modelProviders![SHARED]!].sort(), [...ids].sort())

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  const cat = catalog.get()

  assert.equal(cat.source, 'discovered')
  assert.equal(cat.unionAccounts, 2)
  // The two neon variants became one selectable model; the solo and shared models are their own entries.
  assert.deepEqual(catalogIds(cat).sort(), [SHARED, SOLO, NEON])
  assert.deepEqual(effortsOf(cat, NEON), ['high', 'low'])
  assert.deepEqual(ownersOf(cat, NEON), [primary], 'the account that lists neither neon variant is not credited for it')
  assert.deepEqual([...ownersOf(cat, SHARED)].sort(), [...ids].sort())
  assert.deepEqual(ownersOf(cat, SOLO), [secondary])
  assert.equal(entryOf(cat, SOLO).efforts, null, 'a lone variant is not an effort-family model')
})

test('every catalog entry is a model at least one usable account is entitled to serve', async () => {
  const { pool, ids } = makePool('routable', ['primary-acc', 'secondary-acc'])
  const [primary, secondary] = ids
  persistModelList(pool, primary, [NEON_LOW, NEON_HIGH, SHARED])
  persistModelList(pool, secondary, [SOLO, SHARED])
  const svc = new ScriptedQuota(pool, {
    [`tok-${primary}`]: answered({ [NEON_LOW]: { remainingFraction: 1 } }),
    [`tok-${secondary}`]: 'throw',
  })

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  const cat = catalog.get()

  for (const entry of cat.models) {
    const family = modelFamilyOf(entry.id)
    const owners = ownersOf(cat, entry.id)
    assert.ok(owners.length > 0, `catalog entry '${entry.id}' has no account behind it`)
    for (const accountId of owners) {
      assert.ok(ids.includes(accountId), `provider '${accountId}' is not an account of this pool`)
    }
    assert.notEqual(
      pool.selectAccount(family, entry.id),
      null,
      `picker offers '${entry.id}' but no account can be scheduled for it`,
    )
  }
  assert.deepEqual(ownersOf(cat, SOLO), [secondary])
  assert.equal(pool.selectAccount('google', SOLO)!.id, secondary, 'the solo model routes to the account that lists it')
})

// ---------------------------------------------------------------------------
// 2. A failing probe can never delete a model.

test('an account whose probe times out keeps contributing the models only it serves', async () => {
  const { pool, ids } = makePool('probe-timeout', ['primary-acc', 'solo-acc'])
  const [primary, solo] = ids
  // What pool.json already says about each account (persisted by past quota refreshes).
  persistModelList(pool, primary, [NEON_LOW, NEON_HIGH])
  persistModelList(pool, solo, [SOLO, `${HYDRO_BASE}-high`])

  const svc = new ScriptedQuota(pool, {
    [`tok-${primary}`]: answered({ [NEON_LOW]: { remainingFraction: 1 }, [NEON_HIGH]: { remainingFraction: 1 } }),
    [`tok-${solo}`]: { hangMs: 700 },
  })

  const res = await svc.discoverAvailableModels({ accountTimeoutMs: 200, totalBudgetMs: 4_000 })
  assert.ok(res, 'one unreachable account must not fail the discovery')
  assert.equal(res.discoveredFromAccounts, 1)
  assert.equal(res.discoveredAccountFailures, 1)
  assert.equal(res.unionAccounts, 2, 'the unreachable account still contributes its last-known list')
  assert.deepEqual(res.catalogAccounts!.find((a) => a.accountId === solo)!, { accountId: solo, models: 2, origin: 'last-known' })
  assert.ok(res.models![SOLO], 'the solo account model survived its own timed-out probe')
  assert.deepEqual(res.accountFailures!.map((f) => f.accountId), [solo])
  assert.ok(res.accountFailures![0]!.error.length > 0, 'the failure reason is recorded, not swallowed')

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  const cat = catalog.get()
  assert.deepEqual(catalogIds(cat).sort(), [SOLO, `${HYDRO_BASE}-high`, NEON])
  assert.deepEqual(effortsOf(cat, NEON), ['high', 'low'])
  assert.deepEqual(ownersOf(cat, SOLO), [solo])
})

test('a model list an account answered earlier survives that account failing later', async () => {
  const { pool, ids } = makePool('roster-continuity', ['primary-acc', 'solo-acc'])
  const [primary, solo] = ids
  persistModelList(pool, primary, [NEON_LOW])
  persistModelList(pool, solo, [SOLO])
  const svc = new ScriptedQuota(pool, {
    [`tok-${primary}`]: answered({ [NEON_LOW]: { remainingFraction: 1 } }),
    [`tok-${solo}`]: answered({ [SOLO]: { remainingFraction: 1 } }),
  })

  const first = await svc.discoverAvailableModels()
  assert.ok(first!.models![SOLO])
  // A probe answer is also persisted, so the next process starts from the same truth.
  assert.deepEqual(pool.getAccount(solo)!.quotas.google!.models!.map((m) => m.modelId), [SOLO])

  // Next round: the solo account is unreachable.
  svc.script[`tok-${solo}`] = 'throw'
  const second = await svc.discoverAvailableModels()
  assert.ok(second, 'discovery still reports the union it can vouch for')
  assert.equal(second.discoveredFromAccounts, 1)
  assert.ok(second.models![SOLO], 'a transient failure removed the only account serving this model')
  assert.equal(second.catalogAccounts!.find((a) => a.accountId === solo)!.origin, 'last-known')

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  assert.ok(catalogIds(catalog.get()).includes(SOLO))
  assert.equal(modelEntitlementOf(pool.getAccount(solo)!, 'google', SOLO).supported, true)
  assert.equal(modelEntitlementOf(pool.getAccount(primary)!, 'google', SOLO).supported, false, 'the account that answered without it is known not to serve it')
  assert.equal(pool.selectAccount('google', SOLO)!.id, solo)
})

test('every account failing keeps the persisted union and records why it degraded', async () => {
  const { pool, ids } = makePool('all-fail', ['primary-acc', 'secondary-acc'])
  persistModelList(pool, ids[0]!, [NEON_LOW, NEON_HIGH])
  persistModelList(pool, ids[1]!, [SOLO])

  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: 'throw',
    [`tok-${ids[1]}`]: { hangMs: 700 },
  })
  const catalog = svc.catalog()

  const res = await svc.discoverAvailableModels({ accountTimeoutMs: 200, totalBudgetMs: 4_000 })
  assert.ok(res, 'a pool with persisted lists is not an empty answer')
  assert.equal(res.discoveredFromAccounts, 0)
  assert.equal(res.discoveredAccountFailures, 2)

  await catalog.forceRefresh()
  const cat = catalog.get()
  assert.equal(cat.source, 'discovered', 'the catalog stayed a discovered union instead of falling back to the built-in table')
  assert.deepEqual(catalogIds(cat).sort(), [SOLO, NEON])
  assert.match(cat.lastError ?? '', /discovery failed for all 2 account/)
  assert.equal(cat.accountFailures?.length, 2)
  assert.deepEqual(ownersOf(cat, SOLO), [ids[1]!])

  // Diagnostics the GUI reads from /status: the union is attributed, not guessed.
  const diagnostics = svc.lastDiscoveryDiagnostics!
  assert.equal(diagnostics.succeeded, 0)
  assert.equal(diagnostics.failures, 2)
  assert.equal(diagnostics.unionAccounts, 2)
  assert.deepEqual(diagnostics.catalogAccounts!.map((a) => a.origin), ['last-known', 'last-known'])
})

test('no answer and no persisted list anywhere still returns null so the old catalog survives', async () => {
  const { pool, ids } = makePool('nothing-known', ['primary-acc', 'secondary-acc'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: 'throw',
    [`tok-${ids[1]}`]: 'empty',
  })
  const res = await svc.discoverAvailableModels()
  assert.equal(res, null, 'inventing a catalog out of nothing is how phantom models get offered')
  assert.equal(svc.lastDiscoveryDiagnostics!.unionAccounts, 0)
  assert.equal(svc.lastDiscoveryDiagnostics!.accountFailures.length, 2)

  const catalog = svc.catalog(0)
  await catalog.refreshIfNeeded()
  assert.equal(catalog.get().source, 'fallback')
  assert.equal(catalog.get().models.length, DEFAULT_FALLBACK_MODELS.length)
})

// ---------------------------------------------------------------------------
// 3. Removal needs a successful answer that omits the model.

test('a successful answer that drops a model removes it, unless another account still lists it', async () => {
  const { pool, ids } = makePool('drop-after-success', ['primary-acc', 'secondary-acc'])
  const [primary, secondary] = ids
  persistModelList(pool, primary, [NEON_LOW, NEON_HIGH])
  persistModelList(pool, secondary, [SOLO, SHARED])
  const svc = new ScriptedQuota(pool, {
    [`tok-${primary}`]: answered({ [NEON_LOW]: { remainingFraction: 1 }, [NEON_HIGH]: { remainingFraction: 1 } }),
    [`tok-${secondary}`]: answered({ [SOLO]: { remainingFraction: 1 }, [SHARED]: { remainingFraction: 1 } }),
  })

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  assert.ok(catalogIds(catalog.get()).includes(SOLO))

  // The solo account answers again. It still serves Claude and its neon model, but no longer the
  // cobalt model: that is the one signal that may remove a model from the catalog.
  svc.script[`tok-${secondary}`] = answered({ [SHARED]: { remainingFraction: 1 }, [NEON_LOW]: { remainingFraction: 1 } })
  const second = await svc.discoverAvailableModels()
  assert.equal(second!.models![SOLO], undefined, 'an account that answered without the model must stop vouching for it')
  assert.equal(second!.modelProviders![SOLO], undefined)
  assert.ok(second!.models![SHARED], 'the models it still lists stay selectable')
  assert.ok(second!.models![NEON_LOW], 'the other account is untouched by this account changing')

  await catalog.forceRefresh()
  const cat = catalog.get()
  assert.deepEqual(catalogIds(cat).sort(), [SHARED, NEON])
  assert.deepEqual(effortsOf(cat, NEON), ['high', 'low'])

  // Routing agrees with the catalog: nobody serves it any more.
  assert.equal(modelEntitlementOf(pool.getAccount(secondary)!, 'google', SOLO).supported, false)
  assert.equal(pool.selectAccount('google', SOLO), null)
  const status = pool.getFamilyStatus('google', SOLO)
  assert.equal(status.reason, 'model_not_available')
})

test('an account the user switched off or must re-authenticate cannot vouch for a model', async () => {
  const { pool, ids } = makePool('unusable-accounts', ['primary-acc', 'secondary-acc'])
  const [primary, secondary] = ids
  persistModelList(pool, primary, [NEON_LOW])
  persistModelList(pool, secondary, [SOLO])
  const svc = new ScriptedQuota(pool, { [`tok-${primary}`]: answered({ [NEON_LOW]: { remainingFraction: 1 } }) })

  assert.deepEqual(svc.composeAvailableModels().accounts.map((a) => a.accountId), [primary, secondary])

  pool.markAuthRequired(secondary, 'Invalid token')
  assert.deepEqual(
    svc.composeAvailableModels().accounts.map((a) => a.accountId),
    [primary],
    'an account with a broken credential serves nothing, so it must not keep a model selectable',
  )
  assert.equal(svc.composeAvailableModels().models[SOLO], undefined)

  pool.clearAuthRequired(secondary)
  assert.deepEqual(svc.composeAvailableModels().accounts.map((a) => a.accountId), [primary, secondary])

  pool.setAccountEnabled(secondary, false)
  const union = svc.composeAvailableModels()
  assert.deepEqual(union.accounts.map((a) => a.accountId), [primary], 'a switched-off account is out of the union')
  assert.equal(union.models[SOLO], undefined)
  assert.deepEqual(union.providers[NEON_LOW], [primary])
})

test('a payload that carries no model list is a shape problem, not an answer that serves nothing', async () => {
  const { pool, ids } = makePool('payload-shape', ['primary-acc'])
  persistModelList(pool, ids[0]!, [SOLO])
  // Upstream replied, but the reply has no `models` map: no account can be blamed for it and no
  // last-known list may be thrown away because of it.
  const svc = new ScriptedQuota(pool, { [`tok-${ids[0]}`]: { agentModelSorts: [{ modelIds: [] }] } })

  const res = await svc.discoverAvailableModels()
  assert.ok(res, 'a pool with a persisted list is not an empty answer')
  assert.deepEqual(res.rosterKeptAccounts, [ids[0]!], 'a payload with no models map must not be read as "serves nothing"')
  assert.equal(res.discoveredFromAccounts, 1)
  assert.equal(res.discoveredAccountFailures, 0)
  assert.ok(res.models![SOLO])
  assert.equal(modelEntitlementOf(pool.getAccount(ids[0]!)!, 'google', SOLO).supported, true)
})

test('an answer that does carry a model list is authoritative, even when it says "none"', async () => {
  const { pool, ids } = makePool('empty-answer', ['empty-acc', 'healthy-acc'])
  const [empty, healthy] = ids
  persistModelList(pool, empty, [SOLO])
  persistModelList(pool, healthy, [NEON_LOW])
  const svc = new ScriptedQuota(pool, {
    [`tok-${empty}`]: { models: {} },
    [`tok-${healthy}`]: answered({ [NEON_LOW]: { remainingFraction: 1 } }),
  })

  const res = await svc.discoverAvailableModels()
  assert.ok(res)
  assert.equal(res.discoveredFromAccounts, 2)
  assert.equal(res.discoveredAccountFailures, 0)
  assert.equal(res.rosterKeptAccounts, undefined, 'an account that answered is not a kept roster')
  assert.equal(res.models![SOLO], undefined, 'the account that answered "no models" stopped vouching for its old list')
  assert.ok(res.models![NEON_LOW])
  assert.equal(res.unionAccounts, 1)
  assert.deepEqual(svc.composeAvailableModels().accounts.map((a) => a.accountId), [healthy])
})

// ---------------------------------------------------------------------------
// 4. Effort folding across accounts, without duplicate picker entries.

test('effort variants split across accounts fold into one entry that carries every effort', async () => {
  const { pool, ids } = makePool('fold-across-accounts', ['primary-acc', 'secondary-acc'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: answered({ [`${HYDRO_BASE}-low`]: { remainingFraction: 1 }, [`${HYDRO_BASE}-medium`]: { remainingFraction: 1 }, [`${HYDRO_BASE}-high`]: { remainingFraction: 1 } }),
    [`tok-${ids[1]}`]: answered({ [`${HYDRO_BASE}-xhigh`]: { remainingFraction: 1 } }),
  })

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  const cat = catalog.get()

  assert.deepEqual(catalogIds(cat).filter((id) => id.startsWith(HYDRO_BASE)), [HYDRO_BASE])
  assert.deepEqual(effortsOf(cat, HYDRO_BASE), ['high', 'low', 'medium', 'xhigh'])
  assert.deepEqual([...ownersOf(cat, HYDRO_BASE)].sort(), [...ids].sort(), 'both accounts serve the folded model')
  const ids2 = catalogIds(cat)
  assert.equal(new Set(ids2).size, ids2.length, 'the union must not duplicate ids')
})

test('a variant with no sibling anywhere stays selectable on its own', async () => {
  const { pool, ids } = makePool('lone-variant', ['primary-acc'])
  persistModelList(pool, ids[0]!, [SOLO])
  const svc = new ScriptedQuota(pool, { [`tok-${ids[0]}`]: answered({ [SOLO]: { remainingFraction: 1 } }) })

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  const cat = catalog.get()
  assert.deepEqual(catalogIds(cat), [SOLO])
  assert.deepEqual(ownersOf(cat, SOLO), [ids[0]!])
})

test('tiered ids never become their own picker entry next to the model they belong to', async () => {
  const { pool, ids } = makePool('tiered', ['primary-acc', 'secondary-acc'])
  persistModelList(pool, ids[0]!, [`${HYDRO_BASE}-high`, `${HYDRO_BASE}-medium`])
  persistModelList(pool, ids[1]!, [`${HYDRO_BASE}-tiered-high`])
  const svc = new ScriptedQuota(pool, { [`tok-${ids[0]}`]: answered({ [`${HYDRO_BASE}-high`]: { remainingFraction: 1 }, [`${HYDRO_BASE}-medium`]: { remainingFraction: 1 } }) })

  const res = await svc.discoverAvailableModels()
  assert.ok(res!.models![`${HYDRO_BASE}-tiered-high`], 'the tiered id is a real upstream id some account lists')

  const catalog = svc.catalog()
  await catalog.forceRefresh()
  const cat = catalog.get()
  assert.deepEqual(catalogIds(cat).filter((id) => id.startsWith(HYDRO_BASE)), [HYDRO_BASE])
  assert.deepEqual(effortsOf(cat, HYDRO_BASE), ['high', 'medium'])
  assert.ok(!catalogIds(cat).some((id) => id.includes('-tiered')), 'tiered ids are variants, not entries')
})

// ---------------------------------------------------------------------------
// 5. Catalog entries are routable, and unroutable ones are named as such.

test('a model only one account serves is offered by listModels and resolves to a real model', async () => {
  const { pool, ids } = makePool('routing', ['primary-acc', 'solo-acc'])
  const [primary, solo] = ids
  // The primary publishes a model list that does not contain the cobalt model, so it is known
  // not to serve it: only the solo account can be scheduled for it.
  persistModelList(pool, primary, [SHARED, NEON_LOW])
  persistModelList(pool, solo, [SOLO])
  const svc = new ScriptedQuota(pool, {
    [`tok-${primary}`]: answered({ [SHARED]: { remainingFraction: 1 }, [NEON_LOW]: { remainingFraction: 1 } }),
    [`tok-${solo}`]: answered({ [SOLO]: { remainingFraction: 1 } }),
  })

  const catalog = svc.catalog()
  const adapter = new AgyAdapter({
    getConfig: () => defaultConfig(),
    catalog,
    pool,
    endpointCandidates: ['http://127.0.0.1:1'],
  })

  const offered = await adapter.listModels('antigravity')
  assert.ok(offered.some((m) => m.id === SOLO), `listModels hid the model only '${solo}' serves: ${JSON.stringify(offered.map((m) => m.id))}`)
  assert.ok(offered.every((m) => m.name.length > 0))

  const resolved = await adapter.resolveModel('antigravity', SOLO)
  assert.equal(resolved.provider, 'antigravity')
  assert.equal(resolved.id, SOLO)
  assert.ok(resolved.name.length > 0)
  assert.equal(resolved.context?.contextWindow, 1_048_576, 'a gemini model must not fall back to the generic context window')
  assert.equal(pool.selectAccount('google', SOLO)!.id, solo)
  assert.equal(pool.getFamilyStatus('google', SOLO).suppressed, false)
  assert.equal(pool.getAccount(primary)!.quotas.google!.models!.some((m) => m.modelId === SOLO), false)
})

test('when no account serves a model the verdict is MODEL_NOT_AVAILABLE, never RATE_LIMIT', async () => {
  const { pool, ids } = makePool('not-available', ['primary-acc', 'secondary-acc'])
  // Both signed-in accounts publish a model list, and neither list contains the model or its base.
  persistModelList(pool, ids[0]!, [NEON_LOW])
  persistModelList(pool, ids[1]!, [NEON_LOW, SHARED])

  assert.equal(pool.selectAccount('google', SOLO), null)
  const status = pool.getFamilyStatus('google', SOLO)
  assert.equal(status.reason, 'model_not_available', 'a model problem must not be reported as an account problem')

  const verdict = classifyPoolFailure({ family: 'google', wireModel: SOLO, failures: [], familyStatus: status })
  assert.equal(verdict.code, 'MODEL_NOT_AVAILABLE')
  assert.match(verdict.message, new RegExp(SOLO))
  assert.doesNotMatch(verdict.code, /RATE_LIMIT/)
})

test('an entitled account that is rate limited is still RATE_LIMIT, not a model problem', async () => {
  const { pool, ids } = makePool('rate-limit', ['primary-acc'])
  persistModelList(pool, ids[0]!, [SOLO])
  pool.recordFailure(ids[0]!, 'google', '429 Rate Limit')

  assert.equal(modelEntitlementOf(pool.getAccount(ids[0]!)!, 'google', SOLO).supported, true)
  const status = pool.getFamilyStatus('google', SOLO)
  assert.equal(status.reason, 'rate_limited')

  const failures: AttemptFailure[] = [{ cause: 'rate_limit', accountId: ids[0]!, httpStatus: 429, upstreamError: '429 Too Many Requests' }]
  const verdict = classifyPoolFailure({ family: 'google', wireModel: SOLO, failures, familyStatus: status })
  assert.equal(verdict.code, 'RATE_LIMIT', 'a 429 means wait for the reset, not switch model')
})

// ---------------------------------------------------------------------------
// 6. The union is a cheap local synthesis: pool changes reach the catalog inside the TTL.

test('a pool change reaches the catalog without re-probing an endpoint', async () => {
  const { pool, ids } = makePool('live-union', ['primary-acc'])
  persistModelList(pool, ids[0]!, [NEON_LOW])
  const svc = new ScriptedQuota(pool, { [`tok-${ids[0]}`]: answered({ [NEON_LOW]: { remainingFraction: 1 } }) })
  const catalog = svc.catalog()

  await catalog.refreshIfNeeded()
  assert.equal(svc.probeCount, 1)
  assert.ok(!catalogIds(catalog.get()).includes(SOLO))

  // An account added between discovery rounds: its persisted list must show up immediately.
  const late = pool.createAccountSlot('late-acc').id
  pool.setMemoryToken(late, `tok-${late}`, Date.now() + 60_000)
  persistModelList(pool, late, [SOLO])

  await catalog.refreshIfNeeded()
  assert.equal(svc.probeCount, 1, 'inside the TTL a refresh is a local union fold, not an endpoint call')
  assert.ok(catalogIds(catalog.get()).includes(SOLO), 'the new account model is selectable without waiting for a discovery round')
  assert.equal(catalog.get().unionAccounts, 2)

  // Removing the account takes the model back out, again with no endpoint call.
  pool.deleteAccount(late)
  await catalog.refreshIfNeeded()
  assert.equal(svc.probeCount, 1)
  assert.ok(!catalogIds(catalog.get()).includes(SOLO), 'a deleted account must not keep its models alive')
  assert.equal(catalog.get().unionAccounts, 1)
})

test('the TTL gate still refuses a second discovery for a fresh catalog', async () => {
  const { pool, ids } = makePool('ttl', ['primary-acc'])
  persistModelList(pool, ids[0]!, [NEON_LOW])
  const svc = new ScriptedQuota(pool, { [`tok-${ids[0]}`]: answered({ [NEON_LOW]: { remainingFraction: 1 } }) })
  const catalog = svc.catalog(300_000, false)
  await catalog.refreshIfNeeded()
  await catalog.refreshIfNeeded()
  assert.equal(svc.probeCount, 1)
  await catalog.forceRefresh()
  assert.equal(svc.probeCount, 2, 'forceRefresh still probes')
})

// ---------------------------------------------------------------------------
// 7. Fallback defs keep their documented role; a discovered catalog never absorbs them.

test('a discovered catalog does not absorb ids upstream never served', async () => {
  const { pool, ids } = makePool('no-fallback-leak', ['primary-acc'])
  const svc = new ScriptedQuota(pool, { [`tok-${ids[0]}`]: answered({ [NEON_LOW]: { remainingFraction: 1 }, [NEON_HIGH]: { remainingFraction: 1 } }) })
  const catalog = svc.catalog()
  await catalog.forceRefresh()

  const discovered = catalogIds(catalog.get())
  assert.deepEqual(discovered, [NEON])
  const builtInOnly = DEFAULT_FALLBACK_MODELS.map((def) => def.id).filter((id) => !discovered.includes(id))
  assert.ok(builtInOnly.length > 0, 'the built-in table must contain ids this pool does not serve for the leak check to mean anything')
  for (const id of builtInOnly) {
    assert.ok(!discovered.includes(id), `built-in-only id '${id}' leaked into a source: 'discovered' catalog`)
  }
})

test('mergeDiscoveredWithFallback unions on request and keeps the discovered entry for a shared id', () => {
  const discovered: CatalogEntry[] = [{ id: NEON, name: 'Gemini 4 Neon', efforts: ['low', 'high'] }]
  const merged = mergeDiscoveredWithFallback(discovered, [
    { id: NEON, name: 'Built-in Gemini 4 Neon' },
    { id: 'model-nobody-serves', name: 'Nobody Serves This' },
  ])
  assert.deepEqual(merged.map((m) => m.id), [NEON, 'model-nobody-serves'])
  assert.equal(merged[0]!.name, 'Gemini 4 Neon', 'the discovered entry wins over the built-in label')

  const empty = mergeDiscoveredWithFallback([], [{ id: 'only-fallback', name: 'Only Fallback' }])
  assert.deepEqual(empty.map((m) => m.id), ['only-fallback'])
})

test('composeAvailableModels is a pure local read: no token, no endpoint', async () => {
  const { pool, ids } = makePool('pure-compose', ['primary-acc', 'secondary-acc'])
  persistModelList(pool, ids[0]!, [NEON_LOW])
  persistModelList(pool, ids[1]!, [SOLO])
  const svc = new ScriptedQuota(pool, {})

  const snapshot: ModelUnionSnapshot = svc.composeAvailableModels()
  assert.equal(svc.probeCount, 0, 'composition must not ask any account for a model list')
  assert.deepEqual(Object.keys(snapshot.models).sort(), [SOLO, NEON_LOW])
  assert.deepEqual(snapshot.accounts.map((a) => a.origin), ['last-known', 'last-known'])
  assert.deepEqual(snapshot.accounts.map((a) => a.models), [1, 1])
  assert.deepEqual(snapshot.providers[SOLO], [ids[1]!])
  for (const entry of Object.values(snapshot.models)) {
    assert.equal(entry.accountListed, true, 'every composed entry says what kind of evidence vouches for it')
  }

  await svc.discoverAvailableModels()
  assert.equal(svc.probeCount, 2, 'discovery is the path that contacts accounts')
})

// 7. Wiring audit: sections 1-6 prove the catalog behavior *when* the union source is
// passed. This pins that the host construction in src/index.ts actually passes it —
// silently dropping the 4th argument back to probe-only must redden the suite.
test('the host wires quota.composeAvailableModels as the catalog union source', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(
    /new ModelCatalog\([^)]*\)[\s\S]*?\n    \(\) => quota\.composeAvailableModels\(\),\n  \)/.test(src),
    'src/index.ts must construct ModelCatalog with a 4th argument () => quota.composeAvailableModels()',
  )
})
