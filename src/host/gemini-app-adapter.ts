// LlmAdapter implementation for Google Gemini App (Robin / AGSA) service.

import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { GEMINI_APP_PROVIDER_ID, type PluginConfig } from '../common/types.ts'
import {
  GeminiAppClient,
  GeminiAppPoolManager,
  buildProcessQueryRequest,
  type GeminiAppConfig,
  type GeminiAppTransport,
} from './gemini-app.ts'
import type { GenerateOptions as CoreGenerateOptions } from '../../packages/core/src/types/protocol.ts'

export interface GeminiAppAdapterDeps {
  getConfig: () => PluginConfig
  log?: (msg: string) => void
  transport?: GeminiAppTransport
  pool?: GeminiAppPoolManager
}

export const GEMINI_APP_MODELS: readonly LlmModelInfo[] = [
  {
    provider: GEMINI_APP_PROVIDER_ID,
    id: 'gemini-app-default',
    name: 'Gemini App (Default)',
    inputModalities: ['text', 'image'],
  },
  {
    provider: GEMINI_APP_PROVIDER_ID,
    id: 'gemini-app-advanced',
    name: 'Gemini App (Advanced)',
    inputModalities: ['text', 'image'],
  },
  {
    provider: GEMINI_APP_PROVIDER_ID,
    id: 'gemini-app-flash',
    name: 'Gemini App (Flash)',
    inputModalities: ['text', 'image'],
  },
]

export class GeminiAppAdapter extends LlmAdapter {
  private readonly deps: GeminiAppAdapterDeps

  constructor(deps: GeminiAppAdapterDeps) {
    super()
    this.deps = deps
  }

  getPool(): GeminiAppPoolManager | undefined {
    return this.deps.pool
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return {
      id: provider,
      name: 'Google Gemini (App/Robin)',
    }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return GEMINI_APP_MODELS.map((m) => ({
      provider,
      id: m.id,
      name: m.name,
      inputModalities: m.inputModalities,
    }))
  }

  async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const found = GEMINI_APP_MODELS.find((m) => m.id === model)
    const isAdvanced = model.includes('advanced')
    return {
      provider,
      id: model,
      name: found ? found.name : model,
      context: { contextWindow: isAdvanced ? 2_097_152 : 1_048_576 },
      defaultMaxTokens: 8192,
      inputModalities: found?.inputModalities ?? ['text', 'image'],
    }
  }

  async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{
    model: LlmResolvedModelInfo
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  }> {
    const modelInfo = await this.resolveModel(provider, model, signal)
    return {
      model: modelInfo,
      stream: (options) => this.stream(options),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const cfg = this.deps.getConfig()
    const timeoutMs = cfg.geminiAppTimeoutMs || 120_000

    const clientConfig: GeminiAppConfig = {
      endpoint: cfg.geminiAppEndpoint,
      token: cfg.geminiAppToken,
      timeoutMs,
      defaultModel: cfg.geminiAppDefaultModel,
    }

    const client = new GeminiAppClient(clientConfig, this.deps.transport, this.deps.pool)
    const request = buildProcessQueryRequest(options as unknown as CoreGenerateOptions, clientConfig)

    this.deps.log?.(`[gemini-app] Dispatching request for model ${options.model || 'default'}`)

    const controller = new AbortController()
    let timeoutTimer: NodeJS.Timeout | undefined

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        controller.abort(new Error(`Gemini App request timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal

    try {
      for await (const chunk of client.streamProcessQuery(request, combinedSignal)) {
        yield chunk as unknown as StreamChunk
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log?.(`[gemini-app] stream error: ${message}`)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'GEMINI_APP_ERROR',
            message,
          },
        },
      } as unknown as StreamChunk
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }
}
