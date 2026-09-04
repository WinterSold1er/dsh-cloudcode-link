// Direct CloudCode oneshot text runner for agy_ask tool.
import { isAbsolute, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { PluginConfig } from '../common/types.ts'
import { modelFamilyOf } from '../common/pool-types.ts'
import type { AccountPoolManager } from './pool.ts'
import type { QuotaService } from './quota.ts'
import {
  getAntigravityRequestModelId,
  getMaxOutputTokens,
  getThinkingConfig,
} from './models.ts'
import {
  antigravityRequestEnvelope,
  ensureProject,
  streamGenerateContent,
  type AntigravityGenerateRequest,
} from './client.ts'
import { mapSseStreamToChunks } from './sse-mapper.ts'

/** Per-file inline cap; larger files are truncated. */
const INLINE_MAX_BYTES = 256 * 1024

function looksTextual(head: string): boolean {
  if (head === '') return true
  let suspicious = 0
  const n = Math.min(head.length, 2000)
  for (let i = 0; i < n; i++) {
    const c = head.charCodeAt(i)
    if (c === 0 || (c < 9 && c !== 0) || (c > 13 && c < 32)) suspicious++
  }
  return suspicious / n < 0.05
}

export async function inlineFiles(
  prompt: string,
  paths: readonly string[],
  cwd: string,
): Promise<string> {
  if (paths.length === 0) return prompt
  const sections: string[] = []
  for (const raw of paths) {
    const p = isAbsolute(raw) ? raw : resolve(cwd, raw)
    let note = ''
    let body = ''
    try {
      const buf = await readFile(p)
      if (!looksTextual(buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8'))) {
        note = '(skipped: binary file)'
      } else if (buf.byteLength > INLINE_MAX_BYTES) {
        note = '(truncated to the first ' + INLINE_MAX_BYTES + ' bytes)'
        body = buf.subarray(0, INLINE_MAX_BYTES).toString('utf8')
      } else {
        body = buf.toString('utf8')
      }
    } catch {
      note = '(skipped: unreadable - ' + raw + ')'
    }
    sections.push('--- file: ' + p + ' ' + note + ' ---' + '\n' + body)
  }
  return prompt + '\n\n' + sections.join('\n\n')
}

export interface OneShotResult {
  ok: boolean
  text: string
  conversationId: string | null
  error?: string
  durationMs: number
}

export interface OneShotDeps {
  cfg: () => PluginConfig
  pool?: AccountPoolManager
  quota?: QuotaService
  endpointCandidates?: string[]
}

export async function runAgyOnce(
  deps: OneShotDeps,
  req: {
    prompt: string
    model?: string
    effort?: string
    mode?: string
    timeoutMs?: number
    signal?: AbortSignal
    readPaths?: readonly string[]
    schema?: unknown
  },
): Promise<OneShotResult> {
  const startTime = Date.now()
  const cfg = deps.cfg()
  const timeoutMs = req.timeoutMs ?? cfg.timeoutMs
  const abortController = new AbortController()
  const timeoutTimer = setTimeout(() => abortController.abort(), timeoutMs)

  if (req.signal) {
    req.signal.addEventListener('abort', () => abortController.abort())
  }

  try {
    const requestedModel = req.model || cfg.defaultModel || 'gemini-3.7-flash'
    const wireModel = getAntigravityRequestModelId(requestedModel, req.effort)
    const isClaude = wireModel.startsWith('claude-')
    const maxTokens = getMaxOutputTokens(requestedModel, wireModel)
    const thinkingConfig = getThinkingConfig(requestedModel, req.effort)

    let prompt = req.prompt
    if (req.readPaths && req.readPaths.length > 0) {
      prompt = await inlineFiles(prompt, req.readPaths, process.cwd())
    }

    const family = modelFamilyOf(wireModel)
    const account = deps.pool?.selectAccount(family)
    const accountId = account?.id || 'acc_default'

    let token: string | null = null
    if (process.env.ANTIGRAVITY_TOKEN?.trim()) {
      token = process.env.ANTIGRAVITY_TOKEN.trim()
    } else if (deps.quota && account) {
      token = await deps.quota.getValidAccessToken(account)
    } else if (deps.pool) {
      token = deps.pool.getMemoryToken(accountId)
    }

    if (!token) {
      return {
        ok: false,
        text: '',
        conversationId: null,
        error: 'No authenticated Antigravity account available.',
        durationMs: Date.now() - startTime,
      }
    }

    const proxyUrl = account?.proxyUrl
    const endpoints = deps.endpointCandidates || cfg.endpointCandidates as string[]
    const envelope = antigravityRequestEnvelope(wireModel, isClaude)
    const projectId = await ensureProject(
      token,
      account?.alias || account?.id || 'antigravity-default',
      proxyUrl,
      endpoints,
    )

    const requestBody: AntigravityGenerateRequest = {
      project: projectId,
      model: wireModel,
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
        sessionId: envelope.sessionId,
        labels: envelope.labels,
      },
      requestType: 'AGENT',
      userAgent: 'ANTIGRAVITY',
      requestId: envelope.requestId,
    }

    const streamResult = await streamGenerateContent(
      token,
      requestBody,
      abortController.signal,
      proxyUrl,
      endpoints,
    )

    if (!streamResult.response.ok) {
      const errText = await streamResult.response.text().catch(() => '')
      return {
        ok: false,
        text: '',
        conversationId: null,
        error: `CloudCode API error HTTP ${streamResult.response.status}: ${errText}`,
        durationMs: Date.now() - startTime,
      }
    }

    let fullText = ''
    for await (const chunk of mapSseStreamToChunks(streamResult.response, abortController.signal)) {
      if (chunk.type === 'text-delta') {
        fullText += chunk.text
      } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
        // block end
      } else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
        return {
          ok: false,
          text: fullText,
          conversationId: null,
          error: chunk.reason.failure?.message || 'Stream error',
          durationMs: Date.now() - startTime,
        }
      }
    }

    return {
      ok: true,
      text: fullText,
      conversationId: null,
      durationMs: Date.now() - startTime,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      text: '',
      conversationId: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    }
  } finally {
    clearTimeout(timeoutTimer)
  }
}
