// Discovery-side tests for the cross-account model merge (defect B) and its
// hand-off into ModelCatalog. No network, no real tokens: QuotaService's
// token/HTTP seams are overridden and the discovery budgets are injected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountPoolManager } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { DEFAULT_FALLBACK_MODELS } from '../src/common/types.ts'
import type { ManagedAccount } from '../src/common/pool-types.ts'

type EntryScript =
  | { models: Record<string, { quotaInfo?: { remainingFraction?: number }; displayName?: string }> }
  | 'throw'
  | 'empty'
  | { hangMs: number }

function freshPool(tag: string): AccountPoolManager {
  const pool = new AccountPoolManager(mkdtempSync(join(tmpdir(), `agy-discover-${tag}-`)))
  // Drop the bootstrapped accounts so the pool is exactly the one under test.
  for (const acc of pool.getAccounts()) pool.deleteAccount(acc.id)
  return pool
}

/**
 * QuotaService with the credential + model-endpoint seams replaced:
 * the fake token is derived from the account id, and the payload per token comes
 * from `script`. Accounts not present in `script` behave like an upstream failure.
 */
class ScriptedQuota extends QuotaService {
  tokensRequested: string[] = []
  script: Record<string, EntryScript>

  constructor(pool: AccountPoolManager, script: Record<string, EntryScript>) {
    super(pool)
    this.script = script
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
        const timer = setTimeout(() => reject(new Error('fake account never answers')), behaviour.hangMs)
        timer.unref()
      })
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    return behaviour
  }
}

function makePool(tag: string, aliases: readonly string[]): { pool: AccountPoolManager; ids: string[] } {
  const pool = freshPool(tag)
  const ids = aliases.map((alias) => pool.createAccountSlot(alias).id)
  pool.setPrimaryAccount(ids[0]!)
  return { pool, ids }
}

test('discoverAvailableModels unions models across the whole account pool', async () => {
  const { pool, ids } = makePool('union', ['primary-acc', 'secondary-acc'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: {
      models: {
        'gemini-3.8-flash-tiered': { displayName: 'Gemini 3.8 Flash (Tiered)', quotaInfo: { remainingFraction: 1 } },
        'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 0.4 } },
      },
    },
    [`tok-${ids[1]}`]: {
      models: {
        'claude-opus-5-5-low': { displayName: 'Claude Opus 5.5 (Low)' },
        'claude-opus-5-5-medium': { displayName: 'Claude Opus 5.5 (Medium)' },
        'claude-opus-5-5-high': { displayName: 'Claude Opus 5.5 (High)' },
      },
    },
  })

  const res = await svc.discoverAvailableModels()
  assert.ok(res, 'cross-account discovery must return a payload')
  const idsOut = Object.keys(res.models!).sort()
  assert.deepEqual(idsOut, [
    'claude-opus-5-5-high',
    'claude-opus-5-5-low',
    'claude-opus-5-5-medium',
    'claude-sonnet-4-6',
    'gemini-3.8-flash-tiered',
  ], 'models must be the union of every usable account')
  assert.equal(res.discoveredFromAccounts, 2, 'merged-account count must be reported')
  assert.equal(res.discoveredAccountFailures, 0)

  // Both accounts were actually fetched, not just the primary one.
  assert.deepEqual(new Set(svc.tokensRequested), new Set([`tok-${ids[0]}`, `tok-${ids[1]}`]))

  // Hand-off: the merged payload must land in the catalog, which is what DSH lists.
  const catalog = new ModelCatalog(async () => res, DEFAULT_FALLBACK_MODELS, 60_000)
  await catalog.forceRefresh()
  const catIds = catalog.get().models.map((m) => m.id)
  assert.ok(catIds.includes('claude-opus-5-5-low'), 'secondary-account model must reach the catalog')
  assert.ok(catIds.includes('gemini-3.8-flash'))
  assert.ok(!catIds.includes('gemini-3.6-flash'), 'built-in-only id must still stay out')
})

test('discoverAvailableModels survives a failing account instead of failing the discovery', async () => {
  const { pool, ids } = makePool('partial', ['broken-acc', 'healthy-acc'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: 'throw',
    [`tok-${ids[1]}`]: { models: { 'claude-sonnet-5-5-high': { displayName: 'Claude Sonnet 5.5 (High)' } } },
  })

  const res = await svc.discoverAvailableModels()
  assert.ok(res, 'one broken account must not sink the discovery')
  assert.deepEqual(Object.keys(res.models!), ['claude-sonnet-5-5-high'])
  assert.equal(res.discoveredFromAccounts, 1)
  assert.equal(res.discoveredAccountFailures, 1)
})

test('discoverAvailableModels prefers the account entry that carries quotaInfo on an id collision', async () => {
  const { pool, ids } = makePool('collision', ['no-quota-acc', 'quota-acc'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: {
      models: {
        'claude-sonnet-5-5-high': { displayName: 'From account without quota' },
        // Present on both accounts; only this account reports quotaInfo for it.
        'gemini-3.8-flash-tiered': { displayName: 'Primary', quotaInfo: { remainingFraction: 0.9 } },
      },
    },
    [`tok-${ids[1]}`]: {
      models: {
        'claude-sonnet-5-5-high': { displayName: 'From account with quota', quotaInfo: { remainingFraction: 0.5 } },
        'gemini-3.8-flash-tiered': { displayName: 'Secondary' },
      },
    },
  })

  const res = await svc.discoverAvailableModels()
  assert.ok(res)
  const collision = res.models!['claude-sonnet-5-5-high']
  assert.equal(collision?.quotaInfo?.remainingFraction, 0.5, 'quotaInfo-carrying entry must win')
  assert.equal(collision?.displayName, 'From account with quota')

  const gemini = res.models!['gemini-3.8-flash-tiered']
  assert.equal(gemini?.quotaInfo?.remainingFraction, 0.9, 'quotaInfo-carrying entry must win both ways round')
  assert.equal(gemini?.displayName, 'Primary')
})

test('discoverAvailableModels returns null when every account fails, so the old catalog survives', async () => {
  const { pool, ids } = makePool('all-fail', ['acc-1', 'acc-2'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: 'throw',
    [`tok-${ids[1]}`]: 'throw',
  })
  const res = await svc.discoverAvailableModels()
  assert.equal(res, null, 'an all-failed pool must surface as null, not an empty payload')
  assert.equal(svc.tokensRequested.length, 2, 'both accounts were attempted')

  const catalog = new ModelCatalog(
    async () => {
      throw new Error('all accounts failed')
    },
    DEFAULT_FALLBACK_MODELS,
    0,
  )
  const cat = await catalog.forceRefresh()
  assert.equal(cat.source, 'fallback')
  assert.equal(cat.lastError, 'all accounts failed')
  assert.equal(cat.models.length, DEFAULT_FALLBACK_MODELS.length)
})

test('discoverAvailableModels stays inside the injected budget when an account hangs', async () => {
  const { pool, ids } = makePool('hang', ['fast-1', 'fast-2', 'hang-acc'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: { models: { 'gemini-3.9-flash-tiered': { displayName: 'Gemini 3.9 Flash (Tiered)' } } },
    [`tok-${ids[1]}`]: { models: { 'claude-opus-5-5-high': { displayName: 'Claude Opus 5.5 (High)' } } },
    [`tok-${ids[2]}`]: { hangMs: 30_000 },
  })

  const started = Date.now()
  const res = await svc.discoverAvailableModels({
    concurrency: 2,
    accountTimeoutMs: 300,
    totalBudgetMs: 500,
  })
  const elapsed = Date.now() - started

  assert.ok(res, 'the fast accounts must still answer even though one account hangs')
  assert.deepEqual(Object.keys(res.models!).sort(), ['claude-opus-5-5-high', 'gemini-3.9-flash-tiered'])
  assert.equal(res.discoveredAccountFailures, 1, 'the hung account is a timeout, not a success')
  assert.ok(elapsed < 2_000, `merge must not wait for the hung account (took ${elapsed}ms)`)
})

test('discoverAvailableModels skips accounts once the total budget is exhausted', async () => {
  const { pool, ids } = makePool('budget', ['acc-1', 'acc-2', 'acc-3'])
  const svc = new ScriptedQuota(pool, {
    [`tok-${ids[0]}`]: { models: { 'gemini-3.9-flash-tiered': {} } },
    [`tok-${ids[1]}`]: { models: { 'claude-opus-5-5-low': {} } },
    [`tok-${ids[2]}`]: { models: { 'claude-opus-5-5-high': {} } },
  })

  const started = Date.now()
  const res = await svc.discoverAvailableModels({ concurrency: 1, accountTimeoutMs: 5_000, totalBudgetMs: 0 })
  const elapsed = Date.now() - started

  assert.equal(res, null, 'a zero budget must fetch nothing at all')
  assert.equal(svc.tokensRequested.length, 0, 'no account may be fetched past the budget')
  assert.ok(elapsed < 500, `budget enforcement must be immediate (took ${elapsed}ms)`)
})
