/**
 * staged-upstream-timeout.test.ts — the staged upstream budgets that replaced the old 180s cap.
 *
 * Production budgets: 60s to get response headers (connect), 120s of silence between two adjacent
 * chunks (idle), and a 30-minute hard ceiling that is a backstop, not a normal-path limit. There
 * is no total-duration cap on a stream that keeps producing chunks.
 *
 * Waiting 60/120/1800 real seconds in a test suite is not an option, so every case injects the
 * same ratios at 1/1000 scale through `AgyAdapterDeps.connectTimeoutMs / idleTimeoutMs /
 * streamCeilingMs`: 60ms, 120ms and 1800ms. The retired 180s total cap scales to 180ms, which is
 * the number the continuous-stream case has to beat. The defaults themselves are asserted
 * separately in model-entitlement-and-error-classification.test.ts.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgyAdapter, classifyPoolFailure, type AttemptFailure } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { defaultConfig } from '../src/common/types.ts'
import { MessageId, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'

const WIRE_MODEL = 'gemini-4-hydrogen-high'
const FAMILY = 'google' as const

/** 1/1000 of the production budgets, so a whole case runs in well under two seconds. */
const CONNECT_MS = 60
const IDLE_MS = 120
const CEILING_MS = 1_800
/** The retired total cap (180_000ms) at the same scale: the case that must no longer be cut. */
const RETIRED_TOTAL_CAP_MS = 180

interface CapturedCall {
  path: string
  authorization: string | undefined
}

interface Upstream {
  endpoint: string
  /** Generation attempts, counted when the request headers reach the server. */
  generateAttempts(): number
  authorizations(): string[]
  close(): Promise<void>
}

/**
 * Fake agy upstream: answers the project-discovery calls the adapter must complete before it
 * generates, then hands the generation request to `onGenerate`.
 */
async function startUpstream(
  onGenerate: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Upstream> {
  const calls: CapturedCall[] = []
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    const isGenerate = !url.includes('loadCodeAssist') && !url.includes('onboardUser')
    if (isGenerate) {
      calls.push({ path: url, authorization: req.headers.authorization })
    }
    if (url.includes('loadCodeAssist')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ cloudaicompanionProject: 'test-project-123' }))
      return
    }
    if (url.includes('onboardUser')) {
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
    generateAttempts: () => calls.length,
    authorizations: () => calls.map((call) => call.authorization ?? ''),
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function makePoolDir(): string {
  return mkdtempSync(join(tmpdir(), 'staged-timeout-'))
}

/** Two signed-in accounts; neither declares a model list, so both may serve the model. */
function makePool(dir: string): { pool: AccountPoolManager; a: string; b: string } {
  const pool = new AccountPoolManager(dir)
  const first = pool.getAccounts()[0]!
  const second = pool.createAccountSlot('acc-b')
  pool.setMemoryToken(first.id, 'token-a', Date.now() + 60_000)
  pool.setMemoryToken(second.id, 'token-b', Date.now() + 60_000)
  return { pool, a: first.id, b: second.id }
}

function adapterFor(
  pool: AccountPoolManager,
  endpoint: string,
  overrides: { connectTimeoutMs: number; idleTimeoutMs: number; streamCeilingMs: number },
): AgyAdapter {
  return new AgyAdapter({
    getConfig: () => defaultConfig(),
    catalog: new ModelCatalog(undefined, [{ id: WIRE_MODEL, name: 'Gemini 4 Hydrogen High' }]),
    pool,
    endpointCandidates: [endpoint],
    ...overrides,
  })
}

function generateOptions(): GenerateOptions {
  const messages: Message[] = [
    {
      id: MessageId('staged-timeout-message-1'),
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    },
  ]
  return { provider: 'antigravity', model: WIRE_MODEL, messages }
}

async function drain(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function textOf(chunk: StreamChunk): string | null {
  if (chunk.type !== 'text-delta') return null
  return typeof (chunk as { text?: unknown }).text === 'string' ? (chunk as { text: string }).text : null
}

function textsOf(chunks: StreamChunk[]): string[] {
  return chunks.map(textOf).filter((text): text is string => text !== null)
}

function errorOf(chunks: StreamChunk[]): { message: string; code?: string } | null {
  for (const chunk of chunks) {
    if (chunk.type !== 'finish') continue
    const reason = (chunk as { reason?: { kind?: string; failure?: { message?: string; code?: string } } }).reason
    if (reason?.kind === 'error') {
      return { message: reason.failure?.message ?? '', code: reason.failure?.code }
    }
  }
  return null
}

function sseText(text: string): string {
  return `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text }] } }] } })}\n\n`
}

const SSE_STOP = 'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n'

/** Stream `texts` one chunk per `gapMs`, then end the stream. Cleared when the client hangs up. */
function writeSlowStream(res: ServerResponse, texts: readonly string[], gapMs: number): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  let index = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    if (timer) clearTimeout(timer)
  }
  res.on('close', stop)
  const push = (): void => {
    if (res.writableEnded || res.destroyed) return
    if (index >= texts.length) {
      res.write(SSE_STOP)
      res.end()
      return
    }
    const text = texts[index++]!
    res.write(sseText(text))
    timer = setTimeout(push, gapMs)
  }
  push()
}

/**
 * Write `texts` one per `gapMs`, then keep the socket open and stay silent forever: no SSE_STOP and
 * no res.end(), so only OUR idle budget is allowed to end the attempt.
 */
function writeThenGoSilent(res: ServerResponse, texts: readonly string[], gapMs: number): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  let index = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  res.on('close', () => {
    if (timer) clearTimeout(timer)
  })
  const push = (): void => {
    if (res.writableEnded || res.destroyed) return
    if (index >= texts.length) return // silence from here on
    res.write(sseText(texts[index++]!))
    timer = setTimeout(push, gapMs)
  }
  push()
}

describe('Staged upstream timeouts (src/host/adapter.ts)', () => {
  it('never truncates a generation that keeps producing chunks', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const { pool } = makePool(dir)
    // 20 chunks, one every 30ms: 600ms of wall clock, i.e. 3.3x the retired 180s cap at this
    // scale (180ms), 5x the idle budget and 10x the connect budget. At production scale this is a
    // ten-minute generation, which the old 180s cap cut at a third of its length.
    const texts = Array.from({ length: 20 }, (_unused, i) => `chunk-${i + 1}`)
    const upstream = await startUpstream((_req, res) => writeSlowStream(res, texts, 30))
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, {
          connectTimeoutMs: CONNECT_MS,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: CEILING_MS,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started

      assert.deepEqual(textsOf(chunks), texts, 'every chunk of a live stream must reach the caller')
      assert.equal(errorOf(chunks), null, 'a continuous stream must not end in a timeout error')
      assert.equal(upstream.generateAttempts(), 1, 'a healthy upstream must not be retried')
      // The point of the case: total duration well past the old cap, still not cut.
      assert.ok(
        elapsed > RETIRED_TOTAL_CAP_MS,
        `stream must outlast the retired total cap to prove anything: ${elapsed}ms`,
      )
      assert.ok(elapsed > IDLE_MS * 4, `stream must outlast several idle budgets: ${elapsed}ms`)
      assert.ok(elapsed < CEILING_MS, `stream must finish before the ceiling backstop: ${elapsed}ms`)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails a stalled stream on the idle budget and fails over to the next account', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const { pool } = makePool(dir)
    // Headers arrive at once (connect budget cleared) and then the body never produces a chunk.
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': keep-alive\n\n')
    })
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, {
          connectTimeoutMs: 1_000,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: 4_000,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'a silent body must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle deadline/i, 'the message must name the phase that fired')
      assert.doesNotMatch(error.message, /connect deadline/i, 'this was not a connect-phase stall')
      assert.ok(elapsed < 2_000, `idle budget must cut the stall quickly: ${elapsed}ms`)
      assert.deepEqual(
        [...new Set(upstream.authorizations())].sort(),
        ['Bearer token-a', 'Bearer token-b'],
        'a pre-emission stall is a stalled upstream and must rotate accounts',
      )
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an idle stall AFTER content reached the caller cuts the turn without replaying it', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const { pool } = makePool(dir)
    // The upstream means to send 8 chunks but goes silent after 3 of them. The ceiling is pushed to
    // 4s so the idle budget is the only one that can fire: this is the idle-phase twin of the
    // ceiling case below, and it is the phase the no-replay rule at src/host/adapter.ts:1031-1041
    // actually guards.
    const planned = Array.from({ length: 8 }, (_unused, i) => `partial-${i + 1}`)
    const delivered = planned.slice(0, 3)
    const upstream = await startUpstream((_req, res) => writeThenGoSilent(res, delivered, 30))
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, {
          connectTimeoutMs: CONNECT_MS,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: 4_000,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'a stalled body must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle deadline/i, 'the idle budget, not the ceiling, cut this turn')
      assert.doesNotMatch(error.message, /ceiling/i, 'the ceiling was 4s away; idle fired first')
      // The half answer is delivered verbatim, once — never replayed on a second account.
      assert.deepEqual(textsOf(chunks), delivered, 'the caller keeps exactly what was emitted')
      assert.ok(textsOf(chunks).length < planned.length, 'the missing tail must not be re-fetched')
      assert.ok(elapsed >= IDLE_MS, `the idle budget must actually have expired: ${elapsed}ms`)
      assert.ok(elapsed < 1_500, `idle must cut the stall long before the ceiling: ${elapsed}ms`)
      assert.equal(
        upstream.generateAttempts(),
        1,
        'an idle stall after emission must not switch accounts and replay the half answer',
      )
      assert.deepEqual(
        [...new Set(upstream.authorizations())],
        [upstream.authorizations()[0]],
        'only the first account may be contacted once content was delivered',
      )
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still fails an account that never answers on the connect budget', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const { pool } = makePool(dir)
    // The socket is accepted but no response head is ever written: the idle budget is deliberately
    // longer than the connect budget so the two phases cannot be confused.
    const upstream = await startUpstream(() => {
      /* never answer */
    })
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, {
          connectTimeoutMs: CONNECT_MS,
          idleTimeoutMs: 5_000,
          streamCeilingMs: 10_000,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'an account that never answers must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /connect deadline/i, 'the message must name the connect phase')
      assert.doesNotMatch(error.message, /idle deadline/i, 'no chunk phase was reached')
      assert.ok(elapsed < 2_000, `connect budget must end the turn: ${elapsed}ms`)
      assert.equal(
        upstream.generateAttempts(),
        2,
        'a connect timeout must fail over to the other account before giving up',
      )
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the ceiling backstop is what stops a stream that trickles forever, without retrying it', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const { pool } = makePool(dir)
    // A chunk every 100ms is under the 120ms idle budget, so idle never fires; only the ceiling
    // can end this. Content was already emitted, so no failover is allowed either.
    const forever = Array.from({ length: 40 }, (_unused, i) => `drip-${i + 1}`)
    const upstream = await startUpstream((_req, res) => writeSlowStream(res, forever, 100))
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, {
          connectTimeoutMs: CONNECT_MS,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: 500,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'an endless stream must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /ceiling/i, 'the message must name the backstop that fired')
      assert.doesNotMatch(error.message, /idle deadline/i, 'idle must not be blamed for a live stream')
      assert.ok(textsOf(chunks).length >= 3, 'the caller must have received the chunks emitted first')
      assert.ok(elapsed < 1_500, `the ceiling must end the turn: ${elapsed}ms`)
      assert.equal(upstream.generateAttempts(), 1, 'a cut-after-emission stream must not be replayed')
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('classifies a connect stall and an idle stall with the same code but different text', () => {
    const report = (failures: AttemptFailure[]) =>
      classifyPoolFailure({
        failures,
        family: FAMILY,
        wireModel: WIRE_MODEL,
        familyStatus: { hasAccount: true, suppressed: false, resetInMs: null },
      })
    const connect = report([
      { cause: 'timeout', accountId: 'acc-a', httpStatus: null, upstreamError: 'connect deadline blown', phase: 'connect' },
    ])
    const idle = report([
      { cause: 'timeout', accountId: 'acc-a', httpStatus: null, upstreamError: 'body went silent', phase: 'idle' },
    ])

    assert.equal(connect.code, 'UPSTREAM_TIMEOUT')
    assert.equal(idle.code, 'UPSTREAM_TIMEOUT')
    assert.match(connect.message, /connect deadline/i)
    assert.doesNotMatch(connect.message, /idle deadline/i)
    assert.match(idle.message, /idle deadline/i)
    assert.doesNotMatch(idle.message, /connect deadline/i)
  })
})
