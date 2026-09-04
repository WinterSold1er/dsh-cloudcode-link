import type {
  CallId,
  ContentBlock,
  FinishReason,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'

export interface SseMapperState {
  hasEmitted: boolean
  hasToolCalls: boolean
}

interface StreamPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  thought_signature?: string
  functionCall?: {
    id?: string
    name?: string
    args?: Record<string, unknown>
    thoughtSignature?: string
    thought_signature?: string
  }
}

interface StreamCandidate {
  content?: { parts?: StreamPart[] }
  finishReason?: string
}

interface StreamUsageMetadata {
  promptTokenCount?: number
  cachedContentTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

interface StreamResponseData {
  candidates?: StreamCandidate[]
  usageMetadata?: StreamUsageMetadata
  error?: { message?: string; code?: number }
  response?: StreamResponseData
}

export function createFinishReason(
  rawReason?: string,
  hasToolCalls = false,
): FinishReason {
  if (hasToolCalls) return { kind: 'tool-calls' }
  if (rawReason === 'MAX_TOKENS') return { kind: 'max-tokens' }
  if (rawReason === 'SAFETY' || rawReason === 'RECITATION') {
    return {
      kind: 'error',
      failure: { message: `Blocked by model finishReason: ${rawReason}`, code: 'FINISH_SAFETY' },
    }
  }
  return { kind: 'stop' }
}

export function mapFinishReason(
  rawReason?: string,
  hasToolCalls = false,
): FinishReason['kind'] {
  if (hasToolCalls) return 'tool-calls'
  if (!rawReason || rawReason === 'STOP') return 'stop'
  if (rawReason === 'MAX_TOKENS') return 'max-tokens'
  if (rawReason === 'SAFETY' || rawReason === 'RECITATION') return 'error'
  return 'stop'
}

export function calculateNetUsage(meta?: StreamUsageMetadata): TokenUsage | null {
  if (!meta) return null
  const prompt = meta.promptTokenCount || 0
  const cached = meta.cachedContentTokenCount || 0
  const thoughts = meta.thoughtsTokenCount || 0
  const candidates = meta.candidatesTokenCount || 0

  const inputTokens = Math.max(0, prompt - cached)
  const outputTokens = candidates + thoughts
  const cacheReadTokens = cached > 0 ? cached : undefined
  const reasoningTokens = thoughts > 0 ? thoughts : undefined

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  }
}

let toolCallGen = 0

/**
 * Maps SSE stream from Google CloudCode into DSH StreamChunk async stream.
 */
export async function* mapSseStreamToChunks(
  response: Response,
  signal?: AbortSignal,
  onFirstEmit?: () => void,
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!response.body) {
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'Empty response body from CloudCode', code: 'EMPTY_RESPONSE' },
      },
    }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let scanStart = 0

  let blockIndex = 0
  let currentBlock:
    | { type: 'text'; text: string; index: number; thoughtSignature?: string }
    | { type: 'reasoning'; text: string; index: number; thoughtSignature?: string }
    | null = null

  let lastUsage: TokenUsage | null = null
  let lastFinishReason: string | undefined
  let hasToolCalls = false
  let firstChunkEmitted = false

  const notifyFirstEmit = () => {
    if (!firstChunkEmitted) {
      firstChunkEmitted = true
      if (onFirstEmit) onFirstEmit()
    }
  }

  const closeCurrentBlock = (): StreamChunk | null => {
    if (!currentBlock) return null
    const chunk: StreamChunk = {
      type: 'block-end',
      index: currentBlock.index,
      block:
        currentBlock.type === 'text'
          ? ({
              type: 'text',
              text: currentBlock.text,
              ...(currentBlock.thoughtSignature ? { thoughtSignature: currentBlock.thoughtSignature } : {}),
            } as ContentBlock)
          : ({
              type: 'reasoning',
              text: currentBlock.text,
              ...(currentBlock.thoughtSignature ? { thoughtSignature: currentBlock.thoughtSignature } : {}),
            } as ContentBlock),
    }
    currentBlock = null
    return chunk
  }

  try {
    while (true) {
      if (signal?.aborted) {
        const end = closeCurrentBlock()
        if (end) yield end
        yield {
          type: 'finish',
          reason: {
            kind: 'aborted',
            failure: { message: 'Request aborted', code: 'ABORTED' },
          },
        }
        return
      }

      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) continue

      buffer += decoder.decode(value, { stream: true })

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n', scanStart)) !== -1) {
        const line = buffer.slice(scanStart, newlineIdx).trim()
        scanStart = newlineIdx + 1

        if (!line.startsWith('data:')) continue
        const jsonStr = line.slice(5).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue

        let data: StreamResponseData
        try {
          data = JSON.parse(jsonStr) as StreamResponseData
        } catch {
          continue
        }

        const resp = data.response || data
        if (resp.error) {
          const end = closeCurrentBlock()
          if (end) yield end
          notifyFirstEmit()
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                message: resp.error.message || 'Error in CloudCode SSE stream',
                code: 'STREAM_ERROR',
              },
            },
          }
          return
        }

        if (resp.usageMetadata) {
          const u = calculateNetUsage(resp.usageMetadata)
          if (u) lastUsage = u
        }

        const candidate = resp.candidates?.[0]
        if (candidate?.finishReason) {
          lastFinishReason = candidate.finishReason
        }

        for (const part of candidate?.content?.parts || []) {
          // 1. Text or Thinking part
          if (part.text !== undefined) {
            const isThought = part.thought === true
            const blockType = isThought ? 'reasoning' : 'text'
            const sig = part.thoughtSignature || part.thought_signature

            if (!currentBlock || currentBlock.type !== blockType) {
              const end = closeCurrentBlock()
              if (end) yield end

              const idx = blockIndex++
              currentBlock = {
                type: blockType,
                text: '',
                index: idx,
                ...(sig ? { thoughtSignature: sig } : {}),
              }
              notifyFirstEmit()
              yield { type: 'block-start', index: idx, blockType }
            }

            const active = currentBlock!
            active.text += part.text
            if (sig) {
              active.thoughtSignature = sig
            }
            notifyFirstEmit()
            if (isThought) {
              yield { type: 'reasoning-delta', index: active.index, text: part.text }
            } else {
              yield { type: 'text-delta', index: active.index, text: part.text }
            }
          }

          // 2. Tool Call part
          if (part.functionCall) {
            hasToolCalls = true
            const end = closeCurrentBlock()
            if (end) yield end

            const idx = blockIndex++
            const rawId =
              part.functionCall.id ||
              `call_${Date.now()}_${++toolCallGen}`
            const name = part.functionCall.name || 'tool'
            const fullArgs = JSON.stringify(part.functionCall.args || {})
            const sig =
              part.thoughtSignature ||
              part.thought_signature ||
              part.functionCall.thoughtSignature ||
              part.functionCall.thought_signature

            notifyFirstEmit()
            yield { type: 'block-start', index: idx, blockType: 'tool-call' }

            // Incremental argument delta cursor
            yield {
              type: 'tool-call-delta',
              index: idx,
              id: rawId as CallId,
              name,
              argumentsDelta: fullArgs,
            }

            yield {
              type: 'block-end',
              index: idx,
              block: {
                type: 'tool-call',
                id: rawId as CallId,
                name,
                arguments: fullArgs,
                ...(sig ? { thoughtSignature: sig } : {}),
              } as unknown as ContentBlock,
            }
          }
        }
      }

      if (scanStart > 0) {
        buffer = buffer.slice(scanStart)
        scanStart = 0
      }
    }

    const end = closeCurrentBlock()
    if (end) yield end

    if (lastUsage) {
      notifyFirstEmit()
      yield { type: 'usage', usage: lastUsage }
    }

    notifyFirstEmit()
    yield {
      type: 'finish',
      reason: createFinishReason(lastFinishReason, hasToolCalls),
    }
  } catch (err: unknown) {
    const end = closeCurrentBlock()
    if (end) yield end
    notifyFirstEmit()
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: err instanceof Error ? err.message : String(err),
          code: 'STREAM_EXCEPTION',
        },
      },
    }
  }
}
