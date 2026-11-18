import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AgyAdapter,
  UPSTREAM_CONNECT_TIMEOUT_MS,
  UPSTREAM_IDLE_TIMEOUT_MS,
  UPSTREAM_STREAM_CEILING_MS,
  classifyPoolFailure,
  type AttemptFailure,
} from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import {
  AccountPoolManager,
  MODEL_UNSUPPORTED_COOLDOWN_MS,
  modelBaseOf,
  modelEntitlementOf,
} from '../src/host/pool.ts'
import { defaultConfig } from '../src/common/types.ts'
import { MessageId, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'

const WIRE_MODEL = 'gemini-4-hydrogen-high'
const FAMILY = 'google' as const

/** Requests the fake upstream actually received, so assertions run on real wire bytes. */
interface CapturedRequest {
  path: string
  json: Record<string, unknown> | null
}

interface Upstream {
  endpoint: string
  captured: CapturedRequest[]
  close(): Promise<void>
}

/**
 * Fake agy upstream: answers the project-discovery calls the adapter must complete before it
 * generates, then hands the generation request to `onGenerate`.
 */
async function startUpstream(
  onGenerate: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Upstream> {
  const captured: CapturedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (piece: Buffer) => chunks.push(piece))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let json: Record<string, unknown> | null = null
      try {
        json = raw ? JSON.parse(raw) : null
      } catch {
        json = null // Not JSON (or truncated): nothing to assert on for this request.
      }
      captured.push({ path: req.url ?? '', json })
    })

    if ((req.url ?? '').includes('loadCodeAssist')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ cloudaicompanionProject: 'test-project-123' }))
      return
    }
    if ((req.url ?? '').includes('onboardUser')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ done: true, cloudaicompanionProject: 'test-project-123' }))
      return
    }
    onGenerate(req, res)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    endpoint: `http://127.0.0.1:${port}`,
    captured,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function makePoolDir(): string {
  return mkdtempSync(join(tmpdir(), 'w4-entitlement-'))
}

/** Two signed-in accounts whose `models[]` entitlement lists are exactly `modelsA` / `modelsB`. */
function makePool(
  dir: string,
  modelsA: string[] | undefined,
  modelsB: string[] | undefined,
): { pool: AccountPoolManager; a: string; b: string } {
  const pool = new AccountPoolManager(dir)
  const first = pool.getAccounts()[0]!
  const second = pool.createAccountSlot('acc-b')
  if (modelsA) {
    pool.updateAccountQuotas(first.id, {
      [FAMILY]: { remainingFraction: 0.9, models: modelsA.map((modelId) => ({ modelId })) },
    })
  }
  if (modelsB) {
    pool.updateAccountQuotas(second.id, {
      [FAMILY]: { remainingFraction: 0.9, models: modelsB.map((modelId) => ({ modelId })) },
    })
  }
  pool.setMemoryToken(first.id, 'token-a', Date.now() + 60_000)
  pool.setMemoryToken(second.id, 'token-b', Date.now() + 60_000)
  return { pool, a: first.id, b: second.id }
}

function adapterFor(
  pool: AccountPoolManager,
  endpoint: string,
  overrides?: {
    connectTimeoutMs?: number
    idleTimeoutMs?: number
    streamCeilingMs?: number
    now?: () => number
  },
): AgyAdapter {
  return new AgyAdapter({
    getConfig: () => defaultConfig(),
    catalog: new ModelCatalog(undefined, [{ id: WIRE_MODEL, name: 'Gemini 4 Hydrogen High' }]),
    pool,
    endpointCandidates: [endpoint],
    ...overrides,
  })
}

function generateOptions(signal?: AbortSignal): GenerateOptions {
  const messages: Message[] = [
    {
      id: MessageId('w4-test-message-1'),
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    },
  ]
  return { provider: 'antigravity', model: WIRE_MODEL, messages, ...(signal ? { signal } : {}) }
}

async function drain(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

/** The terminal error the adapter reported, taken from the real chunk stream. */
function terminalError(chunks: StreamChunk[]): { message: string; code: string } {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i]!
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      return { message: chunk.reason.failure.message, code: chunk.reason.failure.code }
    }
  }
  assert.fail(`expected a terminal error chunk, got: ${JSON.stringify(chunks.map((c) => c.type))}`)
}

function generateCalls(upstream: Upstream): CapturedRequest[] {
  return upstream.captured.filter((entry) => entry.path.includes('streamGenerateContent'))
}

describe('Model-level entitlement selection (packages/core/src/pool.ts)', () => {
  it('normalizes effort suffixes onto the model base', () => {
    assert.equal(modelBaseOf('gemini-4-hydrogen-high'), 'gemini-4-hydrogen')
    assert.equal(modelBaseOf('gemini-4-hydrogen-tiered-high'), 'gemini-4-hydrogen')
    assert.equal(modelBaseOf('gemini-3.8-flash-xhigh'), 'gemini-3.8-flash')
    assert.equal(modelBaseOf('gemini-4-hydrogen'), 'gemini-4-hydrogen')
  })

  it('skips an account whose model list excludes the requested base model', () => {
    const dir = makePoolDir()
    try {
      const { pool, a, b } = makePool(
        dir,
        ['gemini-3.8-flash-high', 'gemini-2.5-pro'],
        ['gemini-4-hydrogen-medium'],
      )
      assert.equal(modelEntitlementOf(pool.getAccount(a)!, FAMILY, WIRE_MODEL).supported, false)
      const picked = pool.selectAccount(FAMILY, WIRE_MODEL)
      assert.ok(picked, 'some account must serve the model')
      assert.equal(picked!.id, b, 'the account that does not list the model must not be picked')
      assert.equal(pool.isAccountHealthy(pool.getAccount(a)!, FAMILY, WIRE_MODEL), false)
      // Same account is still healthy for a model it does list.
      assert.equal(pool.isAccountHealthy(pool.getAccount(a)!, FAMILY, 'gemini-3.8-flash-high'), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts a different effort variant of the same base model', () => {
    const dir = makePoolDir()
    try {
      const { pool, a } = makePool(dir, ['gemini-4-hydrogen-medium', 'gemini-4-hydrogen-low'], undefined)
      assert.equal(modelEntitlementOf(pool.getAccount(a)!, FAMILY, WIRE_MODEL).supported, true)
      assert.equal(pool.selectAccount(FAMILY, WIRE_MODEL)?.id, a)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats a missing quotas[family] entry as allowed instead of disqualifying the pool', () => {
    const dir = makePoolDir()
    try {
      const { pool, a } = makePool(dir, undefined, undefined)
      const account = pool.getAccount(a)!
      assert.equal(account.quotas[FAMILY]?.models, undefined)
      assert.equal(modelEntitlementOf(account, FAMILY, WIRE_MODEL).known, false)
      assert.equal(pool.isAccountHealthy(account, FAMILY, WIRE_MODEL), true)
      assert.equal(pool.selectAccount(FAMILY, WIRE_MODEL)?.id, a)
      assert.equal(pool.getFamilyStatus(FAMILY, WIRE_MODEL).reason, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never counts a *-disabled or sonar-only listing as entitlement to the hydrogen ladder', () => {
    const dir = makePoolDir()
    try {
      const { pool, a, b } = makePool(
        dir,
        ['gemini-4-hydrogen-disabled', 'gemini-4-hydrogen-sonar'],
        ['gemini-4-hydrogen-disabled'],
      )
      assert.equal(modelEntitlementOf(pool.getAccount(a)!, FAMILY, WIRE_MODEL).supported, false)
      assert.equal(modelEntitlementOf(pool.getAccount(b)!, FAMILY, WIRE_MODEL).supported, false)
      assert.equal(pool.selectAccount(FAMILY, WIRE_MODEL), null)
      assert.equal(pool.getFamilyStatus(FAMILY, WIRE_MODEL).reason, 'model_not_available')
      // What the listing DOES say: sonar entitles sonar, because it is a model of its own and not a
      // rung of the hydrogen ladder; a *-disabled entry entitles nothing.
      assert.equal(modelEntitlementOf(pool.getAccount(a)!, FAMILY, 'gemini-4-hydrogen-sonar').supported, true)
      assert.equal(modelEntitlementOf(pool.getAccount(b)!, FAMILY, 'gemini-4-hydrogen-sonar').supported, false)
      // Without a model in hand both accounts stay schedulable: the pool is not killed.
      assert.equal(pool.getFamilyStatus(FAMILY).reason, undefined)
      assert.ok(pool.selectAccount(FAMILY)?.id)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('soft-quarantines a model after a 403 without marking the account authRequired', () => {
    const dir = makePoolDir()
    try {
      const { pool, a } = makePool(dir, [WIRE_MODEL], undefined)
      pool.recordModelUnsupported(a, FAMILY, 'gemini-4-hydrogen-medium', 'HTTP 403: no permission')
      const account = pool.getAccount(a)!
      assert.equal(account.authRequired, undefined, '403 must not flag the credential')
      assert.equal(pool.isAccountHealthy(account, FAMILY, 'gemini-4-hydrogen-high'), false, 'same base is quarantined')
      assert.equal(pool.isAccountHealthy(account, FAMILY), true, 'other models of the account stay usable')
      assert.ok(MODEL_UNSUPPORTED_COOLDOWN_MS > 0)
      pool.clearModelQuarantine(a, FAMILY)
      assert.equal(pool.isAccountHealthy(account, FAMILY, 'gemini-4-hydrogen-high'), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Adapter error classification (src/host/adapter.ts)', () => {
  it('reports MODEL_NOT_AVAILABLE, without /ccl auth, when no account serves the model', async () => {
    const dir = makePoolDir()
    delete process.env.ANTIGRAVITY_TOKEN
    const { pool, a, b } = makePool(dir, ['gemini-3.8-flash-high'], ['gemini-2.5-pro'])
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end()
    })
    try {
      const chunks = await drain(adapterFor(pool, upstream.endpoint).stream(generateOptions()))
      const error = terminalError(chunks)
      assert.equal(error.code, 'MODEL_NOT_AVAILABLE')
      assert.match(error.message, /gemini-4-hydrogen-high/)
      assert.doesNotMatch(error.message, /\/ccl auth/)
      assert.doesNotMatch(error.message, /AUTH_REQUIRED/)
      assert.equal(generateCalls(upstream).length, 0, 'an unentitled account must never be asked to generate')
      assert.equal(pool.getAccount(a)!.authRequired, undefined)
      assert.equal(pool.getAccount(b)!.authRequired, undefined)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a 403 quarantines the model only: no authRequired, and the real upstream text is surfaced', async () => {
    const dir = makePoolDir()
    delete process.env.ANTIGRAVITY_TOKEN
    const { pool, a, b } = makePool(dir, [WIRE_MODEL], [WIRE_MODEL])
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { code: 403, message: 'The user has no permission to access model: gemini-4-hydrogen-high' },
        }),
      )
    })
    try {
      const chunks = await drain(adapterFor(pool, upstream.endpoint).stream(generateOptions()))
      const error = terminalError(chunks)
      assert.equal(generateCalls(upstream).length, 2, 'both accounts must be tried')
      assert.equal(error.code, 'MODEL_NOT_AVAILABLE')
      assert.match(error.message, /no permission to access model/)
      assert.doesNotMatch(error.message, /\/ccl auth/)

      for (const id of [a, b]) {
        assert.equal(pool.getAccount(id)!.authRequired, undefined, `403 must not mark ${id} authRequired`)
        assert.equal(pool.isAccountHealthy(pool.getAccount(id)!, FAMILY), true, `${id} stays usable for other models`)
        assert.equal(
          pool.isAccountHealthy(pool.getAccount(id)!, FAMILY, WIRE_MODEL),
          false,
          'the refused model is quarantined',
        )
      }
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a 401 still marks authRequired and ends in AUTH_REQUIRED with /ccl auth', async () => {
    const dir = makePoolDir()
    delete process.env.ANTIGRAVITY_TOKEN
    const { pool, a, b } = makePool(dir, [WIRE_MODEL], [WIRE_MODEL])
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 401, message: 'invalid credential' } }))
    })
    try {
      const chunks = await drain(adapterFor(pool, upstream.endpoint).stream(generateOptions()))
      const error = terminalError(chunks)
      assert.equal(error.code, 'AUTH_REQUIRED')
      assert.match(error.message, /\/ccl auth/)
      for (const id of [a, b]) {
        assert.equal(pool.getAccount(id)!.authRequired, true, `401 must mark ${id} authRequired`)
      }
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sends the captured agy envelope fields on the generation body', async () => {
    const dir = makePoolDir()
    delete process.env.ANTIGRAVITY_TOKEN
    const { pool } = makePool(dir, [WIRE_MODEL], undefined)
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}],"finishReason":"STOP"}}\n\n')
    })
    try {
      await drain(
        adapterFor(pool, upstream.endpoint, { now: () => 1_777_000_000_000 }).stream(generateOptions()),
      )
      const body = generateCalls(upstream)[0]?.json
      assert.ok(body, 'the adapter must have issued a generation request')
      assert.deepEqual(
        Object.keys(body!),
        ['project', 'requestId', 'request', 'model', 'userAgent', 'requestType'],
        'top-level keys must serialize in the captured order',
      )
      assert.equal(body!.userAgent, 'antigravity')
      assert.equal(body!.requestType, 'agent')
      const requestId = String(body!.requestId)
      const segments = requestId.split('/')
      assert.equal(segments.length, 5, `unexpected requestId: ${requestId}`)
      assert.equal(segments[0], 'agent')
      assert.equal(segments[2], '1777000000000', 'the injected clock must drive the epoch segment')
      assert.equal(segments[3], segments[1], 'cascade segment must stand in for the trajectory id')
      assert.equal(segments[4], '1', 'step index segment')
      const inner = body!.request as Record<string, unknown>
      const labels = inner.labels as Record<string, string>
      assert.ok(labels.cascade_id, 'labels must come from the envelope')
      assert.ok(labels.trajectory_id && labels.last_step_index)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('classifies every-429 exhaustion as RATE_LIMIT with a reset countdown', () => {
    const failures: AttemptFailure[] = [
      { cause: 'rate_limit', accountId: 'acc_a', httpStatus: 429, upstreamError: 'Too Many Requests' },
      { cause: 'rate_limit', accountId: 'acc_b', httpStatus: 429, upstreamError: 'Too Many Requests' },
    ]
    const verdict = classifyPoolFailure({
      family: FAMILY,
      wireModel: WIRE_MODEL,
      failures,
      familyStatus: { hasAccount: true, suppressed: true, reason: 'rate_limited', resetInMs: 42_000 },
    })
    assert.equal(verdict.code, 'RATE_LIMIT')
    assert.equal(verdict.status, 429)
    assert.match(verdict.message, /Resets in/)
    assert.match(verdict.message, /Too Many Requests/)
    assert.doesNotMatch(verdict.message, /\/ccl auth/)
  })

  it('classifies credential failures as AUTH_REQUIRED and 403 evidence as MODEL_NOT_AVAILABLE', () => {
    const authOnly = classifyPoolFailure({
      family: FAMILY,
      wireModel: WIRE_MODEL,
      failures: [{ cause: 'auth', accountId: 'acc_a', httpStatus: 401, upstreamError: 'invalid credential' }],
      familyStatus: { hasAccount: true, suppressed: false, reason: 'auth_required', resetInMs: null },
    })
    assert.equal(authOnly.code, 'AUTH_REQUIRED')
    assert.match(authOnly.message, /\/ccl auth/)

    const modelOnly = classifyPoolFailure({
      family: FAMILY,
      wireModel: WIRE_MODEL,
      failures: [{ cause: 'model_unsupported', accountId: 'acc_a', httpStatus: 403, upstreamError: 'no permission' }],
      familyStatus: { hasAccount: true, suppressed: false, resetInMs: null },
    })
    assert.equal(modelOnly.code, 'MODEL_NOT_AVAILABLE')
    assert.doesNotMatch(modelOnly.message, /\/ccl auth/)

    // An account that answered 429 was entitled: the honest verdict is the reset countdown.
    const mixed = classifyPoolFailure({
      family: FAMILY,
      wireModel: WIRE_MODEL,
      failures: [
        { cause: 'model_unsupported', accountId: 'acc_a', httpStatus: 403, upstreamError: 'no permission' },
        { cause: 'rate_limit', accountId: 'acc_b', httpStatus: 429, upstreamError: 'Too Many Requests' },
      ],
      familyStatus: { hasAccount: true, suppressed: true, reason: 'rate_limited', resetInMs: 15_000 },
    })
    assert.equal(mixed.code, 'RATE_LIMIT')
  })
})

describe('Upstream staged timeouts (src/host/adapter.ts)', () => {
  it('exposes the named timeout budgets instead of scattering magic numbers', () => {
    assert.equal(UPSTREAM_CONNECT_TIMEOUT_MS, 60_000)
    assert.equal(UPSTREAM_IDLE_TIMEOUT_MS, 120_000)
    assert.equal(UPSTREAM_STREAM_CEILING_MS, 1_800_000)
    // The ceiling is a backstop, so it must sit far above both per-phase budgets: a long
    // generation is allowed to run, a stalled one is caught by connect/idle first.
    assert.ok(UPSTREAM_STREAM_CEILING_MS > UPSTREAM_IDLE_TIMEOUT_MS)
    assert.ok(UPSTREAM_IDLE_TIMEOUT_MS > UPSTREAM_CONNECT_TIMEOUT_MS)
  })

  it('fails over and terminates when an account never answers', async () => {
    const dir = makePoolDir()
    delete process.env.ANTIGRAVITY_TOKEN
    const { pool } = makePool(dir, [WIRE_MODEL], [WIRE_MODEL])
    // A server that accepts the request and never answers: the 600s hang this replaces.
    const upstream = await startUpstream(() => {
      /* deliberately no response: the adapter must cut this attempt itself */
    })
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, { connectTimeoutMs: 400, streamCeilingMs: 2_000 }).stream(
          generateOptions(),
        ),
      )
      const elapsed = Date.now() - started
      const error = terminalError(chunks)
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /deadline/i)
      assert.ok(elapsed < 5_000, `stalled upstream must not hold the turn: ${elapsed}ms`)
      assert.equal(generateCalls(upstream).length, 2, 'both accounts must be tried before giving up')
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cuts a stalled stream at the idle budget instead of waiting forever', async () => {
    const dir = makePoolDir()
    delete process.env.ANTIGRAVITY_TOKEN
    const { pool } = makePool(dir, [WIRE_MODEL], undefined)
    // Headers arrive immediately (so the connect budget is cleared) and then the body goes silent.
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': keep-alive\n\n')
    })
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, { connectTimeoutMs: 5_000, idleTimeoutMs: 600 }).stream(
          generateOptions(),
        ),
      )
      const elapsed = Date.now() - started
      const error = terminalError(chunks)
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle/i, 'the message must name the phase that fired')
      assert.ok(elapsed < 5_000, `stalled SSE body must be cut by the idle budget: ${elapsed}ms`)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
