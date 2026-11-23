import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID, formatDuration, type PluginConfig } from '../common/types.ts'
import { modelFamilyOf, type FamilyStatus, type ManagedAccount, type ModelFamily } from '../common/pool-types.ts'
import type { AccountPoolManager } from './pool.ts'
import type { QuotaService } from './quota.ts'
import {
  defaultEffortFor,
  findEntry,
  getAntigravityRequestModelId,
  getInputModalitiesForModel,
  getMaxOutputTokens,
  getThinkingConfig,
  ModelCatalog,
  resolveModelSlug,
  isGemini4Model,
} from './models.ts'
import {
  antigravityRequestEnvelope,
  ensureProject,
  streamGenerateContent,
  type AntigravityGenerateRequest,
} from './client.ts'
import type { SessionStore } from './sessions.ts'
import { convertTools } from './schema-converter.ts'
import { convertMessages, type ImageReader } from './message-converter.ts'
import { mapSseStreamToChunks } from './sse-mapper.ts'
import type { StatsCollector, RequestMetricStatus } from './stats.ts'
import { describeAccountAuth, reauthGuidance } from './account-health.ts'
import type { GeminiAppAdapter } from './gemini-app-adapter.ts'
import { streamWithGeminiAppOffload } from './gemini-app-offload.ts'

/**
 * Connect-phase budget for ONE upstream attempt.
 * `net.ts` deliberately disables the timeout for `streamGenerateContent` (a healthy generation can
 * run for minutes), which leaves the connect/handshake phase untimed: measured stalls of 603s and
 * 211s while the account was already dead. Every attempt gets this deadline explicitly.
 */
export const UPSTREAM_CONNECT_TIMEOUT_MS = 60_000

/**
 * Body-phase budget for ONE upstream attempt: the maximum allowed gap between two ADJACENT SSE
 * chunks (the gap from the response headers to the first chunk counts as one too).
 * This is the budget that catches the failure mode actually observed in production: `net.ts`
 * deliberately leaves `streamGenerateContent` untimed (a healthy generation runs for minutes), so
 * an upstream that sends headers and then goes silent used to stall the turn for 603s. A stream
 * that keeps producing chunks is never cut by this budget, however long it runs.
 */
export const UPSTREAM_IDLE_TIMEOUT_MS = 120_000

/**
 * Backstop only — deliberately NOT a normal-path limit, and deliberately far above a real long
 * session. It exists for two pathological cases: an upstream that trickles keep-alive bytes often
 * enough to never trip {@link UPSTREAM_IDLE_TIMEOUT_MS}, and a failover loop in which every
 * account burns its own connect budget. A legitimately long generation finishes long before it.
 */
export const UPSTREAM_STREAM_CEILING_MS = 30 * 60_000

/** Why one attempt failed to serve the request. Drives the final error classification. */
export type FailoverCause = 'auth' | 'model_unsupported' | 'rate_limit' | 'connect' | 'timeout' | 'api'

/** Which staged budget stopped an attempt; keeps connect vs idle distinguishable in the error. */
export type UpstreamTimeoutPhase = 'connect' | 'idle' | 'ceiling'

/** Human-readable name of each phase, used to build the terminal timeout message. */
const TIMEOUT_PHASE_LABEL: Record<UpstreamTimeoutPhase, string> = {
  connect: 'connect deadline (response headers never arrived)',
  idle: 'idle deadline (no chunk in the gap between adjacent chunks)',
  ceiling: 'hard ceiling backstop (safety net, not a normal-path limit)',
}

/** One observed attempt failure, with the real upstream evidence attached. */
export interface AttemptFailure {
  readonly cause: FailoverCause
  readonly accountId: string
  readonly httpStatus: number | null
  readonly upstreamError: string | null
  /** Set when `cause === 'timeout'`: which staged budget fired. */
  readonly phase?: UpstreamTimeoutPhase
  /** User-facing re-auth sentence recorded for this attempt (empty/absent when none applies). */
  readonly guidance?: string
}

/** Everything the failover loop observed for one `stream()` call. */
export interface PoolFailureReport {
  readonly family: ModelFamily
  readonly wireModel: string
  readonly failures: readonly AttemptFailure[]
  /** Pool's own verdict, taken with the requested model in mind. */
  readonly familyStatus: FamilyStatus
}

/** Terminal error surfaced to the DSH runtime after accounts were exhausted. */
export interface PoolFailureVerdict {
  readonly message: string
  readonly code: string
  readonly status?: number
}

/** Cap the echoed upstream text so a huge HTML error page never lands in a chat error. */
const UPSTREAM_ECHO_MAX_CHARS = 240

/** The most specific re-auth sentence recorded for an attempt, '' when no attempt recorded one. */
function lastGuidance(failures: readonly AttemptFailure[]): string {
  for (let i = failures.length - 1; i >= 0; i--) {
    const guidance = failures[i]!.guidance?.trim()
    if (guidance) return ` ${guidance}`
  }
  return ''
}

function summarizeUpstream(failures: readonly AttemptFailure[]): string {
  for (let i = failures.length - 1; i >= 0; i--) {
    const failure = failures[i]!
    if (failure.httpStatus === null && !failure.upstreamError) continue
    const detail = (failure.upstreamError ?? '').replace(/\s+/g, ' ').trim()
    const clipped = detail.length > UPSTREAM_ECHO_MAX_CHARS ? `${detail.slice(0, UPSTREAM_ECHO_MAX_CHARS)}…` : detail
    return ` Last upstream error: account ${failure.accountId}${
      failure.httpStatus !== null ? ` HTTP ${failure.httpStatus}` : ''
    }${clipped ? `: ${clipped}` : ''}.`
  }
  return ''
}

/**
 * Map the observed failures to the one error the user should see.
 *
 * The old behaviour reported `AUTH_REQUIRED: No authenticated Antigravity account available.
 * Please sign in via /ccl auth.` whenever the pool ran out of candidates — including the common
 * case where every account is signed in fine but simply does not serve the requested model. Each
 * code now has exactly one trigger:
 *   - AUTH_REQUIRED      every failure was a credential failure (401 / refresh failure).
 *   - MODEL_NOT_AVAILABLE entitlement says no account serves this model, or every attempt was 403.
 *   - RATE_LIMIT         every failure was a 429 / cooldown, with the reset countdown attached.
 *   - UPSTREAM_TIMEOUT   a staged upstream budget fired: connect (no headers), idle (no chunk in
 *                        the gap between adjacent chunks) or the hard ceiling backstop.
 *   - API_ERROR / ACCOUNTS_EXHAUSTED otherwise, carrying the last real upstream error.
 */
export function classifyPoolFailure(report: PoolFailureReport): PoolFailureVerdict {
  const { failures, family, wireModel, familyStatus } = report
  const upstream = summarizeUpstream(failures)
  const allOf = (cause: FailoverCause): boolean => failures.length > 0 && failures.every((f) => f.cause === cause)

  const credentialOnly = allOf('auth') || (failures.length === 0 && familyStatus.reason === 'auth_required')
  if (credentialOnly) {
    return {
      message: `No authenticated CloudCode Link account available. Please sign in via /ccl auth.${lastGuidance(failures)}`,
      code: 'AUTH_REQUIRED',
    }
  }

  const modelBlocked =
    familyStatus.reason === 'model_not_available' ||
    (allOf('model_unsupported') ||
      (failures.some((f) => f.cause === 'model_unsupported') &&
        !failures.some((f) => f.cause === 'auth') &&
        // An account that answered 429 WAS entitled to the model; telling the user to switch
        // model would be wrong — the honest verdict there is "wait for the reset".
        !failures.some((f) => f.cause === 'rate_limit')))
  if (modelBlocked) {
    return {
      message:
        `No CloudCode Link account in this pool serves model '${wireModel}' (model family '${family}'). ` +
        `Check /ccl accounts for an account entitled to it, or pick another model.${lastGuidance(failures)}${upstream}`,
      code: 'MODEL_NOT_AVAILABLE',
      status: lastHttpStatus(failures, 403) ?? undefined,
    }
  }

  if (
    allOf('rate_limit') ||
    familyStatus.reason === 'rate_limited' ||
    // Quota fully spent with a future reset is the same actionable state for the caller.
    (familyStatus.suppressed && familyStatus.reason === 'quota_exhausted')
  ) {
    const resetMs = familyStatus.resetInMs
    const resetMsg = resetMs && resetMs > 0 ? ` Resets in ${formatDuration(resetMs)}.` : ''
    return {
      message: `CloudCode Link quota exhausted for model family '${family}'.${resetMsg}${upstream}`,
      code: 'RATE_LIMIT',
      status: 429,
    }
  }

  if (allOf('timeout')) {
    const timedOut = failures.filter((failure) => failure.cause === 'timeout')
    const phases = [...new Set(timedOut.map((failure) => failure.phase))]
    const stageText = phases
      .map((phase) => (phase ? TIMEOUT_PHASE_LABEL[phase] : 'upstream stall'))
      .join(' + ')
    const detail = (timedOut[timedOut.length - 1]?.upstreamError ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      message: `CloudCode Link upstream hit its ${stageText} for model '${wireModel}'${
        detail ? `: ${detail}` : '.'
      }${upstream}`,
      code: 'UPSTREAM_TIMEOUT',
    }
  }

  if (allOf('connect')) {
    const last = failures[failures.length - 1]!
    return {
      message: `Google CloudCode connection error: ${last.upstreamError ?? 'unknown'}${upstream}`,
      code: 'CONNECT_ERROR',
    }
  }

  if (failures.length === 0) {
    return {
      message: 'All available CloudCode Link accounts are exhausted or in cooldown.',
      code: 'ACCOUNTS_EXHAUSTED',
    }
  }

  return {
    message: `All CloudCode Link accounts failed for model '${wireModel}'.${upstream}`,
    code: 'API_ERROR',
    status: lastHttpStatus(failures) ?? undefined,
  }
}

function lastHttpStatus(failures: readonly AttemptFailure[], fallback?: number): number | null {
  for (let i = failures.length - 1; i >= 0; i--) {
    const status = failures[i]!.httpStatus
    if (status !== null) return status
  }
  return fallback ?? null
}

/** Positive finite override or the named default. Guards against 0 / NaN config values. */
function positiveOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Union of the caller's abort, the ceiling backstop and the per-attempt connect/idle aborts. */
function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const live = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (live.length === 1) return live[0]!
  return AbortSignal.any(live)
}

/** One-line rendering of a thrown error for logs and telemetry. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface AgyAdapterDeps {
  getConfig: () => PluginConfig
  catalog: ModelCatalog
  pool?: AccountPoolManager
  quota?: QuotaService
  sessionStore?: SessionStore
  statsCollector?: StatsCollector
  /** Shared semaphore for cross-session concurrency. */
  acquire?: () => Promise<() => void>
  log?: (msg: string) => void
  /** Last-run telemetry surfaced by /ccl status. */
  onRun?: (info: { ok: boolean; code: string; durationMs: number; model: string }) => void
  /** Reads image bytes from DSH attachment storage. */
  readImage?: ImageReader
  /** Custom endpoints override if configured. */
  endpointCandidates?: string[]
  /**
   * Per-attempt connect budget override. Defaults to {@link UPSTREAM_CONNECT_TIMEOUT_MS};
   * a smaller value is used by the timeout regression tests and by ops tuning.
   */
  connectTimeoutMs?: number
  /**
   * Adjacent-chunk (idle) budget override. Defaults to {@link UPSTREAM_IDLE_TIMEOUT_MS};
   * a smaller value is used by the stall regression tests and by ops tuning.
   */
  idleTimeoutMs?: number
  /** Hard ceiling backstop override. Defaults to {@link UPSTREAM_STREAM_CEILING_MS}. */
  streamCeilingMs?: number
  /**
   * Per-failure re-auth sentence (401, and a 403 that is really a grant/scope gap). Owned by the
   * account-health module, which is the only place that can tell a scope-gap 403 from a
   * model-permission 403. Left optional so the adapter never invents the sentence itself; when it
   * is absent, a 401 still gets the sentence from {@link describeAccountAuth} and a 403 gets none.
   */
  reauthGuidanceFor?: (accountId: string, failure: AttemptFailure) => string | undefined
  /**
   * Injectable clock for the epoch segment of the envelope requestId. Production leaves it
   * undefined and the envelope uses the real clock; a caller injects one to get a
   * byte-identical requestId. The connect/deadline timers always use the real clock.
   */
  now?: () => number
  /** Optional Gemini App adapter for transparent offloading of tool-free tasks. */
  geminiAppAdapter?: GeminiAppAdapter
}

export class AgyAdapter extends LlmAdapter {
  private readonly deps: AgyAdapterDeps
  /** Last forced quota refresh timestamp (per process, for session-start refresh). */
  private lastSessionStartQuotaRefresh = 0

  constructor(deps: AgyAdapterDeps) {
    super()
    this.deps = deps
  }

  /**
   * Force a live refresh of every healthy account's 5h quota before choosing a
   * fresh account (brand-new session, or mid-session failover when the bound
   * account went unhealthy). This makes the round-robin selection pick the
   * account with the most remaining 5h quota instead of relying on a stale
   * 15-min background poll.
   *
   * Critically, this is called ONLY when bound/pinned affinity did NOT already
   * resolve an account — so an established session stays pinned to its account
   * and never re-selects, preserving CloudCode KV cache hits.
   *
   * Throttled per-process so rapid consecutive selections don't hammer every
   * account with a fresh HTTPS quota fetch.
   */
  private async refreshQuotasForSelection(family: ModelFamily): Promise<void> {
    const pool = this.deps.pool
    const quota = this.deps.quota
    if (!pool || !quota) return
    const now = Date.now()
    const cfg = this.deps.getConfig()
    const minInterval = Math.max(1_000, cfg.sessionStartQuotaRefreshMinIntervalMs)
    if (now - this.lastSessionStartQuotaRefresh < minInterval) return
    this.lastSessionStartQuotaRefresh = now

    const targets = pool.getAccounts().filter((acc) => {
      if (!acc.enabled || acc.authRequired) return false
      const cd = acc.cooldowns[family]
      if (cd && cd.cooldownUntil > now) return false
      return true
    })
    if (targets.length === 0) return

    await Promise.allSettled(
      targets.map((acc) =>
        quota
          .refreshQuotaSummaryOnly(acc)
          .catch((err: unknown) => {
            this.deps.log?.(`[quota-refresh] failed for ${acc.id}: ${String(err)}`)
            return null
          }),
      ),
    )
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // Provider display name shown in DSH (Settings → Models row, model picker group).
    // `provider` stays the internal route id `antigravity` — see src/common/types.ts.
    return {
      id: provider,
      name: 'CloudCode Link',
    }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    await this.deps.catalog.refreshIfNeeded()
    const cat = this.deps.catalog.get()
    return cat.models.map((m) => ({
      provider,
      id: m.id,
      name: m.name,
      inputModalities: m.inputModalities ?? getInputModalitiesForModel(m.id),
    }))
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const cfg = this.deps.getConfig()
    const cat = this.deps.catalog.get()
    const entry = findEntry(cat, model)
    const wireModel = resolveModelSlug(model)
    const isClaude = wireModel.startsWith('claude-')
    const isGptOss = wireModel.startsWith('gpt-oss-')

    const contextWindow =
      isClaude || isGptOss
        ? 200_000
        : wireModel.startsWith('gemini-') ||
            wireModel.includes('3.5') ||
            wireModel.includes('3.6') ||
            wireModel.includes('3.7') ||
            wireModel.includes('3.8')
          ? 1_048_576
          : cfg.contextWindowDefault
    const maxTokens = getMaxOutputTokens(model, wireModel)
    const inputModalities = entry?.inputModalities ?? getInputModalitiesForModel(wireModel)

    const resolved: LlmResolvedModelInfo = {
      provider,
      id: model,
      name: entry ? entry.name : model,
      inputModalities,
      context: { contextWindow },
      defaultMaxTokens: maxTokens,
    }

    if (entry?.efforts && entry.efforts.length > 0) {
      const validDef = defaultEffortFor(entry, cfg)
      return {
        ...resolved,
        reasoning: {
          efforts: entry.efforts.map((eff) => ({
            id: eff as never,
            name: eff,
          })),
          ...(validDef ? { defaultEffort: validDef as never } : {}),
        },
      }
    }
    return resolved
  }

  /**
   * Bind exact model metadata and dispatch to ONE adapter generation.
   * Required by dsh-llm >= 0.1.1-rc.2.
   */
  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
    model: LlmResolvedModelInfo
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  }> {
    const modelInfo = await this.resolveModel(provider, model, signal)
    return {
      model: modelInfo,
      stream: (options) => this.stream(options),
    }
  }

  /**
   * Main streaming entry point: maps GenerateOptions into CloudCode direct API stream.
   * Supports pre-emission silent account failover on 429 / auth errors.
   */
  /**
   * The re-auth sentence to show for one failed attempt, '' when there is nothing honest to say.
   * Deciding this per failure is the account-health module's job (`reauthGuidanceFor`), because a
   * 403 can be either "this account cannot serve this model" or "this grant is missing the aicode
   * scope", and guessing from the adapter would be a fabricated verdict. What the adapter may
   * decide on its own is the 401: that answer is always a credential verdict, so the account's own
   * recorded grant ({@link describeAccountAuth}) supplies the sentence.
   */
  private reauthGuidanceForAttempt(account: ManagedAccount | null, failure: AttemptFailure): string {
    const supplied = this.deps.reauthGuidanceFor?.(failure.accountId, failure)
    if (supplied?.trim()) return supplied.trim()
    if (failure.httpStatus === 401 && account) {
      const health = describeAccountAuth(account)
      if (health.reauthRequired) return reauthGuidance(health, account.alias || account.id)
    }
    return ''
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.deps.geminiAppAdapter) {
      yield* streamWithGeminiAppOffload(options, {
        getConfig: this.deps.getConfig,
        geminiAdapter: this.deps.geminiAppAdapter,
        fallbackToAgy: (opts) => this.streamAgy(opts),
        log: this.deps.log,
      })
      return
    }
    yield* this.streamAgy(options)
  }

  private async *streamAgy(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const startTime = Date.now()
    const releaseGlobal = this.deps.acquire ? await this.deps.acquire() : null

    const connectBudgetMs = positiveOrDefault(this.deps.connectTimeoutMs, UPSTREAM_CONNECT_TIMEOUT_MS)
    const idleBudgetMs = positiveOrDefault(this.deps.idleTimeoutMs, UPSTREAM_IDLE_TIMEOUT_MS)
    const streamCeilingMs = positiveOrDefault(this.deps.streamCeilingMs, UPSTREAM_STREAM_CEILING_MS)
    const ceilingAt = startTime + streamCeilingMs
    /**
     * Backstop abort for the whole turn (see {@link UPSTREAM_STREAM_CEILING_MS}). It is NOT the
     * budget a stalled upstream runs into — connect and idle fire long before it — so a normal
     * long generation is never cut by it.
     */
    const ceilingSignal = AbortSignal.timeout(Math.max(1, streamCeilingMs))
    /** Every attempt failure recorded here; it is what the final error is classified from. */
    const failures: AttemptFailure[] = []

    try {
      const wireModel = getAntigravityRequestModelId(options.model, options.reasoningEffort)
      const isClaude = wireModel.startsWith('claude-')
      const isGptOss = wireModel.startsWith('gpt-oss-')
      const family = modelFamilyOf(wireModel)
      const maxTokens = options.maxTokens ?? getMaxOutputTokens(options.model, wireModel)
      const thinkingConfig = getThinkingConfig(options.model, options.reasoningEffort)

      const convertedTools = convertTools(options.tools, isClaude || isGptOss)
      const contents = await convertMessages(options.messages, this.deps.readImage, wireModel)

      // Session management & session affinity (FR-01, FR-02)
      const rawSessionId = options.sessionId ? String(options.sessionId) : undefined
      let trajectoryId: string | undefined
      let step: number | undefined
      let boundAccountId: string | undefined

      if (rawSessionId && this.deps.sessionStore) {
        const next = this.deps.sessionStore.nextStep(rawSessionId)
        step = next.step
        trajectoryId = next.trajectoryId
        boundAccountId = this.deps.sessionStore.getBoundAccount(rawSessionId)
      }

      let hasEmitted = false
      const maxAttempts = Math.max(1, this.deps.pool ? this.deps.pool.getAccounts().length : 1)
      let attempt = 0
      const triedAccountIds = new Set<string>()
      /** Account used by the most recent attempt; used to attribute deadline failures. */
      let lastAttemptAccountId: string | undefined

      while (attempt < maxAttempts) {
        attempt++

        const remainingMs = ceilingAt - Date.now()
        if (remainingMs <= 0) {
          // The backstop was consumed by earlier attempts: failover stops here instead of starting
          // yet another untimed request.
          failures.push({
            cause: 'timeout',
            accountId: lastAttemptAccountId ?? 'acc_default',
            httpStatus: null,
            upstreamError: `ceiling backstop of ${Math.round(streamCeilingMs / 1000)}s reached before attempt ${attempt}`,
            phase: 'ceiling',
          })
          break
        }

        // 1. Select account (Priority arbitration: Pin > Session Affinity > Sticky Sequential)
        // All three paths ask the pool for an account that is entitled to THIS wire model.
        let account: ManagedAccount | null = null
        let borrowedAccount: ManagedAccount | undefined = undefined
        let effectiveWireModel = wireModel

        if (this.deps.pool) {
          if (isGemini4Model(wireModel)) {
            const pinned = this.deps.pool.getPinnedAccount()
            const preferredId =
              pinned && !triedAccountIds.has(pinned.id)
                ? pinned.id
                : boundAccountId && !triedAccountIds.has(boundAccountId)
                  ? boundAccountId
                  : undefined

            const capable = this.deps.pool.getCapableAccount(wireModel, preferredId)
            if (capable && !triedAccountIds.has(capable.account.id)) {
              account = capable.account
              borrowedAccount = capable.borrowedFrom
              effectiveWireModel = capable.modelToUse
            }
          }

          if (!account) {
            // Priority 1: Pin Lock takes absolute precedence if healthy and not tried
            const pinned = this.deps.pool.getPinnedAccount()
            if (
              pinned &&
              !triedAccountIds.has(pinned.id) &&
              this.deps.pool.isAccountHealthy(pinned, family, wireModel)
            ) {
              account = pinned
            }

            // Priority 2: Session Affinity (if no healthy pinned account or pinned account is in cooldown/tried)
            if (!account && boundAccountId && !triedAccountIds.has(boundAccountId)) {
              const boundAcc = this.deps.pool.getAccount(boundAccountId)
              if (boundAcc && this.deps.pool.isAccountHealthy(boundAcc, family, wireModel)) {
                account = boundAcc
              }
            }

            // Priority 3: Sticky Sequential / Pool selection.
            // Only reached when the session has no healthy pinned/bound account
            // (i.e. a brand-new session or a session whose previous account
            // just went unhealthy). Before picking, force a live quota refresh so
            // we prefer the account with the most remaining 5h quota. We deliberately
            // do NOT refresh when Bound affinity already resolved an account —
            // that guarantees a session stays pinned to ONE account for cache hits.
            if (!account) {
              await this.refreshQuotasForSelection(family)
              account = this.deps.pool.selectAccount(family, wireModel)
            }

            // Failover candidate: if chosen account was already tried in this turn
            if (account && triedAccountIds.has(account.id)) {
              const alt = this.deps.pool
                .getAccounts()
                .find(
                  (a) =>
                    !triedAccountIds.has(a.id) && this.deps.pool!.isAccountHealthy(a, family, wireModel),
                )
              account = alt ?? null
            }
          }
        }

        // Record affinity binding on selected account
        if (rawSessionId && this.deps.sessionStore && account) {
          this.deps.sessionStore.bindAccount(rawSessionId, account.id)
        }

        // If pool is present and no candidate account is available (and no env token override)
        if (!account && this.deps.pool && !process.env.ANTIGRAVITY_TOKEN?.trim()) {
          const verdict = classifyPoolFailure({
            family,
            wireModel,
            failures,
            familyStatus: this.deps.pool.getFamilyStatus(family, wireModel),
          })
          yield {
            type: 'finish',
            reason: { kind: 'error', failure: verdict },
          }
          return
        }

        const accountId = account ? account.id : 'acc_default'
        const authTargetAccount = borrowedAccount ?? account
        const authTargetId = authTargetAccount ? authTargetAccount.id : accountId
        triedAccountIds.add(accountId)
        lastAttemptAccountId = accountId

        // 2. Acquire per-account concurrency semaphore if pool is present
        let releaseAccount: (() => void) | null = null
        if (this.deps.pool && account) {
          const cfg = this.deps.getConfig()
          const releaseBorrower = await this.deps.pool.acquireAccount(account.id, cfg.maxConcurrent)
          let releaseBorrowed: (() => void) | null = null
          if (borrowedAccount && borrowedAccount.id !== account.id) {
            try {
              releaseBorrowed = await this.deps.pool.acquireAccount(borrowedAccount.id, cfg.maxConcurrent)
            } catch (err) {
              releaseBorrower()
              throw err
            }
          }
          releaseAccount = () => {
            try { releaseBorrower() } catch {}
            try { releaseBorrowed?.() } catch {}
          }
        }

        const requestStartTime = Date.now()
        let firstChunkTime: number | null = null
        let promptTokens = 0
        let cachedTokens = 0
        let outputTokens = 0
        let envelope: ReturnType<typeof antigravityRequestEnvelope> | null = null
        let streamStarted = false
        let runOk = false
        let recorded = false

        const recordTelemetry = (statusOverride?: RequestMetricStatus) => {
          if (recorded) return
          if (!envelope) return
          if (!this.deps.statsCollector || !this.deps.getConfig().statsEnabled) return
          recorded = true

          const requestDuration = Date.now() - requestStartTime
          const ttftMs =
            firstChunkTime !== null ? Math.max(0, firstChunkTime - requestStartTime) : requestDuration
          const status: RequestMetricStatus =
            statusOverride ?? (options.signal?.aborted ? 'abort' : runOk ? 'success' : 'error')

          try {
            this.deps.statsCollector.recordRequest({
              requestId: envelope.requestId,
              sessionId: rawSessionId ?? null,
              accountId,
              model: wireModel,
              timestamp: requestStartTime,
              status,
              latencyMs: requestDuration,
              ttftMs,
              promptTokens,
              cachedTokens,
              outputTokens,
            })
          } catch (err) {
            this.deps.log?.(`Failed to record request stats: ${String(err)}`)
          }
        }

        try {
          // 3. Build the request envelope FIRST: identity fields need no network, and every
          //    attempt failure below can then be written to stats.db with a real requestId.
          const env = antigravityRequestEnvelope(wireModel, isClaude, {
            sessionId: rawSessionId,
            trajectoryId,
            step,
            // agy's cascade grouping is not implemented here; the trajectory id stands in for it
            // (w1's convention), so every step of one run shares the same cascade segment.
            cascadeId: trajectoryId,
            // Production keeps the real clock; a caller may inject one for byte-identical ids.
            ...(this.deps.now ? { now: this.deps.now } : {}),
          })
          envelope = env

          // 4. Resolve valid access token
          let token: string | null = null
          if (process.env.ANTIGRAVITY_TOKEN?.trim()) {
            token = process.env.ANTIGRAVITY_TOKEN.trim()
          } else if (this.deps.quota && authTargetAccount) {
            token = await this.deps.quota.getValidAccessToken(authTargetAccount)
          } else if (this.deps.pool) {
            token = this.deps.pool.getMemoryToken(authTargetId)
          }

          if (!token) {
            if (this.deps.pool && authTargetAccount) {
              this.deps.pool.markAuthRequired(authTargetAccount.id, 'No valid access token or refresh failed')
            }
            failures.push({
              cause: 'auth',
              accountId: authTargetId,
              httpStatus: null,
              upstreamError: 'no usable access token (refresh failed or credential revoked)',
            })
            recordTelemetry('error')
            if (!hasEmitted && attempt < maxAttempts && Date.now() < ceilingAt) {
              this.deps.log?.(`No access token for ${authTargetId}, switching accounts...`)
              continue
            }
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: classifyPoolFailure({
                  family,
                  wireModel,
                  failures,
                  familyStatus: this.deps.pool
                    ? this.deps.pool.getFamilyStatus(family, wireModel)
                    : { hasAccount: false, suppressed: false, reason: 'no_accounts', resetInMs: null },
                }),
              },
            }
            return
          }

          // 5. Ensure project ID
          const targetAccount = borrowedAccount ?? account
          const proxyUrl = targetAccount?.proxyUrl
          const customEndpoints = this.deps.endpointCandidates
          const projectId = await ensureProject(
            token,
            targetAccount?.alias || targetAccount?.id || 'antigravity-default',
            proxyUrl,
            customEndpoints,
          )

          // Body keys are declared in the order the captured agy 1.3.5 flows serialize them
          // (project, requestId, request, model, userAgent, requestType) and every identity value
          // comes from the envelope, never from a locally assembled string.
          const requestBody: AntigravityGenerateRequest = {
            project: projectId,
            requestId: env.requestId,
            request: {
              contents,
              ...(options.system
                ? {
                    systemInstruction: {
                      parts: [{ text: options.system }],
                    },
                  }
                : {}),
              generationConfig: {
                ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
                ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
              ...(convertedTools ? { tools: convertedTools } : {}),
              ...(convertedTools ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
              sessionId: env.sessionId,
              labels: env.labels,
            },
            model: effectiveWireModel,
            userAgent: env.userAgent,
            requestType: env.requestType,
          }

          // 6. Connect with an explicit connect-phase budget. It times the arrival of the RESPONSE
          //    HEADERS only and is cleared the moment they arrive: a long generation is normal, an
          //    account that never answers is not. From the headers onwards the idle budget rules.
          const connectController = new AbortController()
          /** Aborted by the idle budget the moment the body phase goes silent. */
          const idleController = new AbortController()
          let connectTimedOut = false
          let idleTimedOut = false
          let connectTimer: ReturnType<typeof setTimeout> | undefined
          let idleTimer: ReturnType<typeof setTimeout> | undefined

          /**
           * (Re)arm the adjacent-chunk budget. Re-armed on every chunk, so an upstream that keeps
           * producing chunks never trips it, no matter how long the generation runs.
           */
          const armIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer)
            idleTimer = setTimeout(() => {
              idleTimedOut = true
              idleController.abort()
            }, idleBudgetMs)
          }

          /** Which of OUR staged budgets killed this attempt; null means the provider (or caller) did. */
          const ourStallPhase = (): UpstreamTimeoutPhase | null => {
            if (options.signal?.aborted) return null
            if (idleTimedOut) return 'idle'
            if (ceilingSignal.aborted) return 'ceiling'
            return null
          }

          const connectDeadline = new Promise<never>((_, reject) => {
            connectTimer = setTimeout(() => {
              connectTimedOut = true
              connectController.abort()
              reject(
                new Error(
                  `upstream connect deadline of ${connectBudgetMs}ms exceeded before any response header`,
                ),
              )
            }, connectBudgetMs)
          })
          let res: Response
          try {
            const streamResult = await Promise.race([
              streamGenerateContent(
                token,
                requestBody,
                combineSignals([
                  options.signal,
                  ceilingSignal,
                  connectController.signal,
                  idleController.signal,
                ]),
                proxyUrl,
                customEndpoints,
              ),
              connectDeadline,
            ])
            res = streamResult.response
          } catch (err: unknown) {
            recordTelemetry(options.signal?.aborted ? 'abort' : 'error')
            failures.push({
              cause: connectTimedOut ? 'timeout' : 'connect',
              accountId,
              httpStatus: null,
              upstreamError: describeError(err),
              phase: connectTimedOut ? 'connect' : undefined,
            })
            if (!hasEmitted && attempt < maxAttempts && Date.now() < ceilingAt) {
              this.deps.log?.(
                `CloudCode ${connectTimedOut ? 'connect timeout' : 'connection error'} on account ${accountId}: ${describeError(err)}, trying next`,
              )
              continue
            }
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: classifyPoolFailure({
                  family,
                  wireModel,
                  failures,
                  familyStatus: this.deps.pool
                    ? this.deps.pool.getFamilyStatus(family, wireModel)
                    : { hasAccount: false, suppressed: false, reason: 'no_accounts', resetInMs: null },
                }),
              },
            }
            return
          } finally {
            if (connectTimer) clearTimeout(connectTimer)
          }

          // 7. Handle HTTP response status
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            const canFailover = !hasEmitted && attempt < maxAttempts && Date.now() < ceilingAt

            if (res.status === 429) {
              const resetHeader = res.headers.get('retry-after') || undefined
              if (this.deps.pool && authTargetAccount) {
                this.deps.pool.recordFailure(authTargetAccount.id, family, errText || 'Rate limit 429', resetHeader)
              }
              failures.push({
                cause: 'rate_limit',
                accountId: authTargetId,
                httpStatus: 429,
                upstreamError: errText || '429 Too Many Requests',
              })
              if (canFailover) {
                recordTelemetry('error')
                this.deps.log?.(`Rate limited (429) on ${authTargetId}, switching accounts...`)
                continue
              }
            } else if (res.status === 401) {
              // 401 IS a credential verdict: this account really does need `/ccl auth` again.
              if (this.deps.pool && authTargetAccount) {
                this.deps.pool.markAuthRequired(authTargetAccount.id, `Auth failed (401): ${errText}`)
              }
              const failure: AttemptFailure = {
                cause: 'auth',
                accountId: authTargetId,
                httpStatus: 401,
                upstreamError: errText || '401 Unauthorized',
              }
              const guidance = this.reauthGuidanceForAttempt(authTargetAccount, failure)
              failures.push(guidance ? { ...failure, guidance } : failure)
              if (canFailover) {
                recordTelemetry('error')
                this.deps.log?.(
                  `Auth failed (401) on ${authTargetId}, switching accounts...${guidance ? ` ${guidance}` : ''}`,
                )
                continue
              }
            } else if (res.status === 403) {
              // 403 is NOT a credential verdict: the credential may be perfectly valid but not
              // entitled to this model. Quarantine the MODEL for this account (soft failure) so
              // the rest of the pool stays schedulable and the user is not told to sign in again.
              if (this.deps.pool) {
                const quarantineTarget = borrowedAccount ?? account
                if (quarantineTarget) {
                  this.deps.pool.recordModelUnsupported(
                    quarantineTarget.id,
                    family,
                    effectiveWireModel,
                    `HTTP 403: ${errText || 'forbidden'}`,
                  )
                }
              }
              const failure: AttemptFailure = {
                cause: 'model_unsupported',
                accountId: authTargetId,
                httpStatus: 403,
                upstreamError: errText || '403 Forbidden',
              }
              // Only the account-health owner can call this 403 a grant gap; without that verdict
              // the adapter stays with the model-unsupported reading it already had.
              const guidance = this.reauthGuidanceForAttempt(authTargetAccount, failure)
              failures.push(guidance ? { ...failure, guidance } : failure)
              if (canFailover) {
                recordTelemetry('error')
                this.deps.log?.(
                  `Account ${authTargetId} cannot serve '${effectiveWireModel}' (403), switching accounts...${
                    guidance ? ` ${guidance}` : ''
                  }`,
                )
                continue
              }
            } else {
              failures.push({
                cause: 'api',
                accountId: authTargetId,
                httpStatus: res.status,
                upstreamError: errText || `HTTP ${res.status}`,
              })
            }

            recordTelemetry(options.signal?.aborted ? 'abort' : 'error')

            const verdict: PoolFailureVerdict = this.deps.pool
              ? classifyPoolFailure({
                  family,
                  wireModel,
                  failures,
                  familyStatus: this.deps.pool.getFamilyStatus(family, wireModel),
                })
              : {
                  message: `Google CloudCode API error HTTP ${res.status}: ${errText}`,
                  code: 'API_ERROR',
                  status: res.status,
                }

            yield {
              type: 'finish',
              reason: { kind: 'error', failure: verdict },
            }
            return
          }

          // 8. Consume SSE chunks. The idle budget is armed here — the headers are in hand and the
          //    connect budget is cleared — and re-armed on every chunk: a stream that keeps producing
          //    chunks runs to completion, only a silent one is cut.
          streamStarted = true
          runOk = true
          /**
           * Whether a real chunk has been handed to the caller. The mapper also calls its
           * `onFirstEmit` hook when it closes a stream with a synthetic finish/abort/error chunk, so
           * `hasEmitted` alone cannot tell "the caller saw content" from "the stream was cut before
           * any content" — and only the latter is safe to replay on the next account.
           */
          let contentReachedCaller = false
          armIdleTimer()
          /** Set when one of OUR budgets aborted this attempt's fetch mid-body. */
          let stallPhase: UpstreamTimeoutPhase | null = null
          let stallDetail = ''
          try {
            for await (const chunk of mapSseStreamToChunks(
              res,
              combineSignals([
                options.signal,
                ceilingSignal,
                connectController.signal,
                idleController.signal,
              ]),
              () => {
                hasEmitted = true
                if (firstChunkTime === null) {
                  firstChunkTime = Date.now()
                }
              },
            )) {
              // Adjacent-chunk guard: a chunk arrived, so the silence budget restarts from now.
              armIdleTimer()
              if (firstChunkTime === null) {
                firstChunkTime = Date.now()
              }
              if (chunk.type === 'finish') {
                const finish = chunk as Extract<StreamChunk, { type: 'finish' }>
                const phase = ourStallPhase()
                if (
                  phase !== null &&
                  (finish.reason?.kind === 'error' || finish.reason?.kind === 'aborted')
                ) {
                  // The mapper's read threw (or bailed) because OUR budget aborted the fetch, not
                  // because the provider ended the stream.
                  stallPhase = phase
                  stallDetail = finish.reason.failure?.message ?? 'stream aborted by an upstream budget'
                  break
                }
              }
              if (chunk.type !== 'finish') {
                contentReachedCaller = true
              }
              yield chunk as StreamChunk
              if (chunk.type === 'usage' && (chunk as { usage?: any }).usage) {
                const u = (chunk as { usage?: any }).usage
                const cTokens = typeof u.cacheReadTokens === 'number' ? u.cacheReadTokens : 0
                const inTokens = typeof u.inputTokens === 'number' ? u.inputTokens : 0
                cachedTokens = cTokens
                promptTokens = inTokens + cTokens
                outputTokens = typeof u.outputTokens === 'number' ? u.outputTokens : 0
              }
              if (chunk.type === 'finish') {
                const finish = (chunk as { reason?: { kind?: string } }).reason
                if (finish?.kind === 'error') {
                  runOk = false
                }
              }
            }
          } catch (streamErr) {
            runOk = false
            const phase = ourStallPhase()
            if (phase === null) throw streamErr
            // Our budget aborted the fetch and the mapper let the error through untouched.
            stallPhase = phase
            stallDetail = describeError(streamErr)
          } finally {
            if (idleTimer) clearTimeout(idleTimer)
            recordTelemetry()
          }

          if (stallPhase !== null) {
            runOk = false
            const stallText =
              stallPhase === 'idle'
                ? `no SSE chunk for ${idleBudgetMs}ms of silence after the response headers`
                : `ceiling backstop of ${Math.round(streamCeilingMs / 1000)}s reached`
            failures.push({
              cause: 'timeout',
              accountId,
              httpStatus: null,
              upstreamError: `${stallText}: ${stallDetail}`,
              phase: stallPhase,
            })
            recordTelemetry('error')
            // An idle stall is a stalled upstream and failover-able WHILE nothing was emitted.
            // Once content reached the caller the turn is terminal: a half-delivered answer must
            // not be replayed on another account. The ceiling is a whole-turn backstop, so it
            // never triggers a new attempt.
            if (
              stallPhase === 'idle' &&
              !contentReachedCaller &&
              attempt < maxAttempts &&
              Date.now() < ceilingAt
            ) {
              this.deps.log?.(
                `CloudCode idle timeout (${idleBudgetMs}ms with no chunk) on account ${accountId}, switching accounts...`,
              )
              continue
            }
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  message:
                    `CloudCode Link stream for model '${wireModel}' hit the ` +
                    `${TIMEOUT_PHASE_LABEL[stallPhase]}: ${stallDetail}`,
                  code: 'UPSTREAM_TIMEOUT',
                },
              },
            }
            return
          }

          const requestDuration = Date.now() - requestStartTime

          if (runOk) {
            if (this.deps.pool && account) {
              this.deps.pool.recordSuccess(account.id, family)
            }
            this.deps.onRun?.({
              ok: true,
              code: 'OK',
              durationMs: requestDuration,
              model: wireModel,
            })
          } else {
            this.deps.onRun?.({
              ok: false,
              code: 'STREAM_ERROR',
              durationMs: requestDuration,
              model: wireModel,
            })
          }

          // Successful turn completed
          return
        } finally {
          if (streamStarted && !recorded) {
            recordTelemetry()
          }
          if (releaseAccount) releaseAccount()
        }
      }

      // If loop exhausted with no emit
      if (!hasEmitted) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: classifyPoolFailure({
              family,
              wireModel,
              failures,
              familyStatus: this.deps.pool
                ? this.deps.pool.getFamilyStatus(family, wireModel)
                : { hasAccount: false, suppressed: false, reason: 'no_accounts', resetInMs: null },
            }),
          },
        }
      }
    } finally {
      if (releaseGlobal) releaseGlobal()
    }
  }
}
