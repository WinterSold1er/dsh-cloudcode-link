// account-models HTTP surface.
//
// Two layers are covered:
//  1. `handleAccountModels` — the framework-free function the route delegates to. Its account
//     lookup and its quota refresh are injected dependencies, so status codes, the contract
//     fields, and the "a failed refresh must not become a 500" rule are all asserted without
//     touching the network.
//  2. The routes actually registered by `apply()`, exercised through a captured mock webServer
//     (the paradigm already used by test/m4-integration.test.ts) against a pool.json seeded in a
//     throwaway directory via CLOUDCODE_ACCOUNTS_DIR / DSH_HOME. That proves both prefixes are
//     registered, GET reads the query string, POST reads the JSON body, and the response really
//     is the normalized catalog rather than the raw pool record.
//
// Refresh at the route level is exercised with a seeded account that has no credential file, so
// QuotaService stops before any HTTP request; the failing-refresh degradation itself is asserted
// with an injected refresh that throws, which no real account could produce on demand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

import { apply } from '../src/index.ts'
import { describeAccountModels, handleAccountModels } from '../src/host/account-models.ts'
import type { ManagedAccount, ModelFamily } from '../src/common/pool-types.ts'

type FamilyModels = Array<{
  family: ModelFamily
  known: boolean
  quota?: Record<string, unknown>
  models: Array<{ id: string; name: string; family: ModelFamily; remainingFraction?: number; resetTime?: string }>
}>

function makeAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: 'acc_test',
    alias: 'acc_test',
    dir: '',
    enabled: true,
    createdAt: 0,
    cooldowns: {},
    quotas: {},
    ...overrides,
  }
}

function familiesOf(body: Record<string, unknown>): ModelFamily[] {
  return (body.familyModels as FamilyModels).map((f) => f.family)
}

// ---------------------------------------------------------------------------
// 1. handleAccountModels: the code path behind the route
// ---------------------------------------------------------------------------

test('handleAccountModels: a blank or missing id is 400 id_required and never reaches the pool', async () => {
  let lookups = 0
  const deps = { getAccount: () => { lookups += 1; return undefined } }

  const missing = await handleAccountModels({}, deps)
  assert.equal(missing.status, 400)
  assert.deepEqual(missing.body, { ok: false, error: 'id_required' })

  const blank = await handleAccountModels({ id: '   ' }, deps)
  assert.equal(blank.status, 400)
  assert.equal(blank.body.error, 'id_required')

  const notAString = await handleAccountModels({ id: 42 }, deps)
  assert.equal(notAString.status, 400)
  assert.equal(lookups, 0, 'a request without a usable id must not consult the pool at all')
})

test('handleAccountModels: an unknown id is 404 account_not_found and triggers no refresh', async () => {
  let refreshes = 0
  const res = await handleAccountModels(
    { id: 'acc_ghost', refresh: true },
    {
      getAccount: () => undefined,
      refreshQuota: () => { refreshes += 1 },
    },
  )

  assert.equal(res.status, 404)
  assert.deepEqual(res.body, { ok: false, error: 'account_not_found' })
  assert.equal(refreshes, 0, 'nothing can be refreshed for an account that does not exist')
})

test('handleAccountModels: a plain read answers the full contract without a quota round-trip', async () => {
  const account = makeAccount({
    id: 'acc_gray',
    alias: '灰度账号 A',
    email: 'gray@example.com',
    quotas: {
      google: {
        remainingFraction: 0.5,
        weeklyFraction: 0.8,
        updatedAt: 111,
        models: [
          { modelId: 'gemini-4-hydrogen-medium', displayName: 'Gemini 4 Hydrogen', remainingFraction: 0.5, resetTime: '2026-11-18T12:00:00Z' },
          { modelId: 'gemini-3-flash', remainingFraction: 0.25 },
        ],
      },
    },
  })

  let refreshes = 0
  const res = await handleAccountModels(
    { id: 'acc_gray' },
    { getAccount: () => account, refreshQuota: () => { refreshes += 1 } },
  )

  assert.equal(res.status, 200)
  assert.equal(refreshes, 0, 'a read is a read: no upstream quota call')
  assert.equal(res.body.ok, true)
  assert.equal(res.body.id, 'acc_gray')
  assert.equal(res.body.alias, '灰度账号 A')
  assert.equal(res.body.email, 'gray@example.com')
  assert.equal(res.body.known, true)
  assert.equal(res.body.total, 2)
  assert.equal(res.body.refreshedAt, 111)
  assert.equal('refreshError' in res.body, false)
  assert.deepEqual(familiesOf(res.body), ['google', 'anthropic', 'openai', 'unknown'])

  const google = (res.body.familyModels as FamilyModels)[0]
  assert.equal(google?.known, true)
  assert.deepEqual(google?.models.map((m) => m.id), ['gemini-3-flash', 'gemini-4-hydrogen-medium'])
  assert.deepEqual(google?.quota, { remainingFraction: 0.5, weeklyFraction: 0.8, updatedAt: 111 })
  // The handler and the pure function must agree exactly — the route adds no extra shaping.
  assert.deepEqual(res.body.familyModels, describeAccountModels(account).familyModels)
})

test('handleAccountModels: an account with nothing recorded answers known:false and no invented model', async () => {
  const account = makeAccount({ id: 'acc_blind', quotas: { google: { remainingFraction: 0.9, updatedAt: 7 } } })
  const res = await handleAccountModels({ id: 'acc_blind' }, { getAccount: () => account })

  assert.equal(res.status, 200)
  assert.equal(res.body.known, false)
  assert.equal(res.body.total, 0)
  assert.equal(res.body.refreshedAt, 7)
  for (const family of res.body.familyModels as FamilyModels) {
    assert.equal(family.known, false)
    assert.deepEqual(family.models, [])
  }
})

test('handleAccountModels: refresh:true re-reads quota and reports the account after the refresh', async () => {
  const before = makeAccount({ id: 'acc_gray', alias: 'gray-alias', quotas: {} })
  const after = makeAccount({
    id: 'acc_gray',
    alias: 'gray-alias',
    email: 'fresh@example.com',
    quotas: {
      google: { updatedAt: 900, models: [{ modelId: 'gemini-4-hydrogen-medium', remainingFraction: 0.4 }] },
    },
  })

  const refreshedIds: string[] = []
  let served = before
  const res = await handleAccountModels(
    { id: 'acc_gray', refresh: true },
    {
      getAccount: () => served,
      refreshQuota: (account) => {
        refreshedIds.push(account.id)
        served = after
      },
    },
  )

  assert.deepEqual(refreshedIds, ['acc_gray'])
  assert.equal(res.status, 200)
  assert.equal('refreshError' in res.body, false)
  assert.equal(res.body.known, true, 'the answer must reflect the refreshed account, not the stale one')
  assert.equal(res.body.total, 1)
  assert.equal(res.body.refreshedAt, 900)
  assert.equal(res.body.email, 'fresh@example.com')
})

test('handleAccountModels: a refresh sent as the string "true" is still a refresh request', async () => {
  let refreshes = 0
  const account = makeAccount({ id: 'acc_gray', quotas: {} })
  const res = await handleAccountModels(
    { id: 'acc_gray', refresh: 'true' },
    { getAccount: () => account, refreshQuota: () => { refreshes += 1 } },
  )

  assert.equal(refreshes, 1)
  assert.equal(res.status, 200)
  assert.equal('refreshError' in res.body, false)
})

test('handleAccountModels: a refresh that throws degrades to 200 + refreshError and keeps the old data', async () => {
  const account = makeAccount({
    id: 'acc_gray',
    quotas: {
      anthropic: { updatedAt: 5, models: [{ modelId: 'claude-sonnet-4-5-20250929', remainingFraction: 0.8 }] },
    },
  })

  const res = await handleAccountModels(
    { id: 'acc_gray', refresh: true },
    {
      getAccount: () => account,
      refreshQuota: () => {
        throw new Error('upstream 429 Too Many Requests')
      },
    },
  )

  assert.equal(res.status, 200, 'a failed refresh must not hide the data the account already has')
  assert.equal(res.body.ok, true)
  assert.equal(res.body.refreshError, 'upstream 429 Too Many Requests')
  assert.equal(res.body.known, true)
  assert.equal(res.body.total, 1)
  const anthropic = (res.body.familyModels as FamilyModels).find((f) => f.family === 'anthropic')
  assert.deepEqual(anthropic?.models.map((m) => m.id), ['claude-sonnet-4-5-20250929'])
  assert.equal(anthropic?.models[0]?.remainingFraction, 0.8)
})

test('handleAccountModels: a non-Error rejection and a missing refresh dependency both surface as refreshError', async () => {
  const account = makeAccount({ id: 'acc_gray', quotas: {} })

  const thrown = await handleAccountModels(
    { id: 'acc_gray', refresh: true },
    {
      getAccount: () => account,
      refreshQuota: () => Promise.reject('quota endpoint unreachable'),
    },
  )
  assert.equal(thrown.status, 200)
  assert.equal(thrown.body.ok, true)
  assert.equal(thrown.body.refreshError, 'quota endpoint unreachable')

  const unsupported = await handleAccountModels({ id: 'acc_gray', refresh: true }, { getAccount: () => account })
  assert.equal(unsupported.status, 200)
  assert.equal(unsupported.body.refreshError, 'refresh_unavailable')
  assert.equal(unsupported.body.known, false)
})

test('handleAccountModels: the handler never writes to the account it was handed', async () => {
  const account = makeAccount({
    id: 'acc_gray',
    email: 'gray@example.com',
    quotas: { google: { updatedAt: 3, models: [{ modelId: 'gemini-3-flash', remainingFraction: 0.1 }] } },
  })
  const before = structuredClone(account)

  await handleAccountModels({ id: 'acc_gray', refresh: true }, {
    getAccount: () => account,
    refreshQuota: () => undefined,
  })

  assert.deepEqual(account, before)
})

// ---------------------------------------------------------------------------
// 2. The routes as apply() registers them
// ---------------------------------------------------------------------------

type Route = { kind: string; path: string; handler: (req: unknown, res: unknown) => void }

const GRAY_ACCOUNT_ID = 'acc_gray_fixture'
const BLIND_ACCOUNT_ID = 'acc_blind_fixture'

function fixtureAccounts(accountsDir: string): ManagedAccount[] {
  return [
    makeAccount({
      id: GRAY_ACCOUNT_ID,
      alias: 'Fixture Gray',
      email: 'fixture-gray@example.com',
      dir: join(accountsDir, GRAY_ACCOUNT_ID),
      quotas: {
        google: {
          remainingFraction: 0.6,
          weeklyFraction: 0.7,
          updatedAt: 1_700_000_000_000,
          models: [
            { modelId: 'gemini-4-hydrogen-medium', displayName: 'Gemini 4 Hydrogen', remainingFraction: 0.6, resetTime: '2026-11-19T00:00:00Z' },
            { modelId: 'gemini-3-flash', remainingFraction: 0.3 },
          ],
        },
        anthropic: { updatedAt: 1_700_000_000_500, models: [{ modelId: 'claude-sonnet-4-5-20250929', remainingFraction: 0.9 }] },
      },
    }),
    makeAccount({
      id: BLIND_ACCOUNT_ID,
      alias: 'Fixture Blind',
      dir: join(accountsDir, BLIND_ACCOUNT_ID),
      quotas: {},
    }),
  ]
}

/** Run the plugin's own route registration against a throwaway pool and hand back the routes. */
async function withPluginRoutes<T>(fn: (routes: Route[]) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'ccl-account-models-api-'))
  const accountsDir = join(dir, 'accounts')
  mkdirSync(accountsDir, { recursive: true })
  const accounts = fixtureAccounts(accountsDir)
  writeFileSync(
    join(accountsDir, 'pool.json'),
    JSON.stringify({ version: 1, mode: 'sequential', defaultCooldownMs: 900_000, maxCooldownMs: 3_600_000, accounts }),
  )

  const saved = {
    accountsDir: process.env.CLOUDCODE_ACCOUNTS_DIR,
    dshHome: process.env.DSH_HOME,
    token: process.env.ANTIGRAVITY_TOKEN,
  }
  process.env.CLOUDCODE_ACCOUNTS_DIR = accountsDir
  process.env.DSH_HOME = join(dir, 'dsh-home')
  delete process.env.ANTIGRAVITY_TOKEN

  const routes: Route[] = []
  const disposeHandlers: Array<() => unknown> = []
  const mockWebServer = {
    register: (route: Route) => {
      routes.push(route)
      return () => {}
    },
  }
  const mockCtx = {
    on: (event: string, handler: () => unknown) => {
      if (event === 'dispose') disposeHandlers.push(handler)
    },
    effect: () => () => {},
    get: () => undefined,
    llm: { registerAdapter: () => () => {} },
    commands: { register: () => () => {} },
    inject: (deps: string[], cb: (sub: unknown) => unknown) => {
      if (deps.includes('webServer')) return cb({ get: () => mockWebServer })
      return undefined
    },
  }

  try {
    apply(mockCtx as unknown as Context)
    return await fn(routes)
  } finally {
    for (const dispose of disposeHandlers) {
      try {
        await dispose()
      } catch {}
    }
    if (saved.accountsDir === undefined) delete process.env.CLOUDCODE_ACCOUNTS_DIR
    else process.env.CLOUDCODE_ACCOUNTS_DIR = saved.accountsDir
    if (saved.dshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved.dshHome
    if (saved.token !== undefined) process.env.ANTIGRAVITY_TOKEN = saved.token
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Drive a registered handler with a mock req/res and read back what it answered. */
async function invokeRoute(
  handler: (req: unknown, res: unknown) => void,
  init: { method?: string; url?: string; body?: unknown },
): Promise<{ status: number; headers: Record<string, string>; json: Record<string, unknown> }> {
  const listeners = new Map<string, Array<(chunk: Buffer) => void>>()
  const req = {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    on: (event: string, cb: (chunk: Buffer) => void) => {
      const list = listeners.get(event) ?? []
      list.push(cb)
      listeners.set(event, list)
    },
  }

  let status = 0
  let headers: Record<string, string> = {}
  let raw = ''
  const res = {
    writeHead: (code: number, h: Record<string, string>) => {
      status = code
      headers = h
    },
    end: (body?: unknown) => {
      raw = body === undefined ? '' : String(body)
    },
  }

  handler(req, res)
  // The handler subscribes to the body inside readBody(); push the chunks one turn later.
  setImmediate(() => {
    for (const cb of listeners.get('data') ?? []) cb(Buffer.from(JSON.stringify(init.body ?? {})))
    for (const cb of listeners.get('end') ?? []) cb(Buffer.alloc(0))
  })
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve))

  assert.notStrictEqual(raw, '', 'the route handler answered nothing')
  return { status, headers, json: JSON.parse(raw) as Record<string, unknown> }
}

test('pool/account-models is registered on both prefixes and shares one handler', async () => {
  await withPluginRoutes((routes) => {
    const prefixed = routes.find((r) => r.path === '/plugins/cloudcode-link/pool/account-models')
    const legacy = routes.find((r) => r.path === '/plugins/agy-link/pool/account-models')

    assert.ok(prefixed, 'the cloudcode-link prefix must serve the model catalog')
    assert.ok(legacy, 'the legacy agy-link prefix must serve it too')
    assert.equal(prefixed?.kind, 'exact')
    assert.equal(prefixed?.handler, legacy?.handler, 'regBoth must register one handler on both paths')
  })
})

test('GET pool/account-models?id= answers the normalized catalog, not the raw pool record', async () => {
  const fixture = fixtureAccounts('/unused')[0]
  assert.ok(fixture)
  const expected = describeAccountModels(fixture)

  await withPluginRoutes(async (routes) => {
    const route = routes.find((r) => r.path === '/plugins/cloudcode-link/pool/account-models')
    assert.ok(route)

    const answer = await invokeRoute(route.handler, {
      method: 'GET',
      url: `/plugins/cloudcode-link/pool/account-models?id=${GRAY_ACCOUNT_ID}`,
    })

    assert.equal(answer.status, 200)
    assert.ok(answer.headers['Content-Type']?.includes('application/json'))
    assert.equal(answer.json.ok, true)
    assert.equal(answer.json.id, GRAY_ACCOUNT_ID)
    assert.equal(answer.json.alias, 'Fixture Gray')
    assert.equal(answer.json.email, 'fixture-gray@example.com')
    assert.equal(answer.json.known, true)
    assert.equal(answer.json.total, 3)
    assert.equal(answer.json.refreshedAt, 1_700_000_000_500)
    assert.equal('refreshError' in answer.json, false)
    assert.deepEqual(familiesOf(answer.json), ['google', 'anthropic', 'openai', 'unknown'])

    const google = (answer.json.familyModels as FamilyModels)[0]
    assert.ok(google, 'google is the first family in the contract order')
    assert.deepEqual(google.models.map((m) => m.id), ['gemini-3-flash', 'gemini-4-hydrogen-medium'])
    assert.equal(google.models[1]?.name, 'Gemini 4 Hydrogen')
    assert.equal(google.models[1]?.resetTime, '2026-11-19T00:00:00Z')
    assert.deepEqual(google.quota, { remainingFraction: 0.6, weeklyFraction: 0.7, updatedAt: 1_700_000_000_000 })

    // Same normalized shape the core pure function produces: no internal fields leak out.
    assert.deepEqual(answer.json.familyModels, expected.familyModels)
    assert.equal('quotas' in answer.json, false)
    assert.equal('cooldowns' in answer.json, false)
    assert.equal('models' in answer.json, false)
  })
})

test('GET pool/account-models answers 400 without an id and 404 for an account that does not exist', async () => {
  await withPluginRoutes(async (routes) => {
    const route = routes.find((r) => r.path === '/plugins/cloudcode-link/pool/account-models')
    assert.ok(route)

    const noId = await invokeRoute(route.handler, { method: 'GET', url: '/plugins/cloudcode-link/pool/account-models' })
    assert.equal(noId.status, 400)
    assert.deepEqual(noId.json, { ok: false, error: 'id_required' })

    const emptyId = await invokeRoute(route.handler, { method: 'GET', url: '/plugins/cloudcode-link/pool/account-models?id=' })
    assert.equal(emptyId.status, 400)
    assert.equal(emptyId.json.error, 'id_required')

    const ghost = await invokeRoute(route.handler, {
      method: 'GET',
      url: '/plugins/cloudcode-link/pool/account-models?id=acc_that_is_not_in_the_pool',
    })
    assert.equal(ghost.status, 404)
    assert.deepEqual(ghost.json, { ok: false, error: 'account_not_found' })

    const wrongMethod = await invokeRoute(route.handler, {
      method: 'DELETE',
      url: `/plugins/cloudcode-link/pool/account-models?id=${GRAY_ACCOUNT_ID}`,
    })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.json.ok, false)
  })
})

test('POST pool/account-models reads the JSON body; a blind account stays known:false after a refresh', async () => {
  await withPluginRoutes(async (routes) => {
    const route = routes.find((r) => r.path === '/plugins/cloudcode-link/pool/account-models')
    assert.ok(route)

    const read = await invokeRoute(route.handler, { method: 'POST', body: { id: GRAY_ACCOUNT_ID } })
    assert.equal(read.status, 200)
    assert.equal(read.json.ok, true)
    assert.equal(read.json.total, 3)
    assert.equal('refreshError' in read.json, false)

    const missingId = await invokeRoute(route.handler, { method: 'POST', body: {} })
    assert.equal(missingId.status, 400)
    assert.deepEqual(missingId.json, { ok: false, error: 'id_required' })

    // The fixture accounts have no credential file, so the refresh stops before any upstream
    // request: the answer must still be 200 and must not invent a single model.
    const refreshed = await invokeRoute(route.handler, { method: 'POST', body: { id: BLIND_ACCOUNT_ID, refresh: true } })
    assert.equal(refreshed.status, 200)
    assert.equal(refreshed.json.known, false)
    assert.equal(refreshed.json.total, 0)
    assert.equal(refreshed.json.refreshedAt, null)
    for (const family of refreshed.json.familyModels as FamilyModels) {
      assert.equal(family.known, false)
      assert.deepEqual(family.models, [])
    }
  })
})
