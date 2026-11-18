/**
 * idle-no-replay.test.ts — the failover gate that protects a half-delivered answer.
 *
 * The rule under test lives in src/host/adapter.ts:1031-1041:
 *
 *     if (stallPhase === 'idle' && !contentReachedCaller && attempt < maxAttempts && ...) continue
 *
 * i.e. an idle (adjacent-chunk) stall is failover-able ONLY while the caller has been given nothing.
 * As soon as one real chunk (a chunk that is not a finish) has been handed to the caller, the turn
 * is terminal: switching accounts would replay the half answer the caller already saw.
 *
 * `contentReachedCaller` is deliberately not the mapper's `hasEmitted`. mapSseStreamToChunks calls
 * notifyFirstEmit() even when it closes a stream with a synthetic finish/abort/error chunk (see the
 * comment at src/host/adapter.ts:937-941 and src/sse-mapper.ts:247/256/339), so `hasEmitted` is
 * already true for a stall that delivered nothing at all. The control cases below pin both halves:
 *   - content delivered -> no second account (kills a mutation that drops `!contentReachedCaller`),
 *   - nothing delivered -> the second account IS used (kills a mutation that swaps in `!hasEmitted`,
 *     which would wrongly freeze the no-content case).
 *
 * Every case talks to a real local node:http fake upstream with two signed-in accounts and injects
 * the production budget ratios at 1/1000 scale (60ms connect / 120ms idle / 1800ms ceiling), so no
 * test ever waits for the real 120s idle budget.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { defaultConfig } from '../src/common/types.ts'
import { MessageId, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'

const WIRE_MODEL = 'gemini-4-hydrogen-high'

/** 1/1000 of the production budgets, same scale as staged-upstream-timeout.test.ts. */
const CONNECT_MS = 60
const IDLE_MS = 120
const CEILING_MS = 1_800

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
  const calls: { authorization: string | undefined }[] = []
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    const isGenerate = !url.includes('loadCodeAssist') && !url.includes('onboardUser')
    if (isGenerate) {
      calls.push({ authorization: req.headers.authorization })
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
  return mkdtempSync(join(tmpdir(), 'idle-no-replay-'))
}

/** Two signed-in accounts; neither declares a model list, so both may serve the model. */
function makePool(dir: string): AccountPoolManager {
  const pool = new AccountPoolManager(dir)
  const first = pool.getAccounts()[0]!
  const second = pool.createAccountSlot('acc-b')
  pool.setMemoryToken(first.id, 'token-a', Date.now() + 60_000)
  pool.setMemoryToken(second.id, 'token-b', Date.now() + 60_000)
  return pool
}

function adapterFor(
  pool: AccountPoolManager,
  endpoint: string,
  logs: string[],
  overrides: { connectTimeoutMs: number; idleTimeoutMs: number; streamCeilingMs: number },
): AgyAdapter {
  return new AgyAdapter({
    getConfig: () => defaultConfig(),
    catalog: new ModelCatalog(undefined, [{ id: WIRE_MODEL, name: 'Gemini 4 Hydrogen High' }]),
    pool,
    endpointCandidates: [endpoint],
    log: (msg) => logs.push(msg),
    ...overrides,
  })
}

function generateOptions(): GenerateOptions {
  const messages: Message[] = [
    {
      id: MessageId('idle-no-replay-message-1'),
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

function finishCount(chunks: StreamChunk[]): number {
  return chunks.filter((chunk) => chunk.type === 'finish').length
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

/**
 * Write `texts` one per `gapMs` and then keep the socket open, silent, forever: the body-phase stall
 * under test. The stream is deliberately NOT ended and no finishReason is sent — only our idle
 * budget is allowed to end the attempt.
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

/**
 * Send headers and then SSE *comments* forever. Comments are bytes on the socket that no SSE parser
 * turns into a chunk, so the adapter's adjacent-chunk timer is never re-armed: this is a stall that
 * delivered nothing, and it must stay failover-able.
 */
function headersThenCommentsOnly(res: ServerResponse, everyMs: number): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.write(': ping\n\n')
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return
    res.write(': ping\n\n')
  }, everyMs)
  res.on('close', () => clearInterval(timer))
}

describe('Idle timeout vs. the no-replay rule (src/host/adapter.ts:1031-1041)', () => {
  it('a single delivered chunk makes an idle stall terminal: no second account, no replay', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const pool = makePool(dir)
    const logs: string[] = []
    const emitted = ['partial-answer-1']
    // Headers + one real (non-finish) chunk arrive, then the upstream goes silent past the idle
    // budget. The ceiling is 15x further away, so idle is the only budget that can fire here.
    const upstream = await startUpstream((_req, res) => writeThenGoSilent(res, emitted, 30))
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, logs, {
          connectTimeoutMs: CONNECT_MS,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: 4_000,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'a stalled body must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle deadline/i, 'the message must name the idle phase')
      assert.doesNotMatch(error.message, /connect deadline/i, 'headers were in hand')
      assert.doesNotMatch(error.message, /ceiling/i, 'the ceiling was nowhere near; idle cut this turn')

      // The safety property itself: the half answer was delivered exactly once, never replayed.
      assert.deepEqual(textsOf(chunks), emitted, 'the half answer must reach the caller once, not twice')
      assert.equal(finishCount(chunks), 1, 'exactly one terminal chunk, from one attempt')

      // Only one account may be touched.
      assert.equal(upstream.generateAttempts(), 1, 'a cut-after-emission turn must not be replayed')
      assert.equal(
        new Set(upstream.authorizations()).size,
        1,
        'the second account must never be contacted once content was delivered',
      )
      assert.equal(
        logs.filter((msg) => /switching accounts/i.test(msg)).length,
        0,
        'the failover branch must not be taken',
      )

      // Timing proof: idle really had to expire, and idle (not the ceiling) ended the attempt.
      assert.ok(elapsed >= IDLE_MS, `idle budget must actually have expired: ${elapsed}ms`)
      assert.ok(elapsed < 1_500, `idle must cut the stall quickly: ${elapsed}ms`)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('control — an idle stall that delivered nothing IS failover-able', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const pool = makePool(dir)
    const logs: string[] = []
    // Headers flushed, zero body bytes: the caller is handed nothing, so failover is required.
    // This is the case that fails if the guard is switched from `!contentReachedCaller` to the
    // mapper's `!hasEmitted`, because notifyFirstEmit() also fires for a synthetic finish.
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.flushHeaders()
    })
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, logs, {
          connectTimeoutMs: 1_000,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: 4_000,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'a silent body must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle deadline/i, 'headers arrived, so this is an idle stall')
      assert.doesNotMatch(error.message, /connect deadline/i, 'the connect budget was 1s; idle cut it')
      assert.deepEqual(textsOf(chunks), [], 'no content may be reported for a silent upstream')

      assert.equal(upstream.generateAttempts(), 2, 'a pre-emission idle stall must fail over')
      assert.deepEqual(
        [...new Set(upstream.authorizations())].sort(),
        ['Bearer token-a', 'Bearer token-b'],
        'both accounts must be tried before giving up',
      )
      assert.equal(
        logs.filter((msg) => /idle timeout/i.test(msg) && /switching accounts/i.test(msg)).length,
        1,
        'exactly one account switch, logged',
      )
      assert.ok(elapsed < 2_000, `two idle budgets must still end the turn fast: ${elapsed}ms`)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('control — bytes that are not content do not make the turn terminal', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const pool = makePool(dir)
    const logs: string[] = []
    // SSE comments every 40ms keep the socket busy without ever producing a chunk, so the
    // adjacent-chunk budget still expires. If the guard were keyed on socket activity instead of
    // on delivered content, this case would wrongly stop after one account.
    const upstream = await startUpstream((_req, res) => headersThenCommentsOnly(res, 40))
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, logs, {
          connectTimeoutMs: 1_000,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: 4_000,
        }).stream(generateOptions()),
      )
      const error = errorOf(chunks)

      assert.ok(error, 'a comment-only body must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle deadline/i, 'comments are not chunks, so idle fired')
      assert.deepEqual(textsOf(chunks), [], 'comments must not be reported as content')
      assert.equal(upstream.generateAttempts(), 2, 'comment bytes must not freeze the failover')
      assert.equal(
        new Set(upstream.authorizations()).size,
        2,
        'both accounts must be tried',
      )
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the no-replay rule holds with the production-scaled ceiling as well (idle cut, 1800ms ceiling)', async () => {
    delete process.env.ANTIGRAVITY_TOKEN
    const dir = makePoolDir()
    const pool = makePool(dir)
    const logs: string[] = []
    const emitted = ['answer-part-1', 'answer-part-2']
    // Two chunks, then silence. Budgets are the exact 1/1000 production triple, so this is the
    // same shape a real 120s production stall has — just compressed.
    const upstream = await startUpstream((_req, res) => writeThenGoSilent(res, emitted, 30))
    const started = Date.now()
    try {
      const chunks = await drain(
        adapterFor(pool, upstream.endpoint, logs, {
          connectTimeoutMs: CONNECT_MS,
          idleTimeoutMs: IDLE_MS,
          streamCeilingMs: CEILING_MS,
        }).stream(generateOptions()),
      )
      const elapsed = Date.now() - started
      const error = errorOf(chunks)

      assert.ok(error, 'a stalled body must end in an error')
      assert.equal(error.code, 'UPSTREAM_TIMEOUT')
      assert.match(error.message, /idle deadline/i)
      assert.deepEqual(textsOf(chunks), emitted, 'both delivered chunks, in order, exactly once')
      assert.equal(upstream.generateAttempts(), 1, 'no replay of the half answer')
      assert.ok(elapsed < CEILING_MS, `idle must have cut the turn before the ceiling: ${elapsed}ms`)
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
