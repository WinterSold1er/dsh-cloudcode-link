// Shared vocabulary for dsh-cloudcode-link: plugin config, provider-route ids,
// stable error codes, and the CloudCode direct API types.

export const PROVIDER_ID = 'antigravity'
export const PLUGIN_ID = 'cloudcode-link'
export const PKG_NAME = 'dsh-cloudcode-link'

export type PermissionMode = 'skip' | 'plan' | 'accept-edits'

export interface FallbackModelDef {
  id: string
  name: string
  /** Selectable reasoning efforts; omit for fixed-thinking models. */
  efforts?: readonly string[]
}

export interface PluginConfig {
  enabled: boolean
  defaultModel: string
  defaultEffort: string
  /** Watchdog for one generation call. */
  timeoutMs: number
  maxConcurrent: number
  contextWindowDefault: number
  maxTokensDefault: number
  /** Background quota polling interval in ms (default 15 min; clamped >= 60s). */
  quotaPollIntervalMs: number
  fallbackModels: readonly FallbackModelDef[]
  askTool: boolean
  /** Opt-out and suppress Google Cloud Code / Antigravity telemetry tracking. */
  disableTelemetry: boolean
  /** Automatically fallback to available lower-tier model if active model is exhausted. */
  autoFallbackModel: boolean
  /** Custom base URL for CloudCode API (empty = default). */
  baseUrl: string
  /** Candidate endpoints for fallback. */
  endpointCandidates: readonly string[]
  modelsCacheTtlMs: number
  /** Days to retain historical logs before automatic sweep (default: 7). */
  logRetentionDays: number
  /** Maximum requests allowed per minute across all sessions (0 = disabled). */
  rateLimitPerMinute: number
  /** Send keepalive heartbeat pings during subagent execution to preserve CloudCode KV cache. */
  heartbeatEnabled: boolean
  /** Interval in ms between keepalive heartbeat pings (min: 30000, default: 180000). */
  heartbeatIntervalMs: number

  // Deprecated configuration options (kept for backwards compatibility, silently ignored):
  /** @deprecated Use direct CloudCode API instead of agy binary */
  agyBin?: string
  /** @deprecated Permission mode was used for agy CLI */
  permissionMode?: PermissionMode
  /** @deprecated Workspace root was used for agy CLI */
  workspaceRoot?: string
  /** @deprecated MCP bridge was used for agy CLI */
  mcpBridge?: boolean
  /** @deprecated */
  mcpToolAllowlist?: string
  /** @deprecated */
  mediaDir?: string
  /** @deprecated */
  mediaTtlMs?: number
  /** @deprecated */
  mediaMaxBytes?: number
  /** @deprecated */
  mediaMaxImages?: number
  /** @deprecated */
  forwardSystemPrompt?: boolean
  /** @deprecated */
  digestMaxChars?: number
  /** @deprecated */
  allowAuxiliary?: boolean
  /** @deprecated */
  compactionMaxChars?: number
  /** @deprecated */
  extraArgs?: readonly string[]
}

export const DEFAULT_ENDPOINT_CANDIDATES: readonly string[] = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
]

// Full fallback line-up
export const DEFAULT_FALLBACK_MODELS: readonly FallbackModelDef[] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', efforts: ['low', 'high'] },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
]

export function defaultConfig(): PluginConfig {
  return {
    enabled: true,
    defaultModel: '',
    defaultEffort: '',
    timeoutMs: 600_000,
    maxConcurrent: 3,
    contextWindowDefault: 1_048_576,
    maxTokensDefault: 65_536,
    quotaPollIntervalMs: 15 * 60_000,
    fallbackModels: DEFAULT_FALLBACK_MODELS,
    askTool: false,
    disableTelemetry: true,
    autoFallbackModel: false,
    baseUrl: '',
    endpointCandidates: DEFAULT_ENDPOINT_CANDIDATES,
    modelsCacheTtlMs: 300_000,
    logRetentionDays: 7,
    rateLimitPerMinute: 0,
    heartbeatEnabled: true,
    heartbeatIntervalMs: 180_000,
    agyBin: '',
    permissionMode: 'skip',
    workspaceRoot: '',
    mcpBridge: false,
    mcpToolAllowlist: '',
    mediaDir: '',
    mediaTtlMs: 86_400_000,
    mediaMaxBytes: 10 * 1024 * 1024,
    mediaMaxImages: 8,
    forwardSystemPrompt: false,
    digestMaxChars: 8_000,
    allowAuxiliary: true,
    compactionMaxChars: 800_000,
    extraArgs: [],
  }
}

// Stable LlmError codes surfaced by the adapter
export const Err = {
  AUTH: 'AUTH',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMIT: 'RATE_LIMIT',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  CONNECT_ERROR: 'CONNECT_ERROR',
  STREAM_ERROR: 'STREAM_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const

export function looksLikeAuthFailure(text?: string): boolean {
  if (!text) return false
  return /auth|unauthorized|permission denied|invalid credential|login required|token expired|please sign in/i.test(text)
}

export function looksLikeHardRateLimit(text?: string): boolean {
  if (!text) return false
  return /RESOURCE_EXHAUSTED|code[ :]?429\b|status[ :]?429\b|HTTP[ :]?429\b|too many requests|individual quota reached|quota (?:exceeded|reached|exhausted)|rate[ -]?limit(?:ed)? (?:exceeded|reached|hit)|exceeded (?:your |the )?quota/i.test(
    text,
  )
}

export function looksLikeRateLimit(text?: string): boolean {
  if (!text) return false
  return (
    looksLikeHardRateLimit(text) || /model overloaded|experiencing high traffic/i.test(text)
  )
}

export function parseResetDurationMs(text?: string): number | undefined {
  if (!text) return undefined

  // 1. Compact: "Resets in 2h26m6s", "resets in 21m25s", "resets in 45s"
  const compactMatch = text.match(/resets?\s+in\s+((?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?)/i)
  if (compactMatch && compactMatch[1]?.trim()) {
    const hours = parseInt(compactMatch[2] || '0', 10)
    const minutes = parseInt(compactMatch[3] || '0', 10)
    const seconds = parseInt(compactMatch[4] || '0', 10)
    const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000
    if (totalMs > 0) return totalMs
  }

  // 2. Word-based: "Resets in 15 minutes", "resets in 2 hours", "retry after 30 seconds"
  const wordMatch = text.match(/(?:resets?|retry)\s+(?:in|after)\s+(\d+)\s*(hour|hr|minute|min|second|sec)s?/i)
  if (wordMatch) {
    const num = parseInt(wordMatch[1]!, 10)
    const unit = wordMatch[2]!.toLowerCase()
    if (unit.startsWith('h')) return num * 3600 * 1000
    if (unit.startsWith('m')) return num * 60 * 1000
    if (unit.startsWith('s')) return num * 1000
  }

  // 3. ISO timestamp or future date string
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/)
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0])
    if (!Number.isNaN(parsed) && parsed > Date.now()) {
      return parsed - Date.now()
    }
  }

  const retrySec = parseInt(text.trim(), 10)
  if (!Number.isNaN(retrySec) && retrySec > 0 && retrySec < 86400 * 7) {
    return retrySec * 1000
  }

  return undefined
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSecs = Math.ceil(ms / 1000)
  const days = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  const secs = totalSecs % 60

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  return `${secs}s`
}
