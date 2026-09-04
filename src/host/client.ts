import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { agyFetch } from './net.ts'
import { ANTIGRAVITY_MODEL_ENUM } from './models.ts'

export const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
export const ENDPOINT_FALLBACKS: readonly string[] = [
  DEFAULT_ENDPOINT,
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
]

const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000
const projectCache = new Map<string, { projectId: string; expiresAt: number }>()

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000
const modelCache = new Map<string, { result: DynamicModelInfo | undefined; expiresAt: number }>()
const inFlightModelLookups = new Map<string, Promise<DynamicModelInfo | undefined>>()

const DISCOVERY_TIMEOUT_MS = 10_000

export interface DynamicModelInfo {
  id: string
  experiments?: string[]
  apiProvider?: string
  modelProvider?: string
}

export type GeminiTextPart = { text: string; thoughtSignature?: string }
export type GeminiInlineDataPart = { inlineData: { mimeType: string; data: string } }
export type GeminiThoughtPart = { thought: true; text: string; thoughtSignature?: string }
export type GeminiFunctionCallPart = {
  functionCall: {
    name: string
    args: Record<string, unknown>
    id?: string
  }
  thoughtSignature?: string
}
export type GeminiFunctionResponsePart = {
  functionResponse: {
    name: string
    response: { error: string } | { output: string }
    id?: string
  }
}
export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiThoughtPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  parametersJsonSchema?: Record<string, unknown>
}

export interface GeminiToolConfig {
  functionCallingConfig: {
    mode: 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED'
  }
}

export interface GeminiGenerationConfig {
  temperature?: number
  maxOutputTokens?: number
  thinkingConfig?: {
    includeThoughts?: boolean
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
    thinkingBudget?: number
  }
}

export interface GeminiRequestBody {
  contents: GeminiContent[]
  systemInstruction?: {
    role: 'user'
    parts: GeminiTextPart[]
  }
  generationConfig?: GeminiGenerationConfig
  tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[]
  toolConfig?: GeminiToolConfig
  sessionId?: string
  labels?: Record<string, string>
}

export interface AntigravityGenerateRequest {
  project: string
  model: string
  request: GeminiRequestBody
  requestType: 'AGENT'
  userAgent: 'ANTIGRAVITY'
  requestId: string
}

export function endpointCandidates(customBaseUrl?: string): string[] {
  const explicit = customBaseUrl?.trim() || process.env.ANTIGRAVITY_BASE_URL?.trim()
  if (explicit) {
    return [explicit.replace(/\/+$/, '')]
  }
  return [...ENDPOINT_FALLBACKS]
}

function defaultUserAgent(): string {
  const version = process.env.ANTIGRAVITY_HUB_VERSION || '2.8.0'
  const cl = process.env.ANTIGRAVITY_HUB_CL || '963137146'
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`
}

export function antigravityHeaders(token: string): Record<string, string> {
  const platform =
    process.platform === 'darwin'
      ? 'PLATFORM_DARWIN'
      : process.platform === 'win32'
        ? 'PLATFORM_WINDOWS'
        : 'PLATFORM_LINUX'
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': defaultUserAgent(),
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'ANTIGRAVITY',
      platform,
      pluginType: 'GEMINI',
    }),
  }
}

export function stableProjectId(seed: string): string {
  const bytes = createHash('sha1').update(`antigravity:${seed}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function defaultProjectId(seed = 'antigravity-default'): string {
  return process.env.ANTIGRAVITY_PROJECT_ID?.trim() || stableProjectId(seed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function extractProjectId(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  const direct =
    data.antigravityProjectId ??
    data.projectId ??
    data.backendProjectId ??
    data.userDefinedCloudaicompanionProject ??
    data.cloudaicompanionProject ??
    data.project ??
    data.id
  const directId = asString(direct)
  if (directId) return directId
  if (isRecord(direct)) {
    const nestedId = asString(direct.id) ?? asString(direct.name) ?? extractProjectId(direct)
    if (nestedId) return nestedId
  }
  for (const key of ['projects', 'projectIds', 'cloudaicompanionProjects']) {
    const value = data[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = extractProjectId(item)
        if (nested) return nested
        const itemId = asString(item)
        if (itemId) return itemId
        if (isRecord(item)) {
          const id = asString(item.id) ?? asString(item.projectId) ?? asString(item.project)
          if (id) return id
        }
      }
    }
  }
  return undefined
}

export async function listCloudAICompanionProjects(
  token: string,
  proxyUrl?: string,
  customEndpoints?: string[],
): Promise<string | undefined> {
  const endpoints = customEndpoints && customEndpoints.length ? customEndpoints : endpointCandidates()
  for (const endpoint of endpoints) {
    try {
      const res = await agyFetch(`${endpoint}/v1internal:listCloudAICompanionProjects`, {
        method: 'POST',
        headers: antigravityHeaders(token),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      }, proxyUrl)
      if (!res.ok) continue
      const data: unknown = await res.json().catch(() => ({}))
      const proj = extractProjectId(data)
      if (proj) return proj
    } catch {
      // try next endpoint
    }
  }
  return undefined
}

/**
 * Discover project ID via loadCodeAssist (with 30-min in-memory LRU cache keyed by token).
 */
export async function loadCodeAssist(
  token: string,
  proxyUrl?: string,
  customEndpoints?: string[],
  bypassCache = false,
): Promise<string | undefined> {
  if (!bypassCache) {
    const cached = projectCache.get(token)
    if (cached && cached.expiresAt > Date.now()) {
      projectCache.delete(token)
      projectCache.set(token, cached)
      return cached.projectId
    }
  }

  const body = JSON.stringify({
    metadata: {
      ideType: 'ANTIGRAVITY',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  })

  const endpoints = customEndpoints && customEndpoints.length ? customEndpoints : endpointCandidates()
  for (const endpoint of endpoints) {
    try {
      const res = await agyFetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: antigravityHeaders(token),
        body,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      }, proxyUrl)
      if (!res.ok) continue
      const data: unknown = await res.json().catch(() => ({}))
      let proj = extractProjectId(data)
      if (!proj) {
        proj = await listCloudAICompanionProjects(token, proxyUrl, endpoints)
      }
      if (proj) {
        projectCache.set(token, { projectId: proj, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS })
        if (projectCache.size > 32) {
          const oldest = projectCache.keys().next().value
          if (oldest !== undefined) projectCache.delete(oldest)
        }
        return proj
      }
    } catch {
      // try next endpoint
    }
  }
  return undefined
}

export interface OnboardResponse {
  done?: boolean
  name?: string
  response?: {
    cloudaicompanionProject?: {
      id?: string
    }
    project?: string
  }
  error?: {
    code?: number
    message?: string
  }
}

export async function onboardUser(
  token: string,
  tierId = 'TIER_FREE',
  proxyUrl?: string,
  customEndpoints?: string[],
): Promise<OnboardResponse | null> {
  const body = JSON.stringify({
    tierId,
    metadata: {
      ideType: 'ANTIGRAVITY',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  })

  const endpoints = customEndpoints && customEndpoints.length ? customEndpoints : endpointCandidates()
  for (const endpoint of endpoints) {
    try {
      const res = await agyFetch(`${endpoint}/v1internal:onboardUser`, {
        method: 'POST',
        headers: antigravityHeaders(token),
        body,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      }, proxyUrl)
      if (res.ok) {
        return (await res.json().catch(() => null)) as OnboardResponse | null
      }
    } catch {
      // try next endpoint
    }
  }
  return null
}

export async function getOperation(
  token: string,
  operationName: string,
  proxyUrl?: string,
  customEndpoints?: string[],
): Promise<OnboardResponse | null> {
  const body = JSON.stringify({ name: operationName })
  const endpoints = customEndpoints && customEndpoints.length ? customEndpoints : endpointCandidates()
  for (const endpoint of endpoints) {
    try {
      const res = await agyFetch(`${endpoint}/v1internal:getOperation`, {
        method: 'POST',
        headers: antigravityHeaders(token),
        body,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      }, proxyUrl)
      if (res.ok) {
        return (await res.json().catch(() => null)) as OnboardResponse | null
      }
    } catch {
      // try next endpoint
    }
  }
  return null
}

/**
 * Ensure project ID is available:
 * 1. Check LRU cache
 * 2. loadCodeAssist
 * 3. If none, onboardUser + LRO polling
 * 4. Fallback to defaultProjectId(seed)
 */
export async function ensureProject(
  token: string,
  seedOrEmail = 'antigravity-default',
  proxyUrl?: string,
  customEndpoints?: string[],
): Promise<string> {
  const cached = projectCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId
  }

  // 1. Try loadCodeAssist
  const loaded = await loadCodeAssist(token, proxyUrl, customEndpoints)
  if (loaded) return loaded

  // 2. Try onboardUser
  try {
    let onboard = await onboardUser(token, 'TIER_FREE', proxyUrl, customEndpoints)
    if (onboard) {
      if (!onboard.done && onboard.name) {
        const opName = onboard.name
        for (let i = 0; i < 6; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
          const op = await getOperation(token, opName, proxyUrl, customEndpoints)
          if (op) {
            onboard = op
            if (op.done) break
          }
        }
      }
      const proj = onboard.response?.cloudaicompanionProject?.id || onboard.response?.project
      if (proj) {
        projectCache.set(token, { projectId: proj, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS })
        return proj
      }
    }
  } catch {
    // onboarding failed, fall back
  }

  // 3. Fallback to deterministic seed project ID
  const fallback = defaultProjectId(seedOrEmail)
  projectCache.set(token, { projectId: fallback, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS })
  return fallback
}

export function clearProjectCache(): void {
  projectCache.clear()
}

export function clearModelCache(): void {
  modelCache.clear()
}

export function antigravityRequestEnvelope(
  wireModelId: string,
  isClaude: boolean,
): { requestId: string; sessionId: string; labels: Record<string, string> } {
  const agentId = randomUUID()
  const trajectoryId = randomUUID()
  const step = 2
  const bytes = randomBytes(8)
  const sessionId = String(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true))
  const usageLabel = isClaude ? 'true' : 'false'
  const labels: Record<string, string> = {
    last_step_index: String(step - 1),
    trajectory_id: trajectoryId,
    used_claude: usageLabel,
    used_claude_conservative: usageLabel,
  }
  const modelEnum = ANTIGRAVITY_MODEL_ENUM[wireModelId]
  if (modelEnum) labels.model_enum = modelEnum
  return {
    requestId: `agent/${agentId}/${Date.now()}/${trajectoryId}/${step}`,
    sessionId,
    labels,
  }
}

/**
 * Execute streamGenerateContent against Google CloudCode PA endpoint with fallback.
 */
export async function streamGenerateContent(
  token: string,
  request: AntigravityGenerateRequest,
  signal?: AbortSignal,
  proxyUrl?: string,
  customEndpoints?: string[],
): Promise<{ response: Response; endpoint: string }> {
  const endpoints = customEndpoints && customEndpoints.length ? customEndpoints : endpointCandidates()
  const isClaude = request.model.startsWith('claude-')
  const headers: Record<string, string> = {
    ...antigravityHeaders(token),
    ...(isClaude ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {}),
  }
  const body = JSON.stringify(request)

  let lastResponse: Response | undefined
  let lastError: Error | undefined

  for (const endpoint of endpoints) {
    if (signal?.aborted) throw new Error('Request was aborted')
    try {
      const res = await agyFetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers,
        body,
        signal,
      }, proxyUrl)

      if (res.ok) {
        return { response: res, endpoint }
      }

      lastResponse = res
      // Don't fallback on 401/403 or non-retriable client errors except 404 (model endpoint not found)
      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 429) {
        return { response: res, endpoint }
      }
    } catch (err) {
      lastError = err as Error
      if (signal?.aborted) throw err
    }
  }

  if (lastResponse) {
    return { response: lastResponse, endpoint: endpoints[0] || DEFAULT_ENDPOINT }
  }
  throw lastError || new Error('All Google CloudCode endpoints failed to connect')
}
