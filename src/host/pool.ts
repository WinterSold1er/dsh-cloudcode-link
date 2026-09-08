// AccountPoolManager: multi-profile credential isolation, family-scoped cooldown,
// and sticky sequential drain scheduling for Google Antigravity accounts.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  defaultPoolData,
  modelFamilyOf,
  type AccountPoolData,
  type FamilyCooldownState,
  type FamilyQuotaInfo,
  type FamilyStatus,
  type ManagedAccount,
  type ModelFamily,
} from '../common/pool-types.ts'
import { parseResetDurationMs } from '../common/types.ts'
import { dshHome } from '../common/config.ts'

export function defaultPoolDir(): string {
  return join(dshHome(), 'agy-accounts')
}

export class Semaphore {
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

export class AccountPoolManager {
  private data: AccountPoolData
  private readonly baseDir: string
  private readonly file: string
  private readonly activeMemoryTokens = new Map<string, { token: string; expiresAt: number }>()
  private readonly accountSemaphores = new Map<string, Semaphore>()
  private readonly runtimeActiveAccountIds = new Map<ModelFamily, string>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(baseDir = defaultPoolDir()) {
    this.baseDir = baseDir
    this.file = join(baseDir, 'pool.json')
    try {
      chmodSync(this.baseDir, 0o700)
    } catch {}
    this.data = this.load()
    this.bootstrapDefaultAccount()
    this.normalizeLegacyPrimary()
  }

  private load(): AccountPoolData {
    if (!existsSync(this.file)) {
      return defaultPoolData()
    }
    const raw = readFileSync(this.file, 'utf8')
    try {
      const parsed = JSON.parse(raw) as AccountPoolData
      if (parsed && Array.isArray(parsed.accounts)) {
        return {
          ...defaultPoolData(),
          ...parsed,
        }
      }
      throw new Error('Missing or invalid accounts array')
    } catch (err: unknown) {
      const corruptBackup = `${this.file}.corrupted.${Date.now()}`
      try {
        renameSync(this.file, corruptBackup)
      } catch {
        // Best-effort backup
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to load account pool from ${this.file}: ${msg}. Corrupted file backed up to ${corruptBackup}`)
    }
  }

  private persist(): void {
    const doWrite = () => {
      try {
        const dir = dirname(this.file)
        mkdirSync(dir, { recursive: true })
        try {
          chmodSync(dir, 0o700)
        } catch {}
        const tmp = join(
          dir,
          `.pool.json.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
        )
        writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 })
        try {
          chmodSync(tmp, 0o600)
        } catch {}
        renameSync(tmp, this.file)
      } catch {
        // Best-effort persistence
      }
    }

    // Queue writes to serialize concurrent async persist calls
    this.writeQueue = this.writeQueue.then(doWrite, doWrite)
    // Synchronously write immediately to satisfy synchronous callers and tests
    doWrite()
  }

  /**
   * Bootstraps the primary account on first start.
   *
   * The primary account rides the REAL system HOME with no directory
   * isolation: agy 1.1.15+ persists credentials in the macOS Keychain
   * ("Antigravity Safe Storage"), not in a ~/.gemini token file, so copying
   * files cannot migrate sign-in state. Injecting HOME would log the
   * primary account out of agy entirely (observed: "Please sign in").
   * Only SECONDARY pool accounts get isolated HOME directories, created
   * and signed in via /agy add-account.
   */
  private bootstrapDefaultAccount(): void {
    // The primary slot represents whatever account is currently logged into
    // the REAL system HOME (`agy login` / `agy logout` outside DSH). It must
    // ALWAYS exist: it used to be created only for an empty pool, so deleting
    // it while other accounts remained made the system-HOME login invisible
    // forever — the UI fell back to an isolated account and looked "stale"
    // after every external re-login. Users who don't want it can disable it.
    const hasSystemHome = this.data.accounts.some((a) => a.systemHome)
    if (hasSystemHome) return

    const primary: ManagedAccount = {
      id: 'acc_primary',
      alias: '主账号 (系统登录)',
      dir: '',
      systemHome: true,
      enabled: true,
      createdAt: Date.now(),
      cooldowns: {},
      quotas: {},
    }

    this.data.accounts.unshift(primary)
    this.data.primaryAccountId = primary.id
    this.persist()
  }

  /**
   * Migrates pool files created before Keychain-aware primaries: an
   * acc_primary that carries an isolated dir (and likely a broken token
   * copy) is converted back to the system HOME so agy stays signed in.
   * The stale directory is left untouched (never deletes user data).
   */
  private normalizeLegacyPrimary(): void {
    const primary = this.data.accounts.find((a) => a.id === 'acc_primary')
    if (!primary || primary.systemHome) return
    primary.dir = ''
    primary.systemHome = true
    primary.alias = '主账号 (系统登录)'
    this.data.primaryAccountId = primary.id
    this.persist()
  }

  getPoolData(): Readonly<AccountPoolData> {
    return this.data
  }

  setMemoryToken(id: string, token: string, expiresAt?: number): void {
    this.activeMemoryTokens.set(id, {
      token,
      expiresAt: expiresAt ?? Date.now() + 55 * 60 * 1000,
    })
  }

  getMemoryToken(id: string): string | null {
    const entry = this.activeMemoryTokens.get(id)
    if (!entry) return null
    if (entry.expiresAt <= Date.now() + 10_000) {
      this.activeMemoryTokens.delete(id)
      return null
    }
    return entry.token
  }

  clearMemoryToken(id: string): void {
    this.activeMemoryTokens.delete(id)
  }

  async acquireAccount(id: string, maxConcurrent = 1): Promise<() => void> {
    let sem = this.accountSemaphores.get(id)
    if (!sem) {
      sem = new Semaphore(() => maxConcurrent)
      this.accountSemaphores.set(id, sem)
    }
    return sem.acquire()
  }

  getAccounts(): readonly ManagedAccount[] {
    return this.data.accounts
  }

  getAccount(id: string): ManagedAccount | undefined {
    return this.data.accounts.find((a) => a.id === id)
  }

  /**
   * Create an isolated staging directory for an unverified account login attempt.
   */
  createStagingSlot(): { id: string; dir: string } {
    const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const dir = join(this.baseDir, `staging_${id}`)
    mkdirSync(join(dir, '.gemini', 'antigravity-cli'), { recursive: true })
    try {
      chmodSync(dir, 0o700)
    } catch {}
    return { id, dir }
  }

  /**
   * Commit a successfully authenticated staging account into the pool.
   */
  commitStagingAccount(id: string, dir: string, alias?: string, email?: string, proxyUrl?: string): ManagedAccount {
    const finalDir = join(this.baseDir, id)
    try {
      if (existsSync(dir)) {
        renameSync(dir, finalDir)
        try {
          chmodSync(finalDir, 0o700)
        } catch {}
      }
    } catch {
      // If rename fails, keep dir
    }
    const count = this.data.accounts.length + 1
    const newAccount: ManagedAccount = {
      id,
      alias: alias || `备用 Google 账号 ${count}`,
      dir: existsSync(finalDir) ? finalDir : dir,
      ...(email ? { email } : {}),
      ...(proxyUrl ? { proxyUrl } : {}),
      enabled: true,
      createdAt: Date.now(),
      cooldowns: {},
      quotas: {},
    }

    this.data.accounts.push(newAccount)
    this.persist()
    return newAccount
  }

  cleanupStagingSlot(dir: string): void {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      // Ignore cleanup error
    }
  }

  /**
   * Remove every staging_* directory left behind by interrupted add-account
   * attempts. Staging dirs are never referenced by committed accounts, so
   * sweeping them at boot is always safe. Returns the number removed.
   */
  sweepStaleStaging(): number {
    let removed = 0
    try {
      for (const entry of readdirSync(this.baseDir)) {
        if (!entry.startsWith('staging_')) continue
        rmSync(join(this.baseDir, entry), { recursive: true, force: true })
        removed++
      }
    } catch {
      // Ignore sweep errors
    }
    return removed
  }

  /**
   * Sweep agy CLI log files older than maxDays (default: 7) across all managed account directories
   * as well as the primary system ~/.gemini/antigravity-cli/log directory.
   */
  sweepOldLogs(maxDays = 7): number {
    const maxAgeMs = Math.max(1, maxDays) * 86_400_000
    const now = Date.now()
    let removed = 0

    const targetLogDirs = [
      join(homedir(), '.gemini', 'antigravity-cli', 'log'),
    ]

    for (const acc of this.data.accounts) {
      if (acc.dir) {
        targetLogDirs.push(join(acc.dir, '.gemini', 'antigravity-cli', 'log'))
      }
    }

    for (const logDir of targetLogDirs) {
      if (!existsSync(logDir)) continue
      try {
        const files = readdirSync(logDir)
        for (const f of files) {
          if (!f.startsWith('cli-') || !f.endsWith('.log')) continue
          const fp = join(logDir, f)
          try {
            const st = statSync(fp)
            if (now - st.mtimeMs > maxAgeMs) {
              rmSync(fp, { force: true })
              removed++
            }
          } catch {
            // Ignore file error
          }
        }
      } catch {
        // Ignore dir error
      }
    }

    return removed
  }

  /**
   * Create a new isolated account slot and prepare its filesystem home.
   */
  createAccountSlot(alias?: string): ManagedAccount {
    const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const dir = join(this.baseDir, id)
    mkdirSync(join(dir, '.gemini', 'antigravity-cli'), { recursive: true })
    try {
      chmodSync(dir, 0o700)
    } catch {}

    const count = this.data.accounts.length + 1
    const newAccount: ManagedAccount = {
      id,
      alias: alias || `备用账号 ${count} (Account ${count})`,
      dir,
      enabled: true,
      createdAt: Date.now(),
      cooldowns: {},
      quotas: {},
    }

    this.data.accounts.push(newAccount)
    this.persist()
    return newAccount
  }

  deleteAccount(id: string): boolean {
    const idx = this.data.accounts.findIndex((a) => a.id === id)
    if (idx === -1) return false
    const [removed] = this.data.accounts.splice(idx, 1)
    if (removed) {
      try {
        if (existsSync(removed.dir)) {
          rmSync(removed.dir, { recursive: true, force: true })
        }
      } catch {
        // Ignore deletion errors
      }
    }
    if (this.data.primaryAccountId === id) {
      // Never promote an isolated account to "primary": the primary slot is
      // reserved for the system-HOME login and is re-bootstrapped on load.
      this.data.primaryAccountId = undefined
    }
    if (this.data.pinnedAccountId === id) {
      this.data.pinnedAccountId = undefined
    }
    for (const [fam, accId] of this.runtimeActiveAccountIds.entries()) {
      if (accId === id) this.runtimeActiveAccountIds.delete(fam as ModelFamily)
    }
    if (this.data.activeAccountIds) {
      for (const [fam, accId] of Object.entries(this.data.activeAccountIds)) {
        if (accId === id) delete this.data.activeAccountIds[fam as ModelFamily]
      }
    }
    this.persist()
    return true
  }

  setAccountProxy(id: string, proxyUrl?: string): boolean {
    const acc = this.getAccount(id)
    if (!acc) return false
    acc.proxyUrl = proxyUrl?.trim() ? proxyUrl.trim() : undefined
    this.persist()
    return true
  }

  setAccountAlias(id: string, alias: string): boolean {
    const acc = this.getAccount(id)
    if (!acc) return false
    acc.alias = alias.trim()
    this.persist()
    return true
  }

  setAccountEnabled(id: string, enabled: boolean): boolean {
    const acc = this.getAccount(id)
    if (!acc) return false
    acc.enabled = enabled
    if (!enabled) {
      for (const [fam, accId] of this.runtimeActiveAccountIds.entries()) {
        if (accId === id) this.runtimeActiveAccountIds.delete(fam as ModelFamily)
      }
      if (this.data.activeAccountIds) {
        for (const [fam, accId] of Object.entries(this.data.activeAccountIds)) {
          if (accId === id) delete this.data.activeAccountIds[fam as ModelFamily]
        }
      }
      if (this.data.pinnedAccountId === id) {
        this.data.pinnedAccountId = undefined
      }
      delete acc.pinned
    }
    this.persist()
    return true
  }

  markAuthRequired(id: string, reason?: string): void {
    const acc = this.getAccount(id)
    if (!acc) return
    acc.authRequired = true
    acc.authError = reason || 'Authentication expired or revoked (invalid_grant)'
    for (const [fam, accId] of this.runtimeActiveAccountIds.entries()) {
      if (accId === id) this.runtimeActiveAccountIds.delete(fam as ModelFamily)
    }
    if (this.data.activeAccountIds) {
      for (const [fam, accId] of Object.entries(this.data.activeAccountIds)) {
        if (accId === id) delete this.data.activeAccountIds[fam as ModelFamily]
      }
    }
    this.persist()
  }

  /**
   * External re-login detected (agy logout + new login): identity-bound
   * state from the PREVIOUS account (cooldowns, quotas, auth quarantine)
   * must not leak onto the new one. Resets everything email-bound while
   * keeping slot config (alias, dir, proxy, enabled).
   */
  resetAccountIdentity(id: string, newEmail: string): void {
    const acc = this.getAccount(id)
    if (!acc) return
    acc.email = newEmail
    acc.cooldowns = {}
    acc.quotas = {}
    delete acc.authRequired
    delete acc.authError
    this.persist()
  }

  clearAuthRequired(id: string): void {
    const acc = this.getAccount(id)
    if (!acc) return
    delete acc.authRequired
    delete acc.authError
    this.persist()
  }

  setPrimaryAccount(id: string): boolean {
    const idx = this.data.accounts.findIndex((a) => a.id === id)
    if (idx === -1) return false
    this.data.primaryAccountId = id
    // Move to front of accounts list
    const [acc] = this.data.accounts.splice(idx, 1)
    if (acc) this.data.accounts.unshift(acc)
    // Make primary immediately active for all families in persistent configuration
    this.data.activeAccountIds = {
      google: id,
      anthropic: id,
      openai: id,
    }
    // Also synchronize runtime active account IDs
    this.runtimeActiveAccountIds.set('google', id)
    this.runtimeActiveAccountIds.set('anthropic', id)
    this.runtimeActiveAccountIds.set('openai', id)
    this.persist()
    return true
  }

  /**
   * Pins an account as the user-locked preferred account.
   * A healthy pinned account always takes precedence over sequential drain or round-robin.
   */
  pinAccount(id: string | null): boolean {
    if (!id) {
      this.data.pinnedAccountId = undefined
      for (const acc of this.data.accounts) {
        delete acc.pinned
      }
      this.persist()
      return true
    }
    const acc = this.getAccount(id)
    if (!acc || !acc.enabled) return false
    this.data.pinnedAccountId = id
    for (const a of this.data.accounts) {
      if (a.id === id) {
        a.pinned = true
      } else {
        delete a.pinned
      }
    }
    this.runtimeActiveAccountIds.set('google', id)
    this.runtimeActiveAccountIds.set('anthropic', id)
    this.runtimeActiveAccountIds.set('openai', id)
    this.persist()
    return true
  }

  /**
   * Retrieves the currently pinned account if configured.
   */
  getPinnedAccount(): ManagedAccount | null {
    if (this.data.pinnedAccountId) {
      return this.getAccount(this.data.pinnedAccountId) ?? null
    }
    return this.data.accounts.find((a) => a.pinned) ?? null
  }

  reorderAccounts(ids: string[]): boolean {
    const map = new Map(this.data.accounts.map((a) => [a.id, a]))
    const reordered: ManagedAccount[] = []
    for (const id of ids) {
      const acc = map.get(id)
      if (acc) {
        reordered.push(acc)
        map.delete(id)
      }
    }
    // Append any unmentioned accounts
    for (const remaining of map.values()) {
      reordered.push(remaining)
    }
    this.data.accounts = reordered
    this.persist()
    return true
  }

  setMode(mode: 'sequential' | 'round-robin'): void {
    this.data.mode = mode
    this.persist()
  }

  updateAccountQuotas(id: string, quotas: Partial<Record<ModelFamily, FamilyQuotaInfo>>, email?: string): void {
    const acc = this.getAccount(id)
    if (!acc) return
    acc.quotas = {
      ...acc.quotas,
      ...quotas,
    }
    if (email) acc.email = email
    this.persist()
  }

  /**
   * Records a rate-limit / 429 error and sets cooldown for the requested model family.
   */
  recordFailure(id: string, family: ModelFamily, reason: string, serverResetTime?: string): void {
    const acc = this.getAccount(id)
    if (!acc) return

    const prev = acc.cooldowns[family]
    const failures = (prev?.consecutiveFailures ?? 0) + 1

    let cooldownUntil: number
    const parsedDuration = parseResetDurationMs(serverResetTime || reason)

    if (serverResetTime && !parsedDuration) {
      const parsed = Date.parse(serverResetTime)
      if (!Number.isNaN(parsed) && parsed > Date.now()) {
        cooldownUntil = parsed + 10_000 // 10s safety buffer
      } else {
        cooldownUntil = Date.now() + Math.min(this.data.defaultCooldownMs * failures, this.data.maxCooldownMs)
      }
    } else if (parsedDuration && parsedDuration > 0) {
      // Add a 10s safety buffer to avoid hitting Google at the exact millisecond of reset
      cooldownUntil = Date.now() + parsedDuration + 10_000
    } else {
      cooldownUntil = Date.now() + Math.min(this.data.defaultCooldownMs * failures, this.data.maxCooldownMs)
    }

    acc.cooldowns[family] = {
      cooldownUntil,
      reason,
      consecutiveFailures: failures,
    }
    this.persist()
  }

  /**
   * Records a successful run, clearing failure counter and authRequired flag for the family.
   */
  recordSuccess(id: string, family: ModelFamily): void {
    const acc = this.getAccount(id)
    if (!acc) return
    acc.lastUsedAt = Date.now()
    if (acc.authRequired) {
      delete acc.authRequired
      delete acc.authError
    }
    if (acc.cooldowns[family]) {
      delete acc.cooldowns[family]
    }
    this.persist()
  }

  clearCooldown(id?: string, family?: ModelFamily): void {
    if (id) {
      const acc = this.getAccount(id)
      if (!acc) return
      if (family) delete acc.cooldowns[family]
      else acc.cooldowns = {}
    } else {
      for (const acc of this.data.accounts) {
        if (family) delete acc.cooldowns[family]
        else acc.cooldowns = {}
      }
    }
    this.persist()
  }

  /**
   * Checks whether an account is healthy and available for use with the specified model family.
   * Centralizes checks for enabled, authRequired, cooldown, and 5h/weekly quota exhaustion.
   */
  isAccountHealthy(account: ManagedAccount, family: ModelFamily): boolean {
    if (!account.enabled || account.authRequired) return false
    const now = Date.now()
    const cd = account.cooldowns[family]
    if (cd && cd.cooldownUntil > now) return false
    const quota = account.quotas[family]
    if (quota && typeof quota.remainingFraction === 'number' && quota.remainingFraction <= 0.02) {
      if (quota.resetTime) {
        const resetMs = Date.parse(quota.resetTime)
        if (!Number.isNaN(resetMs) && resetMs > now) return false
      }
    }
    if (quota && typeof quota.weeklyFraction === 'number' && quota.weeklyFraction <= 0.01) {
      if (quota.weeklyResetTime) {
        const resetMs = Date.parse(quota.weeklyResetTime)
        if (!Number.isNaN(resetMs) && resetMs > now) return false
      }
    }
    return true
  }

  /**
   * Core scheduling algorithm: Sticky Sequential Drain.
   * Sticks to the current active account until it runs out of quota/rate-limited,
   * then smoothly advances to the next available account in cyclic order.
   */
  selectAccount(family: ModelFamily): ManagedAccount | null {
    const candidates = this.data.accounts.filter((acc) => this.isAccountHealthy(acc, family))

    if (candidates.length === 0) return null

    // 0. Pin check: if a pinned account is configured and healthy, ALWAYS prefer it!
    const pinned = this.getPinnedAccount()
    if (pinned && candidates.some((c) => c.id === pinned.id)) {
      this.runtimeActiveAccountIds.set(family, pinned.id)
      return pinned
    }

    if (this.data.mode === 'round-robin' && candidates.length > 1) {
      // Pick least recently used candidate
      const sorted = candidates.slice().sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
      const chosen = sorted[0] ?? null
      if (chosen) {
        this.runtimeActiveAccountIds.set(family, chosen.id)
      }
      return chosen
    }

    // Default 'sequential' (Sticky Sequential Drain):
    // 1. If currently active account for this family is still healthy and has quota, STICK WITH IT!
    const activeId = this.runtimeActiveAccountIds.get(family) ?? this.data.activeAccountIds?.[family]
    if (activeId) {
      const activeCandidate = candidates.find((a) => a.id === activeId)
      if (activeCandidate) {
        this.runtimeActiveAccountIds.set(family, activeCandidate.id)
        return activeCandidate
      }
    }

    // 2. Active account is drained or unavailable -> advance to next healthy candidate in cyclic order
    let nextAccount: ManagedAccount = candidates[0]!
    if (activeId) {
      const currentIndex = this.data.accounts.findIndex((a) => a.id === activeId)
      if (currentIndex !== -1) {
        const total = this.data.accounts.length
        for (let i = 1; i < total; i++) {
          const checkAcc = this.data.accounts[(currentIndex + i) % total]!
          if (candidates.some((c) => c.id === checkAcc.id)) {
            nextAccount = checkAcc
            break
          }
        }
      }
    }

    // CRITICAL: Update runtime in-memory active account ONLY.
    // NEVER mutate this.data.activeAccountIds and NEVER call this.persist() during read-only selectAccount!
    this.runtimeActiveAccountIds.set(family, nextAccount.id)
    return nextAccount
  }

  /**
   * Get countdown in milliseconds until the earliest account in cooldown or quota resets.
   */
  getEarliestResetCountdown(family: ModelFamily): number | null {
    const now = Date.now()
    let earliest: number | null = null
    for (const acc of this.data.accounts) {
      if (!acc.enabled || acc.authRequired) continue
      let accReset: number | null = null
      const cd = acc.cooldowns[family]
      if (cd && cd.cooldownUntil > now) {
        accReset = Math.max(accReset ?? 0, cd.cooldownUntil)
      }
      const quota = acc.quotas[family]
      if (quota && typeof quota.remainingFraction === 'number' && quota.remainingFraction <= 0.02) {
        if (quota.resetTime) {
          const resetMs = Date.parse(quota.resetTime)
          if (!Number.isNaN(resetMs) && resetMs > now) {
            accReset = Math.max(accReset ?? 0, resetMs)
          }
        }
      }
      if (quota && typeof quota.weeklyFraction === 'number' && quota.weeklyFraction <= 0.01) {
        if (quota.weeklyResetTime) {
          const resetMs = Date.parse(quota.weeklyResetTime)
          if (!Number.isNaN(resetMs) && resetMs > now) {
            accReset = Math.max(accReset ?? 0, resetMs)
          }
        }
      }
      if (accReset !== null) {
        if (earliest === null || accReset < earliest) {
          earliest = accReset
        }
      }
    }
    return earliest !== null ? Math.max(0, earliest - now) : null
  }

  /**
   * Inspect availability and suppression status for a given model family across the pool.
   */
  getFamilyStatus(family: ModelFamily): FamilyStatus {
    const accounts = this.data.accounts
    if (accounts.length === 0) {
      return { hasAccount: false, suppressed: false, reason: 'no_accounts', resetInMs: null }
    }

    const enabledAccounts = accounts.filter((a) => a.enabled)
    if (enabledAccounts.length === 0) {
      return { hasAccount: false, suppressed: false, reason: 'disabled', resetInMs: null }
    }

    const authValidAccounts = enabledAccounts.filter((a) => !a.authRequired)
    if (authValidAccounts.length === 0) {
      return { hasAccount: false, suppressed: false, reason: 'auth_required', resetInMs: null }
    }

    const candidate = this.selectAccount(family)
    if (candidate) {
      return { hasAccount: true, suppressed: false, resetInMs: null }
    }

    // Has authenticated accounts, but all are suppressed by cooldown / quota
    const resetInMs = this.getEarliestResetCountdown(family)
    const hasRateLimitCooldown = authValidAccounts.some(
      (a) => a.cooldowns[family] && a.cooldowns[family]!.cooldownUntil > Date.now(),
    )
    const reason = hasRateLimitCooldown ? 'rate_limited' : 'quota_exhausted'

    return {
      hasAccount: true,
      suppressed: true,
      reason,
      resetInMs,
    }
  }
}
