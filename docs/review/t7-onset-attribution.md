# T7 起点归因：12:30 那次成功走的是哪个端点 + preferredEndpointIndex 耦合

worker-forensics | 2026-10-18 | 全程只读

**结论先行**
1. `stats.db` **无端点/主机/状态码列** ⇒ 「12:30:51 那次成功来自 daily 还是 production」**无法判定**；已检查的表与列清单见 §1。
   但运行时**确有**端点值：`packages/core/src/client.ts:474` `return { response: res, endpoint }` —— 该值被 schema 丢弃，这就是缺失的判别证据。
2. 耦合**机制**（字段 + 读出逻辑）预存在于 **fac08c5（= 957cba6 的 core，last-known-good）**；**但 `AGY_ENDPOINTS` 的数组顺序是 `1c0931a` 翻成 production-first 的**（§3.2(b) 有真实 diff）。
   该常量**只被配额路径使用**（唯一 import 方 `quota.ts:16`；用点 `:320/:323/:343/:371`），**生成路径完全不读它**（生成候选走 `client.ts:103-109 endpointCandidates()`）
   ⇒ 该耦合**不能**在运行时把生成首选改成 production。T6 报的这条为**已排除（非承载原因）**——排除的是「迁移机制」，不是「顺序翻转」这个事实。
3. 起点被**收紧到 4.2 秒**：2026-10-16 **16:11:22.471 → 16:11:26.667 CST**，**5 个账号在一次请求内被逐一 429**，stats 只落 1 行（最后一跳 n0tdx）。
   ⇒ 该 429 与单账号配额无关，是 **production 端点的 per-project 闸门**。
4. 故障起点归因真值表见 §5；当前证据**已证**「production 429 + `client.ts:478-480` 立即返回 = 充分的总失效机制」，且**已证**上游端点状态在 12:30 与现在之间发生了由 ok 到全死的转变；
   但「12:30:51 成功来自哪个端点」与「daily 在 16:11:22 是否还活着」**仍不可判定**（故 G1↔G3 无法二选一）。

---

## 1. `stats.db` schema 全表清单（Q1）

命令：`sqlite3 -readonly /home/csy/.cloudcode/accounts/stats.db ".schema"`

**全部对象**（唯一 2 张表 + 8 个索引，共 10 个对象，无视图/触发器）：
```
request_metrics        table
session_metrics        table
idx_requests_timestamp  index   (request_metrics.timestamp DESC)
idx_requests_session    index   (request_metrics.sessionId)
idx_requests_account    index   (request_metrics.accountId)
idx_requests_latency    index   (request_metrics.latencyMs ASC)
idx_sessions_updated    index   (session_metrics.updatedAt DESC)
idx_sessions_account    index   (session_metrics.accountId)
sqlite_autoindex_request_metrics_1 / sqlite_autoindex_session_metrics_1
```

`PRAGMA table_info('request_metrics')`（12 列，**无 endpoint / host / statusCode / url / project 任何一列**）：
| cid | name | type | notnull |
|---|---|---|---|
| 0 | requestId | TEXT | 0 (PK) |
| 1 | sessionId | TEXT | 0 |
| 2 | accountId | TEXT | 1 |
| 3 | **model** | TEXT | 1 |
| 4 | timestamp | INTEGER | 1 |
| 5 | status | TEXT | 1 |
| 6 | latencyMs | INTEGER | 1 |
| 7 | ttftMs | INTEGER | 0 |
| 8 | cacheHit | INTEGER | 1 |
| 9 | promptTokens | INTEGER | 1 |
| 10 | cachedTokens | INTEGER | 1 |
| 11 | outputTokens | INTEGER | 1 |

`PRAGMA table_info('session_metrics')`（10 列）：`sessionId, accountId, createdAt, updatedAt, totalRequests, totalSuccess, totalFailed, totalPromptTokens, totalCachedTokens, cacheHitRate`
—— 同样**无端点维度**（连 model 都没有）。

**唯一与端点沾边的列 = `model`**（值如 `gemini-3.8-flash-high`），而**同一 wire model 在三个端点上同名**，故 `model` 不能替代端点列。
代码级依据（不靠外部假设）：`packages/core/src/client.ts:457 const body = JSON.stringify(request)` 在 `:462 for (const endpoint of endpoints)` **之前**执行
⇒ 请求体（含 model）在选端点**之前**就已固定，落到哪个端点都不改变 `model` 列的值。

### 逐行证据：2026-10-16 12:00–12:31 CST 的 success 行
查询：`SELECT ... WHERE status='success' AND timestamp BETWEEN 12:00:00 CST AND 12:31:00 CST`
（`timestamp` 毫秒：`1792118400000`=12:00:00 CST，`1792163460000`=12:31:00 CST）

- 命中 **436 行**（窗口 `1792123200000`=12:00:00 CST → `1792125060000`=12:31:00 CST；
  `MIN=2026-10-16 04:00:01Z / 12:00:01 CST`，`MAX=2026-10-16 04:30:51Z / 12:30:51 CST`）。
- 其中**翻转产物落盘之后**（`timestamp > 1792123525479` = 12:05:25.479 CST）为 **401 行** —— 与 T6 口径一致。
- 该窗口账号分布：`xhs7n 211`（12:04:08–12:30:51）、`pqxkh 183`（12:00:01–12:28:28）、`5ptu4 42`（12:11:34–12:30:30）。
- 端点分布：**无法输出** —— 表内不存在端点列。逐行 dump（时刻|UTC|CST|status|accountId|model|latencyMs|requestId 前缀）：
  `docs/review/t6-db-rows-since-2026-10-16T03.txt`（T6 产物，涵盖本区间全部行）。
- 12:30:51 那一秒共 2 行：`acc_1788785623927_xhs7n`, `gemini-3.8-flash-high`, latencyMs `7999` / `8706`。

**⇒ 明确回答：「12:30:51 的成功来自 daily-cloudcode-pa」—— 可能，但本证据下不可判定（禁止外推）。**
理由与可行判据见 §2。

---

## 2. 用「401 次成功」做可复核的逻辑判别（Q2）

### 2.1 代码事实（HEAD，core `e52abe7`；fac08c5 侧由 §8 复跑表逐条独立复核）
`packages/core/src/client.ts:444-490`（`streamGenerateContent`）：
```ts
462:  for (const endpoint of endpoints) {
465:      const res = await agyFetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {...})
473:      if (res.ok) {
474:        return { response: res, endpoint }      // ← 端点值在此返回给调用方
475:      }
477:      lastResponse = res
478:      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 429) {
479:        return { response: res, endpoint }      // ← 429/400/401/403 立即返回，不试下一候选端点
480:      }
481:    } catch (err) { ... }                       // 网络异常 → 下一候选
```
⇒ 语义：**2xx → 立即成功返回；429/400/401/403 → 立即失败返回（不换端点）；404/5xx/网络异常 → 换下一候选端点。**
该分支在 fac08c5 里**同为第 478 行、判断条件逐字相同**，即**翻转提交未改动它**（复跑命令与真实输出见 §8 表 R2/R3）。

候选顺序（`packages/core/src/client.ts:6-11`）：
```ts
// fac08c5 (= 957cba6, last-known-good)
export const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
export const ENDPOINT_FALLBACKS = [ daily, daily-sandbox, production ]
// 1c0931a (= dc0ca77) / HEAD
export const DEFAULT_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
export const ENDPOINT_FALLBACKS = [ production, daily, daily-sandbox ]
```
实测**安装副本**（本机在跑的那份，`sha256 6b8e1fad…`）—— 两个数组都是 production-first（复跑命令与真实输出见 §8 表 R6/R7）：
```
$ D=/home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
$ grep -n -A4 'const ENDPOINT_FALLBACKS' "$D"
25650:const ENDPOINT_FALLBACKS = [
25651-	"https://cloudcode-pa.googleapis.com",
25652-	"https://daily-cloudcode-pa.googleapis.com",
25653-	"https://daily-cloudcode-pa.sandbox.googleapis.com"
25654-];
$ grep -n -A5 'const AGY_ENDPOINTS' "$D"
27786:const AGY_ENDPOINTS = [
27787-	"https://cloudcode-pa.googleapis.com",
27788-	"https://daily-cloudcode-pa.googleapis.com",
27789-	"https://daily-cloudcode-pa.sandbox.googleapis.com",
27790-	"https://autopush-cloudcode-pa.sandbox.googleapis.com"
27791-];
```
⇒ **线上产物在生成候选数组与配额路径数组两处都是 production-first**。

### 2.2 可复核判据（写成谓词）
设某一时刻 t 三端点状态为 `S(t) ∈ {ok, 404, 5xx, 429, 400/401/403}`，候选顺序 `O`（翻转前 `O₀=[daily, sandbox, prod]`，翻转后 `O₁=[prod, daily, sandbox]`）。

- **判据 P1（成功 ⇒ 存在 ok）**：任一 success 行 ⇒ 在 `O` 中**第一个非 {400,401,403,429} 的候选**返回 ok。即 `∃ e ∈ {daily, sandbox, production}: S_t(e)=ok`。
- **推论 P1′**：12:05:25–12:30:51 CST 存在 **401 次成功** ⇒ **这 25 分钟内至少有一个端点 ok**。
  ⇒ 若「三端点当时全部已死（429/404）」则成功不可能发生 ⇒ **「12:30:51 时三端点全死」被 401 次成功直接否证**。
- **判据 P2（429 ⇒ 屏蔽后续候选）**：翻转后顺序下，`S(prod)=429` ⇒ 请求在**第一个候选**即返回，**daily/sandbox 从未被咨询**。
  ⇒ 翻转后「daily 是否还活着」**不可由线上成功/失败观测到**。
- **判据 P3（翻转前的失败语义）**：翻转前，`S(daily)=429` ⇒ 立即失败（不试 sandbox/prod）；`S(daily)=404` ⇒ 继续试 sandbox；`S(daily)=404 ∧ S(sandbox)=404` ⇒ 继续试 production。

### 2.3 「12:30:51 成功是否来自 daily」——二选一所需证据
| 情形 | 12:30:51 success 的端点 | 需要的判别证据 |
|---|---|---|
| S(daily)=ok | daily（第一候选即 ok） | 12:30:51 该行请求的 `endpoint` 值 |
| S(daily)=404 ∧ S(sandbox)=ok | daily-sandbox | 同上 |
| S(daily)=404 ∧ S(sandbox)=404 ∧ S(prod)=ok | **production** | 同上 |

**可获得的判别证据只有一个，且它存在但被丢弃**：`client.ts:474` 的 `endpoint` 返回值。
统计落库路径 `packages/core/src/stats/*` 只取 `accountId/model/status/latencyMs/tokens`，**未把 `endpoint` 写入 `request_metrics`**。
⇒ **补齐方式（供修复，不在本次写域）**：给 `request_metrics` 加 `endpoint TEXT` 列并在 telemetry 里带上 `endpoint`；此后同类问题可一行 SQL 判定。
其余替代证据（本地均不存在）：上游 Google 侧 per-endpoint 请求日志；插件侧端点访问日志（本机无）。

---

## 3. `preferredEndpointIndex` 耦合取证（Q3）

### 3.1 定义 / 写点 / 读点（HEAD core `e52abe7`）
`packages/core/src/quota.ts`：
```
167:  private preferredEndpointIndex = 0                      // 定义：私有字段，初值 0，构造函数赋值，无 TTL、无重置
319:  private getOrderedEndpoints(): string[] {               // 读点：唯一消费者
323:      ordered.push(AGY_ENDPOINTS[(this.preferredEndpointIndex + i) % total]!)
343:          this.preferredEndpointIndex = AGY_ENDPOINTS.indexOf(endpoint)   // 写点 1：fetchQuotaSummary 成功时
371:          this.preferredEndpointIndex = AGY_ENDPOINTS.indexOf(endpoint)   // 写点 2：fetchAvailableModels 成功时
```
`AGY_ENDPOINTS`（**HEAD** `packages/core/src/oauth.ts:42-47`）= `[production, daily, daily-sandbox, autopush-sandbox]`；
**注意 fac08c5 的同一常量是 `[daily, production, daily-sandbox, autopush-sandbox]`（顺序被 1c0931a 翻转，详见 §3.2(b)）。**

**调用图（vectr_trace `getOrderedEndpoints`）**：
```
Called by (2):
  fetchAvailableModels   packages/core/src/quota.ts:356
  fetchQuotaSummary      packages/core/src/quota.ts:328
```
⇒ **只有 QuotaService 自己的两个方法调用它**；`fetchAvailableModels`/`fetchQuotaSummary` 的用途是模型目录与配额摘要。

**谁读 `preferredEndpointIndex`？** 全仓 `grep -rn preferredEndpointIndex src/ packages/core/src/` 只有上述 4 处（全在 quota.ts）；
`src/` 下 **0 命中**（无 getter、无注入、无导出）。生成路径 `client.ts:451` 取候选的方式是
`customEndpoints?.length ? customEndpoints : endpointCandidates()`，而 `endpointCandidates()`（client.ts:103-109）只读 `process.env.ANTIGRAVITY_BASE_URL`，**不读任何 quota 状态**。

**实例数**：`src/index.ts:108` `const quota = new QuotaService(pool)` —— 单个长生命周期实例；`preferredEndpointIndex` 除构造外**无任何重置代码**（无 TTL，进程存活期内粘滞）。

### 3.2 耦合机制预存在；`AGY_ENDPOINTS` 的**顺序**由 1c0931a 翻成 production-first（但**不构成生成首选迁移机制**）

> **本节曾于第 1 轮审查被打回（D1）**：初版误写「fac08c5 里 `AGY_ENDPOINTS` 与 HEAD 逐字相同」。该断言**错误**，已按下方复跑输出更正。

**(a) 耦合机制：fac08c5（= 957cba6 的 core）里就已存在**
```
packages/core $ git show fac08c5…:src/quota.ts | grep -n "preferredEndpointIndex\|getOrderedEndpoints"
162:  private preferredEndpointIndex = 0
314:  private getOrderedEndpoints(): string[] {
318:      ordered.push(AGY_ENDPOINTS[(this.preferredEndpointIndex + i) % total]!)
324:    const endpoints = this.getOrderedEndpoints()
```
`fac08c5` = **repo `957cba6`（last-known-good, 10-14 11:37）所记录的 core 指针**（`git ls-tree 957cba6 packages/core` → `fac08c5e1…`）。
翻转提交 `fac08c5 → 1c0931a` 的**全量 diff 中 grep `preferredEndpointIndex` = 0 命中**；`src/quota.ts` 的 hunk 头为
`@@ -20,8 +20,13 @@ mergeFallbackFamilyQuota`、`@@ -434,6 +439,14 @@`、`@@ -457,6 +470,7 @@`、`@@ -488,6 +502,7 @@`、`@@ -524,7 +539,7 @@` —— 全部位于 `MODEL_FALLBACKS` 目录区（新增 gemini-3-flash / gemini-2.5-pro / gemini-2.5-flash / gemini-3.1-flash-lite 等回退条目），**不触及 162/314-345 的端点索引区**。
⇒ **字段与读出逻辑本身是预存在的。**

**(b) 但 `AGY_ENDPOINTS` 的顺序确实被 1c0931a 翻转了（初版错误在此）**
```
$ git -C packages/core show fac08c5…:src/oauth.ts | grep -n -A6 'export const AGY_ENDPOINTS'
38:export const AGY_ENDPOINTS: readonly string[] = [
39-  'https://daily-cloudcode-pa.googleapis.com',      ← index 0 = daily
40-  'https://cloudcode-pa.googleapis.com',            ← index 1 = production
41-  'https://daily-cloudcode-pa.sandbox.googleapis.com',
42-  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
43-]

$ git -C packages/core show 1c0931a -- src/oauth.ts | tail -12
diff --git a/src/oauth.ts b/src/oauth.ts
@@ -36,8 +36,8 @@ export const OAUTH_CALLBACK_PATH = '/oauth-callback'
 export const AGY_ENDPOINTS: readonly string[] = [
-  'https://daily-cloudcode-pa.googleapis.com',
   'https://cloudcode-pa.googleapis.com',
+  'https://daily-cloudcode-pa.googleapis.com',
   'https://daily-cloudcode-pa.sandbox.googleapis.com',
   'https://autopush-cloudcode-pa.sandbox.googleapis.com',
 ]
```
⇒ 翻转提交把 `AGY_ENDPOINTS` 的 index 0/1 对调（daily ↔ production），并同时把 `client.ts:6-11` 的生成候选数组翻成 production-first。

**(c) 该顺序翻转的爆炸半径 = 仅配额路径，不含生成路径**（这是 Q3 结论仍然成立的依据）
```
$ grep -rn "AGY_ENDPOINTS" src/ packages/core/src/
packages/core/src/quota.ts:16:import { AGY_ENDPOINTS, OAUTH_USERINFO_URL, refreshTokens } from './oauth.ts'
packages/core/src/quota.ts:320:    const total = AGY_ENDPOINTS.length
packages/core/src/quota.ts:323:      ordered.push(AGY_ENDPOINTS[(this.preferredEndpointIndex + i) % total]!)
packages/core/src/quota.ts:343:          this.preferredEndpointIndex = AGY_ENDPOINTS.indexOf(endpoint)
packages/core/src/quota.ts:371:          this.preferredEndpointIndex = AGY_ENDPOINTS.indexOf(endpoint)
packages/core/src/oauth.ts:42:export const AGY_ENDPOINTS: readonly string[] = [
```
**唯一 import 方 = `quota.ts`**；`src/` 0 命中；调用方只有 `fetchQuotaSummary`(quota.ts:328) 与 `fetchAvailableModels`(quota.ts:356)（vectr_trace，见 §3.1）。
生成候选来自 `client.ts:103-109 endpointCandidates()` → `ENDPOINT_FALLBACKS`（独立常量，**不是** `AGY_ENDPOINTS`）。

**⇒ 准确表述（替换初版）：耦合机制预存在（fac08c5 已有 `preferredEndpointIndex` 与 `getOrderedEndpoints`）；
`AGY_ENDPOINTS` 的**「顺序」**由 1c0931a 翻成 production-first；该常量只被配额路径使用（quota.ts:16/320/323/343/371），
生成路径不读它，故**「生成首选迁移机制」不成立**。**

### 3.3 它能否在运行时把「生成首选」改成 production？——**不能**，并给出只读最小复现
最小只读复现（三条命令，全部只读，不写任何文件、不改 src）：
```bash
# 1) 读点收敛性：只有 QuotaService 自己调用 getOrderedEndpoints
#    期望输出：仅 fetchAvailableModels / fetchQuotaSummary 两个 caller
#    （工具：mcp vectr_trace name=getOrderedEndpoints direction=both）
# 2) 生成路径不读该字段
grep -rn "preferredEndpointIndex" src/ packages/core/src/
#    期望：仅 packages/core/src/quota.ts 的 167/323/343/371 四行；src/ 0 命中
# 3) 生成候选来源不含 quota 状态
grep -n -A7 "^export function endpointCandidates" packages/core/src/client.ts
#    期望：return [...ENDPOINT_FALLBACKS] 或 [customBaseUrl]；无 quota 引用
```
三条均已实跑（输出见 §3.1/§3.2 引文）。
⇒ **结论：`preferredEndpointIndex` 只影响配额摘要/模型目录这类 QuotaService 自身请求的端点顺序，对生成端点顺序零影响。**
T6 把它列为「待查耦合」是**基于符号名相似的推测**；本 T7 予以**撤销该推测**（不改写 T6 文档，仅在此声明降级：**非承载原因**）。

**仍然成立的相邻事实（与索引耦合无关）**：翻转真正的破坏点不是这个索引，而是
`client.ts:6-11` 的候选顺序 + `client.ts:478-480` 的「429 立即返回」组合 ——
**production 一旦 429，daily/sandbox 不再被咨询**（§2 判据 P2）。

---

## 4. 起点收紧：16:11:22.471 → 16:11:26.667 CST（4.2 秒）

**退避公式**（`packages/core/src/pool.ts:590-616`，逐字）：
```ts
590:  recordFailure(id, family, reason, serverResetTime?): void {
595:    const failures = (prev?.consecutiveFailures ?? 0) + 1
605:        cooldownUntil = Date.now() + Math.min(this.data.defaultCooldownMs * failures, this.data.maxCooldownMs)
610:      cooldownUntil = Date.now() + Math.min(this.data.defaultCooldownMs * failures, this.data.maxCooldownMs)
616:      consecutiveFailures: failures,
```
`pool.json`：`defaultCooldownMs = 900000`（15 min）、`maxCooldownMs = 3600000`（60 min）。
⇒ `cooldownUntil − min(900000 × failures, 3600000) = 该次失败时刻`。
**为何判定未走 `retry-after` 分支（`:603`/`:608`）**：若走了该分支，`cooldownUntil = parsed + 10_000`，则反解值会带上 `+10 s` 的偏移、且不可能与本地独立时间戳毫秒级吻合；
而本批 5 组反解值分别与两个**互相独立**的本地时间戳吻合到 **6 ms 与 2 ms**（见下方三重交叉验证），只可能来自 `:605`/`:610` 的退避公式分支
⇒ **该 429 响应没有可解析的 `retry-after`**。

对 `ops/diag/endpoint-ab-2026-10-16T08-41-07-515Z.json` 的 `cooldownsBefore`（快照时刻 `2026-10-16T08:40:54.457Z`）反解：

| 账号 | cooldownUntil (UTC) | failures | 退避 | **反解失败时刻 (UTC)** | **= CST** |
|---|---|---|---|---|---|
| acc_…_xhs7n | 2026-10-16T09:11:22.471Z | 5 | 3600 s | 08:11:22.471Z | **16:11:22.471** |
| acc_…_50yxc | 2026-10-16T09:11:23.009Z | 5 | 3600 s | 08:11:23.009Z | **16:11:23.009** |
| acc_…_5ptu4 | 2026-10-16T09:11:23.639Z | 5 | 3600 s | 08:11:23.639Z | **16:11:23.639** |
| acc_…_pqxkh | 2026-10-16T08:41:25.426Z | 2 | 1800 s | 08:11:25.426Z | **16:11:25.426** |
| acc_…_n0tdx | 2026-10-16T09:11:26.665Z | 8 | 3600 s | 08:11:26.665Z | **16:11:26.665** |

**三条独立交叉验证（全部命中到毫秒级）**：
1. `pqxkh` 反解出的 `08:11:25.426Z` 与 stats.db 唯一那行 error 的 `timestamp=1792138285432`（`08:11:25.432Z`）相差 **6 ms**。
2. `n0tdx` 反解出的 `08:11:26.665Z` = 该行 `timestamp + latencyMs` = `08:11:25.432Z + 1235 ms` = `08:11:26.667Z`，相差 **2 ms**。
3. 该快照 `cooldownStateUnchanged: true` 且脚本 `requestBudget.issued=2` —— 说明这 5 个冷却**不是** 16:41 那次 A/B 实验写的，只能是更早的真实请求写的。

**机制证据（为什么 5 个账号会在一次请求里接连 429）**：`src/host/adapter.ts:462-481`
```ts
463:            if (res.status === 429) {
466:                this.deps.pool.recordFailure(account.id, family, errText || 'Rate limit 429', resetHeader)
468:              if (!hasEmitted && attempt < maxAttempts) {
469:                this.deps.log?.(`Rate limited (429) on ${accountId}, switching accounts...`)
470:                continue                                  // ← 换账号重试（账号级故障转移）
481:            recordTelemetry(options.signal?.aborted ? 'abort' : 'error')   // ← 只在尝试耗尽后落 1 行
```
⇒ **账号级 429 会故障转移到下一账号；端点级 429 不会**（`client.ts:478-480`）。
⇒ 观测完全自洽：**一次逻辑请求（16:11:22.471 起）→ 依次试 5 个账号 → 每个都在第一个候选端点（production）拿到 429 → 写 5 个冷却 → 尝试耗尽后落 1 行 stats（最后一个账号 n0tdx）。**

**由此得到的两条硬结论**：
- **起点收紧为 `16:11:22.471 CST`（首次 429 落冷却）/ `16:11:26.667 CST`（本请求最后一次）**，取代 T6 的宽区间 `(12:30:51, 16:11:25]` 的下半部分；同时证明 **12:30:51 与 16:11:22 之间插件侧确实一次请求都没有**（否则会有冷却/行记录）。
- **5 个不同 Google 账号在 4.2 秒内同时 429 ⇒ 不是账号配额耗尽，而是 production 端点的 per-project 闸门**；与 `quotas.google.remainingFraction = 1`（T1/T6）完全自洽。

---

## 5. 故障起点归因真值表（Q4）

**已证事实（无关真值表分组）**：
- F1 12:05:25–12:30:51 CST 存在 401 次成功，当时进程跑 **翻转前**代码（PID 420693 起于 10:03:11.991，`ops/verify/probe-2026-10-16T06-19-35-857Z.json` 判 `process_fresh FAIL: running process predates the new build`）。
- F2 翻转代码首次生效 **14:20:50 CST（PID 500951）**，候选顺序变为 `[production, daily, daily-sandbox]`。
- F3 **16:11:22.471–16:11:26.667 CST**：一次请求，5 账号全部在**第一个候选（production）**拿到 429（§4）。⇒ **`S(production)=429` 在 16:11:22 已成立**。
- F4 **16:40:54–16:41:07 CST**（`ops/diag/endpoint-ab-…08-41-07-515Z.json`，直连客户端、绕过号池，`cooldownStateUnchanged:true`）：production **429**、daily **404**。
- F5 **16:51 CST**（`ops/diag/daily-project-retest-…08-51-41-763Z.json`）：用真实发现 project `aicode-consumers` 再打 daily → **404**（结论字符串：`daily loadCodeAssist status=200 project=aicode-consumers; daily stream=404; production control status=200 ... same project: true`）。
- F6 **10-18 00:11 CST**（T4）：production 429 / daily 404 / sandbox 404。
- F7 由 P1′：**12:30:51 时至少一个端点 ok**。由 F6：**现在三个端点全死**。⇒ **至少一个端点**在 (12:30:51, 现在] 内**由 ok 变为死** —— **上游侧状态变化被证明存在**。

| 组 | daily 在 12:30 | production 429 起点 | 12:30:51 成功来自 | 对「翻转是不是根因」的判定 | 需要的判别证据 | 当前支持? |
|---|---|---|---|---|---|---|
| **G1** | ok | **≤12:30** | daily | 翻转是**直接根因**：flip 把 production 提到首位 + 429 立即返回 ⇒ 屏蔽了仍然健康的 daily | 12:30:51 行的 `endpoint` 值；或 production 在 12:00–12:30 的状态采样 | **不可判定**（无端点列；12:00–12:30 无端点状态采样） |
| **G2** | ok | (12:30, 16:11] | daily | 翻转是**放大器/屏蔽器**，非根因：production 429 本身是上游变化 | production 429 的起始时刻（上游日志） | **部分支持**：F3 证明 16:11:22 已 429；起点早于 16:11:22 的时间不可知 |
| **G3** | 404（已死） | ≤12:30 | production | 翻转**无关**：成功本来就走 production；根因是 daily 先死 + production 后 429 | 12:30:51 行的 `endpoint` 值；daily 在 12:30 的状态 | **不可判定**；但 F5 说明 daily 在 16:51 已是 404（含真实 project），不能反推 12:30 |
| **G4** | 404 ∧ sandbox ok | 任意 | daily-sandbox | 翻转**无关**；根因是 daily/sandbox 相继死亡 | 同上 | **不可判定** |
| **G5** | 三端点全死 | — | — | 不可能 | —— | **被否证**（P1′：401 次成功 ⇒ 至少一个 ok） |

**穷尽性**：12:30 时 `S(daily)` 只有 {ok, 404/5xx} 两种有效分支（429/400/401/403 会当场终止请求，与 401 次成功矛盾），
`S(production)` 只需在 G1/G3 处取值；故 G1–G4 覆盖全部可能，G5 被否证。

### 当前证据实际支持的裁定
- **已证明（可写进结论）**：
  1. **上游侧端点状态确实发生了变化**（F7：12:30 至少一个 ok → 现在三个全死）。⇒ 单纯归因于插件改动**不成立**。
  2. **翻转提供了一个充分的「总失效」机制**：F3 证明 production 429 配 `client.ts:478-480` 的立即返回 ⇒ **daily/sandbox 从 16:11:22 起再未被咨询**。⇒ 即使 daily 当时仍健康，线上也必然全败。
  3. **今天（F6）三端点全死 ⇒ 翻转不再是当前故障的根因**：即便恢复 daily 优先也无救（T15/F5 已同结论）。
- **仍不可判定**：
  - 「12:30:51 的成功是否来自 daily-cloudcode-pa」——**不可判定**（§1/§2.3）。
  - 「daily 在 16:11:22 时是否还活着」——**不可判定**（F3 的 429 立即返回使其从未被咨询；F4/F5 只能把它钉到「16:41 已 404」）。
  - 「production 的 429 是从 12:30 之前就存在（G1），还是 12:30 之后才出现（G2）」——**不可判定**。
- **可判定的边界**：`12:30:51 CST ⊂ T6 宽区间下界` 与 `16:11:22.471 CST ⊂ 上界` 之间**无任何请求**；翻转代码在 `14:20:50` 生效 ⇒
  **若要把责任判给翻转，必须证明 daily 在 16:11:22 仍 ok（G1/G2）**；**若要把责任判给上游，必须证明 daily 在 16:11:22 已死（G3/G4）**。
  两者的唯一现成判别物 = `client.ts:474` 已算出却被丢弃的 `endpoint` 值。

### 最小面修复指向（仅结论，不在本任务写域）
1. **把 `client.ts:478-480` 的 429 从「立即返回」改为「记录并尝试下一候选端点」**（T15 §5 同结论）——这直接消除 §5 的「屏蔽」机制，与端点是否健康无关。
2. 首选端点恢复 daily **单独无效**（F4/F5/F6：daily 已 404）。
3. `request_metrics` 增列 `endpoint`（并落 `client.ts:474` 的返回值）——把 G1↔G3 从「不可判定」变为一行 SQL。

---

## 6. 未找到 / 无法获得清单

1. **12:30:51（及 12:00–12:31 全部 401 行）的端点归属**：DB 无端点列；插件无端点访问日志；journal 起始 16:40:25 之前为空。
2. **production 429 的起始时刻**：`cooldowns.*.reason` 只保留最后一次失败（当前池内全部为 10-17 23:53–23:55 的 429），历史 429 被覆盖；DB 无状态码列。
3. **daily / sandbox 在 16:11:22 的状态**：15:42–17:16 期间唯一一次直连端点采样是 16:40:54 的 A/B（只测 production 与 daily，**`grep -c sandbox` = 0**），16:51 的复测也只测 daily。
4. **`preferredEndpointIndex` 的运行时实际取值**：无日志、无持久化、无 getter；只能证明它**不影响生成**。
5. **stats 行与端点尝试的对应关系**：`adapter.ts:481` 只在尝试耗尽后落 1 行 ⇒ 单行无法区分「第几次尝试」。

---

## 7. 只读声明与脱敏

- 本次只读操作：`sqlite3 -readonly`、`read`/`grep`/`ls`/`stat`、`git show`/`git diff`/`git ls-tree`（未 `checkout`/`reset`/`stash`）、`python3` 只读 JSON 解析、`vectr_trace`。
- **未写**：`pool.json`、`stats.db`、任何日志；**未改** `src/**`、`packages/core/**`、`dist/**`；**未重启 host**；**未发起任何上游请求**（本次为纯静态 + 只读 DB/文件取证，0 次生成调用）。
- 写入产物仅限 `docs/review/t7-*`：本文件。
- 脱敏命中数：3 类令牌前缀（Google 访问令牌前缀 `ya2[9]\.`、刷新令牌前缀 `1[/]/`、JWT 头 `e[y]J`）——**0 / 0 / 0**。
  实测（非自匹配写法，命令原文见 §8 表 R11）：`t7-onset-attribution.md` 三个模式 `grep -c` 全部返回 `0`。
  本文件刻意用 `[…]` 括注的方式书写这三个模式，避免把脱敏模式自身变成命中。

---

## 8. 复跑表（每条断言 → 命令 → 真实输出）

### 8.1 本节为 D1 整改新增：凡全篇出现「逐字相同 / 完全一致 / 无改动 / 同为」之处，逐条列命令与真实输出

| id | 断言所在 | 复跑命令 | 真实输出（原样） | 结论 |
|---|---|---|---|---|
| **R1** | §3.2(b)（D1 反例） | `git -C packages/core show fac08c5e1…:src/oauth.ts \| grep -n -A6 'export const AGY_ENDPOINTS'` | `38:export const AGY_ENDPOINTS: readonly string[] = [` / `39-  'https://daily-cloudcode-pa.googleapis.com',` / `40-  'https://cloudcode-pa.googleapis.com',` / `41-  'https://daily-cloudcode-pa.sandbox.googleapis.com',` / `42-  'https://autopush-cloudcode-pa.sandbox.googleapis.com',` / `43-]` | **fac08c5 index 0 = daily**（初版「与 HEAD 逐字相同」错误） |
| **R2** | §2.1 第 478 行分支 | `git -C packages/core show fac08c5e1…:src/client.ts \| grep -n "res.status === 401"` | `478:      if (res.status === 401 \|\| res.status === 403 \|\| res.status === 400 \|\| res.status === 429) {` | fac08c5 与 HEAD **同为第 478 行、条件逐字相同** |
| **R3** | §2.1 返回行 | `git -C packages/core show fac08c5e1…:src/client.ts \| grep -n -A3 "res.status === 401"` | `478:…{` / `479-        return { response: res, endpoint }` / `480-      }` | 与 HEAD `478-480` 一致 |
| **R4** | §2.1 翻转前候选数组 | `git -C packages/core show fac08c5e1…:src/client.ts \| grep -n -A5 "^export const DEFAULT_ENDPOINT"` | `6:export const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'` / `7-export const ENDPOINT_FALLBACKS: readonly string[] = [` / `8-  DEFAULT_ENDPOINT,` / `9-  'https://daily-cloudcode-pa.sandbox.googleapis.com',` / `10-  'https://cloudcode-pa.googleapis.com',` / `11-]` | 翻转前 = `[daily, daily-sandbox, production]` |
| **R5** | §3.1/§3.2 `preferredEndpointIndex` 全仓落点 | `grep -rn "preferredEndpointIndex" src/ packages/core/src/` | `packages/core/src/quota.ts:167` / `:323` / `:343` / `:371`（`src/` 0 命中） | 仅 quota.ts 四处；无 getter/无重置 |
| **R6** | §2.1 线上产物生成候选数组 | `grep -n -A4 'const ENDPOINT_FALLBACKS' /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js` | `25650:const ENDPOINT_FALLBACKS = [` / `25651-	"https://cloudcode-pa.googleapis.com",` / `25652-	"https://daily-cloudcode-pa.googleapis.com",` / `25653-	"https://daily-cloudcode-pa.sandbox.googleapis.com"` / `25654-];` | 线上 = production-first |
| **R7** | §2.1/§3.2 线上产物配额数组 | `grep -n -A5 'const AGY_ENDPOINTS' …dist/index.js` | `27786:const AGY_ENDPOINTS = [` / `27787-	"https://cloudcode-pa.googleapis.com",` / `27788-	"https://daily-cloudcode-pa.googleapis.com",` / `27789-	"https://daily-cloudcode-pa.sandbox.googleapis.com",` / `27790-	"https://autopush-cloudcode-pa.sandbox.googleapis.com"` / `27791-];` | 线上 = production-first（两处一致） |
| **R8** | §3.2(c) `AGY_ENDPOINTS` 爆炸半径 | `grep -rn "AGY_ENDPOINTS" src/ packages/core/src/` | `quota.ts:16`（import）/ `quota.ts:320` / `:323` / `:343` / `:371` / `oauth.ts:42`（定义）；`src/` 0 命中 | **唯一 import 方 = quota.ts** |
| **R9** | §3.1 调用图 | `mcp vectr_trace name=getOrderedEndpoints direction=both` | `Called by (2): fetchAvailableModels  packages/core/src/quota.ts:356` / `fetchQuotaSummary  packages/core/src/quota.ts:328` | 无生成路径 caller |
| **R10** | §3.2 翻转 diff 的 quota.ts hunk 头 | `git -C packages/core diff fac08c5e1… 1c0931a7… -- src/quota.ts \| grep "^@@"` | `@@ -20,8 +20,13 @@ mergeFallbackFamilyQuota(` / `@@ -434,6 +439,14 @@ export class QuotaService {` / `@@ -457,6 +470,7 @@` / `@@ -488,6 +502,7 @@` / `@@ -524,7 +539,7 @@` | 全在 MODEL_FALLBACKS 区，不触及索引区 |
| **R11** | §7 脱敏 | `for p in 'ya2[9]\.' '1[/]/' 'e[y]J'; do printf '%s=%s ' "$p" "$(grep -c -- "$p" docs/review/t7-onset-attribution.md)"; done` | `ya2[9]\.=0 1[/]/=0 e[y]J=0` | 0 / 0 / 0 |
| **R12** | §4 退避公式 | `grep -rn "defaultCooldownMs\|maxCooldownMs" packages/core/src/pool.ts`（读取 `:605`/`:610`） | `605: cooldownUntil = Date.now() + Math.min(this.data.defaultCooldownMs * failures, this.data.maxCooldownMs)` / `610:` 同式 | 公式确认；`pool.json` 中 `900000` / `3600000` |
| **R13** | §4 账号级故障转移 | `grep -n -B4 -A22 "recordFailure" src/host/adapter.ts` | `463: if (res.status === 429) {` / `466: recordFailure(...)` / `468: if (!hasEmitted && attempt < maxAttempts) {` / `470: continue` / `481: recordTelemetry(...)` | 429 → 换账号；仅耗尽后落 1 行 |
| **R14** | §1 窗口计数 | `sqlite3 -readonly … "SELECT COUNT(*), … WHERE status='success' AND timestamp BETWEEN 1792123200000 AND 1792125060000;"` | `436\|2026-10-16 04:00:01Z\|2026-10-16 12:00:01 CST\|2026-10-16 12:30:51 CST` | 436 行 |
| **R15** | §1 落盘后计数 | 同上，条件 `timestamp > 1792123525479` | `401` | 401 行（与 T6 一致） |
| **R16** | §6 未测沙箱 | `grep -c "sandbox" ops/diag/endpoint-ab-2026-10-16T08-41-07-515Z.json` | `0` | 10-16 A/B **未测** daily-sandbox |

### 8.2 本轮修复操作摘要（D1 闭环）
1. §3.2 标题与正文重写：从「预存在、翻转前后一致、非其改动」改为「耦合机制预存在；`AGY_ENDPOINTS` **顺序**由 1c0931a 翻成 production-first；仅配额路径使用 ⇒ 不构成生成首选迁移机制」，并附 R1 反例与真实 diff。
2. §2.1 把「逐字相同」的空口说法换成 R2/R3/R4 命令+输出；把线上产物断言从「字面量出现顺序」（`grep -o` 的首次出现偏移，弱证据）换成 R6/R7 的**数组字面量**强证据。
3. §1 补 `model` 不可替代端点列的**代码级**依据（`client.ts:457` 早于 `:462` 循环）。
4. §4 补「为何未走 `retry-after` 分支」的毫秒级论证（R12）。
5. §7 脱敏改为非自匹配写法（R11）。
6. 新增本节 §8 复跑表，覆盖全篇所有「相同/一致/无改动」类断言。
