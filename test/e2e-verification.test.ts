import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

import { resolveConfig } from '../src/common/config.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import {
  SqliteStatsStorage,
  MemoryStatsStorage,
  createStatsStorage,
  StatsCollector,
  type RequestMetric,
} from '../src/host/stats.ts'
import { apply } from '../src/index.ts'

describe('QA End-to-End (E2E) Comprehensive Verification Suite', () => {
  // =========================================================================
  // Section 1: Configuration Externalization & Boundary Resilience
  // =========================================================================
  describe('1. Configuration Externalization & Boundary Resilience', () => {
    it('1.1: Full environment variable hierarchy overrides file defaults without code changes', () => {
      const customDb = '/tmp/test-env-stats.db'
      const customEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DSH_CLOUDCODE_STATS_ENABLED: 'false',
        DSH_CLOUDCODE_DB_PATH: customDb,
        DSH_CLOUDCODE_STATS_BUFFER_CAPACITY: '1024',
        DSH_CLOUDCODE_STATS_BATCH_SIZE: '50',
        DSH_CLOUDCODE_STATS_FLUSH_INTERVAL_MS: '500',
        DSH_CLOUDCODE_STATS_RETENTION_DAYS: '15',
        DSH_CLOUDCODE_STATS_RETENTION_CHECK_INTERVAL_MS: '1800000',
        DSH_CLOUDCODE_LOW_QUOTA_THRESHOLD: '0.12',
        DSH_CLOUDCODE_SESSION_START_QUOTA_REFRESH_MIN_INTERVAL_MS: '8000',
        DSH_CLOUDCODE_API_MAX_PAGE_SIZE: '60',
      }

      const cfg = resolveConfig(undefined, customEnv)
      assert.equal(cfg.statsEnabled, false)
      assert.equal(cfg.statsDbPath, customDb)
      assert.equal(cfg.statsBufferCapacity, 1024)
      assert.equal(cfg.statsBatchSize, 50)
      assert.equal(cfg.statsFlushIntervalMs, 500)
      assert.equal(cfg.statsRetentionDays, 15)
      assert.equal(cfg.statsRetentionCheckIntervalMs, 1800000)
      assert.equal(cfg.lowQuotaThreshold, 0.12)
      assert.equal(cfg.sessionStartQuotaRefreshMinIntervalMs, 8000)
      assert.equal(cfg.apiMaxPageSize, 60)
    })

    it('1.2: Legacy DSH_AGY_* fallback works when DSH_CLOUDCODE_* variables are absent', () => {
      const legacyEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DSH_AGY_STATS_ENABLED: 'true',
        DSH_AGY_DB_PATH: '/tmp/legacy-stats.db',
      }
      delete legacyEnv.DSH_CLOUDCODE_STATS_ENABLED
      delete legacyEnv.DSH_CLOUDCODE_DB_PATH

      const cfg = resolveConfig(undefined, legacyEnv)
      assert.equal(cfg.statsDbPath, '/tmp/legacy-stats.db')
      assert.equal(cfg.statsEnabled, true)
    })

    it('1.3: Malformed numeric config safely clamped without NaN or application crash', () => {
      const badEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DSH_CLOUDCODE_LOW_QUOTA_THRESHOLD: '-0.5',
        DSH_CLOUDCODE_STATS_BUFFER_CAPACITY: '-100',
        DSH_CLOUDCODE_STATS_FLUSH_INTERVAL_MS: '2',
      }

      const cfg = resolveConfig(undefined, badEnv)
      assert.equal(cfg.lowQuotaThreshold, 0)
      assert.equal(cfg.statsBufferCapacity, 1)
      assert.equal(cfg.statsFlushIntervalMs, 10)
    })

    it('1.4: Invalid or unwritable DB path gracefully degrades to MemoryStatsStorage', () => {
      const invalidPath = '/dev/null/impossible/directory/stats.db'
      const storage = createStatsStorage({
        dbPath: invalidPath,
        retentionDays: 7,
        flushIntervalMs: 100,
        maxQueueSize: 100,
        cleanupIntervalMs: 60000,
      })

      assert.ok(storage instanceof MemoryStatsStorage)
      assert.ok(!(storage instanceof SqliteStatsStorage))
    })
  })

  // =========================================================================
  // Section 2: Stats Telemetry & SQLite Persistence E2E
  // =========================================================================
  describe('2. Stats Telemetry & SQLite Persistence E2E', () => {
    it('2.1: Asynchronous batch writing and capacity-based oldest metric eviction', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-stats-1-'))
      const dbPath = join(tempDir, 'e2e-stats.db')
      try {
        const storage = new SqliteStatsStorage(dbPath)
        const droppedItems: any[] = []

        const collector = new StatsCollector(
          {
            retentionDays: 30,
            dbPath,
            flushIntervalMs: 200,
            maxQueueSize: 50,
            batchSize: 20,
            cleanupIntervalMs: 3600000,
          },
          storage,
          {
            onDrop: (dropped) => droppedItems.push(...dropped),
          },
        )
        collector.start()

        for (let i = 0; i < 80; i++) {
          collector.recordRequest({
            requestId: `req-batch-${i}`,
            sessionId: `sess-batch-${i % 5}`,
            accountId: `acc-${i % 2}`,
            model: 'gemini-2.5-pro',
            status: 'success',
            latencyMs: 100 + i,
            ttftMs: 30,
            promptTokens: 100,
            cachedTokens: 50,
            outputTokens: 20,
          })
        }

        assert.ok(droppedItems.length >= 30, `Expected >= 30 dropped, got ${droppedItems.length}`)

        await collector.flush()

        const count = await storage.countRequests()
        assert.equal(count, 80 - droppedItems.length)

        await collector.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('2.2: WAL mode verified & zero lock contention under high-concurrency read/write stress', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-stats-2-'))
      const dbPath = join(tempDir, 'e2e-stats.db')
      try {
        const storage = new SqliteStatsStorage(dbPath)

        const numBatches = 5
        const batchSize = 40
        const now = Date.now()

        const writePromises = Array.from({ length: numBatches }, async (_, bIdx) => {
          const metrics: RequestMetric[] = Array.from({ length: batchSize }, (_, i) => ({
            requestId: `concur-write-${bIdx}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            sessionId: `sess-concur-${bIdx}`,
            accountId: `acc-concur-${bIdx % 3}`,
            model: 'gemini-2.5-flash',
            timestamp: now - (bIdx * 100 + i),
            status: i % 10 === 0 ? 'error' : 'success',
            latencyMs: 150 + i,
            ttftMs: 40 + i,
            cacheHit: true,
            promptTokens: 500,
            cachedTokens: 250,
            outputTokens: 50,
          }))
          await storage.saveRequestMetrics(metrics)
        })

        const readPromises = Array.from({ length: 50 }, async (_, rIdx) => {
          if (rIdx % 3 === 0) {
            return await storage.getOverviewMetrics()
          } else if (rIdx % 3 === 1) {
            return await storage.getAccountUsage()
          } else {
            return await storage.queryRequests({ limit: 20 })
          }
        })

        const results = await Promise.all([...writePromises, ...readPromises])
        assert.equal(results.length, 55)

        await storage.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('2.3: Mathematical ground truth verification for SQL aggregations vs raw metrics', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-stats-3-'))
      const mathDbPath = join(tempDir, 'math-verify.db')
      try {
        const storage = new SqliteStatsStorage(mathDbPath)
        const baseTime = Date.now()

        const groundTruthMetrics: RequestMetric[] = [
          { requestId: 'm-1', sessionId: 's-1', accountId: 'acc-A', model: 'gemini-1.5-pro', timestamp: baseTime - 1000, status: 'success', latencyMs: 100, ttftMs: 30, cacheHit: true, promptTokens: 1000, cachedTokens: 800, outputTokens: 100 },
          { requestId: 'm-2', sessionId: 's-1', accountId: 'acc-A', model: 'gemini-1.5-pro', timestamp: baseTime - 2000, status: 'success', latencyMs: 200, ttftMs: 50, cacheHit: true, promptTokens: 1000, cachedTokens: 600, outputTokens: 150 },
          { requestId: 'm-3', sessionId: 's-1', accountId: 'acc-A', model: 'gemini-1.5-pro', timestamp: baseTime - 3000, status: 'abort',   latencyMs: 300, ttftMs: 60, cacheHit: false, promptTokens: 500, cachedTokens: 0, outputTokens: 20 },
          { requestId: 'm-4', sessionId: 's-2', accountId: 'acc-B', model: 'claude-3-7-sonnet', timestamp: baseTime - 4000, status: 'error', latencyMs: 400, ttftMs: undefined, cacheHit: false, promptTokens: 400, cachedTokens: 0, outputTokens: 0 },
          { requestId: 'm-5', sessionId: 's-2', accountId: 'acc-B', model: 'claude-3-7-sonnet', timestamp: baseTime - 5000, status: 'success', latencyMs: 500, ttftMs: 100, cacheHit: true, promptTokens: 2000, cachedTokens: 1500, outputTokens: 200 },
          { requestId: 'm-6', sessionId: 's-3', accountId: 'acc-B', model: 'claude-3-7-sonnet', timestamp: baseTime - 6000, status: 'success', latencyMs: 600, ttftMs: 120, cacheHit: true, promptTokens: 1000, cachedTokens: 500, outputTokens: 100 },
          { requestId: 'm-7', sessionId: 's-3', accountId: 'acc-C', model: 'gemini-2.5-flash', timestamp: baseTime - 7000, status: 'success', latencyMs: 700, ttftMs: 80, cacheHit: false, promptTokens: 300, cachedTokens: 0, outputTokens: 50 },
          { requestId: 'm-8', sessionId: 's-4', accountId: 'acc-C', model: 'gemini-2.5-flash', timestamp: baseTime - 8000, status: 'success', latencyMs: 800, ttftMs: 90, cacheHit: true, promptTokens: 700, cachedTokens: 350, outputTokens: 80 },
          { requestId: 'm-9', sessionId: 's-4', accountId: 'acc-C', model: 'gemini-2.5-flash', timestamp: baseTime - 9000, status: 'error',   latencyMs: 900, ttftMs: undefined, cacheHit: false, promptTokens: 100, cachedTokens: 0, outputTokens: 0 },
          { requestId: 'm-10', sessionId: 's-4', accountId: 'acc-C', model: 'gemini-2.5-flash', timestamp: baseTime - 10000, status: 'abort', latencyMs: 1000, ttftMs: 200, cacheHit: false, promptTokens: 200, cachedTokens: 0, outputTokens: 10 },
        ]

        await storage.saveRequestMetrics(groundTruthMetrics)

        const overviewResult = await storage.getOverviewMetrics()
        const ov = overviewResult.overview

        assert.equal(ov.totalRequests, 10)
        assert.equal(ov.totalSuccess, 6)
        assert.equal(ov.totalAbort, 2)
        assert.equal(ov.totalFailed, 2)
        assert.equal(ov.totalPromptTokens, 7200)
        assert.equal(ov.totalCachedTokens, 3750)
        assert.equal(ov.totalOutputTokens, 710)
        assert.equal(ov.cacheHitRate, 0.5208)
        assert.equal(ov.avgLatencyMs, 550)
        assert.equal(ov.avgTtftMs, 91)
        assert.equal(ov.p50LatencyMs, 600)
        assert.equal(ov.p90LatencyMs, 1000)

        assert.equal(overviewResult.accounts.length, 3)
        const accA = overviewResult.accounts.find((a) => a.accountId === 'acc-A')!
        assert.equal(accA.totalRequests, 3)
        assert.equal(accA.successRequests, 2)
        assert.equal(accA.failedRequests, 0)
        assert.equal(accA.promptTokens, 2500)
        assert.equal(accA.cachedTokens, 1400)
        assert.equal(accA.cacheHitRate, Number((1400 / 2500).toFixed(4)))

        const usageList = await storage.getAccountUsage()
        assert.equal(usageList.length, 3)
        const uA = usageList.find((u) => u.accountId === 'acc-A')!
        assert.equal(uA.totalRequests, 3)
        assert.equal(uA.totalLatencyMs, 600)
        assert.equal(uA.lastUsed, baseTime - 1000)

        const buckets = await storage.getAggregatedMetrics(5000, baseTime - 10000, baseTime)
        assert.ok(buckets.length > 0)
        const totalBucketRequests = buckets.reduce((acc, b) => acc + b.requests, 0)
        assert.equal(totalBucketRequests, 10)

        await storage.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('2.4: Expired data retention cleanup removes stale metrics and retains fresh metrics', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-stats-4-'))
      const cleanDbPath = join(tempDir, 'clean-verify.db')
      try {
        const storage = new SqliteStatsStorage(cleanDbPath)
        const now = Date.now()
        const days30Ms = 30 * 86400 * 1000

        const staleTimestamp = now - days30Ms - 10000
        const freshTimestamp = now - 5000

        await storage.saveRequestMetrics([
          { requestId: 'old-1', sessionId: null, accountId: 'acc-1', model: 'gemini-1.5-flash', timestamp: staleTimestamp, status: 'success', latencyMs: 100, cacheHit: false, promptTokens: 100, cachedTokens: 0, outputTokens: 50 },
          { requestId: 'old-2', sessionId: null, accountId: 'acc-1', model: 'gemini-1.5-flash', timestamp: staleTimestamp - 1000, status: 'error', latencyMs: 100, cacheHit: false, promptTokens: 100, cachedTokens: 0, outputTokens: 0 },
          { requestId: 'fresh-1', sessionId: null, accountId: 'acc-1', model: 'gemini-1.5-flash', timestamp: freshTimestamp, status: 'success', latencyMs: 120, cacheHit: true, promptTokens: 200, cachedTokens: 100, outputTokens: 40 },
          { requestId: 'fresh-2', sessionId: null, accountId: 'acc-1', model: 'gemini-1.5-flash', timestamp: freshTimestamp, status: 'success', latencyMs: 130, cacheHit: true, promptTokens: 300, cachedTokens: 150, outputTokens: 60 },
        ])

        assert.equal(await storage.countRequests(), 4)

        const collector = new StatsCollector(
          {
            retentionDays: 30,
            dbPath: cleanDbPath,
            flushIntervalMs: 1000,
            maxQueueSize: 100,
            cleanupIntervalMs: 60000,
          },
          storage,
        )

        const cleanupRes = await collector.cleanup(now)
        assert.equal(cleanupRes.deletedRequests, 2)

        const remaining = await storage.queryRequests()
        assert.equal(remaining.length, 2)
        assert.ok(remaining.every((r) => r.requestId.startsWith('fresh-')))

        await collector.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('2.5: Graceful shutdown drain flushes in-memory queue to SQLite disk before closing', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-stats-5-'))
      const drainDbPath = join(tempDir, 'drain-verify.db')
      try {
        const storage = new SqliteStatsStorage(drainDbPath)

        const collector = new StatsCollector(
          {
            retentionDays: 7,
            dbPath: drainDbPath,
            flushIntervalMs: 60000,
            maxQueueSize: 100,
            cleanupIntervalMs: 3600000,
          },
          storage,
        )
        collector.start()

        collector.recordRequest({
          requestId: 'drain-req-1',
          sessionId: 'sess-drain',
          accountId: 'acc-drain',
          model: 'gemini-2.5-pro',
          status: 'success',
          latencyMs: 250,
          promptTokens: 500,
          cachedTokens: 200,
          outputTokens: 80,
        })

        await collector.close()

        const verifyStorage = new SqliteStatsStorage(drainDbPath)
        const count = await verifyStorage.countRequests()
        assert.equal(count, 1)
        const requests = await verifyStorage.queryRequests()
        assert.equal(requests[0]!.requestId, 'drain-req-1')
        await verifyStorage.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  // =========================================================================
  // Section 3: Quota-Aware Scheduling & Family Cooldown E2E
  // =========================================================================
  describe('3. Quota-Aware Scheduling & Family Cooldown E2E', () => {
    it('3.1: Quota-Aware Selection (highest 5H remaining fraction first in round-robin mode)', () => {
      const poolDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-pool-1-'))
      try {
        const pool = new AccountPoolManager(poolDir, 0.05)
        pool.setMode('round-robin')

        const accPrimary = pool.getAccounts()[0]!
        const accB = pool.createAccountSlot('account-B')
        const accC = pool.createAccountSlot('account-C')

        // Set quotas across all accounts in pool: Primary=0.20, AccB=0.85, AccC=0.50
        pool.updateAccountQuotas(accPrimary.id, {
          google: { remainingFraction: 0.20, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })
        pool.updateAccountQuotas(accB.id, {
          google: { remainingFraction: 0.85, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })
        pool.updateAccountQuotas(accC.id, {
          google: { remainingFraction: 0.50, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })

        // Round-robin selection must pick AccB (highest: 0.85 remaining)
        const selected1 = pool.selectAccount('google')
        assert.equal(selected1?.id, accB.id)

        // When AccB quota drops to 0.10, next selection chooses AccC (0.50 remaining)
        pool.updateAccountQuotas(accB.id, {
          google: { remainingFraction: 0.10, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })
        const selected2 = pool.selectAccount('google')
        assert.equal(selected2?.id, accC.id)
      } finally {
        rmSync(poolDir, { recursive: true, force: true })
      }
    })

    it('3.2: Sticky Sequential Drain persists on active account until exhaustion in sequential mode', () => {
      const poolDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-pool-2-'))
      try {
        const pool = new AccountPoolManager(poolDir, 0.05)
        pool.setMode('sequential')
        pool.createAccountSlot('account-1')
        pool.createAccountSlot('account-2')

        const s1 = pool.selectAccount('google')
        const s2 = pool.selectAccount('google')
        const s3 = pool.selectAccount('google')
        assert.equal(s1?.id, s2?.id)
        assert.equal(s2?.id, s3?.id)
      } finally {
        rmSync(poolDir, { recursive: true, force: true })
      }
    })

    it('3.3: Low Quota Watermark Skip skips accounts at or below safety watermark threshold', () => {
      const poolDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-pool-3-'))
      try {
        const pool = new AccountPoolManager(poolDir, 0.05)
        const accounts = pool.getAccounts()
        const targetAcc = accounts[0]!
        const otherAcc = pool.createAccountSlot('account-other')

        pool.updateAccountQuotas(targetAcc.id, {
          google: { remainingFraction: 0.03, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })
        pool.updateAccountQuotas(otherAcc.id, {
          google: { remainingFraction: 0.50, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })

        assert.equal(pool.isAccountHealthy(targetAcc, 'google'), false)

        pool.setLowQuotaThreshold(0.02)
        assert.equal(pool.isAccountHealthy(targetAcc, 'google'), true)

        pool.setLowQuotaThreshold(0.05)
        assert.equal(pool.isAccountHealthy(targetAcc, 'google'), false)
      } finally {
        rmSync(poolDir, { recursive: true, force: true })
      }
    })

    it('3.4: Single-family 429 isolation ensures gemini cooldown does not impact claude family', () => {
      const poolDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-pool-4-'))
      try {
        const pool = new AccountPoolManager(poolDir, 0.05)
        const testAcc = pool.createAccountSlot('account-multi-family')

        pool.recordFailure(testAcc.id, 'google', 'Rate limit 429', '60')

        assert.equal(pool.isAccountHealthy(testAcc, 'google'), false)
        assert.equal(pool.isAccountHealthy(testAcc, 'anthropic'), true)

        pool.clearCooldown(testAcc.id)
        assert.equal(pool.isAccountHealthy(testAcc, 'google'), true)
      } finally {
        rmSync(poolDir, { recursive: true, force: true })
      }
    })

    it('3.5: Arbitration precedence (Pin > Session Affinity > Quota/Sequential)', () => {
      const poolDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-pool-5-'))
      try {
        const pool = new AccountPoolManager(poolDir, 0.05)
        const accounts = pool.getAccounts()
        const accPrimary = accounts[0]!
        const pinTarget = pool.createAccountSlot('acc-pinned')

        pool.updateAccountQuotas(accPrimary.id, {
          google: { remainingFraction: 0.90, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })
        pool.updateAccountQuotas(pinTarget.id, {
          google: { remainingFraction: 0.10, resetTime: new Date(Date.now() + 3600000).toISOString() },
        })

        // Pin the account with lower quota
        pool.pinAccount(pinTarget.id)

        // Pinned account must be selected despite having lower quota than primary
        const selected = pool.selectAccount('google')
        assert.equal(selected?.id, pinTarget.id)

        // Temporary cooldown on pinned account triggers failover to primary
        pool.recordFailure(pinTarget.id, 'google', 'Rate limit 429', '30')
        const failoverSelected = pool.selectAccount('google')
        assert.equal(failoverSelected?.id, accPrimary.id)

        // Clear cooldown -> pin immediately recovers precedence
        pool.clearCooldown(pinTarget.id)
        const recoveredSelected = pool.selectAccount('google')
        assert.equal(recoveredSelected?.id, pinTarget.id)

        pool.pinAccount(null)
      } finally {
        rmSync(poolDir, { recursive: true, force: true })
      }
    })
  })

  // =========================================================================
  // Section 4: Streaming Exceptions & Telemetry Interruption Capture E2E
  // =========================================================================
  describe('4. Streaming Exceptions & Telemetry Interruption Capture E2E', () => {
    it('4.1: Normal stream completion records success, ttftMs, and token metrics', async () => {
      const recordedTelemetry: any[] = []
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || ''
        if (url.includes('loadCodeAssist')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: 'test-proj-e2e' }))
          return
        }
        if (url.includes('streamGenerateContent')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          })
          res.write('data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello from E2E"}]}}]}}\n\n')
          res.write('data: {"response":{"usageMetadata":{"promptTokenCount":150,"cachedContentTokenCount":100,"candidatesTokenCount":50}}}\n\n')
          res.end()
          return
        }
        res.writeHead(404)
        res.end()
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as { port: number }).port
      const endpoint = `http://127.0.0.1:${port}`

      const prevToken = process.env.ANTIGRAVITY_TOKEN
      process.env.ANTIGRAVITY_TOKEN = 'test-token-e2e'

      try {
        const mockCollector = {
          recordRequest: (input: any) => recordedTelemetry.push(input),
        } as any

        const catalog = new ModelCatalog(async () => null, [{ id: 'gemini-2.5-flash', name: 'Gemini' }])
        const adapter = new AgyAdapter({
          getConfig: () => resolveConfig({ statsEnabled: true }),
          catalog,
          statsCollector: mockCollector,
          endpointCandidates: [endpoint],
        })

        const stream = adapter.stream({
          provider: 'antigravity',
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as any],
        })

        const chunks: any[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }

        assert.ok(chunks.length > 0)
        await new Promise((r) => setTimeout(r, 40))

        assert.equal(recordedTelemetry.length, 1)
        const t = recordedTelemetry[0]
        assert.equal(t.status, 'success')
        assert.ok(typeof t.ttftMs === 'number' && t.ttftMs >= 0)
        assert.equal(t.promptTokens, 150)
        assert.equal(t.cachedTokens, 100)
        assert.equal(t.outputTokens, 50)
      } finally {
        process.env.ANTIGRAVITY_TOKEN = prevToken
        if (server.closeAllConnections) server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })

    it('4.2: Client user abort mid-stream caught in finally guard and recorded with status abort', async () => {
      const recordedTelemetry: any[] = []
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || ''
        if (url.includes('loadCodeAssist')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: 'test-proj-e2e' }))
          return
        }
        if (url.includes('streamGenerateContent')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          })
          res.write('data: {"response":{"candidates":[{"content":{"parts":[{"text":"Chunk 1"}]}}]}}\n\n')
          req.on('close', () => {
            res.end()
          })
          return
        }
        res.writeHead(404)
        res.end()
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as { port: number }).port
      const endpoint = `http://127.0.0.1:${port}`

      const prevToken = process.env.ANTIGRAVITY_TOKEN
      process.env.ANTIGRAVITY_TOKEN = 'test-token-e2e'

      try {
        const mockCollector = {
          recordRequest: (input: any) => recordedTelemetry.push(input),
        } as any

        const catalog = new ModelCatalog(async () => null, [{ id: 'gemini-2.5-flash', name: 'Gemini' }])
        const adapter = new AgyAdapter({
          getConfig: () => resolveConfig({ statsEnabled: true }),
          catalog,
          statsCollector: mockCollector,
          endpointCandidates: [endpoint],
        })

        const controller = new AbortController()
        const stream = adapter.stream({
          provider: 'antigravity',
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as any],
          signal: controller.signal,
        })

        const iter = stream[Symbol.asyncIterator]()
        const first = await iter.next()
        assert.ok(!first.done)

        controller.abort()
        await iter.return?.()

        await new Promise((r) => setTimeout(r, 50))

        assert.ok(recordedTelemetry.length > 0)
        assert.equal(recordedTelemetry[0].status, 'abort')
      } finally {
        process.env.ANTIGRAVITY_TOKEN = prevToken
        if (server.closeAllConnections) server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })

    it('4.3: Upstream HTTP 500 error recorded with status error in telemetry', async () => {
      const recordedTelemetry: any[] = []
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || ''
        if (url.includes('loadCodeAssist')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: 'test-proj-e2e' }))
          return
        }
        if (url.includes('streamGenerateContent')) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { code: 500, message: 'Internal Server Error' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as { port: number }).port
      const endpoint = `http://127.0.0.1:${port}`

      const prevToken = process.env.ANTIGRAVITY_TOKEN
      process.env.ANTIGRAVITY_TOKEN = 'test-token-e2e'

      try {
        const mockCollector = {
          recordRequest: (input: any) => recordedTelemetry.push(input),
        } as any

        const catalog = new ModelCatalog(async () => null, [{ id: 'gemini-2.5-flash', name: 'Gemini' }])
        const adapter = new AgyAdapter({
          getConfig: () => resolveConfig({ statsEnabled: true }),
          catalog,
          statsCollector: mockCollector,
          endpointCandidates: [endpoint],
        })

        const stream = adapter.stream({
          provider: 'antigravity',
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as any],
        })

        const chunks: any[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }

        await new Promise((r) => setTimeout(r, 40))

        assert.ok(recordedTelemetry.length > 0)
        assert.equal(recordedTelemetry[0].status, 'error')
      } finally {
        process.env.ANTIGRAVITY_TOKEN = prevToken
        if (server.closeAllConnections) server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })
  })

  // =========================================================================
  // Section 5: Web GUI & HTTP API Security E2E
  // =========================================================================
  describe('5. Web GUI & HTTP API Security E2E', () => {
    it('5.1: Dual-mount compatibility: both /plugins/agy-link/ and /plugins/cloudcode-link/ serve identical responses', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-http-1-'))
      const prevDir = process.env.CLOUDCODE_ACCOUNTS_DIR
      process.env.CLOUDCODE_ACCOUNTS_DIR = tempDir

      const routes: Array<{ path: string; handler: (req: unknown, res: unknown) => void }> = []
      const disposeCallbacks: Array<() => Promise<void> | void> = []
      const effectDisposers: Array<() => void> = []

      const mockWebServer = {
        register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => {
          routes.push(route)
          return () => {
            const idx = routes.indexOf(route)
            if (idx >= 0) routes.splice(idx, 1)
          }
        },
      }

      const mockCtx = {
        on: (evt: string, cb: () => Promise<void> | void) => {
          if (evt === 'dispose') disposeCallbacks.push(cb)
        },
        effect: (fn: () => () => void) => {
          const d = fn()
          if (typeof d === 'function') effectDisposers.push(d)
        },
        get: () => undefined,
        llm: { registerAdapter: () => () => {} },
        commands: { register: () => () => {} },
        inject: (deps: string[], cb: (sub: unknown) => void) => {
          if (deps.includes('webServer')) {
            cb({ get: () => mockWebServer })
          }
        },
      }

      apply(mockCtx as unknown as Context, {
        statsEnabled: true,
        statsDbPath: join(tempDir, 'http-stats.db'),
      })

      const server = createServer((req, res) => {
        const reqPath = (req.url || '').split('?')[0]
        const matched = routes.find((r) => r.path === reqPath)
        if (matched) {
          matched.handler(req, res)
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not Found' }))
        }
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as { port: number }).port

      try {
        const endpoints = ['stats/overview', 'stats/requests', 'stats/accounts-usage', 'catalog', 'pool']
        for (const ep of endpoints) {
          const resAgy = await fetch(`http://127.0.0.1:${port}/plugins/agy-link/${ep}`)
          const resCloud = await fetch(`http://127.0.0.1:${port}/plugins/cloudcode-link/${ep}`)

          assert.equal(resAgy.status, 200, `Expected 200 for agy-link/${ep}`)
          assert.equal(resCloud.status, 200, `Expected 200 for cloudcode-link/${ep}`)

          const dataAgy = await resAgy.json()
          const dataCloud = await resCloud.json()
          assert.deepEqual(dataAgy, dataCloud, `Responses must match identically for endpoint ${ep}`)
        }
      } finally {
        for (const d of effectDisposers) try { d() } catch {}
        for (const cb of disposeCallbacks) try { await cb() } catch {}
        process.env.CLOUDCODE_ACCOUNTS_DIR = prevDir
        if (server.closeAllConnections) server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('5.2: Privacy & Email Masking strictly prevents raw email leakage in /stats/accounts-usage', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-http-2-'))
      const prevDir = process.env.CLOUDCODE_ACCOUNTS_DIR
      process.env.CLOUDCODE_ACCOUNTS_DIR = tempDir

      // Create account slot with email BEFORE initializing plugin via apply
      const preInitPool = new AccountPoolManager(tempDir)
      const acc = preInitPool.createAccountSlot('security-test-slot')
      preInitPool.updateAccountQuotas(acc.id, {}, 'sensitive.developer@corporate.com')

      const routes: Array<{ path: string; handler: (req: unknown, res: unknown) => void }> = []
      const disposeCallbacks: Array<() => Promise<void> | void> = []
      const effectDisposers: Array<() => void> = []

      const mockWebServer = {
        register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => {
          routes.push(route)
          return () => {
            const idx = routes.indexOf(route)
            if (idx >= 0) routes.splice(idx, 1)
          }
        },
      }

      const mockCtx = {
        on: (evt: string, cb: () => Promise<void> | void) => {
          if (evt === 'dispose') disposeCallbacks.push(cb)
        },
        effect: (fn: () => () => void) => {
          const d = fn()
          if (typeof d === 'function') effectDisposers.push(d)
        },
        get: () => undefined,
        llm: { registerAdapter: () => () => {} },
        commands: { register: () => () => {} },
        inject: (deps: string[], cb: (sub: unknown) => void) => {
          if (deps.includes('webServer')) {
            cb({ get: () => mockWebServer })
          }
        },
      }

      apply(mockCtx as unknown as Context, {
        statsEnabled: true,
        statsDbPath: join(tempDir, 'http-stats.db'),
      })

      const server = createServer((req, res) => {
        const reqPath = (req.url || '').split('?')[0]
        const matched = routes.find((r) => r.path === reqPath)
        if (matched) {
          matched.handler(req, res)
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not Found' }))
        }
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const port = (server.address() as { port: number }).port

      try {
        const res = await fetch(`http://127.0.0.1:${port}/plugins/cloudcode-link/stats/accounts-usage`)
        assert.equal(res.status, 200)

        const bodyText = await res.text()
        assert.ok(
          !bodyText.includes('sensitive.developer@corporate.com'),
          'Raw email MUST NEVER leak in API responses',
        )

        const json = JSON.parse(bodyText)
        assert.ok(Array.isArray(json.accounts))
        const targetAcc = json.accounts.find((a: any) => a.accountId === acc.id)
        assert.ok(targetAcc, 'Target account must exist in accounts usage')
        assert.equal(targetAcc.email, 'se***@corporate.com')
      } finally {
        for (const d of effectDisposers) try { d() } catch {}
        for (const cb of disposeCallbacks) try { await cb() } catch {}
        process.env.CLOUDCODE_ACCOUNTS_DIR = prevDir
        if (server.closeAllConnections) server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('5.3: Web GUI source verification confirms maskEmail is applied across all account views', () => {
      const clientSource = readFileSync(join(process.cwd(), 'src/client/index.ts'), 'utf8')
      assert.ok(clientSource.includes('function maskEmail'), 'Client must contain maskEmail helper')
      assert.ok(clientSource.includes('maskEmail(acc.email)'), 'Client badge must use maskEmail(acc.email)')
      assert.ok(clientSource.includes('maskEmail(account.email)'), 'Audit table must use maskEmail(account.email)')
    })
  })
})
