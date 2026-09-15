// dsh-cloudcode-link host assembly: Direct Google CloudCode API integration,
// LlmAdapter registration, /agy commands, agy_ask tool, auth helper, and
// the /plugins/cloudcode-link/* HTTP surface. Everything registers as cordis effects,
// so uninstalling the plugin rolls it back cleanly.
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dshHome, overridesPath, readOverrides, resolveConfig, stateDir } from './common/config.ts'
import { PROVIDER_ID, type PluginConfig } from './common/types.ts'
import { AgyAdapter } from './host/adapter.ts'
import { defineAgyAskTool } from './host/ask-tool.ts'
import { AuthHelper } from './host/auth.ts'
import { agyCommandDefinition } from './host/commands.ts'
import { writeDoctorReport } from './host/diagnostics.ts'
import { ModelCatalog } from './host/models.ts'
import { AccountPoolManager } from './host/pool.ts'
import { PoolAuthFlow } from './host/pool-auth.ts'
import { QuotaService } from './host/quota.ts'
import { HeartbeatManager } from './host/heartbeat.ts'
import { SessionStore } from './host/sessions.ts'
import type { ImageReader } from './host/message-converter.ts'
import {
  StatsCollector,
  SqliteStatsStorage,
  isSqliteAvailable,
  MemoryStatsStorage,
  createStatsStorage,
  maskEmail,
  type IStatsStorage,
  type RequestMetric,
  type AggregatedBucketMetric,
  type AccountUsageMetric,
} from './host/stats.ts'

export interface SubagentEvent {
  id?: string
  session?: {
    id?: string
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dispose'(): void | Promise<void>
    'subagent/start'(event?: SubagentEvent): void
    'subagent/end'(event?: SubagentEvent): void
  }
}

export const name = 'dsh-cloudcode-link'
export const inject = ['llm', 'commands']

type StatusWriter = {
  writeHead(status: number, headers: Record<string, string>): unknown
  end(body?: unknown): unknown
}
type RawReq = {
  method?: string
  on(event: string, cb: (chunk: Buffer) => void): unknown
}
type RawRes = StatusWriter
type WebServerLike = {
  register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void }): unknown
}

/** Cross-session concurrency limiter. */
class Semaphore {
  private active = 0
  private queue: Array<() => void> = []
  private readonly max: () => number
  constructor(max: () => number) {
    this.max = max
  }
  async acquire(): Promise<() => void> {
    if (this.active < Math.max(1, this.max())) {
      this.active++
      return () => this.releaseOne()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve(() => this.releaseOne())
      })
    })
  }
  private releaseOne(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

export function apply(ctx: Context, entryConfig: Record<string, unknown> = {}): void {
  const tag = '[dsh-cloudcode-link] '
  const log = (msg: string) => {
    const logger = (ctx as unknown as { logger?: { info?: (m: string) => void } }).logger
    logger?.info?.(tag + msg)
  }

  let dormantReason: string | null = null
  let lastRun: { ok: boolean; code: string; durationMs: number; model: string } | null = null

  const getConfig = (): PluginConfig => resolveConfig(entryConfig)
  const dshAccountsDir = process.env.CLOUDCODE_ACCOUNTS_DIR?.trim()
    || process.env.ANTIGRAVITY_ACCOUNTS_DIR?.trim()
    || join(dshHome(), 'agy-accounts')
  const pool = new AccountPoolManager(dshAccountsDir, getConfig().lowQuotaThreshold)
  const quota = new QuotaService(pool)
  void quota.selfHealQuarantinedAccounts().catch(() => undefined)
  const sessionStore = new SessionStore(join(stateDir(), 'sessions.json'))

  // Stats storage and collector initialization (safe node:sqlite fallback)
  const initialCfg = getConfig()
  let statsStorage: IStatsStorage
  try {
    if (isSqliteAvailable()) {
      statsStorage = new SqliteStatsStorage(initialCfg.statsDbPath)
    } else {
      log(`[stats] node:sqlite is not available, falling back to MemoryStatsStorage for ${initialCfg.statsDbPath}`)
      statsStorage = new MemoryStatsStorage()
    }
  } catch (err) {
    log(`[stats] failed to initialize SqliteStatsStorage: ${String(err)}, falling back to MemoryStatsStorage`)
    statsStorage = new MemoryStatsStorage()
  }

  const statsCollector = new StatsCollector(
    {
      retentionDays: initialCfg.statsRetentionDays,
      dbPath: initialCfg.statsDbPath,
      flushIntervalMs: initialCfg.statsFlushIntervalMs,
      maxQueueSize: initialCfg.statsBufferCapacity,
      batchSize: initialCfg.statsBatchSize,
      cleanupIntervalMs: initialCfg.statsRetentionCheckIntervalMs,
    },
    statsStorage,
    {
      onError: (err, context) => {
        log(`[stats-collector-error] ${context}: ${String(err)}`)
      },
      onDrop: (dropped) => {
        log(`[stats-buffer-drop] evicted ${dropped.length} oldest metrics due to capacity`)
      },
    },
  )

  if (initialCfg.statsEnabled) {
    statsCollector.start()
  }

  ctx.on('dispose', async () => {
    await statsCollector.close().catch((err) => {
      log(`[stats] error closing statsCollector on dispose: ${String(err)}`)
    })
  })

  const heartbeat = new HeartbeatManager({ getConfig, quota, pool, log })
  const semaphore = new Semaphore(() => getConfig().maxConcurrent)

  ctx.on('subagent/start', (event) => {
    const id = event?.id ?? event?.session?.id
    heartbeat.onSubagentStart(id)
  })
  ctx.on('subagent/end', (event) => {
    const id = event?.id ?? event?.session?.id
    heartbeat.onSubagentEnd(id)
  })
  ctx.effect(() => () => heartbeat.dispose())

  const catalog = new ModelCatalog(
    async () => quota.discoverAvailableModels(),
    getConfig().fallbackModels,
    getConfig().modelsCacheTtlMs,
  )

  // Warm model cache in background if logged in
  void catalog.refreshIfNeeded().catch(() => undefined)

  const auth = new AuthHelper(pool, quota)
  const poolAuth = new PoolAuthFlow(pool, quota, log)

  // Boot hygiene: remove stale staging dirs and sweep old logs
  const swept = pool.sweepStaleStaging()
  if (swept > 0) log('swept ' + swept + ' stale staging dir(s)')
  const logsSwept = pool.sweepOldLogs(getConfig().logRetentionDays)
  if (logsSwept > 0) log('swept ' + logsSwept + ' old log file(s)')

  const readImage: ImageReader = async (ref) => {
    const svc = (ctx.get('attachments') as { readImage?: (r: unknown) => Promise<{ data?: Uint8Array } | null> } | undefined)
      ?? (ctx as unknown as { attachments?: { readImage?: (r: unknown) => Promise<{ data?: Uint8Array } | null> } }).attachments
    if (svc && typeof svc.readImage === 'function') {
      try {
        const stored = await svc.readImage(ref)
        if (stored?.data) return stored.data
      } catch {
        // fallback
      }
    }
    try {
      const id = (ref as { attachmentId?: string })?.attachmentId
      if (id && typeof id === 'string') {
        const diskPath = join(dshHome(), 'attachments', 'v1', 'objects', id.slice(0, 2), id)
        if (existsSync(diskPath)) {
          return readFileSync(diskPath)
        }
      }
    } catch {
      return null
    }
    return null
  }

  const adapter = new AgyAdapter({
    getConfig,
    catalog,
    pool,
    quota,
    sessionStore,
    statsCollector,
    acquire: () => semaphore.acquire(),
    log,
    readImage,
    onRun: (info) => {
      lastRun = info
    },
  })

  const setOverride = (key: string, value: unknown): void => {
    const file = overridesPath()
    const current = readOverrides(file)
    current[key] = value
    try {
      mkdirSync(stateDir(), { recursive: true })
      writeFileSync(file, JSON.stringify(current, null, 2), 'utf8')
    } catch (e) {
      log('failed to persist override: ' + String(e))
    }
  }

  // ---- llm registration (dormant-safe) ----
  if (getConfig().enabled) {
    try {
      ctx.llm.registerAdapter([PROVIDER_ID], adapter)
      log('registered provider route: ' + PROVIDER_ID + ' (Direct CloudCode)')
    } catch (e) {
      log('adapter registration failed: ' + String(e))
    }
  }

  // ---- /agy command ----
  ctx.commands.register(
    agyCommandDefinition({
      cfg: getConfig,
      auth: () => auth,
      catalog: () => catalog,
      store: () => sessionStore,
      pool: () => pool,
      poolAuth: () => poolAuth,
      quota: () => quota,
      lastRun: () => lastRun,
      setOverride,
      runDoctor: async () => {
        return writeDoctorReport({
          cfg: getConfig,
          catalog: () => catalog,
          pool: () => pool,
        })
      },
    }),
  )

  // ---- tool registration (agy_ask) ----
  const toolsSvcRef: { current: { register: (t: unknown) => unknown } | null } = { current: null }
  const askToolDispose = { current: null as null | (() => void) }
  const syncAskTool = (): void => {
    const want = getConfig().askTool
    if (want && askToolDispose.current === null && toolsSvcRef.current) {
      const reg = toolsSvcRef.current.register(
        defineAgyAskTool({ cfg: getConfig, pool, quota, catalog: () => catalog.get() }),
      ) as unknown as () => void
      askToolDispose.current = typeof reg === 'function' ? reg : null
    } else if (!want && askToolDispose.current !== null) {
      askToolDispose.current()
      askToolDispose.current = null
    }
  }

  ctx.inject(['tools'], (sub) => {
    toolsSvcRef.current = sub.get('tools') as { register: (t: unknown) => unknown }
    syncAskTool()
    return () => {
      if (askToolDispose.current !== null) askToolDispose.current()
      askToolDispose.current = null
      toolsSvcRef.current = null
    }
  })

  // ---- HTTP surface for the client panel ----
  const registerRoutes = (webServer: WebServerLike): (() => void) => {
    const disposers: Array<() => void> = []
    const reg = (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void }): void => {
      const d = webServer.register(route) as unknown as () => void | undefined
      if (typeof d === 'function') disposers.push(d)
    }
    const regBoth = (subPath: string, handler: (req: unknown, res: unknown) => void): void => {
      reg({ kind: 'exact', path: `/plugins/agy-link/${subPath}`, handler })
      reg({ kind: 'exact', path: `/plugins/cloudcode-link/${subPath}`, handler })
    }
    const sendJson = (res: RawRes, status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    const parseQuery = (req: unknown): Record<string, string> => {
      const url = (req as { url?: string })?.url ?? ''
      const qIdx = url.indexOf('?')
      if (qIdx === -1) return {}
      const search = url.slice(qIdx + 1)
      const params = new URLSearchParams(search)
      const result: Record<string, string> = {}
      for (const [k, v] of params.entries()) {
        result[k] = v
      }
      return result
    }
    const readBody = (req: unknown): Promise<Record<string, unknown>> => {
      const r = req as { on?: (e: string, cb: (c: Buffer) => void) => void }
      return new Promise((resolve) => {
        const chunks: Buffer[] = []
        r.on?.('data', (c) => chunks.push(c))
        r.on?.('end', () => {
          try {
            const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve(v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
          } catch {
            resolve({})
          }
        })
      })
    }
    const methodOf = (req: unknown): string => {
      const m = (req as { method?: unknown }).method
      return typeof m === 'string' ? m.toUpperCase() : 'GET'
    }

    regBoth('status', (_req, res) => {
      void (async () => {
        const cfg = getConfig()
        const cat = catalog.get()
        const authStatus = await auth.resolvedStatus()
        sendJson(res as RawRes, 200, {
          plugin: 'dsh-cloudcode-link',
          transport: 'direct',
          dormantReason,
          enabled: cfg.enabled,
          defaultModel: cfg.defaultModel,
          defaultEffort: cfg.defaultEffort,
          askTool: cfg.askTool,
          auth: authStatus,
          poolAuth: poolAuth.status(),
          pool: pool.getPoolData(),
          catalog: { source: cat.source, count: cat.models.length, lastError: cat.lastError ?? null },
          lastRun,
        })
      })()
    })

    regBoth('catalog', (_req, res) => {
      const current = catalog.get()
      sendJson(res as RawRes, 200, {
        ok: true,
        source: current.source,
        count: current.models.length,
        models: current.models,
      })
    })

    regBoth('pool', (_req, res) => {
      sendJson(res as RawRes, 200, pool.getPoolData())
    })

    regBoth('pool/begin-add', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const alias = typeof body.alias === 'string' ? body.alias : undefined
        const proxyUrl = typeof body.proxyUrl === 'string' ? body.proxyUrl : undefined
        const st = await poolAuth.begin(alias, proxyUrl)
        sendJson(res as RawRes, st.ok ? 200 : 500, st)
      })()
    })

    regBoth('pool/complete-add', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const code = typeof body.code === 'string' ? body.code : ''
        if (!code) {
          sendJson(res as RawRes, 400, { ok: false, error: 'missing code' })
          return
        }
        const st = await poolAuth.submitCode(code)
        sendJson(res as RawRes, st.ok ? 200 : 400, {
          ok: st.ok,
          phase: st.phase,
          message: st.message,
          pool: pool.getPoolData(),
        })
      })()
    })

    regBoth('pool/cancel-add', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        await readBody(req)
        await poolAuth.cancel()
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('pool/remove', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id : ''
        pool.deleteAccount(id)
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('pool/proxy', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id : ''
        const proxyUrl = typeof body.proxyUrl === 'string' ? body.proxyUrl : undefined
        pool.setAccountProxy(id, proxyUrl)
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('pool/primary', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id : ''
        pool.setPrimaryAccount(id)
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('pool/mode', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const mode = body.mode === 'round-robin' ? 'round-robin' : 'sequential'
        pool.setMode(mode)
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('pool/refresh-quota', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id : ''
        if (id) {
          const acc = pool.getAccount(id)
          if (acc) await quota.refreshAccountQuota(acc, true)
        } else {
          await quota.refreshAllQuotas(true)
        }
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('pool/clear-cooldown', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id : undefined
        const family = typeof body.family === 'string' ? body.family : undefined
        pool.clearCooldown(id, family as never)
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
      })()
    })

    regBoth('config', (req, res) => {
      void (async () => {
        if (methodOf(req) !== 'POST') {
          sendJson(res as RawRes, 405, { error: 'POST only' })
          return
        }
        const body = await readBody(req)
        const key = typeof body.key === 'string' ? body.key : ''
        const allowed = ['defaultModel', 'defaultEffort', 'askTool', 'baseUrl']
        if (!allowed.includes(key)) {
          sendJson(res as RawRes, 400, { error: 'key not settable' })
          return
        }
        setOverride(key, body.value)
        syncAskTool()
        sendJson(res as RawRes, 200, { ok: true, key, value: body.value })
      })()
    })

    // ---- Stats endpoints ----
    // 1. Overview metrics
    regBoth('stats/overview', (_req, res) => {
      void (async () => {
        try {
          if (statsStorage.getOverviewMetrics) {
            const result = await statsStorage.getOverviewMetrics()
            sendJson(res as RawRes, 200, {
              ok: true,
              overview: result.overview,
              accounts: result.accounts,
            })
            return
          }

          const requests = (await statsStorage.queryRequests?.({ limit: 5000 })) ?? []
          let totalSuccess = 0
          let totalFailed = 0
          let totalAbort = 0
          let totalPromptTokens = 0
          let totalCachedTokens = 0
          let totalOutputTokens = 0
          let totalLatencyMs = 0
          let totalTtftMs = 0
          let ttftCount = 0
          const latencies: number[] = []

          const accountMap = new Map<string, {
            accountId: string
            totalRequests: number
            successRequests: number
            failedRequests: number
            promptTokens: number
            cachedTokens: number
            outputTokens: number
            cacheHitRate: number
            avgLatencyMs: number
          }>()

          for (const r of requests) {
            if (r.status === 'success') totalSuccess++
            else if (r.status === 'abort') totalAbort++
            else totalFailed++

            totalPromptTokens += r.promptTokens
            totalCachedTokens += r.cachedTokens
            totalOutputTokens += r.outputTokens
            totalLatencyMs += r.latencyMs
            latencies.push(r.latencyMs)
            if (typeof r.ttftMs === 'number') {
              totalTtftMs += r.ttftMs
              ttftCount++
            }

            let acc = accountMap.get(r.accountId)
            if (!acc) {
              acc = {
                accountId: r.accountId,
                totalRequests: 0,
                successRequests: 0,
                failedRequests: 0,
                promptTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
                cacheHitRate: 0,
                avgLatencyMs: 0,
              }
              accountMap.set(r.accountId, acc)
            }
            acc.totalRequests++
            if (r.status === 'success') acc.successRequests++
            else acc.failedRequests++
            acc.promptTokens += r.promptTokens
            acc.cachedTokens += r.cachedTokens
            acc.outputTokens += r.outputTokens
            acc.avgLatencyMs = Math.round(acc.avgLatencyMs + (r.latencyMs - acc.avgLatencyMs) / acc.totalRequests)
          }

          latencies.sort((a, b) => a - b)
          const p50LatencyMs = latencies.length > 0 ? (latencies[Math.floor(latencies.length * 0.5)] ?? 0) : 0
          const p90LatencyMs = latencies.length > 0 ? (latencies[Math.floor(latencies.length * 0.9)] ?? 0) : 0
          const totalRequests = requests.length
          const avgLatencyMs = totalRequests > 0 ? Math.round(totalLatencyMs / totalRequests) : 0
          const avgTtftMs = ttftCount > 0 ? Math.round(totalTtftMs / ttftCount) : 0
          const cacheHitRate = totalPromptTokens > 0 ? Number((totalCachedTokens / totalPromptTokens).toFixed(4)) : 0

          for (const acc of accountMap.values()) {
            acc.cacheHitRate = acc.promptTokens > 0 ? Number((acc.cachedTokens / acc.promptTokens).toFixed(4)) : 0
          }

          sendJson(res as RawRes, 200, {
            ok: true,
            overview: {
              totalRequests,
              totalSuccess,
              totalFailed,
              totalAbort,
              totalTokens: totalPromptTokens + totalOutputTokens,
              totalPromptTokens,
              totalCachedTokens,
              totalOutputTokens,
              cacheHitRate,
              avgLatencyMs,
              avgTtftMs,
              p50LatencyMs,
              p90LatencyMs,
            },
            accounts: Array.from(accountMap.values()),
          })
        } catch (err) {
          sendJson(res as RawRes, 500, { ok: false, error: String(err) })
        }
      })()
    })

    // 2. Request history with pagination and filters
    regBoth('stats/requests', (req, res) => {
      void (async () => {
        try {
          const q = parseQuery(req)
          const limitParam = q.limit ? parseInt(q.limit, 10) : 50
          const maxLimit = getConfig().apiMaxPageSize
          const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, maxLimit) : 50
          const offsetParam = q.offset ? parseInt(q.offset, 10) : 0
          const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0
          const accountId = q.accountId?.trim() || undefined
          const sessionId = q.sessionId?.trim() || undefined
          const status: RequestMetric['status'] | undefined =
            q.status === 'success' || q.status === 'error' || q.status === 'abort'
              ? q.status
              : undefined

          const filter = { limit, offset, accountId, sessionId, status }
          const items = (await statsStorage.queryRequests?.(filter)) ?? []
          const total = statsStorage.countRequests
            ? await statsStorage.countRequests({ accountId, sessionId, status })
            : items.length

          sendJson(res as RawRes, 200, {
            ok: true,
            requests: items,
            total,
            limit,
            offset,
          })
        } catch (err) {
          sendJson(res as RawRes, 500, { ok: false, error: String(err) })
        }
      })()
    })

    // 3. Aggregated metrics (hour / day)
    regBoth('stats/aggregated', (req, res) => {
      void (async () => {
        try {
          const q = parseQuery(req)
          const interval = q.interval === 'day' ? 'day' : 'hour'
          const intervalMs = interval === 'day' ? 86_400_000 : 3_600_000
          const since = q.since ? parseInt(q.since, 10) : undefined
          const until = q.until ? parseInt(q.until, 10) : undefined

          let buckets: AggregatedBucketMetric[] = []
          if (statsStorage.getAggregatedMetrics) {
            buckets = await statsStorage.getAggregatedMetrics(intervalMs, since, until, 1000)
          } else {
            const requests = (await statsStorage.queryRequests?.({ since, until, limit: 5000 })) ?? []
            const bucketMap = new Map<number, AggregatedBucketMetric>()
            for (const r of requests) {
              const bKey = Math.floor(r.timestamp / intervalMs) * intervalMs
              let b = bucketMap.get(bKey)
              if (!b) {
                b = {
                  bucket: bKey,
                  requests: 0,
                  successCount: 0,
                  failedCount: 0,
                  promptTokens: 0,
                  cachedTokens: 0,
                  outputTokens: 0,
                  totalLatencyMs: 0,
                  totalTtftMs: 0,
                  ttftCount: 0,
                }
                bucketMap.set(bKey, b)
              }
              b.requests++
              if (r.status === 'success') b.successCount++
              else b.failedCount++
              b.promptTokens += r.promptTokens
              b.cachedTokens += r.cachedTokens
              b.outputTokens += r.outputTokens
              b.totalLatencyMs += r.latencyMs
              if (typeof r.ttftMs === 'number') {
                b.totalTtftMs += r.ttftMs
                b.ttftCount++
              }
            }
            buckets = Array.from(bucketMap.values()).sort((a, b) => a.bucket - b.bucket)
          }

          const sortedBuckets = buckets.map((b) => ({
            bucket: b.bucket,
            interval,
            requests: b.requests,
            successCount: b.successCount,
            failedCount: b.failedCount,
            promptTokens: b.promptTokens,
            cachedTokens: b.cachedTokens,
            outputTokens: b.outputTokens,
            cacheHitRate: b.promptTokens > 0 ? Number((b.cachedTokens / b.promptTokens).toFixed(4)) : 0,
            avgLatencyMs: b.requests > 0 ? Math.round(b.totalLatencyMs / b.requests) : 0,
            avgTtftMs: b.ttftCount > 0 ? Math.round(b.totalTtftMs / b.ttftCount) : 0,
          }))

          sendJson(res as RawRes, 200, {
            ok: true,
            interval,
            data: sortedBuckets,
          })
        } catch (err) {
          sendJson(res as RawRes, 500, { ok: false, error: String(err) })
        }
      })()
    })

    // 4. Accounts usage aggregation
    regBoth('stats/accounts-usage', (_req, res) => {
      void (async () => {
        try {
          const usageList = statsStorage.getAccountUsage
            ? await statsStorage.getAccountUsage()
            : []

          const accountUsageMap = new Map<string, AccountUsageMetric>()
          for (const u of usageList) {
            accountUsageMap.set(u.accountId, u)
          }

          const accounts = pool.getAccounts()
          const seen = new Set<string>()

          const result = accounts.map((acc) => {
            seen.add(acc.id)
            const u = accountUsageMap.get(acc.id)
            const totalReq = u?.totalRequests ?? 0
            const promptTok = u?.promptTokens ?? 0
            const cachedTok = u?.cachedTokens ?? 0
            return {
              accountId: acc.id,
              alias: acc.alias,
              email: acc.email ? maskEmail(acc.email) : undefined,
              enabled: acc.enabled,
              authRequired: acc.authRequired,
              totalRequests: totalReq,
              successRequests: u?.successRequests ?? 0,
              failedRequests: u?.failedRequests ?? 0,
              promptTokens: promptTok,
              cachedTokens: cachedTok,
              outputTokens: u?.outputTokens ?? 0,
              cacheHitRate: promptTok > 0 ? Number((cachedTok / promptTok).toFixed(4)) : 0,
              avgLatencyMs: totalReq > 0 ? Math.round((u?.totalLatencyMs ?? 0) / totalReq) : 0,
              lastUsed: u?.lastUsed ?? null,
            }
          })

          for (const [id, u] of accountUsageMap.entries()) {
            if (!seen.has(id)) {
              const promptTok = u.promptTokens ?? 0
              const cachedTok = u.cachedTokens ?? 0
              result.push({
                accountId: id,
                alias: id,
                email: undefined,
                enabled: false,
                authRequired: false,
                totalRequests: u.totalRequests,
                successRequests: u.successRequests,
                failedRequests: u.failedRequests,
                promptTokens: promptTok,
                cachedTokens: cachedTok,
                outputTokens: u.outputTokens,
                cacheHitRate: promptTok > 0 ? Number((cachedTok / promptTok).toFixed(4)) : 0,
                avgLatencyMs: u.totalRequests > 0 ? Math.round(u.totalLatencyMs / u.totalRequests) : 0,
                lastUsed: u.lastUsed,
              })
            }
          }

          sendJson(res as RawRes, 200, {
            ok: true,
            accounts: result,
          })
        } catch (err) {
          sendJson(res as RawRes, 500, { ok: false, error: String(err) })
        }
      })()
    })

    return () => {
      for (const d of disposers) {
        try {
          d()
        } catch {
          // ignore
        }
      }
    }
  }

  ctx.inject(['webServer'], (sub) => {
    const webServer = sub.get('webServer') as WebServerLike | undefined
    if (!webServer) return
    return registerRoutes(webServer)
  })

  // Background quota refresh: one HTTPS call per account per poll interval
  ctx.effect(() => {
    if (!getConfig().enabled) return () => undefined
    const refresh = (): void => {
      void quota.refreshAllQuotas().catch(() => undefined)
    }
    const boot = setTimeout(refresh, 5_000)
    const timer = setInterval(refresh, Math.max(60_000, getConfig().quotaPollIntervalMs))
    return () => {
      clearTimeout(boot)
      clearInterval(timer)
    }
  })

  ctx.effect(() => {
    auth.cancel()
    void poolAuth.cancel()
    if (askToolDispose.current !== null) askToolDispose.current()
    return () => undefined
  })
}
