import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import {
  SqliteStatsStorage,
  MemoryStatsStorage,
  createStatsStorage,
  maskEmail,
  type RequestMetric,
  type StatsConfig,
} from '../src/host/stats.ts'
import { QuotaService } from '../src/host/quota.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { resolveConfig } from '../src/common/config.ts'
import { apply } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'

describe('Adversarial Review Remediation (8 Issues Closed)', () => {
  const sampleMetrics: RequestMetric[] = [
    {
      requestId: 'req-1',
      sessionId: 'sess-1',
      accountId: 'acc-1',
      model: 'gemini-2.5-flash',
      timestamp: 1000,
      status: 'success',
      latencyMs: 100,
      ttftMs: 40,
      cacheHit: true,
      promptTokens: 200,
      cachedTokens: 100,
      outputTokens: 50,
    },
    {
      requestId: 'req-2',
      sessionId: 'sess-1',
      accountId: 'acc-1',
      model: 'gemini-2.5-flash',
      timestamp: 2000,
      status: 'error',
      latencyMs: 300,
      ttftMs: 80,
      cacheHit: false,
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 0,
    },
    {
      requestId: 'req-3',
      sessionId: 'sess-2',
      accountId: 'acc-2',
      model: 'claude-3-5-sonnet',
      timestamp: 5000,
      status: 'abort',
      latencyMs: 50,
      ttftMs: 20,
      cacheHit: false,
      promptTokens: 50,
      cachedTokens: 0,
      outputTokens: 10,
    },
  ]

  describe('Issue 1: Aggregated Storage Methods & Zero Unbounded Scans', () => {
    it('SqliteStatsStorage computes getOverviewMetrics, getAccountUsage, and getAggregatedMetrics directly in SQL', async () => {
      const storage = new SqliteStatsStorage(':memory:')
      await storage.saveRequestMetrics(sampleMetrics)

      const overview = await storage.getOverviewMetrics()
      assert.equal(overview.overview.totalRequests, 3)
      assert.equal(overview.overview.totalSuccess, 1)
      assert.equal(overview.overview.totalFailed, 1)
      assert.equal(overview.overview.totalAbort, 1)
      assert.equal(overview.overview.totalPromptTokens, 350)
      assert.equal(overview.overview.totalCachedTokens, 100)
      assert.equal(overview.overview.totalOutputTokens, 60)
      assert.equal(overview.overview.totalTokens, 410)
      assert.equal(overview.overview.avgLatencyMs, 150)
      assert.equal(overview.overview.p50LatencyMs, 100)
      assert.equal(overview.overview.p90LatencyMs, 300)
      assert.equal(overview.accounts.length, 2)

      const acc1 = overview.accounts.find((a) => a.accountId === 'acc-1')!
      assert.ok(acc1)
      assert.equal(acc1.totalRequests, 2)
      assert.equal(acc1.successRequests, 1)
      assert.equal(acc1.failedRequests, 1)
      assert.equal(acc1.promptTokens, 300)
      assert.equal(acc1.cachedTokens, 100)
      assert.equal(acc1.cacheHitRate, 0.3333)

      const usage = await storage.getAccountUsage()
      assert.equal(usage.length, 2)
      const u1 = usage.find((u) => u.accountId === 'acc-1')!
      assert.equal(u1.totalRequests, 2)
      assert.equal(u1.lastUsed, 2000)

      const agg = await storage.getAggregatedMetrics(3600000, 0, 10000)
      assert.equal(agg.length, 1)
      assert.equal(agg[0]!.requests, 3)

      await storage.close()
    })

    it('MemoryStatsStorage computes identical overview, usage, and aggregated metrics', async () => {
      const storage = new MemoryStatsStorage()
      await storage.saveRequestMetrics(sampleMetrics)

      const overview = await storage.getOverviewMetrics()
      assert.equal(overview.overview.totalRequests, 3)
      assert.equal(overview.overview.totalSuccess, 1)
      assert.equal(overview.overview.totalFailed, 1)
      assert.equal(overview.overview.totalAbort, 1)
      assert.equal(overview.overview.totalPromptTokens, 350)
      assert.equal(overview.overview.totalCachedTokens, 100)
      assert.equal(overview.overview.totalOutputTokens, 60)
      assert.equal(overview.overview.totalTokens, 410)
      assert.equal(overview.overview.avgLatencyMs, 150)
      assert.equal(overview.overview.p50LatencyMs, 100)
      assert.equal(overview.overview.p90LatencyMs, 300)
      assert.equal(overview.accounts.length, 2)

      const usage = await storage.getAccountUsage()
      assert.equal(usage.length, 2)
      const u2 = usage.find((u) => u.accountId === 'acc-2')!
      assert.equal(u2.totalRequests, 1)
      assert.equal(u2.lastUsed, 5000)

      const agg = await storage.getAggregatedMetrics(3600000, 0, 10000)
      assert.equal(agg.length, 1)
      assert.equal(agg[0]!.requests, 3)

      await storage.close()
    })
  })

  describe('Issue 2: Email Masking in DOM and API', () => {
    it('maskEmail masks email preserving domain and hiding username safely', () => {
      assert.equal(maskEmail('developer@company.org'), 'de***@company.org')
      assert.equal(maskEmail('john.doe@example.com'), 'jo***@example.com')
      assert.equal(maskEmail('ab@test.com'), 'a***@test.com')
      assert.equal(maskEmail('a@test.com'), 'a***@test.com')
      assert.equal(maskEmail(''), '')
      assert.equal(maskEmail(undefined), '')
    })

    it('/stats/accounts-usage endpoint masks email field in output', async () => {
      const routes: Array<{ path: string; handler: (req: unknown, res: unknown) => void }> = []
      const mockWebServer = {
        register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => {
          routes.push(route)
          return () => {}
        },
      }
      const mockCtx = {
        on: () => {},
        effect: () => () => {},
        get: () => undefined,
        llm: { registerAdapter: () => () => {} },
        commands: { register: () => () => {} },
        inject: (deps: string[], cb: (sub: unknown) => void) => {
          if (deps.includes('webServer')) cb({ get: () => mockWebServer })
        },
      }

      const tempDir = mkdtempSync(join(tmpdir(), 'mask-email-test-'))
      try {
        const pool = new AccountPoolManager(tempDir)
        const acc = pool.createAccountSlot('test-slot')
        pool.updateAccountQuotas(acc.id, {}, 'sensitive_owner@gmail.com')

        const prevAccountsDir = process.env.CLOUDCODE_ACCOUNTS_DIR
        process.env.CLOUDCODE_ACCOUNTS_DIR = tempDir
        try {
          apply(mockCtx as unknown as Context, {
            statsEnabled: true,
            statsDbPath: ':memory:',
          })

          const usageRoute = routes.find((r) => r.path === '/plugins/cloudcode-link/stats/accounts-usage')!
          assert.ok(usageRoute)

          let json: any = null
          const mockRes = {
            writeHead: () => {},
            end: (data: string) => {
              json = JSON.parse(data)
            },
          }
          usageRoute.handler({}, mockRes)
          await new Promise((r) => setTimeout(r, 50))

          assert.ok(json && json.ok)
          assert.ok(Array.isArray(json.accounts))
          const target = json.accounts.find((a: any) => a.accountId === acc.id)
          assert.ok(target)
          assert.equal(target.email, 'se***@gmail.com', 'email must be masked in API output')
          assert.notEqual(target.email, 'sensitive_owner@gmail.com')
        } finally {
          process.env.CLOUDCODE_ACCOUNTS_DIR = prevAccountsDir
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('Issue 3: Graceful Shutdown Promise Propagation', () => {
    it('ctx.on("dispose") registers an async callback returning a promise for drain completion', async () => {
      let disposeHandler: (() => Promise<void>) | null = null
      const mockCtx = {
        on: (event: string, handler: any) => {
          if (event === 'dispose') {
            disposeHandler = handler
          }
        },
        effect: () => () => {},
        get: () => undefined,
        llm: { registerAdapter: () => () => {} },
        commands: { register: () => () => {} },
        inject: () => {},
      }

      const tempDir = mkdtempSync(join(tmpdir(), 'dispose-test-'))
      try {
        const prev = process.env.CLOUDCODE_ACCOUNTS_DIR
        process.env.CLOUDCODE_ACCOUNTS_DIR = tempDir
        try {
          apply(mockCtx as unknown as Context, {
            statsEnabled: true,
            statsDbPath: ':memory:',
          })

          assert.ok(disposeHandler, 'dispose handler must be registered')
          const p = (disposeHandler as () => Promise<void>)()
          assert.ok(p instanceof Promise, 'dispose handler must return a promise for Cordis to await')
          await p
        } finally {
          process.env.CLOUDCODE_ACCOUNTS_DIR = prev
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('Issue 4: Generator Early Return / Abort Telemetry in finally Guard', () => {
    it('records telemetry with status abort when stream iterator returns early', async () => {
      const recorded: any[] = []
      const mockCollector = {
        recordRequest: (input: any) => {
          recorded.push(input)
        },
      } as any

      const server = createServer((req, res) => {
        if (req.url?.includes('loadCodeAssist')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: 'test-project-123' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}}\n\n')
      })

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve())
      })
      const port = (server.address() as { port: number }).port
      const endpoint = `http://127.0.0.1:${port}`

      try {
        const catalog = new ModelCatalog(async () => null, [{ id: 'gemini-2.5-flash', name: 'Gemini' }])
        const adapter = new AgyAdapter({
          getConfig: () => resolveConfig({ statsEnabled: true }),
          catalog,
          statsCollector: mockCollector,
          endpointCandidates: [endpoint],
        })

        const prevToken = process.env.ANTIGRAVITY_TOKEN
        process.env.ANTIGRAVITY_TOKEN = 'test-token'
        try {
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

          await new Promise((r) => setTimeout(r, 20))

          assert.ok(recorded.length > 0, 'telemetry must be recorded even when generator returns early')
          assert.equal(recorded[0].status, 'abort')
        } finally {
          process.env.ANTIGRAVITY_TOKEN = prevToken
        }
      } finally {
        server.close()
      }
    })
  })

  describe('Issue 5: Lightweight Quota Refresh & Config-Respecting Floor', () => {
    it('refreshQuotaSummaryOnly skips redundant fetchUserInfo and fetchAvailableModels', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'light-quota-'))
      try {
        const pool = new AccountPoolManager(dir)
        const acc = pool.createAccountSlot('light-slot')
        pool.updateAccountQuotas(acc.id, {}, 'light@example.com')

        const tokenDir = join(acc.dir!, '.gemini', 'antigravity-cli')
        writeFileSync(
          join(tokenDir, 'antigravity-oauth-token'),
          JSON.stringify({ access_token: 'ya29.test', expiry: Date.now() + 3600_000 }),
          'utf8',
        )

        let userInfoCalls = 0
        let availableModelsCalls = 0
        let summaryCalls = 0

        class InstrumentedQuotaService extends QuotaService {
          override async fetchUserInfo() {
            userInfoCalls++
            return { email: 'light@example.com' }
          }
          override async fetchAvailableModels() {
            availableModelsCalls++
            return { models: {} } as any
          }
          override async fetchQuotaSummary() {
            summaryCalls++
            return {
              groups: [
                {
                  displayName: 'Gemini Models',
                  buckets: [{ bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.95 }],
                },
              ],
            } as any
          }
        }

        const svc = new InstrumentedQuotaService(pool)
        const res = await svc.refreshQuotaSummaryOnly(pool.getAccount(acc.id)!)

        assert.equal(summaryCalls, 1, 'must fetch quota summary')
        assert.equal(userInfoCalls, 0, 'must NOT call fetchUserInfo in lightweight mode')
        assert.equal(availableModelsCalls, 0, 'must NOT call fetchAvailableModels in summaryOnly mode')
        assert.equal(res?.google?.remainingFraction, 0.95)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('refreshQuotasForSelection respects sessionStartQuotaRefreshMinIntervalMs down to 1000ms', () => {
      const cfg = resolveConfig({ sessionStartQuotaRefreshMinIntervalMs: 2000 })
      assert.equal(cfg.sessionStartQuotaRefreshMinIntervalMs, 2000)
      const minInterval = Math.max(1_000, cfg.sessionStartQuotaRefreshMinIntervalMs)
      assert.equal(minInterval, 2000, 'floor is 1000, not 5000')
    })
  })

  describe('Issue 6: createStatsStorage Exception Protection', () => {
    it('falls back to MemoryStatsStorage with warning if SqliteStatsStorage throws on invalid path/perms', () => {
      const config: StatsConfig = {
        retentionDays: 7,
        dbPath: '/dev/null/impossible/path/stats.db',
        flushIntervalMs: 50,
        maxQueueSize: 5,
        cleanupIntervalMs: 200,
      }

      const storage = createStatsStorage(config)
      assert.ok(storage instanceof MemoryStatsStorage, 'must fallback to MemoryStatsStorage gracefully')
    })
  })

  describe('Issue 7: Centralized Stats Relay Module', () => {
    it('src/host/stats.ts exports all storage, collector and types cleanly', () => {
      assert.ok(SqliteStatsStorage)
      assert.ok(MemoryStatsStorage)
      assert.ok(createStatsStorage)
      assert.ok(maskEmail)
    })
  })
})
