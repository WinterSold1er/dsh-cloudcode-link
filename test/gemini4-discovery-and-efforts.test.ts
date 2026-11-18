import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import {
  parseModelsOutput,
  foldEfforts,
  getAntigravityRequestModelId,
} from '../src/host/models.ts'
import { AGY_ENDPOINTS } from '../src/host/oauth.ts'
import { agyUserAgent, QuotaService } from '../src/host/quota.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { antigravityHeaders, streamGenerateContent } from '../src/host/client.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

test('1. agyUserAgent outputs verbatim upstream CLI identity and fetchAvailableModels sends it in headers', async () => {
  const expectedUA = 'antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)'
  const actualUA = agyUserAgent()
  assert.equal(actualUA, expectedUA, 'User-Agent must strictly match upstream agy CLI identity')

  let capturedUA: string | undefined
  const server = createServer((req, res) => {
    capturedUA = req.headers['user-agent']
    res.writeHead(200, { 'Content-Type': 'application/json' })
    // Fixture-only: QuotaService resolves the project through loadCodeAssist before it will
    // send either query RPC, so the host has to name one the way the real backend does
    // (cloudaicompanionProject, ops/relink/t2-traffic-findings.md #2.4). Without it no query
    // request is sent at all and the User-Agent assertion below would test nothing.
    const payload = (req.url ?? '').includes('loadCodeAssist')
      ? { cloudaicompanionProject: 'aicode-consumers' }
      : { models: {} }
    res.end(JSON.stringify(payload))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  const tmpDir = mkdtempSync(join(tmpdir(), 'test-pool-ua-'))

  try {
    const pool = new AccountPoolManager(tmpDir)
    const quota = new QuotaService(pool)
    ;(quota as unknown as { getOrderedEndpoints: () => string[] }).getOrderedEndpoints = () => [
      `http://127.0.0.1:${port}`,
    ]

    const res = await quota.fetchAvailableModels('fake-token')
    assert.ok(res, 'fetchAvailableModels must succeed against 200 response')
    assert.equal(capturedUA, expectedUA, 'Actual request header User-Agent must strictly equal agyUserAgent')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('2. AGY_ENDPOINTS prioritizes daily endpoint first', () => {
  assert.equal(
    AGY_ENDPOINTS[0],
    'https://daily-cloudcode-pa.googleapis.com',
    'daily endpoint must be the first preferred endpoint',
  )
  assert.equal(
    AGY_ENDPOINTS[1],
    'https://cloudcode-pa.googleapis.com',
    'production endpoint must be the secondary fallback',
  )
})

test('3. fetchAvailableModels fallback: 403 on first endpoint continues to second endpoint', async () => {
  let firstCalled = false
  let secondCalled = false

  const server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url.includes('endpoint1')) {
      firstCalled = true
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 403, message: 'Forbidden on daily' } }))
      return
    }
    if (url.includes('endpoint2')) {
      // Fixture-only: the project lookup runs over the same endpoint list, so the host has to
      // name a project (as the real backend does) for the query RPCs to be sent at all.
      // `secondCalled` stays reserved for the query RPC, so the 403-fallback assertion below
      // can still only be satisfied by an actual fallback.
      if (url.includes('loadCodeAssist')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ cloudaicompanionProject: 'aicode-consumers' }))
        return
      }
      secondCalled = true
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: { 'gemini-3.8-flash': { displayName: 'Gemini 3.8 Flash' } } }))
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port

  const tmpDir = mkdtempSync(join(tmpdir(), 'test-pool-fallback-'))
  try {
    const pool = new AccountPoolManager(tmpDir)
    const quota = new QuotaService(pool)
    ;(quota as unknown as { getOrderedEndpoints: () => string[] }).getOrderedEndpoints = () => [
      `http://127.0.0.1:${port}/endpoint1`,
      `http://127.0.0.1:${port}/endpoint2`,
    ]

    const res = await quota.fetchAvailableModels('fake-token')
    assert.ok(firstCalled, 'First endpoint must be attempted')
    assert.ok(secondCalled, 'Second endpoint must be attempted on 403 fallback (not aborted)')
    assert.ok(res, 'Must return result from second endpoint')
    assert.ok(res?.models?.['gemini-3.8-flash'], 'Result from second endpoint must be parsed')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('4. Real 34-model fixture parses gemini-4-argon and gemini-4-hydrogen correctly with full efforts', () => {
  const fixturePath = join(__dirname, 'fixtures', 'fetch-available-models.json')
  const rawJson = readFileSync(fixturePath, 'utf-8')

  const rawList = parseModelsOutput(rawJson)
  const catalog = foldEfforts(rawList)

  // 1. Argon checks
  const argon = catalog.find((c) => c.id === 'gemini-4-argon')
  assert.ok(argon, 'gemini-4-argon base entry must exist')
  assert.equal(argon.name, 'Gemini 4 Argon')
  assert.deepEqual(
    argon.efforts?.slice().sort(),
    ['high', 'low', 'medium'],
    'gemini-4-argon must have low, medium, high efforts',
  )

  // 2. Hydrogen checks
  const hydrogen = catalog.find((c) => c.id === 'gemini-4-hydrogen')
  assert.ok(hydrogen, 'gemini-4-hydrogen base entry must exist')
  assert.equal(hydrogen.name, 'Gemini 4 Hydrogen')
  assert.deepEqual(
    hydrogen.efforts?.slice().sort(),
    ['high', 'low', 'medium', 'xhigh'],
    'gemini-4-hydrogen must have low, medium, high, xhigh efforts',
  )

  // 3. Hygiene & no garbage / duplicate checks
  for (const item of catalog) {
    assert.ok(!item.id.includes('-disabled'), `Item id must not contain -disabled: ${item.id}`)
    assert.ok(!item.id.includes('-tiered'), `Item id must not contain -tiered: ${item.id}`)
    assert.ok(!item.id.includes('-sonar'), `Item id must not contain -sonar: ${item.id}`)
  }

  // Duplicate id check
  const ids = catalog.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'Every catalog entry must have a unique ID')

  // Duplicate name check
  const names = catalog.map((c) => c.name)
  assert.equal(new Set(names).size, names.length, 'Every catalog entry must have a unique display name')

  // Overall catalog count aligns with 17 recommended active models folded into 10 catalog entries
  assert.equal(catalog.length, 10, 'Folded catalog from recommended models should have exactly 10 entries')
})

test('5. Sorts race condition: merging restricted (9 models) and full (18 models) accounts in both arrival orders produces identical catalogs', async () => {
  const fixturePath = join(__dirname, 'fixtures', 'fetch-available-models.json')
  const fullPayload = JSON.parse(readFileSync(fixturePath, 'utf-8'))

  // Restricted payload: only 9 baseline models without argon or hydrogen in sorts
  const restrictedSortIds = [
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-low',
    'claude-opus-5-5-low',
    'claude-opus-5-5-medium',
    'claude-opus-5-5-high',
    'claude-sonnet-5-5-low',
    'claude-sonnet-5-5-medium',
    'claude-sonnet-5-5-high',
  ]
  const restrictedPayload = {
    models: Object.fromEntries(
      Object.entries(fullPayload.models).filter(([k]) => restrictedSortIds.includes(k) || k.includes('-disabled')),
    ),
    agentModelSorts: [
      {
        displayName: 'Recommended',
        groups: [{ modelIds: restrictedSortIds }],
      },
    ],
  }

  // Simulation order 1: Restricted arrives first, Full arrives second
  const tmpDir1 = mkdtempSync(join(tmpdir(), 'test-pool-race-1-'))
  const tmpDir2 = mkdtempSync(join(tmpdir(), 'test-pool-race-2-'))

  let res1: unknown
  let res2: unknown
  try {
    const pool1 = new AccountPoolManager(tmpDir1)
    const quota1 = new QuotaService(pool1)

    const accRestricted = { id: 'acc_restricted', enabled: true, authRequired: false }
    const accFull = { id: 'acc_full', enabled: true, authRequired: false }

    ;(pool1 as unknown as { getAccounts: () => unknown[] }).getAccounts = () => [accRestricted, accFull]
    ;(pool1 as unknown as { getAccount: (id: string) => unknown }).getAccount = (id: string) =>
      id === 'acc_restricted' ? accRestricted : accFull

    let callCount1 = 0
    ;(quota1 as unknown as { getValidAccessToken: () => Promise<string> }).getValidAccessToken = async () => 'fake-token'
    ;(quota1 as unknown as { fetchAvailableModels: () => Promise<unknown> }).fetchAvailableModels = async () => {
      callCount1++
      return callCount1 === 1 ? restrictedPayload : fullPayload
    }

    // Simulation order 2: Full arrives first, Restricted arrives second
    const pool2 = new AccountPoolManager(tmpDir2)
    const quota2 = new QuotaService(pool2)

    ;(pool2 as unknown as { getAccounts: () => unknown[] }).getAccounts = () => [accFull, accRestricted]
    ;(pool2 as unknown as { getAccount: (id: string) => unknown }).getAccount = (id: string) =>
      id === 'acc_full' ? accFull : accRestricted

    let callCount2 = 0
    ;(quota2 as unknown as { getValidAccessToken: () => Promise<string> }).getValidAccessToken = async () => 'fake-token'
    ;(quota2 as unknown as { fetchAvailableModels: () => Promise<unknown> }).fetchAvailableModels = async () => {
      callCount2++
      return callCount2 === 1 ? fullPayload : restrictedPayload
    }

    const results = await Promise.all([
      quota1.discoverAvailableModels(),
      quota2.discoverAvailableModels(),
    ])
    res1 = results[0]
    res2 = results[1]
  } finally {
    rmSync(tmpDir1, { recursive: true, force: true })
    rmSync(tmpDir2, { recursive: true, force: true })
  }

  assert.ok(res1, 'Discovery 1 must succeed')
  assert.ok(res2, 'Discovery 2 must succeed')

  const catalog1 = foldEfforts(parseModelsOutput(JSON.stringify(res1)))
  const catalog2 = foldEfforts(parseModelsOutput(JSON.stringify(res2)))

  // Both catalogs must have identical length
  assert.equal(catalog1.length, catalog2.length, 'Catalogs under both arrival orders must have identical size')

  // Both must contain gemini-4-argon with 3 efforts
  const a1 = catalog1.find((c) => c.id === 'gemini-4-argon')
  const a2 = catalog2.find((c) => c.id === 'gemini-4-argon')
  assert.ok(a1 && a2, 'Both must contain gemini-4-argon')
  assert.deepEqual(a1.efforts?.slice().sort(), a2.efforts?.slice().sort())
  assert.deepEqual(a1.efforts?.slice().sort(), ['high', 'low', 'medium'])

  // Both must contain gemini-4-hydrogen with 4 efforts
  const h1 = catalog1.find((c) => c.id === 'gemini-4-hydrogen')
  const h2 = catalog2.find((c) => c.id === 'gemini-4-hydrogen')
  assert.ok(h1 && h2, 'Both must contain gemini-4-hydrogen')
  assert.deepEqual(h1.efforts?.slice().sort(), h2.efforts?.slice().sort())
  assert.deepEqual(h1.efforts?.slice().sort(), ['high', 'low', 'medium', 'xhigh'])

  // 100% item-by-item equality
  for (let i = 0; i < catalog1.length; i++) {
    assert.equal(catalog1[i]?.id, catalog2[i]?.id, `Item ${i} id must match`)
    assert.equal(catalog1[i]?.name, catalog2[i]?.name, `Item ${i} name must match`)
    assert.deepEqual(catalog1[i]?.efforts, catalog2[i]?.efforts, `Item ${i} efforts must match`)
  }
})

test('6. No-sorts scenario: fallback models dict parsing filters internal/tiered/sonar/disabled models', () => {
  const fixturePath = join(__dirname, 'fixtures', 'fetch-available-models.json')
  const parsed = JSON.parse(readFileSync(fixturePath, 'utf-8'))
  // Delete agentModelSorts to force models-dict fallback path
  delete parsed.agentModelSorts

  const rawList = parseModelsOutput(JSON.stringify(parsed))
  const catalog = foldEfforts(rawList)

  // Argon and Hydrogen must still be cleanly parsed
  const argon = catalog.find((c) => c.id === 'gemini-4-argon')
  assert.ok(argon, 'gemini-4-argon must exist even in no-sorts fallback')
  assert.deepEqual(argon.efforts?.slice().sort(), ['high', 'low', 'medium'])

  const hydrogen = catalog.find((c) => c.id === 'gemini-4-hydrogen')
  assert.ok(hydrogen, 'gemini-4-hydrogen must exist even in no-sorts fallback')
  assert.deepEqual(hydrogen.efforts?.slice().sort(), ['high', 'low', 'medium', 'xhigh'])

  // No -tiered, -sonar, -disabled models leaked
  for (const item of catalog) {
    assert.ok(!item.id.includes('-disabled'), `Item id must not contain -disabled: ${item.id}`)
    assert.ok(!item.id.includes('-tiered'), `Item id must not contain -tiered: ${item.id}`)
    assert.ok(!item.id.includes('-sonar'), `Item id must not contain -sonar: ${item.id}`)
  }

  // Unique model IDs
  const ids = catalog.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'No duplicate model IDs in no-sorts fallback')
  assert.equal(catalog.length, 18, 'Fallback models catalog should have 18 distinct models')
})

test('7. getAntigravityRequestModelId correctly maps xhigh without hardcoded model special-casing', () => {
  // Hydrogen maps xhigh -> gemini-4-hydrogen-xhigh
  assert.equal(
    getAntigravityRequestModelId('gemini-4-hydrogen', 'xhigh'),
    'gemini-4-hydrogen-xhigh',
  )
  assert.equal(
    getAntigravityRequestModelId('gemini-4-hydrogen', 'high'),
    'gemini-4-hydrogen-high',
  )

  // Argon maps standard efforts
  assert.equal(
    getAntigravityRequestModelId('gemini-4-argon', 'high'),
    'gemini-4-argon-high',
  )
  assert.equal(
    getAntigravityRequestModelId('gemini-4-argon', 'medium'),
    'gemini-4-argon-medium',
  )
  assert.equal(
    getAntigravityRequestModelId('gemini-4-argon', 'low'),
    'gemini-4-argon-low',
  )
})

test('8. Quota parsing: 3 groups from cli UA do not overwrite or destroy primary google 5h quota', async () => {
  const tmpPoolDir = mkdtempSync(join(tmpdir(), 'test-pool-quota-'))
  const tmpAccDir = mkdtempSync(join(tmpdir(), 'test-acc-quota-'))

  try {
    const pool = new AccountPoolManager(tmpPoolDir)
    const quota = new QuotaService(pool)

    const account = {
      id: 'acc_quota_test',
      email: 'test@example.com',
      enabled: true,
      authRequired: false,
      dir: tmpAccDir,
    }

  const summary3Groups = {
    groups: [
      {
        displayName: 'Gemini Models',
        description: 'Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash',
        buckets: [
          {
            bucketId: 'gemini-weekly',
            window: 'weekly',
            resetTime: '2026-11-23T07:45:13Z',
            remainingFraction: 0.985,
          },
          {
            bucketId: 'gemini-5h',
            window: '5h',
            resetTime: '2026-11-17T08:44:51Z',
            remainingFraction: 0.99,
          },
        ],
      },
      {
        displayName: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
        buckets: [
          { bucketId: '3p-weekly', window: 'weekly', resetTime: '2026-11-24T07:09:30Z', remainingFraction: 1 },
          { bucketId: '3p-5h', window: '5h', resetTime: '2026-11-17T12:09:30Z', remainingFraction: 1 },
        ],
      },
      {
        displayName: 'Gemini 4 Argon',
        description: 'Separate Argon weekly quota',
        buckets: [
          {
            bucketId: 'gemini-argon-wtu-weekly',
            window: 'weekly',
            resetTime: '2026-11-23T10:13:18Z',
            remainingFraction: 1,
          },
        ],
      },
    ],
  }

  ;(quota as unknown as { getValidAccessToken: () => Promise<string> }).getValidAccessToken = async () => 'fake-token'
  ;(quota as unknown as { fetchQuotaSummary: () => Promise<unknown> }).fetchQuotaSummary = async () => summary3Groups
  ;(quota as unknown as { fetchAvailableModels: () => Promise<unknown> }).fetchAvailableModels = async () => ({ models: {} })

  const result = await quota.refreshAccountQuota(account as unknown as Parameters<typeof quota.refreshAccountQuota>[0], true)
  assert.ok(result, 'Quota result must exist')

  const googleQuota = result.google
  assert.ok(googleQuota, 'Google family quota must exist')
  assert.equal(
    googleQuota.remainingFraction,
    0.99,
    'Google 5h remainingFraction must NOT be wiped by Argon weekly-only group',
  )
  assert.equal(
    googleQuota.resetTime,
    '2026-11-17T08:44:51Z',
    'Google 5h resetTime must NOT be wiped by Argon group',
  )
  assert.ok(
    googleQuota.weeklyFraction !== undefined,
    'Google weeklyFraction must be preserved',
  )
  } finally {
    rmSync(tmpPoolDir, { recursive: true, force: true })
    rmSync(tmpAccDir, { recursive: true, force: true })
  }
})

// 9 and 10 are the root-side mirror of the endpoint-error coverage core keeps in
// test/agy-quota-alignment.test.ts (root has no copy of that file). They were rewritten to
// the current contract: a project lookup now runs over the same endpoint list as the query
// RPCs (quota.ts resolveRequestProject -> ensureProject), so a host that names no project is
// skipped before any RPC is sent. Both tests therefore let the host name a project so the
// 500 / 401 / 403 refusals they assert on are real refusals of an accepted project.
test('9. QuotaService records endpointErrors in instance and exposes it via discoverAvailableModels', async () => {
  let endpoint1Called = false
  let endpoint2Called = false

  const server = createServer((req, res) => {
    const url = req.url ?? ''
    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (url.includes('loadCodeAssist')) {
      send(200, { cloudaicompanionProject: 'aicode-consumers' })
      return
    }
    if (url.includes('bad1')) {
      endpoint1Called = true
      send(500, { error: { code: 500, message: 'Internal Server Error' } })
      return
    }
    if (url.includes('bad2')) {
      endpoint2Called = true
      send(403, { error: { code: 403, message: 'Forbidden' } })
      return
    }
    send(404, { error: { code: 404, message: 'not part of the contract under test' } })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port

  const tmpPoolDir = mkdtempSync(join(tmpdir(), 'agy-test-pool-errors-'))
  try {
    const pool = new AccountPoolManager(tmpPoolDir)
    const quota = new QuotaService(pool)
    const endpoints = [
      `http://127.0.0.1:${port}/bad1`,
      `http://127.0.0.1:${port}/bad2`,
    ]

    const res = await quota.fetchAvailableModels('fake-token-secret-xyz', undefined, {
      accountKey: 'acct-errors',
      projectSeed: 'seed-errors',
      endpoints,
    })
    assert.equal(res, null, 'Must return null when all endpoints fail')
    assert.ok(endpoint1Called && endpoint2Called, 'All endpoints must be attempted')
    assert.ok(Array.isArray(quota.lastEndpointErrors), 'lastEndpointErrors must be an array')
    assert.equal(quota.lastEndpointErrors.length, 2, 'Should have 2 endpoint errors')
    assert.ok(quota.lastEndpointErrors[0]?.includes('500'), 'First error must mention 500')
    assert.ok(quota.lastEndpointErrors[1]?.includes('403'), 'Second error must mention 403')
    assert.ok(
      quota.lastEndpointErrors.every((entry) => entry.includes('127.0.0.1')),
      'each recorded error must name the endpoint that refused it',
    )
    assert.ok(
      !quota.lastEndpointErrors.some((entry) => entry.includes('secret-xyz')),
      'Endpoint errors must never contain token secret',
    )
    // The failures below are refusals of a project the backend named, not a skipped lookup.
    assert.equal(quota.lastModelsProjectResolution?.projectUnresolved, false, 'the lookup must have named a project')
    assert.equal(quota.lastModelsProjectResolution?.project, 'aicode-consumers', 'the named project is the one carried by the RPCs')
    assert.equal(quota.lastModelsProjectResolution?.source, 'loadCodeAssist', 'the project came from the lookup, not from a fallback')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(tmpPoolDir, { recursive: true, force: true })
  }
})

test('10. fetchQuotaSummary continues on 401/403 and records lastQuotaEndpointErrors', async () => {
  let firstCalled = false
  let secondCalled = false

  const server = createServer((req, res) => {
    const url = req.url ?? ''
    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (url.includes('loadCodeAssist')) {
      send(200, { cloudaicompanionProject: 'aicode-consumers' })
      return
    }
    if (url.includes('quota1')) {
      firstCalled = true
      send(401, { error: { code: 401, message: 'Quota Unauthorized' } })
      return
    }
    if (url.includes('quota2')) {
      secondCalled = true
      send(403, { error: { code: 403, message: 'Quota Forbidden' } })
      return
    }
    send(404, { error: { code: 404, message: 'not part of the contract under test' } })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port

  const tmpPoolDir = mkdtempSync(join(tmpdir(), 'agy-test-pool-quota-errors-'))
  try {
    const pool = new AccountPoolManager(tmpPoolDir)
    const quota = new QuotaService(pool)
    const endpoints = [
      `http://127.0.0.1:${port}/quota1`,
      `http://127.0.0.1:${port}/quota2`,
    ]

    const summary = await quota.fetchQuotaSummary('fake-token-secret-xyz', undefined, {
      accountKey: 'acct-quota-errors',
      projectSeed: 'seed-quota-errors',
      endpoints,
    })
    assert.equal(summary, null, 'Must return null when every endpoint refuses')
    assert.ok(firstCalled && secondCalled, 'A 401 on the first endpoint must not abort the fallback to the second')
    assert.ok(Array.isArray(quota.lastQuotaEndpointErrors), 'lastQuotaEndpointErrors must be an array')
    assert.equal(quota.lastQuotaEndpointErrors.length, 2, 'Both refusals must be recorded')
    assert.ok(quota.lastQuotaEndpointErrors[0]?.includes('401'), 'First recorded error must reflect 401')
    assert.ok(quota.lastQuotaEndpointErrors[1]?.includes('403'), 'Second recorded error must reflect 403')
    assert.ok(
      !quota.lastQuotaEndpointErrors.some((entry) => entry.includes('secret-xyz')),
      'Recorded errors must never contain the token',
    )
    assert.equal(quota.lastQuotaProjectResolution?.projectUnresolved, false, 'the lookup must have named a project before the refusals')
    assert.equal(quota.lastQuotaProjectResolution?.project, 'aicode-consumers', 'the named project is the one carried by the RPCs')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(tmpPoolDir, { recursive: true, force: true })
  }
})

test('11. antigravityHeaders() generates User-Agent matching CLI identity, never hub/2.8.0', () => {
  const headers = antigravityHeaders('fake-token-abc')
  const ua = headers['User-Agent']
  assert.ok(typeof ua === 'string', 'User-Agent header must be present')
  assert.match(ua, /^antigravity\/cli\/\d+\.\d+\.\d+/, 'User-Agent must start with antigravity/cli/')
  assert.ok(ua.includes('aidev_client'), 'User-Agent must contain aidev_client')
  assert.ok(ua.includes('auth_method=consumer'), 'User-Agent must contain auth_method=consumer')
  assert.ok(!ua.includes('antigravity/hub/'), 'User-Agent must NOT be antigravity/hub/')
})

test('12. streamGenerateContent transmits CLI User-Agent header over wire during generation', async () => {
  let capturedUA: string | undefined
  let capturedMethod: string | undefined
  let capturedUrl: string | undefined
  let capturedBody: any

  const server = createServer((req, res) => {
    capturedUA = req.headers['user-agent']
    capturedMethod = req.method
    capturedUrl = req.url
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { capturedBody = JSON.parse(raw) } catch {}
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"candidates":[{"content":{"parts":[{"text":"hello world"}]}}]}\n\n')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    const customEndpoint = `http://127.0.0.1:${port}`
    const result = await streamGenerateContent(
      'fake-token-123',
      {
        model: 'gemini-4-argon-medium',
        project: 'aicode-consumers',
        request: {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        },
      } as any,
      undefined,
      undefined,
      [customEndpoint],
    )

    assert.equal(result.response.status, 200, 'Mock stream server should return 200')
    assert.ok(capturedUA, 'Server must have captured User-Agent header')
    assert.match(capturedUA, /^antigravity\/cli\/\d+\.\d+\.\d+/, 'Over-the-wire User-Agent must be antigravity/cli/')
    assert.ok(capturedUA.includes('aidev_client'), 'Over-the-wire User-Agent must contain aidev_client')
    assert.ok(capturedUA.includes('auth_method=consumer'), 'Over-the-wire User-Agent must contain auth_method=consumer')
    assert.ok(!capturedUA.includes('antigravity/hub/'), 'Over-the-wire User-Agent must NOT contain antigravity/hub/')
    assert.equal(capturedMethod, 'POST', 'Request method must be POST')
    assert.ok(capturedUrl?.includes('/v1internal:streamGenerateContent?alt=sse'), 'Url must target streamGenerateContent endpoint')
    assert.equal(capturedBody?.model, 'gemini-4-argon-medium', 'Model in body must match requested wire model')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
