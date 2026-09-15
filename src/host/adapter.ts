import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID, formatDuration, type PluginConfig } from '../common/types.ts'
import { modelFamilyOf, type ManagedAccount, type ModelFamily } from '../common/pool-types.ts'
import type { AccountPoolManager } from './pool.ts'
import type { QuotaService } from './quota.ts'
import {
  defaultEffortFor,
  findEntry,
  getAntigravityRequestModelId,
  getMaxOutputTokens,
  getThinkingConfig,
  ModelCatalog,
  resolveModelSlug,
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
  /** Last-run telemetry surfaced by /agy status. */
  onRun?: (info: { ok: boolean; code: string; durationMs: number; model: string }) => void
  /** Reads image bytes from DSH attachment storage. */
  readImage?: ImageReader
  /** Custom endpoints override if configured. */
  endpointCandidates?: string[]
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
    return {
      id: provider,
      name: 'Google Antigravity',
    }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    await this.deps.catalog.refreshIfNeeded()
    const cat = this.deps.catalog.get()
    return cat.models.map((m) => ({
      provider,
      id: m.id,
      name: m.name,
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

    const resolved: LlmResolvedModelInfo = {
      provider,
      id: model,
      name: entry ? entry.name : model,
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
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const startTime = Date.now()
    const releaseGlobal = this.deps.acquire ? await this.deps.acquire() : null

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

      while (attempt < maxAttempts) {
        attempt++

        // 1. Select account (Priority arbitration: Pin > Session Affinity > Sticky Sequential)
        let account: ManagedAccount | null = null
        if (this.deps.pool) {
          // Priority 1: Pin Lock takes absolute precedence if healthy and not tried
          const pinned = this.deps.pool.getPinnedAccount()
          if (pinned && !triedAccountIds.has(pinned.id) && this.deps.pool.isAccountHealthy(pinned, family)) {
            account = pinned
          }

          // Priority 2: Session Affinity (if no healthy pinned account or pinned account is in cooldown/tried)
          if (!account && boundAccountId && !triedAccountIds.has(boundAccountId)) {
            const boundAcc = this.deps.pool.getAccount(boundAccountId)
            if (boundAcc && this.deps.pool.isAccountHealthy(boundAcc, family)) {
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
            account = this.deps.pool.selectAccount(family)
          }

          // Failover candidate: if chosen account was already tried in this turn
          if (account && triedAccountIds.has(account.id)) {
            const alt = this.deps.pool
              .getAccounts()
              .find((a) => !triedAccountIds.has(a.id) && this.deps.pool!.isAccountHealthy(a, family))
            account = alt ?? null
          }
        }

        // Record affinity binding on selected account
        if (rawSessionId && this.deps.sessionStore && account) {
          this.deps.sessionStore.bindAccount(rawSessionId, account.id)
        }

        // If pool is present and no candidate account is available (and no env token override)
        if (!account && this.deps.pool && !process.env.ANTIGRAVITY_TOKEN?.trim()) {
          const status = this.deps.pool.getFamilyStatus(family)
          if (status.suppressed) {
            const resetMsg = status.resetInMs && status.resetInMs > 0
              ? ` Resets in ${formatDuration(status.resetInMs)}.`
              : ''
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  message: `Antigravity quota exhausted for model family '${family}'.${resetMsg}`,
                  code: 'RATE_LIMIT',
                },
              },
            }
            return
          }
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                message: 'No authenticated Antigravity account available. Please sign in via /agy auth.',
                code: 'AUTH_REQUIRED',
              },
            },
          }
          return
        }

        const accountId = account ? account.id : 'acc_default'
        triedAccountIds.add(accountId)

        // 2. Acquire per-account concurrency semaphore if pool is present
        let releaseAccount: (() => void) | null = null
        if (this.deps.pool && account) {
          const cfg = this.deps.getConfig()
          releaseAccount = await this.deps.pool.acquireAccount(account.id, cfg.maxConcurrent)
        }

        const requestStartTime = Date.now()
        let firstChunkTime: number | null = null
        let promptTokens = 0
        let cachedTokens = 0
        let outputTokens = 0
        let envelope: { requestId: string; sessionId: string; labels: Record<string, string> } | null = null
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
          // 3. Resolve valid access token
          let token: string | null = null
          if (process.env.ANTIGRAVITY_TOKEN?.trim()) {
            token = process.env.ANTIGRAVITY_TOKEN.trim()
          } else if (this.deps.quota && account) {
            token = await this.deps.quota.getValidAccessToken(account)
          } else if (this.deps.pool) {
            token = this.deps.pool.getMemoryToken(accountId)
          }

          if (!token) {
            if (this.deps.pool && account) {
              this.deps.pool.markAuthRequired(account.id, 'No valid access token or refresh failed')
            }
            if (!hasEmitted && attempt < maxAttempts) {
              continue
            }
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  message: 'No authenticated Antigravity account available. Please sign in via /agy auth.',
                  code: 'AUTH_REQUIRED',
                },
              },
            }
            return
          }

          // 4. Ensure project ID & build request envelope
          const proxyUrl = account?.proxyUrl
          const customEndpoints = this.deps.endpointCandidates
          const env = antigravityRequestEnvelope(wireModel, isClaude, {
            sessionId: rawSessionId,
            trajectoryId,
            step,
          })
          envelope = env
          const projectId = await ensureProject(
            token,
            account?.alias || account?.id || 'antigravity-default',
            proxyUrl,
            customEndpoints,
          )

          const requestBody: AntigravityGenerateRequest = {
            project: projectId,
            model: wireModel,
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
            requestType: 'AGENT',
            userAgent: 'ANTIGRAVITY',
            requestId: env.requestId,
          }

          // 5. Connect and stream
          let res: Response
          try {
            const streamResult = await streamGenerateContent(
              token,
              requestBody,
              options.signal,
              proxyUrl,
              customEndpoints,
            )
            res = streamResult.response
          } catch (err: unknown) {
            if (!hasEmitted && attempt < maxAttempts) {
              this.deps.log?.(`CloudCode connection error on account ${accountId}: ${String(err)}, trying next`)
              continue
            }
            recordTelemetry(options.signal?.aborted ? 'abort' : 'error')
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  message: `Google CloudCode connection error: ${err instanceof Error ? err.message : String(err)}`,
                  code: 'CONNECT_ERROR',
                },
              },
            }
            return
          }

          // 6. Handle HTTP response status
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            if (res.status === 429) {
              const resetHeader = res.headers.get('retry-after') || undefined
              if (this.deps.pool && account) {
                this.deps.pool.recordFailure(account.id, family, errText || 'Rate limit 429', resetHeader)
              }
              if (!hasEmitted && attempt < maxAttempts) {
                this.deps.log?.(`Rate limited (429) on ${accountId}, switching accounts...`)
                continue
              }
            } else if (res.status === 401 || res.status === 403) {
              if (this.deps.pool && account) {
                this.deps.pool.markAuthRequired(account.id, `Auth failed (${res.status}): ${errText}`)
              }
              if (!hasEmitted && attempt < maxAttempts) {
                continue
              }
            }

            recordTelemetry(options.signal?.aborted ? 'abort' : 'error')

            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  message: `Google CloudCode API error HTTP ${res.status}: ${errText}`,
                  code: res.status === 429 ? 'RATE_LIMIT' : 'API_ERROR',
                },
              },
            }
            return
          }

          // 7. Consume SSE chunks
          streamStarted = true
          runOk = true
          try {
            for await (const chunk of mapSseStreamToChunks(res, options.signal, () => {
              hasEmitted = true
              if (firstChunkTime === null) {
                firstChunkTime = Date.now()
              }
            })) {
              if (firstChunkTime === null) {
                firstChunkTime = Date.now()
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
            throw streamErr
          } finally {
            recordTelemetry()
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
        if (this.deps.pool) {
          const status = this.deps.pool.getFamilyStatus(family)
          if (status.suppressed) {
            const resetMsg = status.resetInMs && status.resetInMs > 0
              ? ` Resets in ${formatDuration(status.resetInMs)}.`
              : ''
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  message: `Antigravity quota exhausted for model family '${family}'.${resetMsg}`,
                  code: 'RATE_LIMIT',
                },
              },
            }
            return
          }
        }
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              message: 'All available Antigravity accounts are exhausted or in cooldown.',
              code: 'ACCOUNTS_EXHAUSTED',
            },
          },
        }
      }
    } finally {
      if (releaseGlobal) releaseGlobal()
    }
  }
}
