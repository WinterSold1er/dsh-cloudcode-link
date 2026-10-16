# 插件 5H 额度与剩余时间逻辑代码走查报告

> **分析人员**：analyzer (静态与根因分析专家)  
> **走查日期**：2026-10-16  
> **分析对象**：`dsh-cloudcode-link` 插件前端渲染面板、后端配额采集与解析链路、本地持久化与数据流转

---

## 一、走查背景与目标

近期用户反馈两项关键异常体验：
1. **面板不显示 5H 额度的剩余时间**（没有倒计时或重置时间提示）；
2. **每次点击刷新或重新同步后，5H 额度数值保持不变**（百分比冻结）。

本报告通过自顶向下（从前端 UI 表现层到后端解析层、通信层及本地存储层）详细走查相关源码与历史变更，梳理出 5H 额度及重置时间的完整代码逻辑链路。

---

## 二、前端面板渲染逻辑走查 (`src/client/index.ts`)

### 1. 额度卡片渲染入口与结构
前端 UI 基于虚拟 DOM 库构建。在 `src/client/index.ts` 中，每个账号卡片通过 `renderAccountCards` 遍历渲染：

```typescript
// src/client/index.ts:1335-1340
h('div', { style: S.quotaBox },
    renderQuotaBar('Gemini', 'google', acc),
    renderQuotaBar('Claude', 'anthropic', acc),
    renderQuotaBar('GPT-OSS', 'openai', acc),
    // ...
)
```

每个账号卡片依次渲染三大家族（Gemini/google、Claude/anthropic、GPT-OSS/openai）的额度条。

### 2. 5H 额度百分比计算
在 `renderQuotaBar` 函数中：
```typescript
// src/client/index.ts:1134-1142
const renderQuotaBar = (label: string, familyKey: 'google' | 'anthropic' | 'openai', acc: ManagedAccount): unknown => {
    const info = acc.quotas[familyKey];
    const cd = acc.cooldowns[familyKey];
    const inCooldown = cd && cd.cooldownUntil > Date.now();

    // 5-Hour limit
    const has5h = typeof info?.remainingFraction === 'number' && Number.isFinite(info.remainingFraction);
    const pct5h = has5h ? Math.max(0, Math.min(100, Math.round(info!.remainingFraction! * 100))) : -1;
```
- 若 `info?.remainingFraction` 存在且为有效数字，则按 `Math.round(remainingFraction * 100)` 计算百分比 `pct5h`（范围 0~100）。
- 若不存在，则 `pct5h = -1`，UI 上展示为横杠 `'—'`。

### 3. 5H 剩余时间与重置倒计时计算
```typescript
// src/client/index.ts:1146-1147
const cdNote = inCooldown ? ' · 本地冷却中' : '';
const w5h = formatQuotaWindow(info?.resetTime);

// src/client/index.ts:1237
renderLine('5h 额度', pct5h, c5h, w5h.resetText ? w5h.resetText + cdNote : cdNote.replace(/^ · /, '')),
```
重置时间由核心函数 `formatQuotaWindow` 格式化：
```typescript
// src/client/index.ts:170-198
function formatQuotaWindow(resetTimeStr?: string): {
    resetText: string;
} {
    if (!resetTimeStr) return { resetText: '' };
    try {
        const d = new Date(resetTimeStr);
        const diffMs = d.getTime() - Date.now();
        if (diffMs <= 0) return { resetText: '' };

        const totalMins = Math.ceil(diffMs / 60000);
        const days = Math.floor(totalMins / 1440);
        const hours = Math.floor((totalMins % 1440) / 60);
        const mins = totalMins % 60;
        const isWeekly = days >= 1;

        const countdown = days > 0 ? `${days}d${hours}h` : hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
        const hh = d.getHours().toString().padStart(2, '0');
        const mm = d.getMinutes().toString().padStart(2, '0');
        const resetText = isWeekly
            ? `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm} (${countdown})`
            : `${hh}:${mm} (${countdown})`;

        return { resetText };
    } catch {
        return { resetText: '' };
    }
}
```

#### 关键隐藏分支分析：
在 `renderLine` 内部：
```typescript
// src/client/index.ts:1228
resetStr ? h('span', { style: { color: 'var(--agy-text-secondary)', fontSize: '11px', fontWeight: 500 } }, `↻ ${resetStr}`) : null,
```
1. **当 `info?.resetTime` 为 `undefined` 或空字符串时**：`formatQuotaWindow` 立即返回 `{ resetText: '' }`；
2. **当 `diffMs <= 0`（即重置时间点位于当前时间之前/已过期）时**：`formatQuotaWindow` 同样直接返回 `{ resetText: '' }`；
3. 当 `resetText` 为空且无本地冷却时，传入 `renderLine` 的 `resetStr` 为空字符串，三元表达式直接返回 `null`。
**结论**：前端只有在 `resetTime` 存在且其时间戳严格大于当前系统时间（未来时间）时，才会渲染倒计时文字 `↻ 15:25 (4h41m)`；一旦 `resetTime` 缺失或过期，面板上该文本完全不渲染。

### 4. 明细折叠面板（单模型明细）
当用户点击卡片右上角“明细”展开按钮时：
```typescript
// src/client/index.ts:1348-1361
allChildModels.map(({ family, model }) => {
    const frac = model.remainingFraction ?? 1;
    const pct = Math.round(frac * 100);
    const w = formatQuotaWindow(model.resetTime);
    // ...
    return h('div', { key: model.modelId, className: 'agy-submodel-row' },
        h('span', null, `[${family}] ${model.displayName || model.modelId}`),
        h('div', null,
            h('span', null, `${pct}%`),
            w.resetText ? h('span', null, `↻ ${w.resetText}`) : null,
        ),
    );
})
```
单模型明细读取的是 `acc.quotas[familyKey]?.models` 列表中的数据，每个模型各自携带 `remainingFraction` 与 `resetTime`。

### 5. 手动刷新触发入口
用户点击账号卡片上的“同步”按钮时：
```typescript
// src/client/index.ts:1074-1080
const refreshQuota = async (id?: string): Promise<void> => {
    setLoadingAction(id ? `refresh:${id}` : 'refresh:all');
    await postJson(`${API_PREFIX}/pool/refresh-quota`, { id });
    await refresh();
    setLoadingAction(null);
    showToast('额度已刷新', 'success');
};
```
该请求发送到后端 `/pool/refresh-quota`，并在完成后调用 `refresh()` 重新获取池数据重新渲染页面。

---

## 三、后端配额获取与解析链路走查

### 1. 数据模型与接口定义 (`packages/core/src/types/pool-types.ts`)
```typescript
export interface FamilyQuotaInfo {
  /** 5-hour rolling remaining quota fraction: 0.0 (exhausted) to 1.0 (full). */
  remainingFraction?: number
  /** ISO-8601 timestamp for when the 5-hour quota window resets. */
  resetTime?: string
  /** Weekly remaining quota fraction: 0.0 (exhausted) to 1.0 (full). */
  weeklyFraction?: number
  /** ISO-8601 timestamp for when the weekly quota resets. */
  weeklyResetTime?: string
  description?: string
  updatedAt?: number
  models?: ModelQuotaInfo[]
}
```

### 2. 路由分发 (`src/index.ts`)
```typescript
// src/index.ts:482-498
regBoth('pool/refresh-quota', (req, res) => {
    void (async () => {
        // ...
        if (id) {
            const acc = pool.getAccount(id)
            if (acc) await quota.refreshAccountQuota(acc, true)
        } else {
            await quota.refreshAllQuotas(true)
        }
        sendJson(res as RawRes, 200, { ok: true, pool: pool.getPoolData() })
    })()
})
```
前端点击“同步”后，执行 `quota.refreshAccountQuota(acc, true)`，其中 `force = true`，未传 `options`（即非 `summaryOnly` 模式）。

### 3. 上游端点与通信机制 (`packages/core/src/quota.ts` & `oauth.ts`)
后端向上游 Google Cloud Code / Antigravity 发送请求时，依赖以下端点列表：
```typescript
// packages/core/src/oauth.ts:38-43
export const AGY_ENDPOINTS: readonly string[] = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]
```
在 `QuotaService` 中维护了轮询偏好 `preferredEndpointIndex`（默认 0，即优先使用 `daily-cloudcode-pa.googleapis.com`）。
向上游发送两类请求：
1. **聚合配额摘要请求**：`POST ${endpoint}/v1internal:retrieveUserQuotaSummary`
2. **可用模型与模型级配额请求**：`POST ${endpoint}/v1internal:fetchAvailableModels`

### 4. 关键响应解析逻辑 (`packages/core/src/quota.ts:455-555`)
在 `refreshAccountQuota` 中：
```typescript
    const familyQuotas: Partial<Record<ModelFamily, FamilyQuotaInfo>> = {}

    // 步骤一：解析 summary.groups (retrieveUserQuotaSummary)
    if (summary && Array.isArray(summary.groups)) {
      for (const group of summary.groups) {
        const dName = (group.displayName || '').toLowerCase()
        const desc = (group.description || '').toLowerCase()
        const isGoogle = dName.includes('gemini') || desc.includes('gemini')
        const is3P = dName.includes('claude') || dName.includes('gpt') || desc.includes('claude') || desc.includes('gpt')

        const targetFamilies: ModelFamily[] = isGoogle
          ? ['google']
          : is3P
          ? ['anthropic', 'openai']
          : []

        let fiveHourFrac: number | undefined
        let fiveHourReset: string | undefined
        let weeklyFrac: number | undefined
        let weeklyReset: string | undefined

        for (const b of group.buckets || []) {
          const w = (b.window || b.bucketId || '').toLowerCase()
          if (w.includes('5h')) {
            fiveHourFrac = b.remainingFraction
            fiveHourReset = b.resetTime
          } else if (w.includes('weekly')) {
            weeklyFrac = b.remainingFraction
            weeklyReset = b.resetTime
          }
        }

        for (const fam of targetFamilies) {
          familyQuotas[fam] = {
            remainingFraction: fiveHourFrac,
            resetTime: fiveHourReset,
            weeklyFraction: weeklyFrac,
            weeklyResetTime: weeklyReset,
            description: group.description,
            updatedAt: now,
          }
        }
      }
    }
```

```typescript
    // 步骤二：解析 discovered.models (fetchAvailableModels)
    const familyModels: Partial<Record<ModelFamily, ModelQuotaInfo[]>> = {}
    if (discovered && discovered.models) {
      for (const [modelId, entry] of Object.entries(discovered.models)) {
        const fam = modelFamilyOf(modelId)
        if (fam === 'unknown') continue
        const remaining = entry.quotaInfo?.remainingFraction
        const resetTime = entry.quotaInfo?.resetTime

        if (typeof remaining !== 'number' || !Number.isFinite(remaining)) continue

        if (!familyModels[fam]) familyModels[fam] = []
        familyModels[fam]!.push({
          modelId,
          displayName: entry.displayName || modelId,
          remainingFraction: remaining,
          resetTime,
        })

        if (!familyQuotas[fam]) {
          familyQuotas[fam] = mergeFallbackFamilyQuota(account.quotas[fam], {
            remainingFraction: remaining,
            resetTime,
            updatedAt: now,
          })
        } else if (familyQuotas[fam]!.remainingFraction === undefined) {
          const curRemaining = familyQuotas[fam]!.remainingFraction ?? 1
          if (remaining < curRemaining) {
            familyQuotas[fam]!.remainingFraction = remaining
            familyQuotas[fam]!.resetTime = resetTime
          } else if (remaining === curRemaining) {
            if (resetTime && (!familyQuotas[fam]!.resetTime || Date.parse(resetTime) > Date.parse(familyQuotas[fam]!.resetTime!))) {
              familyQuotas[fam]!.resetTime = resetTime
            }
          }
        }
      }
    }
```

### 5. 发现的重大逻辑缺陷

#### 缺陷点 A：`mergeFallbackFamilyQuota` 存在反向阻断逻辑
查看该函数定义（`packages/core/src/quota.ts:19-24`）：
```typescript
export function mergeFallbackFamilyQuota(
  prev: FamilyQuotaInfo | undefined,
  fallback: FamilyQuotaInfo,
): FamilyQuotaInfo {
  if (prev && typeof prev.remainingFraction === 'number') return prev
  return fallback
}
```
**严重逻辑死锁**：
- 当 `retrieveUserQuotaSummary` 未返回指定家族（例如 Google Gemini），`familyQuotas['google']` 为空；
- 代码进入降级分支，准备使用 `fetchAvailableModels` 实时探测到的单模型配额作为兜底；
- 但是在调用 `mergeFallbackFamilyQuota(account.quotas['google'], fallback)` 时，如果本地缓存 `account.quotas['google']` 过去曾经存储过 `remainingFraction`（无论是一天前还是一个月前），该函数**强制返回旧的 `prev` 对象**，直接将最新的 `fallback` 丢弃！
- 这导致：
  1. **配额百分比永远停留在旧的 `prev.remainingFraction`**，上游即使变动，本地也永远无法刷新！
  2. **重置时间戳永远停留在旧的 `prev.resetTime`**，随着真实时间流逝，该时间戳变为过去时间（`diffMs <= 0`），导致前端 `formatQuotaWindow` 恒输出空串，5H 倒计时永久消失！

#### 缺陷点 B：`else if (familyQuotas[fam]!.remainingFraction === undefined)` 逻辑短路
在模型遍历循环中（行 527）：
- 当遍历到第 1 个 Gemini 模型时，`if (!familyQuotas[fam])` 执行，`familyQuotas['google']` 被赋值（无论是旧的 `prev` 还是新的 `fallback`，其 `remainingFraction` 都是数字）；
- 当遍历到第 2、3...N 个 Gemini 模型时，`!familyQuotas[fam]` 为假，进入 `else if` 分支；
- 但由于 `familyQuotas['google']!.remainingFraction` 已经是有效数字（不为 undefined），`else if` 条件恒为 `false`；
- **后续所有模型的配额比较逻辑（计算最小值 `remaining < curRemaining`）全部被短路跳过**。

#### 缺陷点 C：`refreshQuotaSummaryOnly` 无法覆盖 Google 家族
在 `src/host/adapter.ts:98` 中，每次会话启动前会调用 `refreshQuotaSummaryOnly(acc)`：
```typescript
// packages/core/src/quota.ts:560
async refreshQuotaSummaryOnly(account: ManagedAccount): Promise<Partial<Record<ModelFamily, FamilyQuotaInfo>> | null> {
    return this.refreshAccountQuota(account, true, { lightweight: true, summaryOnly: true })
}
```
当 `summaryOnly: true` 时，`fetchAvailableModels` 被完全跳过，仅请求 `retrieveUserQuotaSummary`。如果上游该接口没有 Gemini 组，日常会话中的被动刷新根本不会更新 Google 额度。

---

## 四、历史变更与演进记录分析 (git log / git diff)

### 1. `mergeFallbackFamilyQuota` 的历史渊源
通过 `git -C packages/core log -S mergeFallbackFamilyQuota -p` 及测试用例 `test/quota.test.ts:383`：
```typescript
test('mergeFallbackFamilyQuota keeps last-known-good data over partial fallback', () => {
  // Real incident shape: complete entry (5h + weekly) existed, then the
  // summary endpoint blipped and per-model fallback arrived carrying a
  // single window (fraction 1, weekly-window reset a week out, no weekly).
  const good: FamilyQuotaInfo = {
    remainingFraction: 0.84,
    resetTime: '2026-08-25T14:01:28Z',
    weeklyFraction: 0.47,
    weeklyResetTime: '2026-08-27T08:13:04Z',
    updatedAt: 1_000,
  }
  const partial = {
    remainingFraction: 1,
    resetTime: '2026-09-01T09:53:06Z',
    updatedAt: 2_000,
  }
  // Complete previous data wins — never clobbered by the partial shape.
  assert.equal(mergeFallbackFamilyQuota(good, partial), good)
  // ...
})
```
**历史设计意图**：
- 早期遇到过线上问题：`retrieveUserQuotaSummary` 偶发异常（网络抖动或上游临时缺失数据），而 `fetchAvailableModels` 只包含 5H 窗口数据（无周额度 `weeklyFraction`）；
- 开发者希望在“摘要接口临时抖动”时，不要用残缺的数据直接抹除账号已有的完整周额度；
- **但是该实现的致命缺陷在于**：它通过 `if (prev && typeof prev.remainingFraction === 'number') return prev` 做到了“全量拒绝更新”，从而将旧数据永久固化。正确的合并策略应当是“保留旧的 `weeklyFraction` 与 `weeklyResetTime`，但更新实时 5H 的 `remainingFraction`、`resetTime` 与 `updatedAt`”。

### 2. 上游端点差异与形态演进
对比 `research/reproduction/raw_upstream_dump_real.json` 中两个上游端点的实际返回：
1. **端点 1**：`https://daily-cloudcode-pa.googleapis.com` (Google 日常/金丝雀灰度环境，`AGY_ENDPOINTS[0]`)
   - `retrieveUserQuotaSummary` 响应中，`groups` 数组**只有 1 项**：`"Claude and GPT models"`（包含 `3p-weekly` 与 `3p-5h`）；
   - **完全移除了 `"Gemini Models"` 分组**！
   - 但其 `fetchAvailableModels` 中，全部 12+ 个 Gemini 模型均正常返回实时额度：
     `"quotaInfo": { "remainingFraction": 0.8424675, "resetTime": "2026-10-16T07:25:17Z" }`。
2. **端点 2**：`https://cloudcode-pa.googleapis.com` (现网稳定端点，`AGY_ENDPOINTS[1]`)
   - `retrieveUserQuotaSummary` 响应中，`groups` 数组**仍包含 2 项**：`"Gemini Models"` 与 `"Claude and GPT models"`。
3. **关键耦合**：
   由于 `AGY_ENDPOINTS` 默认将 `daily-cloudcode-pa.googleapis.com` 置于首位，只要首个端点返回 HTTP 200，系统便认为请求成功，从而直接采纳了缺少 Gemini 组的数据结构。

---

## 五、代码走查结论汇总

| 异常现象 | 直接代码原因 | 根本机制 |
|---|---|---|
| **不显示 5H 剩余时间/倒计时** | 前端 `src/client/index.ts:176` 中 `diffMs = resetTime - Date.now() <= 0` 判定为真，返回空字符串，触发 `renderLine` 的 `null` 隐藏逻辑。 | 后端 `packages/core/src/quota.ts:23` 的 `mergeFallbackFamilyQuota` 拒绝采纳上游返回的最新未来时间戳，导致存储的 `resetTime` 始终是过去的旧时间戳（已过期）。 |
| **5H 额度刷新数值不变** | 每次调用 `refreshAccountQuota` 时，`familyQuotas['google']` 被 `mergeFallbackFamilyQuota` 强制替换为旧的 `account.quotas['google']` 对象，刷新请求获取到的真实最新值被抛弃。 | 上游 `daily-cloudcode-pa` 的 `retrieveUserQuotaSummary` 不再包含 Gemini 分组，触发了存在严重设计漏洞的 fallback 合并函数。 |

本走查报告已全面阐明从 UI 判断到上游接口解析与历史设计缺陷的完整代码链路，为 Task-3 的根因定性与定量验证提供了确凿的代码依据。
