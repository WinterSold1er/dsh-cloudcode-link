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

export interface SubagentEvent {
  id?: string
  session?: {
    id?: string
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
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
  const pool = new AccountPoolManager()
  const quota = new QuotaService(pool)
  void quota.selfHealQuarantinedAccounts().catch(() => undefined)
  const sessionStore = new SessionStore(join(stateDir(), 'sessions.json'))
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
    const sendJson = (res: RawRes, status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
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

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/status',
      handler: (_req, res) => {
        void (async () => {
          const cfg = getConfig()
          const cat = catalog.get()
          const authStatus = await auth.resolvedStatus()
          sendJson(res as RawRes, 200, {
            plugin: 'dsh-agy-link',
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/catalog',
      handler: (_req, res) => {
        const current = catalog.get()
        sendJson(res as RawRes, 200, {
          ok: true,
          source: current.source,
          count: current.models.length,
          models: current.models,
        })
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool',
      handler: (_req, res) => {
        sendJson(res as RawRes, 200, pool.getPoolData())
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/begin-add',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/complete-add',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/cancel-add',
      handler: (req, res) => {
        void (async () => {
          if (methodOf(req) !== 'POST') {
            sendJson(res as RawRes, 405, { error: 'POST only' })
            return
          }
          await readBody(req)
          await poolAuth.cancel()
          sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
        })()
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/remove',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/proxy',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/primary',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/mode',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/refresh-quota',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/pool/clear-cooldown',
      handler: (req, res) => {
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
      },
    })

    reg({
      kind: 'exact',
      path: '/plugins/agy-link/config',
      handler: (req, res) => {
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
      },
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
