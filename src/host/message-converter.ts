import type {
  ContentBlock,
  ImageBlock,
  Message,
  ReasoningBlock,
  TextBlock,
  ToolCallBlock,
  ToolResultBlock,
} from '@deepseek-ai/dsh-llm'
import type {
  GeminiContent,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
  GeminiInlineDataPart,
  GeminiPart,
  GeminiTextPart,
} from './client.ts'

export type ImageAttachmentRef = ImageBlock['attachment']

export type ImageReader = (ref: ImageAttachmentRef) => Promise<Uint8Array | Buffer | null>

const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/
export function isValidThoughtSignature(signature?: string): boolean {
  if (!signature || typeof signature !== 'string' || signature.length === 0) return false
  if (signature.length % 4 !== 0) return false
  return base64SignaturePattern.test(signature)
}

function detectImageMimeType(bytes: Uint8Array | Buffer): string {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp'
    }
  }
  return 'image/png'
}

export function sanitizeText(text: unknown): string {
  return String(text ?? '').replace(/[\uD800-\uDFFF]/g, '\uFFFD')
}

function appendTurn(contents: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]): void {
  if (!parts.length) return
  const last = contents[contents.length - 1]
  if (last && last.role === role) {
    last.parts.push(...parts)
  } else {
    contents.push({ role, parts })
  }
}

function parseJsonArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fallback
  }
  return {}
}

function extractToolResultText(blocks: ContentBlock[]): string {
  const texts: string[] = []
  for (const b of blocks) {
    if (b.type === 'text') {
      texts.push((b as TextBlock).text)
    }
  }
  return texts.join('\n')
}

/**
 * Maps DSH conversation messages into Google CloudCode GeminiContent turns.
 */
export async function convertMessages(
  messages: Message[],
  readImage?: ImageReader,
  runtimeModel = 'gemini-3.7-flash',
): Promise<GeminiContent[]> {
  const contents: GeminiContent[] = []
  // Map to resolve toolName for tool-result blocks by toolCallId
  const toolNameByCallId = new Map<string, string>()

  // Pass 1: index all toolCall names
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool-call') {
          const tc = block as ToolCallBlock
          if (tc.id && tc.name) {
            toolNameByCallId.set(tc.id, tc.name)
          }
        }
      }
    }
  }

  // Pass 2: convert messages
  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: GeminiPart[] = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          const text = (block as TextBlock).text
          if (text) parts.push({ text: sanitizeText(text) })
        } else if (block.type === 'image') {
          const imgBlock = block as ImageBlock
          if (readImage && imgBlock.attachment) {
            try {
              const bytes = await readImage(imgBlock.attachment)
              if (bytes && bytes.length > 0) {
                const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
                const mimeType = (imgBlock.attachment as { mimeType?: string }).mimeType || detectImageMimeType(buf)
                parts.push({
                  inlineData: {
                    mimeType,
                    data: buf.toString('base64'),
                  },
                })
              }
            } catch {
              // skip failed image
            }
          }
        } else if (block.type === 'tool-result') {
          const tr = block as ToolResultBlock
          const toolName = toolNameByCallId.get(tr.toolCallId) || 'tool'
          const resultText = extractToolResultText(tr.content)
          const resp = tr.isError
            ? { error: resultText || 'Tool error' }
            : { output: resultText || '' }
          parts.push({
            functionResponse: {
              name: toolName,
              response: resp,
              ...(tr.toolCallId ? { id: tr.toolCallId } : {}),
            },
          })
          // Also process nested images inside tool-result if any
          if (readImage && Array.isArray(tr.content)) {
            for (const sub of tr.content) {
              if (sub.type === 'image') {
                const subImg = sub as ImageBlock
                if (subImg.attachment) {
                  try {
                    const bytes = await readImage(subImg.attachment)
                    if (bytes && bytes.length > 0) {
                      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
                      const mimeType = detectImageMimeType(buf)
                      parts.push({
                        inlineData: { mimeType, data: buf.toString('base64') },
                      })
                    }
                  } catch {
                    // skip
                  }
                }
              }
            }
          }
        }
      }
      appendTurn(contents, 'user', parts)
    } else if (msg.role === 'assistant') {
      const parts: GeminiPart[] = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          const text = (block as TextBlock).text
          const sig =
            (block as unknown as { thoughtSignature?: string; thought_signature?: string }).thoughtSignature ||
            (block as unknown as { thoughtSignature?: string; thought_signature?: string }).thought_signature
          if (text) {
            parts.push({
              text: sanitizeText(text),
              ...(isValidThoughtSignature(sig) ? { thoughtSignature: sig } : {}),
            })
          }
        } else if (block.type === 'reasoning') {
          const reasoning = (block as ReasoningBlock).text
          const sig =
            (block as unknown as { thoughtSignature?: string; thought_signature?: string }).thoughtSignature ||
            (block as unknown as { thoughtSignature?: string; thought_signature?: string }).thought_signature
          if (reasoning) {
            if (isValidThoughtSignature(sig)) {
              parts.push({
                thought: true,
                text: sanitizeText(reasoning),
                thoughtSignature: sig,
              })
            } else {
              // Without valid thought signature, treat as text
              parts.push({ text: sanitizeText(reasoning) })
            }
          }
        } else if (block.type === 'tool-call') {
          const tc = block as ToolCallBlock
          const sig =
            (block as unknown as { thoughtSignature?: string; thought_signature?: string }).thoughtSignature ||
            (block as unknown as { thoughtSignature?: string; thought_signature?: string }).thought_signature
          const functionCall: GeminiFunctionCallPart['functionCall'] = {
            name: tc.name,
            args: parseJsonArguments(tc.arguments),
            ...(tc.id ? { id: tc.id } : {}),
          }
          parts.push({
            functionCall,
            ...(isValidThoughtSignature(sig) ? { thoughtSignature: sig } : {}),
          })
        }
      }
      appendTurn(contents, 'model', parts)
    }
  }

  // Google CloudCode requires first turn to be 'user'
  if (contents.length > 0 && contents[0]?.role === 'model') {
    contents.unshift({
      role: 'user',
      parts: [{ text: 'Hello' }],
    })
  }

  return sanitizeTopology(contents)
}

/**
 * Topologically sanitizes conversation turns:
 * 1. History model messages: strip thought:true if signature is missing or invalid.
 * 2. Filter orphan functionResponse: each functionResponse MUST follow a model turn with matching functionCall.
 */
export function sanitizeTopology(contents: GeminiContent[]): GeminiContent[] {
  const result: GeminiContent[] = []

  for (let i = 0; i < contents.length; i++) {
    const turn = contents[i]!

    if (turn.role === 'model') {
      const cleanParts: GeminiPart[] = []
      for (const part of turn.parts) {
        if ('thought' in part && part.thought) {
          if (isValidThoughtSignature(part.thoughtSignature)) {
            cleanParts.push(part)
          } else {
            // Strip invalid signature thought flag, convert to regular text
            cleanParts.push({ text: sanitizeText(part.text) })
          }
        } else {
          cleanParts.push(part)
        }
      }
      if (cleanParts.length > 0) {
        result.push({ role: 'model', parts: cleanParts })
      }
    } else {
      // User turn: check for orphan functionResponses
      const prevTurn = result[result.length - 1]
      const validCallNames = new Set<string>()
      const validCallIds = new Set<string>()

      if (prevTurn && prevTurn.role === 'model') {
        for (const p of prevTurn.parts) {
          if ('functionCall' in p && p.functionCall) {
            if (p.functionCall.name) validCallNames.add(p.functionCall.name)
            if (p.functionCall.id) validCallIds.add(p.functionCall.id)
          }
        }
      }

      const cleanParts: GeminiPart[] = []
      for (const part of turn.parts) {
        if ('functionResponse' in part && part.functionResponse) {
          const fr = part.functionResponse
          const matched =
            (fr.id && validCallIds.has(fr.id)) ||
            (fr.name && validCallNames.has(fr.name))

          if (matched) {
            cleanParts.push(part)
          } else {
            // Orphan functionResponse: convert to user observation text
            const output =
              'output' in fr.response ? fr.response.output : fr.response.error
            cleanParts.push({
              text: `[Observation from \`${fr.name}\`:\n${output}]`,
            })
          }
        } else {
          cleanParts.push(part)
        }
      }

      if (cleanParts.length > 0) {
        result.push({ role: 'user', parts: cleanParts })
      }
    }
  }

  // Ensure conversation starts with 'user'
  if (result.length > 0 && result[0]?.role === 'model') {
    result.unshift({
      role: 'user',
      parts: [{ text: 'Hello' }],
    })
  }

  return result
}
