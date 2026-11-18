# T2 插件侧契约清点 — dsh-cloudcode-link

- 仓库：`/home/csy/Code/Github/dsh-cloudcode-link`
- HEAD：`03fd33c`（2026-10-16T16:32:45+08:00）
- 执行者：`t2-plugin`（worker-contract 子代理）
- 清点范围：`packages/core/src/**`（实际发包代码 `packages/core/package.json main=./dist/index.js`）、`src/**`、`package.json`、`cordis.patch.yml`、`packages/core/package.json`
- 方法：先用 vectr 定位（`vectr_status` 显示索引 46 文件 / 583 chunk），再用 `grep -n` 精确定位行号 + `read offset/limit` 逐行核对原文。**所有引文均来自本次读取的真实文件内容**，行号为当前 HEAD 实际行号。
- 交叉验证：`dist/index.js` 与 `packages/core/dist/index.js` 内均已确认烧入 `2.8.0` / `1.1.15` 字面量（见 §5），即源码结论与实际发包一致。

> 说明：本文件只做**清点与记录**，不含任何判断「谁对谁错」；与官方 agy 1.3.5 的差异请在 diff 环节比对。

---

## 1. `packages/core/src/client.ts`

### 1.1 端点候选数组

| 字段 | 插件值 | file:line | 备注 |
|---|---|---|---|
| 候选常量名 | `ENDPOINT_FALLBACKS`（不是 `endpointCandidates` 常量） | `packages/core/src/client.ts:7` | `export const ENDPOINT_FALLBACKS: readonly string[]` |
| 候选[0] | `https://cloudcode-pa.googleapis.com` | `client.ts:8`（`DEFAULT_ENDPOINT` 定义于 `client.ts:6`） | production |
| 候选[1] | `https://daily-cloudcode-pa.googleapis.com` | `client.ts:9` | daily |
| 候选[2] | `https://daily-cloudcode-pa.sandbox.googleapis.com` | `client.ts:10` | daily sandbox |
| 数组顺序 | 固定 production → daily → daily-sandbox | `client.ts:7-11` | 无运行时重排 |
| 取候选函数 | `endpointCandidates(customBaseUrl?)` | `client.ts:103-109` | 显式 baseUrl 或 `ANTIGRAVITY_BASE_URL` 命中时**只返回该单一 URL** |
| 每账号代理 | `agyFetch(url, init, proxyUrl)` 用 undici `ProxyAgent` | `packages/core/src/net.ts:7-17, 24-38` | 不追加任何 header，仅注入 `dispatcher` 与可选 `signal` |

```ts
// packages/core/src/client.ts:6-11
export const DEFAULT_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
export const ENDPOINT_FALLBACKS: readonly string[] = [
  DEFAULT_ENDPOINT,
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
]

// packages/core/src/client.ts:103-109
export function endpointCandidates(customBaseUrl?: string): string[] {
  const explicit = customBaseUrl?.trim() || process.env.ANTIGRAVITY_BASE_URL?.trim()
  if (explicit) {
    return [explicit.replace(/\/+$/, '')]
  }
  return [...ENDPOINT_FALLBACKS]
}
```

### 1.2 `defaultUserAgent` 完整值

| 字段 | 插件值 | file:line | 备注 |
|---|---|---|---|
| 模板 | `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})` | `client.ts:116` | 注意是 `hub` 命名空间，与 quota 的 `antigravity/<ver>` 不同 |
| version | `process.env.ANTIGRAVITY_HUB_VERSION \|\| '2.8.0'` | `client.ts:112` | **默认写死 2.8.0**，可被环境变量覆盖 |
| cl | `process.env.ANTIGRAVITY_HUB_CL \|\| '963137146'` | `client.ts:113` | 写死 963137146 |
| os | `darwin` \| `windows` \| `linux` | `client.ts:114` | `win32`→`windows`，其余取 `process.platform` 原值 |
| arch | `arm64` \| `x64` | `client.ts:115` | 只要不是 arm64 就一律 `x64` |
| 可见性 | `function`（非 export） | `client.ts:111` | 仅 `antigravityHeaders()` 内部使用 |

```ts
// packages/core/src/client.ts:111-117
function defaultUserAgent(): string {
  const version = process.env.ANTIGRAVITY_HUB_VERSION || '2.8.0'
  const cl = process.env.ANTIGRAVITY_HUB_CL || '963137146'
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`
}
```

### 1.3 `antigravityHeaders` 逐 key 清点

| # | header key | value | file:line |
|---|---|---|---|
| 1 | `Authorization` | `` `Bearer ${token}` `` | `client.ts:127` |
| 2 | `Content-Type` | `application/json` | `client.ts:128` |
| 3 | `Accept` | `text/event-stream`（**对全部 5 类调用都设了**，含非流式 RPC） | `client.ts:129` |
| 4 | `User-Agent` | `defaultUserAgent()` → §1.2 | `client.ts:130` |
| 5 | `X-Goog-Api-Client` | `google-cloud-sdk vscode_cloudshelleditor/0.1` | `client.ts:131` |
| 6 | `Client-Metadata` | `JSON.stringify({ ideType:'ANTIGRAVITY', platform:<PLATFORM_*>, pluginType:'GEMINI' })`，key 顺序固定 | `client.ts:132-136` |

| 字段 | 插件值 | file:line |
|---|---|---|
| `Client-Metadata.ideType` | `ANTIGRAVITY` | `client.ts:133` |
| `Client-Metadata.platform` | `PLATFORM_DARWIN` \| `PLATFORM_WINDOWS` \| `PLATFORM_LINUX` | `client.ts:120-125` |
| `Client-Metadata.pluginType` | `GEMINI` | `client.ts:135` |

```ts
// packages/core/src/client.ts:119-138
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
```

> 注意：`loadCodeAssist` / `onboardUser` / `getOperation` / `listCloudAICompanionProjects` 的 **header** 里 platform 是真实平台，但它们的 **body.metadata.platform** 写死 `PLATFORM_UNSPECIFIED`（`client.ts:240`、`client.ts:300`）。同一请求内两处 platform 取值不一致。

### 1.4 `streamGenerateContent` 请求构造

| 字段 | 插件值 | file:line | 备注 |
|---|---|---|---|
| URL 模板 | `` `${endpoint}/v1internal:streamGenerateContent?alt=sse` `` | `client.ts:465` | host 来自候选列表；path `/v1internal:streamGenerateContent`；**唯一 query 参数 `alt=sse`** |
| method | `POST` | `client.ts:466` | SSE |
| header 集合 | `antigravityHeaders(token)` + 条件 `anthropic-beta: interleaved-thinking-2025-05-14`（仅当 `request.model.startsWith('claude-')`） | `client.ts:452-456` | 即 §1.3 的 6 个 header，DeepSeek/Claude 分支多 1 个 |
| body | `JSON.stringify(request)`，无任何二次包装 | `client.ts:457` | 直接序列化 `AntigravityGenerateRequest` |
| 超时 | `timeoutMs: null` → 不设超时（流式） | `client.ts:470` | `net.ts:26-31` 对 `streamGenerateContent` 默认也是 0 |
| 返回 | `{ response, endpoint }` | `client.ts:450, 474` | `endpoint` 用于错误归因 |

```ts
// packages/core/src/client.ts:444-491
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
        timeoutMs: null,
      }, proxyUrl)

      if (res.ok) {
        return { response: res, endpoint }
      }

      lastResponse = res
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
```

### 1.5 请求 body（顶层 key / model / project / request 包装）

类型定义（6 个顶层 key，全部必填）：

```ts
// packages/core/src/client.ts:94-101
export interface AntigravityGenerateRequest {
  project: string
  model: string
  request: GeminiRequestBody
  requestType: 'AGENT'
  userAgent: 'ANTIGRAVITY'
  requestId: string
}
```

实际构造点（正式对话路径，`packages/core/src/adapter.ts`；`src/host/adapter.ts:403-427` 是同一份逻辑的宿主副本）：

```ts
// packages/core/src/adapter.ts:311-332
const requestBody: AntigravityGenerateRequest = {
  project: projectId,
  model: wireModel,
  request: {
    contents,
    ...(projection.systemInstruction
      ? { systemInstruction: projection.systemInstruction }
      : {}),
    generationConfig: {
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
    ...(convertedTools ? { tools: convertedTools } : {}),
    ...(convertedTools ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
    sessionId: envelope.sessionId,
    labels: envelope.labels,
  },
  requestType: 'AGENT',
  userAgent: 'ANTIGRAVITY',
  requestId: envelope.requestId,
}
```

| body 字段 | 取值来源 | file:line |
|---|---|---|
| `project`（顶层） | `await ensureProject(token, account?.alias \|\| account?.id \|\| 'antigravity-default', proxyUrl, customEndpoints)` | `adapter.ts:304-312`；`src/host/adapter.ts:396-404`；`oneshot.ts:139-147` |
| `model`（顶层） | `wireModel = resolveModelSlug(model)`，已是上游 wire slug | `adapter.ts:82`、`adapter.ts:313` |
| `request.contents` | `message-converter.ts` 投影结果（角色/parts） | `adapter.ts:315` |
| `request.systemInstruction` | `projection.systemInstruction = { parts: [{ text }] }`，仅当存在 system/developer 文本 | `message-converter.ts:617`、`adapter.ts:316-318` |
| `request.generationConfig` | 仅在有值时出现 `temperature` / `maxOutputTokens` / `thinkingConfig` | `adapter.ts:319-323` |
| `request.tools` / `request.toolConfig` | FunctionDeclaration 数组 + `{functionCallingConfig:{mode:'AUTO'}}`（`schema-converter.ts` 产出） | `adapter.ts:324-325` |
| `request.sessionId` | `envelope.sessionId` = `fnv1a64Signed(options.sessionId ?? trajectoryId)`，64-bit 有符号十进制字符串 | `client.ts:424`、`sessions.ts:32-41` |
| `request.labels` | `{ last_step_index, trajectory_id, used_claude, used_claude_conservative, model_enum? }` | `client.ts:426-433` |
| `requestType` | 常量 `'AGENT'` | `adapter.ts:329` |
| `userAgent` | 常量 `'ANTIGRAVITY'`（body 字段，与 header 的 UA 无关） | `adapter.ts:330` |
| `requestId` | `` agent/${trajectoryId}/${step} `` | `client.ts:435` |

信封构造原文：

```ts
// packages/core/src/client.ts:417-439
export function antigravityRequestEnvelope(
  wireModelId: string,
  isClaude: boolean,
  options?: EnvelopeOptions,
): { requestId: string; sessionId: string; labels: Record<string, string> } {
  const trajectoryId = options?.trajectoryId ?? randomUUID()
  const step = options?.step ?? 1
  const wireSessionId = options?.sessionId ? fnv1a64Signed(options.sessionId) : fnv1a64Signed(trajectoryId)
  const usageLabel = isClaude ? 'true' : 'false'
  const labels: Record<string, string> = {
    last_step_index: String(step),
    trajectory_id: trajectoryId,
    used_claude: usageLabel,
    used_claude_conservative: usageLabel,
  }
  const modelEnum = ANTIGRAVITY_MODEL_ENUM[wireModelId]
  if (modelEnum) labels.model_enum = modelEnum
  return {
    requestId: `agent/${trajectoryId}/${step}`,
    sessionId: wireSessionId,
    labels,
  }
}
```

> **关键差异点（供 diff）**：插件出站 body 的 project 字段名是 `project`（`client.ts:95`、`adapter.ts:312`），**全仓出站请求中不存在 `cloudaicompanionProject` 这个 key**；`cloudaicompanionProject` 只出现在**响应解析**里（`client.ts:167` 的 `extractProjectId`、`client.ts:279,387` 的 `onboard.response.cloudaicompanionProject?.id`）。

### 1.6 429 / 404 重试与冷却（精确到行）

| 状态码 | 行为 | file:line |
|---|---|---|
| `401 / 403 / 400 / 429` | **立即 return 当前响应，不尝试下一候选** | `client.ts:478-480` |
| 其他非 2xx（含 **404**、5xx） | 记录 `lastResponse` 后 **继续循环 → 切换下一候选端点** | `client.ts:477`（赋值）+ `client.ts:478`（未命中即继续） |
| 网络异常（含超时） | 记 `lastError`，继续下一候选；若已 abort 则抛出 | `client.ts:481-484` |
| 全部失败但有响应 | 返回 `lastResponse`，但 `endpoint` 报成 `endpoints[0]`（**实际失败的是最后一个候选，归因不准**） | `client.ts:487-489` |
| 全部失败且无响应 | `throw lastError ?? 'All Google CloudCode endpoints failed to connect'` | `client.ts:490` |

429 的账号级冷却（上层 `adapter.ts`，不在 client.ts）：

| 行为 | file:line |
|---|---|
| 读 `retry-after` 头 | `adapter.ts:367` |
| `pool.recordFailure(account.id, family, errText, resetHeader)` 写入冷却 | `adapter.ts:368-370` |
| 若尚未 yield 且 `attempt < maxAttempts` → `continue` **换账号**（不是换端点） | `adapter.ts:371-374` |
| 401/403 → `pool.markAuthRequired` 后换账号 | `adapter.ts:375-382` |
| 最终失败时 yield `finish`+`RATE_LIMIT` / `API_ERROR` | `adapter.ts:384-394` |
| 全池耗尽文案 | `adapter.ts:463` |

---

## 2. `packages/core/src/quota.ts`

### 2.1 `agyUserAgent('1.1.15')`

| 字段 | 插件值 | file:line | 备注 |
|---|---|---|---|
| 函数签名 | `export function agyUserAgent(version = '1.1.15'): string` | `quota.ts:62` | **版本号写在默认参数里**，是硬编码 |
| 模板 | `` antigravity/${version} ${os}/${arch} `` | `quota.ts:65` | 与 client.ts 的 `antigravity/hub/...` 是两套完全不同的 UA 形态 |
| os | `win32`→`windows`，否则 `process.platform` 原值（`linux`/`darwin`） | `quota.ts:63` | 无 `os_type=` 前缀 |
| arch | `x64`→`amd64`，否则 `process.arch` 原值（`arm64`） | `quota.ts:64` | 与 client.ts 的 `arch=x64` 不同（amd64） |
| 调用点 A | `quota.ts:338`（`fetchQuotaSummary` → `POST ${endpoint}/v1internal:retrieveUserQuotaSummary`） | 无参调用 → **恒为 1.1.15** |
| 调用点 B | `quota.ts:366`（`fetchAvailableModels` → `POST ${endpoint}/v1internal:fetchAvailableModels`） | 无参调用 → **恒为 1.1.15** |
| 其它调用点 | 无（`grep -rn "agyUserAgent" packages/core/src` 仅 3 条：62/338/366） | — |

```ts
// packages/core/src/quota.ts:62-66
export function agyUserAgent(version = '1.1.15'): string {
  const os = process.platform === 'win32' ? 'windows' : process.platform
  const arch = process.arch === 'x64' ? 'amd64' : process.arch
  return `antigravity/${version} ${os}/${arch}`
}
```

### 2.2 配额请求的 URL / headers / body

| 请求 | URL | method | headers | body | file:line |
|---|---|---|---|---|---|
| 配额汇总 | `` `${endpoint}/v1internal:retrieveUserQuotaSummary` `` | POST | `Authorization: Bearer <token>`、`Content-Type: application/json`、`User-Agent: agyUserAgent()` — **仅 3 个 header** | `{}` | `quota.ts:333-341` |
| 可用模型 | `` `${endpoint}/v1internal:fetchAvailableModels` `` | POST | 同上 3 个 | `{}` | `quota.ts:361-369` |
| userinfo | `OAUTH_USERINFO_URL` | GET（未写 method，默认 GET） | 仅 `Authorization` | 无 | `quota.ts:307-309` |

```ts
// packages/core/src/quota.ts:328-354
async fetchQuotaSummary(accessToken: string, proxyUrl?: string): Promise<QuotaSummaryResponse | null> {
  const endpoints = this.getOrderedEndpoints()
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i]!
    try {
      const res = await agyFetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': agyUserAgent(),
        },
        body: JSON.stringify({}),
      }, proxyUrl)
      if (res.ok) {
        this.preferredEndpointIndex = AGY_ENDPOINTS.indexOf(endpoint)
        return (await res.json()) as QuotaSummaryResponse
      }
      if (res.status === 401 || res.status === 403) {
        break
      }
    } catch {
      // Try next endpoint
    }
  }
  return null
}
```

| 差异点 | client.ts 生成路径 | quota.ts 配额路径 |
|---|---|---|
| UA | `antigravity/hub/2.8.0 (aidev_client; os_type=…; arch=x64; cl=963137146)` | `antigravity/1.1.15 linux/amd64` |
| `X-Goog-Api-Client` | 有 | **无** |
| `Client-Metadata` | 有 | **无** |
| `Accept: text/event-stream` | 有（含非流式 RPC） | **无** |
| 候选端点集合 | 3 个（`client.ts:7-11`） | **4 个**（`oauth.ts:42-47`，多 `autopush-cloudcode-pa.sandbox.googleapis.com`） |
| 候选顺序 | 固定 | 按 `preferredEndpointIndex` **轮转**（`quota.ts:319-326`） |

---

## 3. project 发现链路

### 3.1 全链路

```ts
// packages/core/src/client.ts:357-401（注释 + 主干）
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
```

| 步骤 | 实现 | 端点 | file:line |
|---|---|---|---|
| 0 | 进程内 LRU（key=accessToken，TTL 30min，上限 32 条，命中即刷新 LRU 位置） | — | `client.ts:13-14`、`client.ts:228-235`、`client.ts:261-265` |
| 1 | **`loadCodeAssist` 已实现** | `POST {endpoint}/v1internal:loadCodeAssist` | `client.ts:222-273`（请求 `client.ts:248`） |
| 1b | `loadCodeAssist` 响应里取不到 project 时，回退调用 **`listCloudAICompanionProjects`** | `POST {endpoint}/v1internal:listCloudAICompanionProjects`，body `{}` | `client.ts:194-217`；调用点 `client.ts:256-259` |
| 2 | **`onboardUser` 已实现**，`tierId` 固定 `TIER_FREE` | `POST {endpoint}/v1internal:onboardUser` | `client.ts:290-322`；调用点 `client.ts:374` |
| 2b | **`getOperation` 已实现**，LRO 轮询 **6 次 × 2s** | `POST {endpoint}/v1internal:getOperation`，body `{ "name": "<opName>" }` | `client.ts:324-348`；调用点 `client.ts:378-386` |
| 3 | 兜底：`defaultProjectId(seed)` = 环境变量 `ANTIGRAVITY_PROJECT_ID` 优先，否则 `stableProjectId(seed)`（`sha1("antigravity:"+seed)` 取前 16 字节，改写为类 UUIDv5 形态） | 无网络 | `client.ts:140-150`、`client.ts:397-400` |
| seed 来源 | `account?.alias \|\| account?.id \|\| 'antigravity-default'` | — | `adapter.ts:306`、`src/host/adapter.ts:398`、`oneshot.ts:141` |

### 3.2 `loadCodeAssist` 请求体 & 响应解析

```ts
// packages/core/src/client.ts:237-253
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
```

`extractProjectId` 的字段优先级（响应侧，非请求侧）：

```ts
// packages/core/src/client.ts:160-192
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
  // …（对象/数组递归 + projects / projectIds / cloudaicompanionProjects 三个数组键）
}
```

### 3.3 与官方 `cloudaicompanionProject` 的异同（仅插件侧事实）

| 项 | 插件事实 | file:line |
|---|---|---|
| 出站生成请求里的 project key 名 | **`project`**（不是 `cloudaicompanionProject`） | `client.ts:95`、`adapter.ts:312`、`oneshot.ts:147`、`src/host/adapter.ts:404` |
| 出站 `loadCodeAssist` body | 只有 `metadata`，**不带 project 字段** | `client.ts:237-243` |
| 出站 `onboardUser` body | `{ tierId, metadata }`，**不带 project 字段** | `client.ts:296-303` |
| 入站解析 | 认 `cloudaicompanionProject`（含 `userDefinedCloudaicompanionProject`、`cloudaicompanionProjects[]`）作为 project 来源之一 | `client.ts:166-167`、`client.ts:176`、`client.ts:279-281`、`client.ts:387` |
| `OnboardResponse` 形状 | `{ done?, name?, response?: { cloudaicompanionProject?: { id? }, project?: string }, error?: {code?,message?} }` | `client.ts:275-288` |

### 3.4 pool.json / config / 环境变量

| 通道 | 是否承载 cloud project | 证据 |
|---|---|---|
| `pool.json`（账号记录 `ManagedAccount`） | **否**：字段只有 `id / alias / email? / dir / systemHome? / proxyUrl? / enabled / pinned? / createdAt / lastUsedAt? / authRequired? / authError? / 冷却状态`，**无 project 字段** | `packages/core/src/types/pool-types.ts:48-73`；`grep -n "projectId" packages/core/src/pool.ts` → 零命中 |
| 配置对象 `CoreConfig` | **否**：`defaultConfig()` 只有 `enabled / defaultModel / defaultEffort / timeoutMs / baseUrl / endpointCandidates / heartbeatEnabled / heartbeatIntervalMs / logRetentionDays` | `config-types.ts:106-118` |
| 环境变量 `ANTIGRAVITY_PROJECT_ID` | **是**：仅在兜底路径生效（优先级低于 loadCodeAssist/onboardUser） | `client.ts:148-150` |

---

## 4. header 全集差异

### 4.1 源码中真实存在的 header（唯一权威范围：`packages/core/src` + `src`，`*.ts`）

| header | 是否发送 | 位置 | 取值 |
|---|---|---|---|
| `Authorization` | 是 | `client.ts:127`、`quota.ts:308/336/364`、`oauth.ts` 内 | `Bearer <token>` |
| `Content-Type` | 是 | `client.ts:128`、`quota.ts:337/365` | `application/json` |
| `Accept` | 是（仅生成路径） | `client.ts:129` | `text/event-stream` |
| `User-Agent` | 是 | `client.ts:130`、`quota.ts:338/366` | 见 §1.2 / §2.1 |
| `X-Goog-Api-Client` | 是（仅生成/发现路径） | `client.ts:131` | `google-cloud-sdk vscode_cloudshelleditor/0.1` |
| `Client-Metadata` | 是（仅生成/发现路径） | `client.ts:132-136` | JSON（ideType/platform/pluginType） |
| `anthropic-beta` | 条件发送（`claude-*` 模型） | `client.ts:455` | `interleaved-thinking-2025-05-14` |

### 4.2 插件**未发送**的 header + 零命中证据

检索范围：仓库根（`--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`），`-i` 忽略大小写。
**源码子集**（`--include=*.ts --include=*.json --include=*.yml packages/core/src src cordis.patch.yml`）为「是否发送」的判定依据；仓库全量命中一律落在 `ops/diag/**`、`research/**`、`test/**` 等**非发包**诊断脚本与日志里。

| header | 源码命中数 | 零命中证据命令（本次实跑） |
|---|---|---|
| `x-client-*`（任意） | **0** | `grep -rni "x-client" --include=*.ts --include=*.json --include=*.yml packages/core/src src cordis.patch.yml \| wc -l` → `0` |
| `x-cloudaicompanion-*`（任意） | **0** | `grep -rni "x-cloudaicompanion" --include=*.ts --include=*.json --include=*.yml packages/core/src src cordis.patch.yml \| wc -l` → `0` |
| `x-cloudaicompanion-project` | **0** | `grep -rn --exclude-dir=node_modules --exclude-dir=dist -i "x-cloudaicompanion-project" . \| wc -l` → `0` |
| `x-goog-user-project` | **0** | `grep -rn --exclude-dir=node_modules --exclude-dir=dist -i "x-goog-user-project" . \| wc -l` → `0` |
| `x-antigravity-*` | **0** | `grep -rn --exclude-dir=node_modules --exclude-dir=dist -i "x-antigravity" . \| wc -l` → `0` |
| `x-stainless-*` | **0** | `grep -rn --exclude-dir=node_modules --exclude-dir=dist -i "x-stainless" . \| wc -l` → `0` |
| `x-request-id` | **0**（源码） | 仓库全量 1 条，位于 `ops/diag/**` 日志，非发包代码 |
| `x-goog-*` | 仅 **`X-Goog-Api-Client` 1 条** | `grep -rni "x-goog" --include=*.ts packages/core/src src` → 唯一命中 `client.ts:131` |
| `client-metadata` | 仅 **1 条**（= `Client-Metadata`） | `grep -rni "client-metadata" --include=*.ts packages/core/src src \| wc -l` → `1` |

仓库全量对照（说明「全量命中 ≠ 插件发送」）：

```
$ grep -rn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git -i -- "x-cloudaicompanion" . | awk -F: '{print $1}' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
     43 ./research/reproduction
     34 ./ops/diag
      4 ./research/live
```

```
$ grep -rn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git -i -- "x-goog" . | awk -F: '{print $1}' | sort | uniq -c
      1 ./ops/diag/endpoint-ab-2026-10-16T08-41-07-515Z.log
      2 ./ops/diag/t1-live.mts
      1 ./ops/diag/t3-endpoint-contract-2026-10-17T16-11-32-229Z.log
      1 ./ops/diag/t3-endpoint-contract-2026-10-17T16-13-53-511Z.log
      4 ./ops/diag/t3-endpoint-contract.analysis.md
      1 ./ops/diag/t3-endpoint-contract.mts
      1 ./packages/core/src/client.ts
      1 ./research/live/probe2.mjs
      1 ./research/live/probe3.mjs
      1 ./research/live/probe4-rootfix.mjs
      1 ./research/live/probe.mjs
```

上游调用面收敛性核对（确认没有「绕过 agyFetch 私自加头」的旁路）：

```
$ grep -rn "agyFetch(" --include=*.ts packages/core/src src | grep -v "net.ts"
packages/core/src/client.ts:202   listCloudAICompanionProjects
packages/core/src/client.ts:248   loadCodeAssist
packages/core/src/client.ts:308   onboardUser
packages/core/src/client.ts:334   getOperation
packages/core/src/client.ts:465   streamGenerateContent
packages/core/src/quota.ts:307    OAUTH_USERINFO_URL
packages/core/src/quota.ts:333    retrieveUserQuotaSummary
packages/core/src/quota.ts:361    fetchAvailableModels
packages/core/src/oauth.ts:94     OAUTH_TOKEN_URL
packages/core/src/oauth.ts:141    OAUTH_USERINFO_URL
```

`net.ts` 的 `agyFetch` 只注入 `dispatcher`（代理）与 `signal`，**不追加任何 header**（`net.ts:33-38`）。即：出站 header 集合完全由上面 10 个调用点的显式 `headers` 决定，不存在隐式注入。

---

## 5. 版本常量

| 载体 | version | file:line | 与 UA `1.1.15` 的关系 |
|---|---|---|---|
| `packages/core/package.json` | `0.1.1` | 第 3 行 | 与 UA 版本**无关**；`0.1.1` 是包版本 |
| 根 `package.json`（dsh 插件包 `dsh-cloudcode-link`） | `0.1.1` | 第 3 行 | 同上 |
| 插件 manifest `cordis.patch.yml` | **无 version 字段**；只有 `id: cloudcode-link`、`name: 'dsh-cloudcode-link'` | `cordis.patch.yml:5-6` | manifest 不参与 UA |
| 生成路径 UA 版本 | `2.8.0`（env `ANTIGRAVITY_HUB_VERSION` 可覆盖） | `client.ts:112` | **硬编码字面量** |
| 生成路径 UA `cl` | `963137146`（env `ANTIGRAVITY_HUB_CL` 可覆盖） | `client.ts:113` | 硬编码 |
| 配额路径 UA 版本 | `1.1.15`（**无 env 覆盖**，只是默认参数） | `quota.ts:62` | **硬编码**，两处调用都不传参 → 恒定 |
| 发包产物核验 | `dist/index.js` 与 `packages/core/dist/index.js` 均含 `1.1.15`、`2.8.0`、`antigravity/hub/${version}`、`X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"` | — | 源码结论与实际发包一致 |

结论：UA 里出现的 `1.1.15` 与 `2.8.0` **都不是从 package.json 读取**，而是源码字面量；包版本 `0.1.1` 与 UA 版本无任何联动。

---

## 6. 端点候选 ↔ 官方 host，以及 429 时候选切换

### 6.1 候选集合对照

| 语义 | 生成/发现路径（`client.ts:7-11`） | 配额路径（`oauth.ts:42-47`） |
|---|---|---|
| production | `https://cloudcode-pa.googleapis.com` ✅ | `https://cloudcode-pa.googleapis.com` ✅ |
| daily | `https://daily-cloudcode-pa.googleapis.com` ✅ | `https://daily-cloudcode-pa.googleapis.com` ✅ |
| sandbox（daily） | `https://daily-cloudcode-pa.sandbox.googleapis.com` ✅ | `https://daily-cloudcode-pa.sandbox.googleapis.com` ✅ |
| sandbox（autopush） | **缺** | `https://autopush-cloudcode-pa.sandbox.googleapis.com` ✅ |

```ts
// packages/core/src/oauth.ts:42-47
export const AGY_ENDPOINTS: readonly string[] = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]
```

另：`packages/core/src/types/config-types.ts:120-124` 又定义了一份 `DEFAULT_ENDPOINT_CANDIDATES`（同样 3 条，同样顺序），仅用作 `defaultConfig().endpointCandidates` 的默认值；真实请求路径优先读 `customEndpoints`，否则回落 `endpointCandidates()`（`client.ts:103-109`）。

### 6.2 429 时是否继续尝试下一候选？

**不会。** 生成路径在 `client.ts:478-480` 对 429 直接 `return { response, endpoint }`，此时 `for (const endpoint of endpoints)` 循环被提前退出，**不再尝试 daily / sandbox**。上层 `adapter.ts:366-374` 的 429 处理是**换账号**（`continue` 到下一 attempt）而不是换端点。

**404 则会继续**：404 不在提前 return 名单里（名单只有 401/403/400/429），因此会落到 `lastResponse` 并进入下一次循环 → 尝试下一候选端点。这正是 T3 实测中「daily / sandbox 返回 404」会继续往下打的原因；三候选全部非 2xx 时，返回的 `endpoint` 字段被错误标注为 `endpoints[0]`（`client.ts:488`），排障时需注意。

对比：配额路径的候选切换是**任何失败都继续**，且会记住成功的 `preferredEndpointIndex` 做下次轮转起点（`quota.ts:319-326`、`quota.ts:342-344`），仅 401/403 才 `break`（`quota.ts:346-348`、`quota.ts:374-376`）。

---

## 附：关键函数原文（完整）

### A. `client.ts` 生成请求 body 构造（`adapter.ts:311-332`）
见 §1.5 原文块（已全量贴出，含 `request.tools` / `toolConfig` / `sessionId` / `labels`）。

### B. `client.ts` 信封（`client.ts:417-439`）
见 §1.5 原文块。

### C. `client.ts` 主循环（`client.ts:444-491`）
见 §1.4 原文块。

### D. `quota.ts` UA 与调用点（`quota.ts:62-66, 333-341, 361-369`）
见 §2.1 / §2.2 原文块。

### E. `client.ts` 项目发现（`client.ts:357-401`）
见 §3.1 原文块。

---

## 总结（约 260 字）

插件对上游的请求面被收敛得很干净：全部 10 处上游调用都走 `net.ts` 的 `agyFetch`，无隐式 header，出站 header 只有 6 个基础头（Authorization / Content-Type / Accept / User-Agent / X-Goog-Api-Client / Client-Metadata），Claude 模型额外加 `anthropic-beta`。存在**两套互相不一致的 UA**：生成路径是 `antigravity/hub/2.8.0 (aidev_client; os_type=…; arch=x64; cl=963137146)`，配额路径是 `antigravity/1.1.15 <os>/<arch-amd64>`，且后者不带 `X-Goog-Api-Client` 与 `Client-Metadata`——这是与官方二进制 diff 时最可能对不齐的地方。请求 body 顶层 6 个 key（project / model / request / requestType / userAgent / requestId），project 字段名是 `project`，`cloudaicompanionProject` 只出现在响应解析；project 发现实现了 loadCodeAssist + listCloudAICompanionProjects + onboardUser + getOperation 全链路，最终兜底为 sha1 派生的确定性 UUID 或 `ANTIGRAVITY_PROJECT_ID`。三端点候选顺序 production→daily→daily-sandbox；**429 直接返回、不切下一候选**（切的是账号），而 404 会继续切下一候选并在全败时把 endpoint 误标为 first candidate。版本号 `1.1.15`/`2.8.0` 均为源码字面量，与包版本 0.1.1 无联动。
