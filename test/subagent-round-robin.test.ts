import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountPoolManager } from '../src/host/pool.ts'
import { SessionStore } from '../src/host/sessions.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import { defaultConfig } from '../src/common/types.ts'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

function makeTestMessages(text = 'Hello'): Message[] {
  return [
    {
      id: 'm1' as any,
      role: 'user',
      source: { kind: 'user' } as any,
      content: [{ type: 'text', text }],
    },
  ]
}

describe('Subagent & Main Session Round-Robin Rotation and Session Affinity E2E', () => {
  it('rotates across accounts for main and subagent sessions, preserving affinity per session', async () => {
    const receivedTokens: string[] = []
    const receivedSessionEnvelopes: Array<{ sessionId?: string; step?: number }> = []

    // 1. Mock CloudCode server on dynamic port
    const server: Server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        // Fast-path project discovery
        if (req.url?.includes('loadCodeAssist') || req.url?.includes('loadCodeProjects')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: 'test-project' }))
          return
        }

        const authHeader = req.headers.authorization || ''
        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
        receivedTokens.push(token)

        try {
          const body = JSON.parse(raw)
          // Antigravity request envelope labels contain session info
          receivedSessionEnvelopes.push({
            sessionId: body?.request?.sessionId ?? req.headers['x-goog-api-client'] as string | undefined,
            step: undefined,
          })
        } catch {}

        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello from " + token}]}}]}}\n\n',
        )
        res.write('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n')
        res.end()
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as { port: number }).port
    const endpoint = `http://127.0.0.1:${port}`

    const dir = mkdtempSync(join(tmpdir(), 'agy-subagent-rr-'))
    try {
      const pool = new AccountPoolManager(dir)
      pool.setMode('round-robin')

      // Set up 3 managed accounts in pool
      const accA = pool.getAccounts()[0]! // primary
      const accB = pool.createAccountSlot('account-B')
      const accC = pool.createAccountSlot('account-C')

      pool.setMemoryToken(accA.id, 'token-acc-a', Date.now() + 3600_000)
      pool.setMemoryToken(accB.id, 'token-acc-b', Date.now() + 3600_000)
      pool.setMemoryToken(accC.id, 'token-acc-c', Date.now() + 3600_000)

      // Ensure all accounts have healthy non-zero quotas
      pool.updateAccountQuotas(accA.id, { google: { remainingFraction: 1.0 } })
      pool.updateAccountQuotas(accB.id, { google: { remainingFraction: 0.9 } })
      pool.updateAccountQuotas(accC.id, { google: { remainingFraction: 0.8 } })

      const sessionStore = new SessionStore(join(dir, 'sessions.json'))
      const catalog = new ModelCatalog(
        undefined,
        [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }],
        60_000,
      )

      const adapter = new AgyAdapter({
        getConfig: () => ({
          ...defaultConfig(),
          sessionStartQuotaRefreshMinIntervalMs: 0,
        }),
        catalog,
        pool,
        sessionStore,
        endpointCandidates: [endpoint],
      })

      // Helper to execute a stream request
      async function executeRequest(sessionId: string): Promise<StreamChunk[]> {
        const options: GenerateOptions = {
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          sessionId: sessionId as any,
          messages: makeTestMessages(`Query from ${sessionId}`),
        }
        const chunks: StreamChunk[] = []
        for await (const chunk of adapter.stream(options)) {
          chunks.push(chunk)
        }
        return chunks
      }

      // =========================================================================
      // ① Main session first request -> allocates and binds Account A
      // =========================================================================
      const chunksMain1 = await executeRequest('main-session')
      assert.ok(chunksMain1.some((c) => c.type === 'finish'), 'main-session req 1 must finish ok')
      assert.equal(receivedTokens[0], 'token-acc-a', 'Main session must allocate Account A on first turn')
      assert.equal(
        sessionStore.getBoundAccount('main-session'),
        accA.id,
        'Main session must be bound to Account A in session store',
      )

      // =========================================================================
      // ② Subagent 1 first request -> round-robin allocates and binds Account B
      // =========================================================================
      const chunksSub1_1 = await executeRequest('subagent-session-1')
      assert.ok(chunksSub1_1.some((c) => c.type === 'finish'), 'subagent-1 req 1 must finish ok')
      assert.equal(receivedTokens[1], 'token-acc-b', 'Subagent 1 must allocate Account B via round-robin')
      assert.equal(
        sessionStore.getBoundAccount('subagent-session-1'),
        accB.id,
        'Subagent 1 must be bound to Account B in session store',
      )

      // =========================================================================
      // ③ Subagent 2 first request -> round-robin allocates and binds Account C
      // =========================================================================
      const chunksSub2_1 = await executeRequest('subagent-session-2')
      assert.ok(chunksSub2_1.some((c) => c.type === 'finish'), 'subagent-2 req 1 must finish ok')
      assert.equal(receivedTokens[2], 'token-acc-c', 'Subagent 2 must allocate Account C via round-robin')
      assert.equal(
        sessionStore.getBoundAccount('subagent-session-2'),
        accC.id,
        'Subagent 2 must be bound to Account C in session store',
      )

      // =========================================================================
      // ④ Session Affinity verification:
      //    Main session turn 2 -> retains Account A
      //    Subagent 1 turn 2   -> retains Account B
      //    Subagent 2 turn 2   -> retains Account C
      // =========================================================================
      const chunksMain2 = await executeRequest('main-session')
      assert.ok(chunksMain2.some((c) => c.type === 'finish'), 'main-session req 2 must finish ok')
      assert.equal(receivedTokens[3], 'token-acc-a', 'Main session turn 2 must stick to Account A (Affinity)')
      assert.equal(sessionStore.getBoundAccount('main-session'), accA.id)

      const chunksSub1_2 = await executeRequest('subagent-session-1')
      assert.ok(chunksSub1_2.some((c) => c.type === 'finish'), 'subagent-1 req 2 must finish ok')
      assert.equal(receivedTokens[4], 'token-acc-b', 'Subagent 1 turn 2 must stick to Account B (Affinity)')
      assert.equal(sessionStore.getBoundAccount('subagent-session-1'), accB.id)

      const chunksSub2_2 = await executeRequest('subagent-session-2')
      assert.ok(chunksSub2_2.some((c) => c.type === 'finish'), 'subagent-2 req 2 must finish ok')
      assert.equal(receivedTokens[5], 'token-acc-c', 'Subagent 2 turn 2 must stick to Account C (Affinity)')
      assert.equal(sessionStore.getBoundAccount('subagent-session-2'), accC.id)

      // =========================================================================
      // Additional verification: Subagent 3 (new session) -> wraps around to Account A
      // =========================================================================
      const chunksSub3_1 = await executeRequest('subagent-session-3')
      assert.ok(chunksSub3_1.some((c) => c.type === 'finish'), 'subagent-3 req 1 must finish ok')
      assert.equal(receivedTokens[6], 'token-acc-a', 'Subagent 3 must wrap around to Account A in circular round-robin')
      assert.equal(sessionStore.getBoundAccount('subagent-session-3'), accA.id)
    } finally {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('handles mid-session 429 failover by switching to next healthy account and updating binding', async () => {
    let failTokenAccA = false
    const receivedTokens: string[] = []

    // Mock server returns 429 when failTokenAccA is true and token is token-acc-a
    const server: Server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        if (req.url?.includes('loadCodeAssist') || req.url?.includes('loadCodeProjects')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: 'test-project' }))
          return
        }

        const authHeader = req.headers.authorization || ''
        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
        receivedTokens.push(token)

        if (failTokenAccA && token === 'token-acc-a') {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'retry-after': '60',
          })
          res.end(JSON.stringify({ error: { message: 'Resource exhausted: rate limit 429' } }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Success with " + token}]}}]}}\n\n',
        )
        res.write('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n')
        res.end()
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as { port: number }).port
    const endpoint = `http://127.0.0.1:${port}`

    const dir = mkdtempSync(join(tmpdir(), 'agy-failover-rr-'))
    try {
      const pool = new AccountPoolManager(dir)
      pool.setMode('round-robin')

      const accA = pool.getAccounts()[0]!
      const accB = pool.createAccountSlot('account-B')
      const accC = pool.createAccountSlot('account-C')

      pool.setMemoryToken(accA.id, 'token-acc-a', Date.now() + 3600_000)
      pool.setMemoryToken(accB.id, 'token-acc-b', Date.now() + 3600_000)
      pool.setMemoryToken(accC.id, 'token-acc-c', Date.now() + 3600_000)

      pool.updateAccountQuotas(accA.id, { google: { remainingFraction: 1.0 } })
      pool.updateAccountQuotas(accB.id, { google: { remainingFraction: 1.0 } })
      pool.updateAccountQuotas(accC.id, { google: { remainingFraction: 1.0 } })

      const sessionStore = new SessionStore(join(dir, 'sessions.json'))
      const catalog = new ModelCatalog(
        undefined,
        [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }],
        60_000,
      )

      const adapter = new AgyAdapter({
        getConfig: () => ({
          ...defaultConfig(),
          sessionStartQuotaRefreshMinIntervalMs: 0,
        }),
        catalog,
        pool,
        sessionStore,
        endpointCandidates: [endpoint],
      })

      async function executeRequest(sessionId: string): Promise<StreamChunk[]> {
        const options: GenerateOptions = {
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          sessionId: sessionId as any,
          messages: makeTestMessages(`Query from ${sessionId}`),
        }
        const chunks: StreamChunk[] = []
        for await (const chunk of adapter.stream(options)) {
          chunks.push(chunk)
        }
        return chunks
      }

      // Step 1: Initial request binds session to Account A
      const chunks1 = await executeRequest('session-failover-test')
      assert.ok(chunks1.some((c) => c.type === 'finish'), 'Turn 1 must finish ok')
      assert.equal(sessionStore.getBoundAccount('session-failover-test'), accA.id)
      assert.equal(receivedTokens[0], 'token-acc-a')

      // Step 2: Trigger 429 on Account A
      failTokenAccA = true
      receivedTokens.length = 0

      // Turn 2: Adapter tries Account A (bound account), receives 429, puts Account A in cooldown,
      // silently switches to Account B in the same turn, and re-binds the session!
      const chunks2 = await executeRequest('session-failover-test')
      assert.ok(chunks2.some((c) => c.type === 'finish'), 'Turn 2 must succeed via failover')

      // Verify that Account A was tried first, then Account B
      assert.deepEqual(
        receivedTokens,
        ['token-acc-a', 'token-acc-b'],
        'Must attempt Account A first, encounter 429, then failover to Account B',
      )

      // Session store binding must now be updated to Account B!
      assert.equal(
        sessionStore.getBoundAccount('session-failover-test'),
        accB.id,
        'Session affinity binding must be updated to Account B after failover',
      )

      // Account A must be in cooldown
      assert.equal(
        pool.isAccountHealthy(pool.getAccount(accA.id)!, 'google'),
        false,
        'Account A must be unhealthy due to 429 cooldown',
      )

      // Step 3: Subsequent turn for this session directly uses Account B (new affinity)
      receivedTokens.length = 0
      const chunks3 = await executeRequest('session-failover-test')
      assert.ok(chunks3.some((c) => c.type === 'finish'), 'Turn 3 must succeed')
      assert.deepEqual(
        receivedTokens,
        ['token-acc-b'],
        'Subsequent turn must directly use Account B with no attempts on Account A',
      )
      assert.equal(sessionStore.getBoundAccount('session-failover-test'), accB.id)

      // Step 4: A new subagent session is created while Account A is in cooldown
      // Round-robin must skip Account A and pick Account C!
      receivedTokens.length = 0
      const chunksSub = await executeRequest('subagent-while-a-in-cooldown')
      assert.ok(chunksSub.some((c) => c.type === 'finish'), 'Subagent turn must succeed')
      assert.deepEqual(
        receivedTokens,
        ['token-acc-c'],
        'New subagent must skip unhealthy Account A and round-robin to Account C',
      )
      assert.equal(sessionStore.getBoundAccount('subagent-while-a-in-cooldown'), accC.id)
    } finally {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refreshQuotasForSelection does not block or execute HTTPS fetches in round-robin mode', async () => {
    let quotaRefreshCalled = false
    const dir = mkdtempSync(join(tmpdir(), 'agy-quota-rr-check-'))
    try {
      const pool = new AccountPoolManager(dir)
      pool.setMode('round-robin')

      const accA = pool.getAccounts()[0]!
      pool.setMemoryToken(accA.id, 'token-acc-a', Date.now() + 3600_000)

      const mockQuota = {
        refreshQuotaSummaryOnly: async () => {
          quotaRefreshCalled = true
          return null
        },
      }

      const sessionStore = new SessionStore(join(dir, 'sessions.json'))
      const catalog = new ModelCatalog(
        undefined,
        [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }],
        60_000,
      )

      const adapter = new AgyAdapter({
        getConfig: () => ({
          ...defaultConfig(),
          sessionStartQuotaRefreshMinIntervalMs: 10_000,
        }),
        catalog,
        pool,
        quota: mockQuota as any,
        sessionStore,
      })

      // Calling private refreshQuotasForSelection via method call or stream initiation
      await (adapter as any).refreshQuotasForSelection('google')
      assert.equal(
        quotaRefreshCalled,
        false,
        'refreshQuotasForSelection must NOT trigger HTTPS fetch in round-robin mode',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
