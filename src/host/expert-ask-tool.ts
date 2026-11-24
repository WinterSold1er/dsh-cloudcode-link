// expert_ask — general-purpose intellectual delegation tool ("brain/hand separation")
// routed to the Google Gemini App (Robin / AGSA) API with role-based system prompts
// and workspace-sandboxed local file attachment.

import fs from 'node:fs'
import path from 'node:path'
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

export const EXPERT_ROLES = ['coding', 'review', 'debug', 'writing', 'math', 'general'] as const
export type ExpertRole = (typeof EXPERT_ROLES)[number]

export const ROLE_SYSTEM_PROMPTS: Record<ExpertRole, string> = {
  coding:
    'You are a senior software engineer. Follow the existing codebase style and conventions, handle edge cases and error paths explicitly, avoid placeholders or TODOs, and output complete, directly applicable code or precise edit blocks.',
  review:
    'You are a strict code reviewer. Report only real defects—logic bugs, concurrency/nullability/security hazards, and architectural flaws—with exact file/line locations and concrete fixes. Skip trivial formatting nitpicks.',
  debug:
    'You are a principal debugging specialist. Trace the causal chain from observed symptoms to the root cause, explain why it happens, and provide minimal, verifiable fix steps.',
  writing:
    'You are an expert technical and editorial writer. Produce clear, well-structured, natural prose tailored to the target audience, genre, and tone.',
  math:
    'You are a mathematician and algorithmist. Derive solutions step by step with rigorous notation, verify edge cases, and state the final conclusion clearly.',
  general:
    'You are a principal analytical advisor. Cut straight to the essence of the problem, provide structured analysis and trade-offs, and deliver actionable conclusions.',
}

export const EXPERT_FIRST_SYSTEM_PROMPT = `## Brain/Hand Separation: Prefer \`expert_ask\` for Thinking & Creation

You have access to \`expert_ask\`, which delegates reasoning, coding, review, debugging, writing, and math to a fast, free Expert model (Robin API). Act as the hands and eyes (file discovery, reading/writing, running commands/tests) and delegate non-trivial intellectual work to \`expert_ask\`:

1. **When to call \`expert_ask\`**:
   - Writing new features, refactoring code, or fixing non-trivial bugs (\`role: "coding"\` / \`"debug"\`)
   - Code review or PR/diff evaluation (\`role: "review"\`)
   - Writing articles, reports, copy, or translations (\`role: "writing"\`)
   - Math problems, algorithm proofs, or complex logic analysis (\`role: "math"\`)
   - Architecture design, tech selection, or complex problem breakdown (\`role: "general"\`)
2. **Standard workflow**:
   - **Coding**: Locate relevant files with \`glob\`/\`grep\` -> pass \`file_paths\` and requirements directly to \`expert_ask\` -> apply the returned solution with \`edit\`/\`write\` -> run tests to verify.
   - **General (writing/math/Q&A)**: Call \`expert_ask\` directly -> present the result to the user (or write to a file if requested).
3. **Exceptions**: Pure file lookups, pure command execution, or trivial 1-2 line obvious edits can be done directly without \`expert_ask\`.`

export interface SandboxedFileLimits {
  maxFileChars?: number
  maxTotalChars?: number
}

const DEFAULT_MAX_FILE_CHARS = 30_000
const DEFAULT_MAX_TOTAL_CHARS = 100_000

function parseFileSpec(rawSpec: string): { filePath: string; start?: number; end?: number } {
  const trimmed = rawSpec.trim()
  if (!trimmed) {
    throw new Error('expert_ask: file_paths entries must be non-empty strings')
  }

  const lastColon = trimmed.lastIndexOf(':')
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (lastColon > lastSlash && lastColon > 0) {
    const filePath = trimmed.slice(0, lastColon)
    const rangePart = trimmed.slice(lastColon + 1)
    const match = /^(\d+)-(\d+)$/.exec(rangePart)
    if (!match) {
      throw new Error(
        `expert_ask: invalid line range "${rangePart}" in "${rawSpec}", expected path:start-end`,
      )
    }
    const start = Number(match[1])
    const end = Number(match[2])
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
      throw new Error(
        `expert_ask: invalid line range ${start}-${end} in "${rawSpec}" (must satisfy 1 <= start <= end)`,
      )
    }
    return { filePath, start, end }
  }

  return { filePath: trimmed }
}

export function readSandboxedFiles(
  filePaths: string[],
  cwd: string,
  limits?: SandboxedFileLimits,
): string {
  const maxFileChars = limits?.maxFileChars ?? DEFAULT_MAX_FILE_CHARS
  const maxTotalChars = limits?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const resolvedCwd = path.resolve(cwd)
  const realCwd = fs.realpathSync(resolvedCwd)

  const sections: string[] = []
  let totalChars = 0

  for (const rawSpec of filePaths) {
    const { filePath, start, end } = parseFileSpec(rawSpec)
    const resolvedTarget = path.resolve(resolvedCwd, filePath)

    const relLexical = path.relative(resolvedCwd, resolvedTarget)
    if (relLexical === '' || relLexical.startsWith('..') || path.isAbsolute(relLexical)) {
      throw new Error(`expert_ask: path "${filePath}" is outside workspace sandbox`)
    }

    let realTarget: string
    try {
      realTarget = fs.realpathSync(resolvedTarget)
    } catch {
      throw new Error(`expert_ask: file not found: "${filePath}"`)
    }

    const relReal = path.relative(realCwd, realTarget)
    if (relReal === '' || relReal.startsWith('..') || path.isAbsolute(relReal)) {
      throw new Error(
        `expert_ask: path "${filePath}" resolves outside workspace sandbox (symlink escape)`,
      )
    }

    const stat = fs.statSync(realTarget)
    if (!stat.isFile()) {
      throw new Error(`expert_ask: path "${filePath}" is not a regular file`)
    }

    const content = fs.readFileSync(realTarget, 'utf8')
    const lines = content.split(/\r?\n/)
    const sliceStart = start !== undefined ? start - 1 : 0
    const sliceEnd = end !== undefined ? end : lines.length
    const selected = lines.slice(sliceStart, sliceEnd)

    let formatted = selected
      .map((line, idx) => `${sliceStart + idx + 1}: ${line}`)
      .join('\n')

    if (formatted.length > maxFileChars) {
      formatted =
        formatted.slice(0, maxFileChars) +
        `\n[truncated: file "${rawSpec}" exceeded ${maxFileChars} chars]`
    }

    const section = `=== File: ${rawSpec} ===\n${formatted}`
    if (totalChars + section.length > maxTotalChars) {
      const remaining = maxTotalChars - totalChars
      if (remaining > 100) {
        sections.push(
          section.slice(0, remaining) +
            `\n[truncated: total attached context exceeded ${maxTotalChars} chars]`,
        )
      } else {
        sections.push(
          `[truncated: total attached context exceeded ${maxTotalChars} chars (remaining files omitted)]`,
        )
      }
      break
    }

    sections.push(section)
    totalChars += section.length
  }

  return sections.join('\n\n')
}

export interface ExpertAskToolDeps {
  cfg: () => PluginConfig
  transport?: GeminiAppTransport
  pool?: GeminiAppPoolManager
  log?: (msg: string) => void
  getCwd?: (exec: unknown) => string | undefined
  callGeminiApp?: (params: {
    prompt: string
    system: string
    mode: 'standard' | 'advanced'
    signal: AbortSignal
    cfg: PluginConfig
  }) => Promise<string>
}

export function defineExpertAskTool(deps: ExpertAskToolDeps) {
  return defineTool({
    name: 'expert_ask',
    description:
      'Delegate thinking, reasoning, coding, code review, debugging, writing, math, and analysis tasks to the Expert (Robin API — fast and free). Prefer calling this tool for any non-trivial intellectual work instead of solving it yourself. Pass file_paths directly so the plugin reads files for the Expert without consuming your own context.',
    parameters: {
      task: {
        type: 'string',
        required: true,
        description: 'The specific task, question, or problem for the Expert to solve.',
      },
      role: {
        type: 'string',
        enum: [...EXPERT_ROLES],
        description:
          "Expert role: 'coding' | 'review' | 'debug' | 'writing' | 'math' | 'general' (default: 'general').",
      },
      file_paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Optional workspace-relative file paths (supports 'path/to/file.ts' or 'path/to/file.ts:10-80' 1-based inclusive line ranges) to attach directly.",
      },
      context: {
        type: 'string',
        description: 'Optional extra context such as error logs, git diff, or constraints.',
      },
      mode: {
        type: 'string',
        enum: ['standard', 'advanced'],
        description: "Optional Robin mode: 'standard' or 'advanced' (default: 'advanced').",
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 5 * 60_000,
    async execute(args, exec) {
      const task = typeof args.task === 'string' ? args.task.trim() : ''
      if (!task) {
        throw new Error('expert_ask: task must be a non-empty string')
      }

      const rawRole = typeof args.role === 'string' ? args.role.trim().toLowerCase() : ''
      const role: ExpertRole = rawRole === '' ? 'general' : (rawRole as ExpertRole)
      if (!EXPERT_ROLES.includes(role)) {
        throw new Error(
          `expert_ask: invalid role "${args.role}", expected one of ${EXPERT_ROLES.join(', ')}`,
        )
      }

      const rawMode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : ''
      if (rawMode !== '' && rawMode !== 'standard' && rawMode !== 'advanced') {
        throw new Error(
          `expert_ask: invalid mode "${args.mode}", expected "standard" or "advanced"`,
        )
      }
      const mode: 'standard' | 'advanced' = rawMode === 'standard' ? 'standard' : 'advanced'

      let attachedFiles = ''
      if (args.file_paths !== undefined) {
        if (!Array.isArray(args.file_paths) || args.file_paths.some((p) => typeof p !== 'string')) {
          throw new Error('expert_ask: file_paths must be an array of strings')
        }
        if (args.file_paths.length > 0) {
          const cwd = deps.getCwd?.(exec) || process.cwd()
          attachedFiles = readSandboxedFiles(args.file_paths, cwd)
        }
      }

      const promptParts = [`## Task\n${task}`]
      if (typeof args.context === 'string' && args.context.trim() !== '') {
        promptParts.push(`## Context\n${args.context.trim()}`)
      }
      if (attachedFiles) {
        promptParts.push(`## Attached Files\n${attachedFiles}`)
      }
      const assembledPrompt = promptParts.join('\n\n')
      const systemPrompt = ROLE_SYSTEM_PROMPTS[role]

      const cfg = deps.cfg()
      const timeoutMs = cfg.geminiAppTimeoutMs || 120_000
      const controller = new AbortController()
      let timeoutTimer: NodeJS.Timeout | undefined
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          controller.abort(new Error(`expert_ask timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }

      const combinedSignal = exec?.signal
        ? AbortSignal.any([exec.signal, controller.signal])
        : controller.signal

      try {
        if (deps.callGeminiApp) {
          return await deps.callGeminiApp({
            prompt: assembledPrompt,
            system: systemPrompt,
            mode,
            signal: combinedSignal,
            cfg,
          })
        }

        const clientConfig: GeminiAppConfig = {
          endpoint: cfg.geminiAppEndpoint,
          token: cfg.geminiAppToken,
          timeoutMs,
          defaultModel: cfg.geminiAppDefaultModel,
        }
        const messages: Message[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: assembledPrompt },
        ]
        const model = mode === 'advanced' ? 'gemini-app-advanced' : 'gemini-app-default'
        const request = buildProcessQueryRequest(
          {
            model,
            messages,
          } as CoreGenerateOptions,
          clientConfig,
        )
        const client = new GeminiAppClient(clientConfig, deps.transport, deps.pool)
        const res = await client.processQuery(request, combinedSignal)
        return res.text
      } catch (err) {
        if (err instanceof GeminiAppError) {
          deps.log?.(`[expert_ask] failed [${err.code}]: ${err.message}`)
          throw new Error(`expert_ask failed [${err.code}]: ${err.message}`)
        }
        const message = err instanceof Error ? err.message : String(err)
        deps.log?.(`[expert_ask] failed: ${message}`)
        throw new Error(`expert_ask failed: ${message}`)
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer)
      }
    },
  })
}

export function registerExpertAskTool(
  tools: { register: (tool: unknown) => unknown },
  deps: ExpertAskToolDeps,
): () => void {
  const reg = tools.register(defineExpertAskTool(deps))
  return typeof reg === 'function' ? (reg as () => void) : () => {}
}

export interface ToolsServiceLike {
  register: (tool: unknown) => unknown
}

export interface SystemPromptServiceLike {
  section: (opts: { name: string; order: number; text: string }) => unknown
}

export interface ExpertAskRegistrationState {
  toolDispose: (() => void) | null
  promptDispose: (() => void) | null
}

export interface SyncExpertAskRegistrationParams {
  enabled: boolean
  toolsSvc: ToolsServiceLike | null
  systemPromptSvc: SystemPromptServiceLike | null
  state: ExpertAskRegistrationState
  deps: ExpertAskToolDeps
  order?: number
}

export function syncExpertAskRegistration(params: SyncExpertAskRegistrationParams): void {
  const { enabled, toolsSvc, systemPromptSvc, state, deps, order = 500 } = params
  if (enabled) {
    if (state.toolDispose === null && toolsSvc) {
      const reg = toolsSvc.register(defineExpertAskTool(deps))
      state.toolDispose = typeof reg === 'function' ? (reg as () => void) : null
    }
    if (state.promptDispose === null && systemPromptSvc) {
      const reg = systemPromptSvc.section({
        name: 'tool:expert_ask',
        order,
        text: EXPERT_FIRST_SYSTEM_PROMPT,
      })
      state.promptDispose = typeof reg === 'function' ? (reg as () => void) : null
    }
  } else {
    if (state.toolDispose !== null) {
      state.toolDispose()
      state.toolDispose = null
    }
    if (state.promptDispose !== null) {
      state.promptDispose()
      state.promptDispose = null
    }
  }
}
