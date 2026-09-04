import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { mapSseStreamToChunks } from '../src/host/sse-mapper.ts'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { defaultConfig } from '../src/common/types.ts'

describe('M3: Adapter & Failover', () => {
  it('prepareCall returns model info and stream handle', async () => {
    const catalog = new ModelCatalog(
      async () => ({ stdout: 'gemini-3.7-flash-high\tGemini 3.7 Flash High', stderr: '' }),
      [
        {
          id: 'gemini-3.7-flash',
          name: 'Gemini 3.7 Flash',
          efforts: ['low', 'medium', 'high'],
        },
      ],
      60_000,
    )

    const adapter = new AgyAdapter({
      getConfig: () => ({
        ...defaultConfig(),
        defaultModel: 'gemini-3.7-flash',
        defaultEffort: 'high',
      }),
      catalog,
    })

    const prepared = await adapter.prepareCall('antigravity', 'gemini-3.7-flash')
    assert.equal(prepared.model.provider, 'antigravity')
    assert.equal(prepared.model.id, 'gemini-3.7-flash')
    assert.equal(typeof prepared.stream, 'function')
  })

  it('stream yields error finish when no accounts are available or token missing', async () => {
    const catalog = new ModelCatalog(
      async () => ({ stdout: '', stderr: '' }),
      [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }],
      60_000,
    )

    const adapter = new AgyAdapter({
      getConfig: () => ({
        ...defaultConfig(),
        defaultModel: 'gemini-3.7-flash',
      }),
      catalog,
    })

    const msgs: Message[] = [
      {
        id: 'm1' as any,
        source: { kind: 'user' } as any,
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    ]

    const opts: GenerateOptions = {
      provider: 'antigravity',
      model: 'gemini-3.7-flash',
      messages: msgs,
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(opts)) {
      chunks.push(chunk)
    }

    assert.equal(chunks.length, 1)
    const finish = chunks[0]!
    assert.equal(finish.type, 'finish')
    if (finish.type === 'finish') {
      assert.equal(finish.reason.kind, 'error')
    }
  })

  it('mapSseStreamToChunks signals onFirstEmit and circuit breaks on mid-stream error', async () => {
    let emitted = false
    const onFirstEmit = () => {
      emitted = true
    }

    const sseBody = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello world"}]}}]}}\n\n',
      'data: {"response":{"error":{"code":429,"message":"Resource exhausted"}}}\n\n',
    ].join('')

    const response = new Response(sseBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of mapSseStreamToChunks(response, undefined, onFirstEmit)) {
      chunks.push(chunk)
    }

    assert.equal(emitted, true)
    // First received text delta
    const textDelta = chunks.find((c) => c.type === 'text-delta')
    assert.ok(textDelta)

    // Terminated with finish: error
    const finish = chunks[chunks.length - 1]!
    assert.equal(finish.type, 'finish')
    if (finish.type === 'finish') {
      assert.equal(finish.reason.kind, 'error')
      assert.match(finish.reason.failure?.message || '', /Resource exhausted/)
    }
  })

  it('mapSseStreamToChunks terminates with STREAM_EXCEPTION and closes active block on mid-stream transport error', async () => {
    let emitted = false
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Partial output"}]}}]}}\n\n',
          ),
        )
        setTimeout(() => {
          controller.error(new Error('Connection dropped unexpectedly'))
        }, 10)
      },
    })

    const mockResp = new Response(errorStream, {
      headers: { 'Content-Type': 'text/event-stream' },
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of mapSseStreamToChunks(mockResp, undefined, () => {
      emitted = true
    })) {
      chunks.push(chunk)
    }

    assert.equal(emitted, true)
    const types = chunks.map((c) => c.type)
    assert.ok(types.includes('block-start'))
    assert.ok(types.includes('text-delta'))
    assert.ok(types.includes('block-end'))
    assert.ok(types.includes('finish'))

    const finish = chunks[chunks.length - 1]!
    assert.equal(finish.type, 'finish')
    if (finish.type === 'finish') {
      assert.equal(finish.reason.kind, 'error')
      assert.equal((finish.reason as any).failure?.code, 'STREAM_EXCEPTION')
      assert.match((finish.reason as any).failure?.message || '', /Connection dropped/)
    }
  })

  it('adapter pre-emission 429 fails over silently to second account in pool', async () => {
    const pool = new AccountPoolManager('/tmp/dsh-test-pool-failover-' + Date.now())
    const slot2 = pool.createAccountSlot('Account 2')
    const accounts = pool.getAccounts()

    pool.setMemoryToken(accounts[0]!.id, 'token-acc-1', Date.now() + 60_000)
    pool.setMemoryToken(accounts[1]!.id, 'token-acc-2', Date.now() + 60_000)

    const server = createServer((req, res) => {
      if (req.headers.authorization === 'Bearer token-acc-1') {
        res.writeHead(429, { 'Content-Type': 'text/plain' })
        res.end('Rate limit exceeded')
      } else if (req.headers.authorization === 'Bearer token-acc-2') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Success from failover account"}]}}]}}\n\n',
        )
        res.write('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n')
        res.end()
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as { port: number }).port
    const endpoint = `http://127.0.0.1:${port}`

    try {
      const catalog = new ModelCatalog(undefined, [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }], 60_000)
      const adapter = new AgyAdapter({
        getConfig: () => defaultConfig(),
        catalog,
        pool,
        endpointCandidates: [endpoint],
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream({
        provider: 'antigravity',
        model: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] } as any],
      })) {
        chunks.push(chunk)
      }

      const textChunk = chunks.find((c) => c.type === 'text-delta')
      assert.ok(textChunk)
      assert.equal((textChunk as any).text, 'Success from failover account')

      const finishChunk = chunks.find((c) => c.type === 'finish')
      assert.ok(finishChunk)
      assert.equal((finishChunk as any).reason.kind, 'stop')
    } finally {
      server.close()
    }
  })

  it('prepareCall resolves model aliases properly', async () => {
    const catalog = new ModelCatalog(
      undefined,
      [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
        { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B' },
      ],
      60_000,
    )

    const adapter = new AgyAdapter({
      getConfig: () => defaultConfig(),
      catalog,
    })

    const preparedSonnet = await adapter.prepareCall('antigravity', 'sonnet')
    assert.equal(preparedSonnet.model.id, 'sonnet')
    assert.equal(preparedSonnet.model.name, 'Claude Sonnet 4.6')
    assert.equal(preparedSonnet.model.context?.contextWindow, 200_000)

    const preparedGpt = await adapter.prepareCall('antigravity', 'gpt-oss')
    assert.equal(preparedGpt.model.id, 'gpt-oss')
    assert.equal(preparedGpt.model.name, 'GPT-OSS 120B')
    assert.equal(preparedGpt.model.context?.contextWindow, 200_000)
  })

  it('stream yields RATE_LIMIT when requested model family quota is exhausted (not AUTH_REQUIRED)', async () => {
    const pool = new AccountPoolManager('/tmp/dsh-test-pool-quota-' + Date.now())
    const acc = pool.getAccounts()[0]!
    pool.setMemoryToken(acc.id, 'mock-token', Date.now() + 60_000)

    // Set anthropic quota exhausted with reset in 2 hours
    const resetTime = new Date(Date.now() + 7200_000).toISOString()
    pool.updateAccountQuotas(acc.id, {
      anthropic: {
        remainingFraction: 0.0,
        resetTime,
      },
      google: {
        remainingFraction: 0.9,
      },
    })

    const catalog = new ModelCatalog(
      undefined,
      [
        { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking' },
        { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
      ],
      60_000,
    )

    const adapter = new AgyAdapter({
      getConfig: () => defaultConfig(),
      catalog,
      pool,
    })

    // 1. Requesting Claude should yield RATE_LIMIT with reset countdown, NOT AUTH_REQUIRED
    const claudeChunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'antigravity',
      model: 'claude-opus-4-6-thinking',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello Claude' }] } as any],
    })) {
      claudeChunks.push(chunk)
    }

    assert.equal(claudeChunks.length, 1)
    const claudeFinish = claudeChunks[0]!
    assert.equal(claudeFinish.type, 'finish')
    if (claudeFinish.type === 'finish') {
      assert.equal(claudeFinish.reason.kind, 'error')
      const failure = (claudeFinish.reason as any).failure
      assert.equal(failure?.code, 'RATE_LIMIT')
      assert.match(failure?.message || '', /anthropic/)
      assert.match(failure?.message || '', /quota exhausted/i)
      assert.match(failure?.message || '', /Resets in/i)
      assert.doesNotMatch(failure?.message || '', /AUTH_REQUIRED/)
    }
  })

  it('stream yields AUTH_REQUIRED when all accounts are quarantined or no accounts exist', async () => {
    const pool = new AccountPoolManager('/tmp/dsh-test-pool-no-auth-' + Date.now())
    const acc = pool.getAccounts()[0]!
    pool.markAuthRequired(acc.id, 'Invalid token')

    const catalog = new ModelCatalog(
      undefined,
      [{ id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking' }],
      60_000,
    )

    const adapter = new AgyAdapter({
      getConfig: () => defaultConfig(),
      catalog,
      pool,
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'antigravity',
      model: 'claude-opus-4-6-thinking',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] } as any],
    })) {
      chunks.push(chunk)
    }

    assert.equal(chunks.length, 1)
    const finish = chunks[0]!
    assert.equal(finish.type, 'finish')
    if (finish.type === 'finish') {
      assert.equal(finish.reason.kind, 'error')
      const failure = (finish.reason as any).failure
      assert.equal(failure?.code, 'AUTH_REQUIRED')
      assert.match(failure?.message || '', /No authenticated Antigravity account available/)
    }
  })
})
