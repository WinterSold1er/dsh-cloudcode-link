import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  ensureProject,
  loadCodeAssist,
  clearProjectCache,
  stableProjectId,
  extractProjectId,
  antigravityHeaders,
} from '../src/host/client.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'

describe('M1: Core Client & Auth', () => {
  beforeEach(() => {
    clearProjectCache()
  })

  it('extractProjectId extracts project id from various payload shapes', () => {
    assert.equal(extractProjectId({ projectId: 'proj-123' }), 'proj-123')
    assert.equal(extractProjectId({ cloudaicompanionProject: { id: 'proj-nested' } }), 'proj-nested')
    assert.equal(extractProjectId({ cloudaicompanionProjects: [{ id: 'proj-arr' }] }), 'proj-arr')
    assert.equal(extractProjectId({ userDefinedCloudaicompanionProject: 'proj-ud' }), 'proj-ud')
  })

  it('stableProjectId produces deterministic UUID-shaped project ID', () => {
    const p1 = stableProjectId('user@example.com')
    const p2 = stableProjectId('user@example.com')
    const p3 = stableProjectId('other@example.com')
    assert.equal(p1, p2)
    assert.notEqual(p1, p3)
    assert.match(p1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('antigravityHeaders produces expected headers', () => {
    const headers = antigravityHeaders('fake-token')
    assert.equal(headers.Authorization, 'Bearer fake-token')
    assert.equal(headers['Content-Type'], 'application/json')
    assert.equal(headers.Accept, 'text/event-stream')
    assert.match(headers['User-Agent'] || '', /^antigravity\//)
    assert.ok(headers['Client-Metadata'])
    const meta = JSON.parse(String(headers['Client-Metadata']))
    assert.equal(meta.ideType, 'ANTIGRAVITY')
    assert.equal(meta.pluginType, 'GEMINI')
  })

  it('AccountPoolManager memory token priority and semaphore', async () => {
    const pool = new AccountPoolManager('/tmp/dsh-test-pool-' + Date.now())
    const acc = pool.getAccounts()[0]!
    assert.ok(acc)

    // Initially no memory token
    assert.equal(pool.getMemoryToken(acc.id), null)

    // Set memory token
    pool.setMemoryToken(acc.id, 'mem-token-123', Date.now() + 60_000)
    assert.equal(pool.getMemoryToken(acc.id), 'mem-token-123')

    // Semaphore acquire
    const release = await pool.acquireAccount(acc.id, 2)
    assert.equal(typeof release, 'function')
    release()

    // Expired memory token
    pool.setMemoryToken(acc.id, 'expired-token', Date.now() - 1000)
    assert.equal(pool.getMemoryToken(acc.id), null)
  })

  it('QuotaService checks env ANTIGRAVITY_TOKEN and memory token before disk', async () => {
    const pool = new AccountPoolManager('/tmp/dsh-test-pool-quota-' + Date.now())
    const quota = new QuotaService(pool)
    const acc = pool.getAccounts()[0]!

    // 1. Memory token
    pool.setMemoryToken(acc.id, 'mem-token-abc', Date.now() + 60_000)
    const tok1 = await quota.getValidAccessToken(acc)
    assert.equal(tok1, 'mem-token-abc')

    // 2. Env token override
    process.env.ANTIGRAVITY_TOKEN = 'env-token-xyz'
    try {
      const tok2 = await quota.getValidAccessToken(acc)
      assert.equal(tok2, 'env-token-xyz')
    } finally {
      delete process.env.ANTIGRAVITY_TOKEN
    }
  })

  it('ensureProject resolves project id via onboarding LRO polling mock', async () => {
    let getOpCalls = 0
    const server = createServer((req, res) => {
      if (req.url?.includes('loadCodeAssist')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({}))
      } else if (req.url?.includes('onboardUser')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ done: false, name: 'operations/op-test-123' }))
      } else if (req.url?.includes('getOperation')) {
        getOpCalls++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            done: true,
            name: 'operations/op-test-123',
            response: { cloudaicompanionProject: { id: 'lro-project-success' } },
          }),
        )
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
      const proj = await ensureProject('token-lro', 'user-seed', undefined, [endpoint])
      assert.equal(proj, 'lro-project-success')
      assert.equal(getOpCalls, 1)

      // Second call hits in-memory LRU cache without hitting server
      const cached = await ensureProject('token-lro', 'user-seed', undefined, [endpoint])
      assert.equal(cached, 'lro-project-success')
      assert.equal(getOpCalls, 1)
    } finally {
      server.close()
    }
  })

  it('ensureProject falls back to deterministic project id when endpoints fail', async () => {
    const badEndpoint = 'http://127.0.0.1:59999'
    const proj = await ensureProject('token-fail', 'user@example.com', undefined, [badEndpoint])
    assert.equal(proj, stableProjectId('user@example.com'))
  })

  it('loadCodeAssist bypassCache flag bypasses in-memory projectCache', async () => {
    let callCount = 0
    const server = createServer((req, res) => {
      if (req.url?.includes('loadCodeAssist')) {
        callCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ projectId: `proj-${callCount}` }))
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
      const p1 = await loadCodeAssist('token-bypass-test', undefined, [endpoint])
      assert.equal(p1, 'proj-1')
      assert.equal(callCount, 1)

      // Cached call with default bypassCache = false
      const p2 = await loadCodeAssist('token-bypass-test', undefined, [endpoint])
      assert.equal(p2, 'proj-1')
      assert.equal(callCount, 1)

      // Bypassed call with bypassCache = true
      const p3 = await loadCodeAssist('token-bypass-test', undefined, [endpoint], true)
      assert.equal(p3, 'proj-2')
      assert.equal(callCount, 2)
    } finally {
      server.close()
    }
  })
})
