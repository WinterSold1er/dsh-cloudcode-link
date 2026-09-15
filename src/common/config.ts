// Config resolution: env (DSH_AGY_*) > runtime overrides file > cordis
// entry config > defaults. The overrides file backs /agy hot changes
// and survives restarts; the env is read per call so a changed
// process environment is honored without reload.
import { defaultConfig, type PermissionMode, type PluginConfig } from './types.ts'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface OverridesFile { [key: string]: unknown }

export function dshHome(): string {
  return process.env.DSH_HOME ?? process.env.DSH_STATE_DIR ?? join(homedir(), '.dsh')
}

export function stateDir(): string {
  const newDir = join(dshHome(), 'cloudcode-link')
  const legacyDir = join(dshHome(), 'agy-link')
  if (!existsSync(newDir) && existsSync(legacyDir)) {
    return legacyDir
  }
  return newDir
}

export function overridesPath(): string {
  return join(stateDir(), 'runtime-overrides.json')
}

function readJson(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {}
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function readOverrides(file = overridesPath()): OverridesFile {
  return readJson(file)
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true' || v === '1'
  return undefined
}

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

const MODES: readonly PermissionMode[] = ['skip', 'plan', 'accept-edits']

function asMode(v: unknown): PermissionMode | undefined {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
    ? (v as PermissionMode)
    : undefined
}

/** Layered config read; cheap enough to call per request (thunk pattern). */
export function resolveConfig(
  entry: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
  overrides: OverridesFile = readOverrides(),
): PluginConfig {
  const base = defaultConfig()
  const e = entry ?? {}
  const layers: Array<Record<string, unknown>> = [e, overrides]
  const get = (k: string): unknown => {
    for (const l of layers) if (l[k] !== undefined && l[k] !== null && l[k] !== '') return l[k]
    return undefined
  }
  const cfg: PluginConfig = {
    ...base,
    enabled: asBool(get('enabled')) ?? base.enabled,
    defaultModel: asString(get('defaultModel')) ?? base.defaultModel,
    defaultEffort: asString(get('defaultEffort')) ?? base.defaultEffort,
    timeoutMs: asNum(get('timeoutMs')) ?? base.timeoutMs,
    maxConcurrent: asNum(get('maxConcurrent')) ?? base.maxConcurrent,
    contextWindowDefault: asNum(get('contextWindowDefault')) ?? base.contextWindowDefault,
    maxTokensDefault: asNum(get('maxTokensDefault')) ?? base.maxTokensDefault,
    quotaPollIntervalMs: asNum(get('quotaPollIntervalMs')) ?? base.quotaPollIntervalMs,
    sessionStartQuotaRefreshMinIntervalMs:
      asNum(get('sessionStartQuotaRefreshMinIntervalMs')) ?? base.sessionStartQuotaRefreshMinIntervalMs,
    statsEnabled: asBool(get('statsEnabled')) ?? base.statsEnabled,
    statsDbPath: asString(get('statsDbPath')) ?? base.statsDbPath,
    statsBufferCapacity: asNum(get('statsBufferCapacity')) ?? base.statsBufferCapacity,
    statsBatchSize: asNum(get('statsBatchSize')) ?? base.statsBatchSize,
    statsFlushIntervalMs: asNum(get('statsFlushIntervalMs')) ?? base.statsFlushIntervalMs,
    statsRetentionDays: asNum(get('statsRetentionDays')) ?? base.statsRetentionDays,
    statsRetentionCheckIntervalMs: asNum(get('statsRetentionCheckIntervalMs')) ?? base.statsRetentionCheckIntervalMs,
    lowQuotaThreshold: asNum(get('lowQuotaThreshold')) ?? base.lowQuotaThreshold,
    apiMaxPageSize: asNum(get('apiMaxPageSize')) ?? base.apiMaxPageSize,
    modelsCacheTtlMs: asNum(get('modelsCacheTtlMs')) ?? base.modelsCacheTtlMs,
    baseUrl: asString(get('baseUrl')) ?? base.baseUrl,
    endpointCandidates: Array.isArray(get('endpointCandidates'))
      ? (get('endpointCandidates') as unknown[]).filter((x): x is string => typeof x === 'string')
      : base.endpointCandidates,
    fallbackModels: Array.isArray(get('fallbackModels'))
      ? (get('fallbackModels') as unknown[]).filter(
          (x): x is PluginConfig['fallbackModels'][number] =>
            !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string',
        )
      : base.fallbackModels,
    askTool: asBool(get('askTool')) ?? base.askTool,
    rateLimitPerMinute: asNum(get('rateLimitPerMinute')) ?? base.rateLimitPerMinute,
    autoFallbackModel: asBool(get('autoFallbackModel')) ?? base.autoFallbackModel,
    logRetentionDays: asNum(get('logRetentionDays')) ?? base.logRetentionDays,
    disableTelemetry: asBool(get('disableTelemetry')) ?? base.disableTelemetry,
    heartbeatEnabled: asBool(get('heartbeatEnabled')) ?? base.heartbeatEnabled,
    heartbeatIntervalMs: (() => {
      const n = asNum(get('heartbeatIntervalMs'))
      return n !== undefined ? Math.max(30_000, n) : base.heartbeatIntervalMs
    })(),

    // Deprecated fields kept for backward compatibility
    agyBin: asString(get('agyBin')) ?? base.agyBin,
    permissionMode: asMode(get('permissionMode')) ?? base.permissionMode,
    workspaceRoot: asString(get('workspaceRoot')) ?? base.workspaceRoot,
    mcpBridge: asBool(get('mcpBridge')) ?? base.mcpBridge,
    mcpToolAllowlist: asString(get('mcpToolAllowlist')) ?? base.mcpToolAllowlist,
    mediaDir: asString(get('mediaDir')) ?? base.mediaDir,
    mediaTtlMs: asNum(get('mediaTtlMs')) ?? base.mediaTtlMs,
    mediaMaxBytes: asNum(get('mediaMaxBytes')) ?? base.mediaMaxBytes,
    mediaMaxImages: asNum(get('mediaMaxImages')) ?? base.mediaMaxImages,
    forwardSystemPrompt: asBool(get('forwardSystemPrompt')) ?? base.forwardSystemPrompt,
    digestMaxChars: asNum(get('digestMaxChars')) ?? base.digestMaxChars,
    allowAuxiliary: asBool(get('allowAuxiliary')) ?? base.allowAuxiliary,
    compactionMaxChars: asNum(get('compactionMaxChars')) ?? base.compactionMaxChars,
    extraArgs: Array.isArray(get('extraArgs'))
      ? (get('extraArgs') as unknown[]).filter((x): x is string => typeof x === 'string')
      : base.extraArgs,
  }

  // Env wins last
  const envEnabled = env.DSH_CLOUDCODE_ENABLED ?? env.DSH_AGY_ENABLED
  if (envEnabled !== undefined) cfg.enabled = asBool(envEnabled) ?? cfg.enabled
  if (env.ANTIGRAVITY_BASE_URL) cfg.baseUrl = env.ANTIGRAVITY_BASE_URL
  const envDefaultModel = env.DSH_CLOUDCODE_DEFAULT_MODEL ?? env.DSH_AGY_DEFAULT_MODEL
  if (envDefaultModel) cfg.defaultModel = envDefaultModel
  const envDefaultEffort = env.DSH_CLOUDCODE_DEFAULT_EFFORT ?? env.DSH_AGY_DEFAULT_EFFORT
  if (envDefaultEffort) cfg.defaultEffort = envDefaultEffort
  const envTimeoutMs = env.DSH_CLOUDCODE_TIMEOUT_MS ?? env.DSH_AGY_TIMEOUT_MS
  if (envTimeoutMs !== undefined) {
    const n = asNum(envTimeoutMs)
    if (n !== undefined) cfg.timeoutMs = n
  }
  const envMaxConcurrent = env.DSH_CLOUDCODE_MAX_CONCURRENT ?? env.DSH_AGY_MAX_CONCURRENT
  if (envMaxConcurrent !== undefined) {
    const n = asNum(envMaxConcurrent)
    if (n !== undefined) cfg.maxConcurrent = n
  }
  const envQuotaPoll = env.DSH_CLOUDCODE_QUOTA_POLL_INTERVAL_MS ?? env.DSH_AGY_QUOTA_POLL_INTERVAL_MS
  if (envQuotaPoll !== undefined) {
    const n = asNum(envQuotaPoll)
    if (n !== undefined) cfg.quotaPollIntervalMs = Math.max(60_000, n)
  }
  const envHeartbeatEnabled = env.DSH_CLOUDCODE_HEARTBEAT_ENABLED ?? env.DSH_AGY_HEARTBEAT_ENABLED
  if (envHeartbeatEnabled !== undefined) {
    cfg.heartbeatEnabled = asBool(envHeartbeatEnabled) ?? cfg.heartbeatEnabled
  }
  const envHeartbeatInterval = env.DSH_CLOUDCODE_HEARTBEAT_INTERVAL_MS ?? env.DSH_AGY_HEARTBEAT_INTERVAL_MS
  if (envHeartbeatInterval !== undefined) {
    const n = asNum(envHeartbeatInterval)
    if (n !== undefined) cfg.heartbeatIntervalMs = Math.max(30_000, n)
  }

  // Stats environment overrides
  const envStatsDbPath = env.DSH_CLOUDCODE_DB_PATH ?? env.DSH_AGY_DB_PATH
  if (envStatsDbPath) cfg.statsDbPath = envStatsDbPath
  const envStatsEnabled = env.DSH_CLOUDCODE_STATS_ENABLED ?? env.DSH_AGY_STATS_ENABLED
  if (envStatsEnabled !== undefined) {
    const b = asBool(envStatsEnabled)
    if (b !== undefined) cfg.statsEnabled = b
  }
  const envStatsBufferCapacity = env.DSH_CLOUDCODE_STATS_BUFFER_CAPACITY
  if (envStatsBufferCapacity !== undefined) {
    const n = asNum(envStatsBufferCapacity)
    if (n !== undefined) cfg.statsBufferCapacity = Math.max(1, n)
  }
  const envStatsBatchSize = env.DSH_CLOUDCODE_STATS_BATCH_SIZE
  if (envStatsBatchSize !== undefined) {
    const n = asNum(envStatsBatchSize)
    if (n !== undefined) cfg.statsBatchSize = Math.max(1, n)
  }
  const envStatsFlushIntervalMs = env.DSH_CLOUDCODE_STATS_FLUSH_INTERVAL_MS
  if (envStatsFlushIntervalMs !== undefined) {
    const n = asNum(envStatsFlushIntervalMs)
    if (n !== undefined) cfg.statsFlushIntervalMs = Math.max(10, n)
  }
  const envStatsRetentionDays = env.DSH_CLOUDCODE_STATS_RETENTION_DAYS
  if (envStatsRetentionDays !== undefined) {
    const n = asNum(envStatsRetentionDays)
    if (n !== undefined) cfg.statsRetentionDays = Math.max(1, n)
  }
  const envStatsRetentionCheckMs = env.DSH_CLOUDCODE_STATS_RETENTION_CHECK_INTERVAL_MS
  if (envStatsRetentionCheckMs !== undefined) {
    const n = asNum(envStatsRetentionCheckMs)
    if (n !== undefined) cfg.statsRetentionCheckIntervalMs = Math.max(1000, n)
  }
  const envLowQuotaThreshold = env.DSH_CLOUDCODE_LOW_QUOTA_THRESHOLD
  if (envLowQuotaThreshold !== undefined) {
    const n = asNum(envLowQuotaThreshold)
    if (n !== undefined) cfg.lowQuotaThreshold = Math.max(0, Math.min(1, n))
  }
  const envSessionRefreshMin = env.DSH_CLOUDCODE_SESSION_START_QUOTA_REFRESH_MIN_INTERVAL_MS
  if (envSessionRefreshMin !== undefined) {
    const n = asNum(envSessionRefreshMin)
    if (n !== undefined) cfg.sessionStartQuotaRefreshMinIntervalMs = Math.max(1000, n)
  }
  const envApiMaxPageSize = env.DSH_CLOUDCODE_API_MAX_PAGE_SIZE
  if (envApiMaxPageSize !== undefined) {
    const n = asNum(envApiMaxPageSize)
    if (n !== undefined) cfg.apiMaxPageSize = Math.max(1, n)
  }

  return cfg
}
