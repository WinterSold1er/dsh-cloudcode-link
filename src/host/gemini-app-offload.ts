// Track A: Transparent offloading of tool-free tasks to Gemini App (Robin)
// with fresh single-turn session trimming for small contexts and pre-emit fallback to AGY.

import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PluginConfig } from '../common/types.ts'
import { resolveGeminiAppToken } from './gemini-app.ts'
import type { GeminiAppAdapter } from './gemini-app-adapter.ts'

const TOOL_BLOCK_TYPES = new Set(['tool-call', 'tool_call', 'tool-result', 'tool_result'])

function estimateBlockChars(block: unknown): number {
  if (!block || typeof block !== 'object') return 0
  const b = block as Record<string, unknown>
  if (typeof b.text === 'string') return b.text.length
  if (b.type === 'tool-call' || b.type === 'tool_call') {
    const nameLen = typeof b.name === 'string' ? b.name.length : 0
    const argsLen =
      typeof b.arguments === 'string'
        ? b.arguments.length
        : b.arguments !== undefined
          ? JSON.stringify(b.arguments).length
          : 0
    return nameLen + argsLen
  }
  if (b.type === 'tool-result' || b.type === 'tool_result') {
    if (typeof b.content === 'string') return b.content.length
    if (b.content !== undefined) return JSON.stringify(b.content).length
    if (b.result !== undefined) return JSON.stringify(b.result).length
  }
  return 0
}

export function estimateContextChars(options: GenerateOptions): number {
  let total = 0
  const sys = (options as { system?: unknown }).system
  if (typeof sys === 'string') {
    total += sys.length
  }
  const messages = options.messages ?? []
  for (const msg of messages) {
    if (!msg) continue
    const content: unknown = msg.content
    if (typeof content === 'string') {
      total += content.length
    } else if (Array.isArray(content)) {
      for (const block of content) {
        total += estimateBlockChars(block)
      }
    }
  }
  return total
}

export function hasToolUsageInMessages(messages: GenerateOptions['messages']): boolean {
  if (!Array.isArray(messages)) return false
  for (const msg of messages) {
    if (!msg) continue
    if ((msg.role as string) === 'tool') return true
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === 'object') {
          const t = (block as { type?: unknown }).type
          if (typeof t === 'string' && TOOL_BLOCK_TYPES.has(t)) {
            return true
          }
        }
      }
    }
  }
  return false
}

export async function shouldOffloadToGeminiApp(
  options: GenerateOptions,
  config: PluginConfig,
): Promise<boolean> {
  if (!config.geminiAppEnabled || !config.geminiAppOffloadEnabled) {
    return false
  }
  if (options.tools && options.tools.length > 0) {
    return false
  }
  if (hasToolUsageInMessages(options.messages)) {
    return false
  }
  const stop = (options as { stop?: readonly string[] }).stop
  if (stop && stop.length > 0) {
    return false
  }
  if (estimateContextChars(options) > config.geminiAppOffloadMaxContextChars) {
    return false
  }
  const token = await resolveGeminiAppToken({ token: config.geminiAppToken })
  return token !== null
}

export function buildFreshSessionOptions(
  options: GenerateOptions,
  config: PluginConfig,
): GenerateOptions {
  const messages = options.messages ?? []
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : undefined
  const estimatedChars = estimateContextChars(options)

  const baseClone: GenerateOptions = { ...options }
  delete (baseClone as { sessionId?: unknown }).sessionId
  delete (baseClone as { conversationId?: unknown }).conversationId
  delete (baseClone as { conversation_id?: unknown }).conversation_id

  if (
    config.geminiAppFreshSessionSingleTurn &&
    estimatedChars <= config.geminiAppFreshSessionMaxChars &&
    lastMsg &&
    lastMsg.role === 'user'
  ) {
    const systemMessages = messages.filter(
      (m) => m && (m.role === 'system' || (m.role as string) === 'developer'),
    )
    return {
      ...baseClone,
      messages: [...systemMessages, lastMsg],
    }
  }

  return baseClone
}

export interface GeminiAppOffloadDeps {
  getConfig: () => PluginConfig
  geminiAdapter: GeminiAppAdapter
  fallbackToAgy: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  log?: (msg: string) => void
}

function isContentChunk(chunk: StreamChunk): boolean {
  const t = (chunk as { type?: string }).type
  return t === 'text-delta' || t === 'reasoning-delta' || t === 'block-start'
}

export async function* streamWithGeminiAppOffload(
  options: GenerateOptions,
  deps: GeminiAppOffloadDeps,
): AsyncIterable<StreamChunk> {
  const cfg = deps.getConfig()
  const offload = await shouldOffloadToGeminiApp(options, cfg)
  if (!offload) {
    yield* deps.fallbackToAgy(options)
    return
  }

  const effectiveOptions = buildFreshSessionOptions(options, cfg)
  deps.log?.(
    `[gemini-app-offload] routing tool-free request to Gemini App (chars=${estimateContextChars(options)}, trimmedMessages=${effectiveOptions.messages.length}/${options.messages.length})`,
  )

  let hasEmittedContent = false
  let fallbackReason: string | null = null

  try {
    for await (const chunk of deps.geminiAdapter.stream(effectiveOptions)) {
      if (isContentChunk(chunk)) {
        hasEmittedContent = true
        yield chunk
        continue
      }

      if (chunk.type === 'finish') {
        const reason = (chunk as { reason?: { kind?: string; failure?: { code?: string; message?: string } } }).reason
        if (reason?.kind === 'error' && !hasEmittedContent && cfg.geminiAppOffloadFallbackToAgy) {
          fallbackReason = reason.failure?.message || reason.failure?.code || 'Gemini App offload error'
          break
        }
      }

      yield chunk
    }
  } catch (err) {
    if (!hasEmittedContent && cfg.geminiAppOffloadFallbackToAgy) {
      fallbackReason = err instanceof Error ? err.message : String(err)
    } else {
      throw err
    }
  }

  if (fallbackReason !== null) {
    deps.log?.(`[gemini-app-offload] pre-emit failure (${fallbackReason}), falling back to AGY pool`)
    yield* deps.fallbackToAgy(options)
  }
}
