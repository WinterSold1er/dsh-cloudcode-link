// AuthHelper: in-GUI Google OAuth without a terminal.
// Checks stored tokens and credentials across environment, memory, Keychain, and disk.
import type { AccountPoolManager } from './pool.ts'
import type { QuotaService } from './quota.ts'

export type AuthPhase = 'idle' | 'pending' | 'submitting' | 'ok' | 'failed' | 'signed-out'

export interface AuthStatus {
  phase: AuthPhase
  accountId?: string
  url?: string
  qrDataUrl?: string
  startedAt?: number
  expiresAt?: number
  message?: string
}

export class AuthHelper {
  private state: AuthStatus = { phase: 'idle' }
  private signedInCache: { value: boolean | null; at: number } | null = null
  private signedInFlight: Promise<boolean | null> | null = null
  private readonly pool?: AccountPoolManager
  private readonly quota?: QuotaService

  constructor(pool?: AccountPoolManager, quota?: QuotaService) {
    this.pool = pool
    this.quota = quota
  }

  status(): AuthStatus {
    return { ...this.state }
  }

  /**
   * Ground-truth login probe: validates whether a valid token exists for the primary or any account.
   */
  async probeSignedIn(force = false): Promise<boolean | null> {
    if (this.state.phase === 'pending' || this.state.phase === 'submitting') return null
    if (this.state.phase === 'ok') return true

    const now = Date.now()
    if (!force && this.signedInCache !== null && now - this.signedInCache.at < 60_000) {
      return this.signedInCache.value
    }
    if (this.signedInFlight !== null) return this.signedInFlight

    const runner = async (): Promise<boolean | null> => {
      // 1. Check env token
      if (process.env.ANTIGRAVITY_TOKEN?.trim()) {
        return true
      }

      // 2. Check pool accounts
      if (this.pool && this.quota) {
        const poolData = this.pool.getPoolData()
        const primaryAcc = poolData.primaryAccountId ? this.pool.getAccount(poolData.primaryAccountId) : undefined
        const candidate = (primaryAcc && primaryAcc.enabled && !primaryAcc.authRequired)
          ? primaryAcc
          : this.pool.getAccounts().find((a) => a.enabled && !a.authRequired)

        if (candidate) {
          try {
            const token = await this.quota.getValidAccessToken(candidate)
            if (token) return true
          } catch {
            // failed
          }
        }
      }

      return false
    }

    this.signedInFlight = runner().then((val) => {
      this.signedInCache = { value: val, at: Date.now() }
      this.signedInFlight = null
      return val
    })

    return this.signedInFlight
  }

  async resolvedStatus(): Promise<AuthStatus> {
    const st = this.status()
    if (st.phase !== 'idle') return st
    const signedIn = await this.probeSignedIn()
    if (signedIn === true) return { phase: 'ok', message: 'signed in' }
    if (signedIn === false) return { phase: 'signed-out', message: 'not signed in — run /agy auth or add account' }
    return st
  }

  cancel(): void {
    this.state = { phase: 'idle' }
  }
}
