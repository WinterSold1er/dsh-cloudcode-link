// gemini_app_ask — stateless one-shot delegation tool for standalone, tool-free tasks
// routed to the Google Gemini App (Robin / AGSA) API.

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PluginConfig } from '../common/types.ts'
import {
  GeminiAppClient,
  GeminiAppError,
  GeminiAppPoolManager,
  buildProcessQueryRequest,
  type GeminiAppConfig,
  type GeminiAppTransport,
} from './gemini-app.ts'
import type { GenerateOptions as CoreGenerateOptions, Message } from '../../packages/core/src/types/protocol.ts'

export interface GeminiAppAskToolDeps {
  cfg: () => PluginConfig
  transport?: GeminiAppTransport
  pool?: GeminiAppPoolManager
  log?: (msg: string) => void
}

export function defineGeminiAppAskTool(deps: GeminiAppAskToolDeps) {
  return defineTool({
    name: 'gemini_app_ask',
    description:
      'Delegate a standalone, tool-free task (such as writing an independent code snippet, summarizing text, translating, explaining concepts, or understanding images) to the Google Gemini App (Robin) API. Each call starts a fresh stateless session and does not support local tool calling. Use this when Gemini App offload/ask mode is enabled to offload tool-free work from the primary model.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The standalone task or question for Gemini App.',
      },
      system: {
        type: 'string',
        description: 'Optional system instructions for this stateless request.',
      },
      mode: {
        type: 'string',
        description: "Optional Gemini App mode: 'standard' or 'advanced' (default: 'standard').",
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 5 * 60_000,
    async execute(args, exec) {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!prompt) {
        throw new Error('gemini_app_ask: prompt must be a non-empty string')
      }

      const rawMode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : ''
      if (rawMode !== '' && rawMode !== 'standard' && rawMode !== 'advanced') {
        throw new Error(`gemini_app_ask: invalid mode "${args.mode}", expected "standard" or "advanced"`)
      }

      const cfg = deps.cfg()
      const timeoutMs = cfg.geminiAppTimeoutMs || 120_000
      const clientConfig: GeminiAppConfig = {
        endpoint: cfg.geminiAppEndpoint,
        token: cfg.geminiAppToken,
        timeoutMs,
        defaultModel: cfg.geminiAppDefaultModel,
      }

      const messages: Message[] = []
      if (typeof args.system === 'string' && args.system.trim() !== '') {
        messages.push({ role: 'system', content: args.system.trim() })
      }
      messages.push({ role: 'user', content: prompt })

      const model = rawMode === 'advanced' ? 'gemini-app-advanced' : 'gemini-app-default'
      const request = buildProcessQueryRequest(
        {
          model,
          messages,
        } as CoreGenerateOptions,
        clientConfig,
      )

      const client = new GeminiAppClient(clientConfig, deps.transport, deps.pool)
      const controller = new AbortController()
      let timeoutTimer: NodeJS.Timeout | undefined
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          controller.abort(new Error(`gemini_app_ask timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }

      const combinedSignal = exec?.signal
        ? AbortSignal.any([exec.signal, controller.signal])
        : controller.signal

      try {
        const res = await client.processQuery(request, combinedSignal)
        return res.text
      } catch (err) {
        if (err instanceof GeminiAppError) {
          deps.log?.(`[gemini_app_ask] failed [${err.code}]: ${err.message}`)
          throw new Error(`gemini_app_ask failed [${err.code}]: ${err.message}`)
        }
        const message = err instanceof Error ? err.message : String(err)
        deps.log?.(`[gemini_app_ask] failed: ${message}`)
        throw new Error(`gemini_app_ask failed: ${message}`)
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer)
      }
    },
  })
}
