import type { PluginConfig } from '../common/types.ts'
import type { AccountPoolManager } from './pool.ts'
import type { QuotaService } from './quota.ts'
import { loadCodeAssist } from './client.ts'

export interface HeartbeatDeps {
  getConfig: () => PluginConfig
  quota: QuotaService
  pool?: AccountPoolManager
  log?: (msg: string) => void
  pingFn?: (token: string, proxyUrl?: string, customEndpoints?: string[]) => Promise<unknown>
}

export interface HeartbeatStatus {
  activeSubagents: number
  isRunning: boolean
  lastPingAt?: number
  lastPingOk?: boolean
}

export class HeartbeatManager {
  private readonly deps: HeartbeatDeps
  private readonly activeSubagentIds = new Set<string>()
  private anonymousCount = 0
  private timer: NodeJS.Timeout | null = null
  private inFlight = false
  private disposed = false
  private lastPingAt?: number
  private lastPingOk?: boolean

  constructor(deps: HeartbeatDeps) {
    this.deps = deps
  }

  onSubagentStart(subagentId?: string): void {
    if (this.disposed) return
    if (subagentId) {
      this.activeSubagentIds.add(subagentId)
    } else {
      this.anonymousCount++
    }
    if (!this.timer) {
      this.startTimer()
    }
  }

  onSubagentEnd(subagentId?: string): void {
    if (this.disposed) return
    if (subagentId) {
      this.activeSubagentIds.delete(subagentId)
    } else if (this.anonymousCount > 0) {
      this.anonymousCount--
    }

    if (this.activeSubagentIds.size === 0 && this.anonymousCount === 0) {
      this.stopTimer()
    }
  }

  private startTimer(): void {
    if (this.disposed || this.timer) return
    const cfg = this.deps.getConfig()
    if (!cfg.heartbeatEnabled) return
    const interval = Math.max(30_000, cfg.heartbeatIntervalMs || 180_000)
    this.timer = setInterval(() => {
      void this.triggerHeartbeat()
    }, interval)
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async triggerHeartbeat(): Promise<void> {
    if (this.disposed || this.inFlight) return
    this.inFlight = true
    try {
      const cfg = this.deps.getConfig()
      if (!cfg.heartbeatEnabled) {
        this.stopTimer()
        return
      }

      const accounts = this.deps.pool
        ? this.deps.pool.getAccounts().filter((a) => a.enabled && !a.authRequired)
        : []

      if (accounts.length === 0) {
        return
      }

      const ping = this.deps.pingFn ?? ((t, p, c) => loadCodeAssist(t, p, c, true))
      const customEndpoints = cfg.endpointCandidates as string[]

      let pingCount = 0
      const results = await Promise.allSettled(
        accounts.map(async (acc) => {
          const token = await this.deps.quota.getValidAccessToken(acc)
          if (!token) return
          pingCount++
          await ping(token, acc.proxyUrl, customEndpoints)
        }),
      )

      if (pingCount > 0) {
        this.lastPingAt = Date.now()
        this.lastPingOk = !results.some((r) => r.status === 'rejected')
      }

      for (const r of results) {
        if (r.status === 'rejected') {
          this.deps.log?.(`heartbeat ping error: ${String(r.reason)}`)
        }
      }
    } catch (err) {
      this.lastPingAt = Date.now()
      this.lastPingOk = false
      this.deps.log?.(`heartbeat error: ${String(err)}`)
    } finally {
      this.inFlight = false
    }
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer()
    this.activeSubagentIds.clear()
    this.anonymousCount = 0
  }

  getStatus(): HeartbeatStatus {
    return {
      activeSubagents: this.activeSubagentIds.size + this.anonymousCount,
      isRunning: this.timer !== null,
      lastPingAt: this.lastPingAt,
      lastPingOk: this.lastPingOk,
    }
  }
}
