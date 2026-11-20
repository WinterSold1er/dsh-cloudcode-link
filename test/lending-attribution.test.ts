import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AccountPoolManager } from '../src/host/pool.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { defaultConfig } from '../src/common/types.ts'
import { MessageId, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'

const G4_HIGH_MODEL = 'gemini-4-hydrogen-high'
const FAMILY = 'google'

function startMockUpstream(
  handler: (req: any, res: any) => void,
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any
      const url = `http://127.0.0.1:${addr.port}`
      resolve({
        server,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

function createLendingPool(dir: string) {
  const regId = 'acc_reg_test'
  const privId = 'acc_priv_test'

  const poolData = {
    version: 1,
    mode: 'round-robin',
    defaultCooldownMs: 900000,
    maxCooldownMs: 3600000,
    accounts: [
      {
        id: regId,
        alias: 'regular@example.com',
        dir: join(dir, regId),
        email: 'regular@example.com',
        enabled: true,
        createdAt: Date.now(),
        cooldowns: {},
        quotas: {
          [FAMILY]: {
            remainingFraction: 1,
            models: [{ modelId: 'gemini-2.5-flash' }, { modelId: 'gemini-4-hydrogen-sonar' }],
          },
        },
      },
      {
        id: privId,
        alias: 'privileged@example.com',
        dir: join(dir, privId),
        email: 'privileged@example.com',
        enabled: true,
        createdAt: Date.now(),
        cooldowns: {},
        quotas: {
          [FAMILY]: {
            remainingFraction: 1,
            models: [{ modelId: 'gemini-4-hydrogen-high' }, { modelId: 'gemini-4-hydrogen-sonar' }],
          },
        },
      },
    ],
  }
  writeFileSync(join(dir, 'pool.json'), JSON.stringify(poolData, null, 2))
  const pool = new AccountPoolManager(dir)
  pool.setMemoryToken(regId, 'token-reg', Date.now() + 60000)
  pool.setMemoryToken(privId, 'token-priv', Date.now() + 60000)
  return { pool, regId, privId }
}

function makeAdapter(pool: AccountPoolManager, endpoint: string, maxConcurrent = 1): AgyAdapter {
  return new AgyAdapter({
    getConfig: () => ({ ...defaultConfig(), maxConcurrent }),
    catalog: new ModelCatalog(undefined, [
      { id: G4_HIGH_MODEL, name: 'Gemini 4 Hydrogen High' },
      { id: 'gemini-4-hydrogen-sonar', name: 'Gemini 4 Hydrogen Sonar' },
    ]),
    pool,
    endpointCandidates: [endpoint],
  })
}

function makeGenerateOptions(model = G4_HIGH_MODEL): GenerateOptions {
  const messages: Message[] = [
    {
      id: MessageId('msg-1'),
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    },
  ]
  return { provider: 'antigravity', model, messages }
}

async function drainStream(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('Capability Lending Attribution & Concurrency Safeguards', () => {
  test('1. HTTP 401 in lending scenario attributes authRequired to borrowedAccount, not borrower', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-attr-401-'))
    const upstream = await startMockUpstream((req, res) => {
      // Return 401 specifically when the borrowed privileged token is used
      if (req.headers.authorization === 'Bearer token-priv') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 401, message: 'Invalid token credential for priv' } }))
      } else {
        // Fallback to regular account succeeds
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end('data: {"response": {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}}\n\n')
      }
    })

    try {
      const { pool, regId, privId } = createLendingPool(dir)
      const adapter = makeAdapter(pool, upstream.url)

      // Regular account requests high-tier model; lending will borrow privileged account token-priv
      const chunks = await drainStream(adapter.stream(makeGenerateOptions()))
      assert.ok(chunks.length > 0)

      // PRIVILEGED account (which actually supplied the failing token) must be marked authRequired
      const privAcc = pool.getAccount(privId)
      assert.equal(privAcc?.authRequired, true, 'Privileged borrowed account must be marked authRequired on 401')

      // REGULAR account (innocent borrower) must NOT be marked authRequired
      const regAcc = pool.getAccount(regId)
      assert.notEqual(regAcc?.authRequired, true, 'Borrower account must NOT be falsely marked authRequired')
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('2. HTTP 429 in lending scenario attributes failure and cooldown to borrowedAccount, not borrower', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-attr-429-'))
    const upstream = await startMockUpstream((req, res) => {
      // Return 429 specifically when the borrowed privileged token is used
      if (req.headers.authorization === 'Bearer token-priv') {
        res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after': '600' })
        res.end(JSON.stringify({ error: { code: 429, message: 'Resource exhausted on priv' } }))
      } else {
        // Fallback succeeds
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end('data: {"response": {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}}\n\n')
      }
    })

    try {
      const { pool, regId, privId } = createLendingPool(dir)
      const adapter = makeAdapter(pool, upstream.url)

      const chunks = await drainStream(adapter.stream(makeGenerateOptions()))
      assert.ok(chunks.length > 0)

      // PRIVILEGED account must enter cooldown
      const privAcc = pool.getAccount(privId)
      const privCooldown = privAcc?.cooldowns[FAMILY]
      assert.ok(privCooldown, 'Privileged borrowed account must have cooldown recorded on 429')
      assert.ok(privCooldown.cooldownUntil > Date.now(), 'Privileged cooldown must be in the future')

      // REGULAR account must NOT be put into cooldown
      const regAcc = pool.getAccount(regId)
      const regCooldown = regAcc?.cooldowns[FAMILY]
      assert.ok(!regCooldown || regCooldown.cooldownUntil <= Date.now(), 'Borrower account must NOT be put into cooldown')
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('3. Concurrency semaphore properly restricts borrowed account in lending scenario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-attr-sem-'))
    let activeUpstreamConnections = 0
    let maxObservedConcurrent = 0

    const upstream = await startMockUpstream(async (_req, res) => {
      activeUpstreamConnections++
      if (activeUpstreamConnections > maxObservedConcurrent) {
        maxObservedConcurrent = activeUpstreamConnections
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"response": {"candidates": [{"content": {"parts": [{"text": "chunk"}]}}]}}\n\n')
      // Hold connection open briefly
      await new Promise((r) => setTimeout(r, 60))
      res.write('data: {"response": {"candidates": [{"finishReason": "STOP"}]}}\n\n')
      res.end()
      activeUpstreamConnections--
    })

    try {
      // Set maxConcurrent = 1 for the pool
      const { pool, privId } = createLendingPool(dir)
      const adapter = makeAdapter(pool, upstream.url, 1)

      // Launch 2 parallel requests both borrowing the privileged account
      const p1 = drainStream(adapter.stream(makeGenerateOptions()))
      const p2 = drainStream(adapter.stream(makeGenerateOptions()))

      const [c1, c2] = await Promise.all([p1, p2])
      assert.ok(c1.length > 0)
      assert.ok(c2.length > 0)

      // The privileged account semaphore with maxConcurrent = 1 should have serialized or limited the requests
      assert.equal(maxObservedConcurrent, 1, 'Max concurrent requests against the borrowed account must not exceed maxConcurrent (1)')
    } finally {
      await upstream.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
