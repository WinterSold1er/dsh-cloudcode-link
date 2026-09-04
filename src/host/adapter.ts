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
import { convertTools } from './schema-converter.ts'
import { convertMessages, type ImageReader } from './message-converter.ts'
import { mapSseStreamToChunks } from './sse-mapper.ts'

export interface AgyAdapterDeps {
  getConfig: () => PluginConfig
  catalog: ModelCatalog
  pool?: AccountPoolManager
  quota?: QuotaService
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

  constructor(deps: AgyAdapterDeps) {
    super()
    this.deps = deps
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

      let hasEmitted = false
      const maxAttempts = Math.max(1, this.deps.pool ? this.deps.pool.getAccounts().length : 1)
      let attempt = 0
      const triedAccountIds = new Set<string>()

      while (attempt < maxAttempts) {
        attempt++

        // 1. Select account
        let account: ManagedAccount | null = null
        if (this.deps.pool) {
          account = this.deps.pool.selectAccount(family)
          if (account && triedAccountIds.has(account.id)) {
            // Find another untried enabled candidate
            const alt = this.deps.pool
              .getAccounts()
              .find((a) => {
                if (!a.enabled || a.authRequired || triedAccountIds.has(a.id)) return false
                const cd = a.cooldowns[family]
                if (cd && cd.cooldownUntil > Date.now()) return false
                const q = a.quotas[family]
                if (q && typeof q.remainingFraction === 'number' && q.remainingFraction <= 0.02) {
                  if (q.resetTime && Date.parse(q.resetTime) > Date.now()) return false
                }
                if (q && typeof q.weeklyFraction === 'number' && q.weeklyFraction <= 0.01) {
                  if (q.weeklyResetTime && Date.parse(q.weeklyResetTime) > Date.now()) return false
                }
                return true
              })
            account = alt ?? null
          }
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
          const envelope = antigravityRequestEnvelope(wireModel, isClaude)
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
                      role: 'user',
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
              sessionId: envelope.sessionId,
              labels: envelope.labels,
            },
            requestType: 'AGENT',
            userAgent: 'ANTIGRAVITY',
            requestId: envelope.requestId,
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
          let runOk = true
          for await (const chunk of mapSseStreamToChunks(res, options.signal, () => {
            hasEmitted = true
          })) {
            yield chunk
            if (chunk.type === 'finish') {
              if (chunk.reason.kind === 'error') {
                runOk = false
              }
            }
          }

          if (runOk) {
            if (this.deps.pool && account) {
              this.deps.pool.recordSuccess(account.id, family)
            }
            this.deps.onRun?.({
              ok: true,
              code: 'OK',
              durationMs: Date.now() - startTime,
              model: wireModel,
            })
          } else {
            this.deps.onRun?.({
              ok: false,
              code: 'STREAM_ERROR',
              durationMs: Date.now() - startTime,
              model: wireModel,
            })
          }

          // Successful turn completed
          return
        } finally {
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
