# 插件 5H 额度与剩余时间异常根因分析报告

> **报告编号**：RC-20261016-01  
> **报告人员**：analyzer (静态与根因分析专家)  
> **联合验证**：reproducer (现场 E2E 复现专员)  
> **日期**：2026-10-16  
> **状态**：已定性与定量闭环验证

---

## 目录
1. [执行摘要 (Executive Summary)](#1-执行摘要)
2. [故障现象与现场复现](#2-故障现象与现场复现)
3. [整体架构与数据流向](#3-整体架构与数据流向)
4. [核心根因深度拆解](#4-核心根因深度拆解)
   - [问题一：为什么面板不显示 5H 额度剩余时间（倒计时）？](#41-问题一为什么面板不显示-5h-额度剩余时间)
   - [问题二：为什么 5H 额度每次刷新后数值保持不变？](#42-问题二为什么-5h-额度每次刷新后数值保持不变)
   - [关联机制：Google 上游 API 架构调整与灰度端点触发源](#43-关联机制google-上游-api-架构调整与灰度端点触发源)
5. [现场抓包与实测证据矩阵](#5-现场抓包与实测证据矩阵)
6. [修复方案与代码整改建议](#6-修复方案与代码整改建议)

---

## 1. 执行摘要

针对用户反馈的 **“插件 5H 额度面板不显示剩余时间”** 以及 **“每次点击刷新后 5H 额度数值保持不变”** 两大问题，分析团队结合前端 UI、后端配额服务、本地持久化数据库及现场捕获的 Google Cloud Code PA 上游 HTTP 原始报文进行了全链路分析。

**核心结论如下**：
1. **Google 上游 API 行为变化触发了本地隐藏设计缺陷**：Google PA 在其日常灰度端点 `daily-cloudcode-pa.googleapis.com`（插件端点列表的首选）的 `v1internal:retrieveUserQuotaSummary` 响应中，**已正式下线/移除了 `Gemini Models` 分组**（仅保留了 3P 模型的 `Claude and GPT models` 组）。所有 Gemini 模型的 5H 配额和重置时间已完全转为在 `v1internal:fetchAvailableModels` 中以单模型 `quotaInfo` 形式返回。
2. **5H 额度刷新数值不变的根本原因**：后端 `packages/core/src/quota.ts` 中的合并兜底函数 `mergeFallbackFamilyQuota` 存在严重的“逆向阻断”逻辑漏洞。当 `retrieveUserQuotaSummary` 缺失 Gemini 组而触发模型级配额兜底时，该函数检测到本地账号在过去已存在 `remainingFraction`（如昨日保存的 `0.2681512`），便**直接返回旧数据对象，彻底把上游实时抓取到的最新额度（如 `0.95993334`）丢弃**。导致本地内存和持久化存储中的 5H 额度永久冻结在历史数值上。
3. **5H 剩余时间（倒计时）不显示的根本原因**：同样由于上述 `mergeFallbackFamilyQuota` 缺陷，本地保存的 `resetTime` 始终是历史旧时间戳（例如 `2026-10-15T12:07:40Z`）。随着现实时间推进到 10 月 16 日，该重置时间早已经过期；前端面板组件在 `src/client/index.ts:176` 计算时间差 `diffMs = resetTime - Date.now() <= 0` 判定该重置时间已失效，从而直接格式化为空字符串并在虚拟 DOM 中渲染为 `null`，导致倒计时组件彻底消失。

---

## 2. 故障现象与现场复现

在当前真实运行的 DSH Web 环境与 `~/.dsh/agy-accounts/pool.json` 账号池中，观察到以下确定现象：

| 检查项 | 现场实际表现 | 预期正常表现 |
|---|---|---|
| **Gemini 5H 额度剩余时间** | 面板上只有百分比（如 `27%`），右侧没有显示任何 `↻ HH:MM (倒计时)` 文本 | 应当显示重置时间点与剩余倒计时，例如 `↻ 15:25 (4h41m)` |
| **Gemini 周额度剩余时间** | 正常显示周重置倒计时，例如 `↻ 10/21 10:23 (4d15h)` | 正常显示 |
| **Claude / GPT 5H 额度** | 正常显示 5H 重置时间，例如 `↻ 15:38 (4h54m)` | 正常显示 |
| **点击“同步”刷新账号** | 触发 `POST /pool/refresh-quota` 成功（HTTP 200），但 Gemini 额度百分比依然是 `27%`，毫厘未动 | 应当同步上游最新浮点数（实际实时值已恢复至 `96%`） |

现场对比数据已固化在 `research/reproduction/refresh-comparison.json` 中：
`acc_1788785623927_xhs7n` 在点击刷新前后，其 `google` 额度对象的 `remainingFraction` 恒定为 `0.2681512`，`resetTime` 恒定为 `2026-10-15T12:07:40Z`，`updatedAt` 恒定为 `1792057950309`（2026-10-15 09:52:30 UTC），100% 字节级未变。

---

## 3. 整体架构与数据流向

整个额度获取与展现流程由以下层级组成：

```
┌────────────────────────────────────────────────────────┐
│ Google Cloud Code PA Upstream API                      │
│   ├─ daily-cloudcode-pa.googleapis.com (灰度端点)      │
│   │    ├─ retrieveUserQuotaSummary (无 Gemini 组)      │
│   │    └─ fetchAvailableModels (含单模型 5H QuotaInfo) │
│   └─ cloudcode-pa.googleapis.com (稳定端点)            │
└──────────────────────────┬─────────────────────────────┘
                           │ agyFetch (Undici ProxyAgent)
                           ▼
┌────────────────────────────────────────────────────────┐
│ Backend: QuotaService (packages/core/src/quota.ts)     │
│   1. fetchQuotaSummary()                               │
│   2. fetchAvailableModels()                            │
│   3. mergeFallbackFamilyQuota() ──► [缺陷阻断点]       │
└──────────────────────────┬─────────────────────────────┘
                           │ AccountPoolManager.updateAccountQuotas()
                           ▼
┌────────────────────────────────────────────────────────┐
│ Storage: Local JSON (~/.dsh/agy-accounts/pool.json)    │
│   acc.quotas['google'] (被锁死在 2026-10-15 旧值)      │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP GET /pool/accounts
                           ▼
┌────────────────────────────────────────────────────────┐
│ Frontend: DSH Web Panel (src/client/index.ts)          │
│   1. renderQuotaBar()                                  │
│   2. formatQuotaWindow(info.resetTime)                 │
│      └─ diffMs <= 0 判定过期 ──► 返回 '' ──► 隐藏倒计时│
└────────────────────────────────────────────────────────┘
```

---

## 4. 核心根因深度拆解

### 4.1 问题一：为什么面板不显示 5H 额度剩余时间？

#### (1) 前端 UI 表现层的隐藏判断条件
在前端面板代码 `src/client/index.ts` 中，5H 额度倒计时由 `formatQuotaWindow` 计算：
```typescript
// src/client/index.ts:170-184
function formatQuotaWindow(resetTimeStr?: string): {
    resetText: string;
} {
    if (!resetTimeStr) return { resetText: '' };
    try {
        const d = new Date(resetTimeStr);
        const diffMs = d.getTime() - Date.now();
        if (diffMs <= 0) return { resetText: '' }; // 【关键点 1：过期直接置空】

        const totalMins = Math.ceil(diffMs / 60000);
        // ... 计算天、小时、分钟 ...
        const countdown = days > 0 ? `${days}d${hours}h` : hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
        const resetText = `${hh}:${mm} (${countdown})`;
        return { resetText };
    } catch {
        return { resetText: '' };
    }
}
```
在渲染额度进度条行的函数 `renderLine` 中：
```typescript
// src/client/index.ts:1228
resetStr ? h('span', { style: { ... } }, `↻ ${resetStr}`) : null
```
- 当 `formatQuotaWindow` 返回 `{ resetText: '' }` 且无本地冷却时，传入的 `resetStr` 为空字符串。
- 三元表达式计算为 `null`，导致该 DOM 节点完全不被挂载。

#### (2) 为什么送达前端的 `resetTime` 位于过去？
查阅 `pool.json` 中各个账号存储的 `google` 配额信息：
```json
"google": {
  "remainingFraction": 0.2681512,
  "resetTime": "2026-10-15T12:07:40Z",
  "updatedAt": 1792057950309
}
```
当前系统时间戳为 `2026-10-16T10:xx:xx+08:00`（即 `2026-10-16T02:xx:xxZ`）。
`new Date("2026-10-15T12:07:40Z").getTime() - Date.now()` 计算结果为 **负 50,000,000 毫秒（即过期已超过 14 个小时）**！
因此：
`diffMs <= 0` 恒成立，`formatQuotaWindow` 每次计算均判定为“已过期”，返回空串，前端从而完全不渲染 5H 剩余时间。

#### (3) 结论判定
- **不是** 前端字段名拼写错误；
- **不是** ISO 时间字符串解析抛出异常；
- **而是** 后端因为下述的缺陷 A，未能将上游 Google 返回的最新有效未来重置时间（`2026-10-16T07:45:22Z`）写入本地数据库，将一个早于昨天的陈旧时间戳持续喂给前端。

---

### 4.2 问题二：为什么 5H 额度每次刷新后数值保持不变？

#### (1) Google 上游 API 的配额属性定性
现场通过抓包验证 Google Cloud Code PA API 的实际行为：
- Google PA 的配额字段是 **高精度的动态浮点剩余比例**（`remainingFraction`，范围 0.0 ~ 1.0），代表 5 小时滑动窗口内的剩余可用算力占比。
- 该配额**绝非静态固定值**，也不是不再扣减。在现场实测中，不同模型和不同使用程度的账号返回的实际值包括 `0.8424675`、`0.93347484`、`0.96216565` 等，随对话交互实时扣减，随时间滑动逐步恢复。
- 用户点击刷新按钮时，网络请求确实通过 Undici 发送至 Google 服务器，并成功收到包含最新浮点数（如 `0.95993334`）的 HTTP 200 响应。

#### (2) 导致刷新不变的代码死锁根因
在后端 `packages/core/src/quota.ts` 的 `refreshAccountQuota` 方法中，当完成上游请求后进行结构组装：
```typescript
// packages/core/src/quota.ts:521-526
if (!familyQuotas[fam]) {
    familyQuotas[fam] = mergeFallbackFamilyQuota(account.quotas[fam], {
        remainingFraction: remaining,
        resetTime,
        updatedAt: now,
    })
}
```
深入检查 `mergeFallbackFamilyQuota` 的代码实现：
```typescript
// packages/core/src/quota.ts:19-24
export function mergeFallbackFamilyQuota(
  prev: FamilyQuotaInfo | undefined,
  fallback: FamilyQuotaInfo,
): FamilyQuotaInfo {
  if (prev && typeof prev.remainingFraction === 'number') return prev
  return fallback
}
```
**致命反向阻断机制**：
1. 由于上游 `retrieveUserQuotaSummary` 没有返回 Gemini 组，`familyQuotas['google']` 为空；
2. 代码遍历 `discovered.models`，拿到第一个 Gemini 模型（如 `gemini-3.5-flash-low`），其实时配额为 `remainingFraction = 0.95993334`，重置时间为未来的 `2026-10-16T07:45:22Z`；
3. 将上述实时对象作为 `fallback` 传给 `mergeFallbackFamilyQuota`，而 `prev` 取的是本地现有账号的旧数据 `account.quotas['google']`；
4. `mergeFallbackFamilyQuota` 判断：`if (prev && typeof prev.remainingFraction === 'number')`。
   因为该账号在昨天曾经保存过配额（`prev.remainingFraction === 0.2681512`，是一个有效的 `number`），**条件直接命中，函数当即执行 `return prev`**！
5. **最新从上游获取到的全部数据被瞬间当作垃圾丢弃**！
6. `this.pool.updateAccountQuotas` 被传入的依旧是那个包含了昨日 `0.2681512` 和昨日 `resetTime` 的旧对象；
7. 持久化回写到 `pool.json`，并通过 HTTP 返回给前端。
8. 前端重新渲染得到的依旧是 `27%`。

**结论**：用户每次点击“同步”刷新，代码虽向上游发起了真实请求并拿到了最新额度，但后端合并逻辑死死守着旧数据拒绝采纳新数据，导致刷新后前台数值 100% 冻结不变。

---

### 4.3 关联机制：Google 上游 API 架构调整与灰度端点触发源

为什么之前没有发现这个问题，直到最近集中爆发？

#### (1) 端点优先级配置
在 `packages/core/src/oauth.ts` 中配置了端点列表：
```typescript
export const AGY_ENDPOINTS: readonly string[] = [
  'https://daily-cloudcode-pa.googleapis.com', // 排名第一：Google 日常灰度/金丝雀端点
  'https://cloudcode-pa.googleapis.com',       // 排名第二：现网生产稳定端点
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]
```
在 `QuotaService` 探测中：
```typescript
for (const endpoint of endpoints) {
    const res = await agyFetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, ...)
    if (res.ok) {
        this.preferredEndpointIndex = AGY_ENDPOINTS.indexOf(endpoint)
        return (await res.json()) as QuotaSummaryResponse
    }
}
```
由于 `daily-cloudcode-pa` 始终能正常返回 HTTP 200，探测立即在此终止，所有请求永久绑定在 `daily-cloudcode-pa.googleapis.com` 上。

#### (2) 上游架构演进与接口语义收敛
通过现场对比 `daily-cloudcode-pa` 与 `cloudcode-pa` 的原始响应，真相大白：
- **现网生产端点 (`cloudcode-pa`)**：`retrieveUserQuotaSummary` 仍然返回两个组（`"Gemini Models"` 和 `"Claude and GPT models"`）。
- **Google 日常灰度端点 (`daily-cloudcode-pa`)**：Google 正在将 API 语义进行分流——`retrieveUserQuotaSummary` 正式剥离了 1st party 的 Gemini 模型配额，**仅用于返回跨厂商 3P 模型（Claude/GPT）的汇总配额**；Gemini 模型的配额全部下沉至 `fetchAvailableModels` 中以单模型粒度提供。
- 当插件优先连接到 `daily-cloudcode-pa` 时，`retrieveUserQuotaSummary` 返回的 `groups` 中再也没有 Gemini 组，从而**系统性地、必定会进入 `mergeFallbackFamilyQuota` 降级路径**。
- 而历史代码中的 `mergeFallbackFamilyQuota` 原本是为了防范“接口偶发网络抖动”编写的权宜之计，缺乏面对上游结构长期调整的兼容能力，直接演变成了全量阻断，彻底引爆了本次 Bug。

#### (3) 会话期间被动刷新的额外盲区
在 `src/host/adapter.ts:98` 中，每次模型调用前夕会触发 `refreshQuotaSummaryOnly(acc)`，传入 `{ summaryOnly: true }`。
在 `packages/core/src/quota.ts:430` 中：
```typescript
if (options?.summaryOnly) {
    summary = await this.fetchQuotaSummary(accessToken, account.proxyUrl)
} else {
    // 只有在非 summaryOnly 模式下才会请求 fetchAvailableModels
}
```
在 `daily-cloudcode-pa` 缺少 Gemini 组的背景下，所有后台定时刷新和会话启动刷新**完全不会去调用 `fetchAvailableModels`**，导致常规使用期间 Google 额度不仅无法更新，甚至连触发降级尝试的机会都没有。

---

## 5. 现场抓包与实测证据矩阵

### 证据 A：`daily-cloudcode-pa` 与 `cloudcode-pa` 原始响应报文对照

| 接口与端点 | HTTP 状态码 | 返回分组内容 (groups) | Gemini 5H 配额字段存在性 | 原始证据文件 |
|---|---|---|---|---|
| `POST daily-cloudcode-pa/...:retrieveUserQuotaSummary` | **200 OK** | 仅 `[ "Claude and GPT models" ]` | **完全不存在** | `research/reproduction/upstream-quota-summary-daily.json` |
| `POST cloudcode-pa/...:retrieveUserQuotaSummary` | **200 OK** | `[ "Gemini Models", "Claude and GPT models" ]` | `gemini-5h` (fraction=1, resetTime=未来时间) | `research/reproduction/upstream-quota-summary-prod.json` |
| `POST daily-cloudcode-pa/...:fetchAvailableModels` | **200 OK** | 19 个模型 | 每个 Gemini 模型 quotaInfo 均含实时浮点数与未来 resetTime | `research/reproduction/raw_upstream_dump_real.json` |
| `POST cloudcode-pa/...:fetchAvailableModels` | **200 OK** | 18 个模型 | 每个 Gemini 模型 quotaInfo 均含实时浮点数与未来 resetTime | `research/reproduction/upstream-available-models-prod.json` |

### 证据 B：本地刷新前后数据 100% 冻结实锤 (`research/reproduction/refresh-comparison.json`)

针对账号 `acc_1788785623927_xhs7n` 调用 `POST /pool/refresh-quota` 前后字段比对：

```diff
  "google": {
-   "remainingFraction": 0.2681512,
+   "remainingFraction": 0.2681512,  <-- [未更新，上游实际值为 0.95993334]
-   "resetTime": "2026-10-15T12:07:40Z",
+   "resetTime": "2026-10-15T12:07:40Z",  <-- [未更新，已过期 14 小时，导致倒计时隐藏]
-   "updatedAt": 1792057950309
+   "updatedAt": 1792057950309   <-- [时间戳完全停留在 2026-10-15 09:52:30 UTC]
  }
```
而同一账号内的 `anthropic` 额度：
```diff
  "anthropic": {
-   "resetTime": "2026-10-16T07:53:50Z",
+   "resetTime": "2026-10-16T07:56:38Z",  <-- [正常更新]
-   "updatedAt": 1792119224198
+   "updatedAt": 1792119392200   <-- [正常更新]
  }
```
Anthropic 正常更新的原因是 `daily-cloudcode-pa` 的 `retrieveUserQuotaSummary` 包含了 3P 组，走的是标准解析流程；而 Google 走了错误的 fallback 流程被丢弃。

---

## 6. 修复方案与代码整改建议

为彻底解决这两大根因并防御未来上游接口变动，建议实施以下三层防御修复：

### 建议 1：重构 `mergeFallbackFamilyQuota`（核心修复）
**位置**：`packages/core/src/quota.ts:19`
**修复逻辑**：合并策略应为“保留旧对象的静态属性（如历史周额度 `weeklyFraction` 和描述信息），但**必须无条件更新 5H 额度 `remainingFraction`、`resetTime` 以及 `updatedAt` 时间戳**”。
```typescript
export function mergeFallbackFamilyQuota(
  prev: FamilyQuotaInfo | undefined,
  fallback: FamilyQuotaInfo,
): FamilyQuotaInfo {
  if (!prev) return fallback
  return {
    ...prev,
    remainingFraction: fallback.remainingFraction ?? prev.remainingFraction,
    resetTime: fallback.resetTime ?? prev.resetTime,
    updatedAt: fallback.updatedAt ?? Date.now(),
  }
}
```

### 建议 2：纠正上游端点优先级配置
**位置**：`packages/core/src/oauth.ts:38`
**修复逻辑**：将现网生产稳定端点 `https://cloudcode-pa.googleapis.com` 调整至首位，Google 日常灰度/金丝雀端点降级为备选，避免未正式发布的后端接口语义变动直接冲击普通用户环境。
```typescript
export const AGY_ENDPOINTS: readonly string[] = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]
```

### 建议 3：修复单模型配额取最小值的短路判断 Bug
**位置**：`packages/core/src/quota.ts:527`
**修复逻辑**：移除导致短路的 `else if (familyQuotas[fam]!.remainingFraction === undefined)` 条件，确保在没有 summary 组聚合时，取该家族所有可用模型中 `remainingFraction` 的最低值（最紧额度）及对应的 `resetTime`，真实反映账号健康度。

### 建议 4：完善 `refreshQuotaSummaryOnly` 对 1st Party Google 模型的覆盖
**位置**：`packages/core/src/quota.ts:430`
**修复逻辑**：当 `fetchQuotaSummary` 返回的 groups 中不包含 Google 家族时，即使设置了 `summaryOnly: true`，也应当触发一次针对 Google 模型的轻量提取，防止会话期间配额更新出现单盲区。
