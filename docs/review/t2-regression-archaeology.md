# T2 回归考古：端点候选顺序翻转是真实回归改动，但不是全池 429 的必要原因

- 作者：worker-archaeo（T2）
- 时间：2026-10-18 00:2x CST
- 约束遵守：只读 git 历史；未修改 `src/**`、`packages/core/**`、`dist/**`；未 checkout/reset/clean/stash；未重启 host。本次唯一写操作 = 本文件。
- 代码检索：先 `vectr_search` / `vectr_recall`（命中 `packages/core/src/client.ts:444-491`，与人工核对一致）；git 历史用只读 git 命令。
- 判定门槛：只认「提交内代码差异 + 安装/进程时间线」；运行期因果（谁真的 429）不属于本任务，交给 T3/T4 复现。

---

## 1. 排序结论（#0 必要原因 + Top-3 本仓改动，已按 T4 A/B 修正）

> **修正说明（2026-10-18 00:3x，收到 T4 note #45 / `ops/diag/t4-causal-ab-analysis.md` 后）**
> 初稿把 #1 判为「必要原因候选」。T4 的受控 A/B 显示：**ARM A（旧顺序 daily→sandbox→production）同样是 daily=404 → sandbox=404 → production=429，最终仍 429 并写冷却**。因此在当前 A/B 条件下，端点顺序**不改变结果**，不是必要原因。#1 降级为「真实回归改动，但因果性未成立」；必要原因指向「三个候选端点全部失败」这一上游事实。
> 这 404 是否可能是 project 构造错误？已基本排除：另一路证据（note #41 / `ops/diag/daily-project-retest-2026-10-16T08-51-41-763Z.{log,json}`）用 `loadCodeAssist` 取到真实 project `aicode-consumers`（daily 与 production 同 project）后，对 daily 打 `streamGenerateContent` 仍为 **404 NOT_FOUND**；同一 project 在 production 侧此前是 429。故「恢复 daily 优先」救不了现场（note #41 的结论与本报告一致）。仍留 T3 严格复核该 404 的来源等级。

### #0 【必要原因（证据指向上游；不在本仓 diff 内）】三个候选端点全部无法返回可用响应

T4 A/B 的双臂都以 `daily=404 → sandbox=404 → production=429`（HTTP 层面）收尾，且 429 不兜底、直接写冷却。故「失败」的必要条件是**上游端点全部不可用**（或 daily/sandbox 的 404 为 project 构造错误时的 production 429 闸门）；这不是任何一条提交引入的。判定：**必要原因，但超出本仓考古范围**，定性归 T3。

### #1 【真实回归改动；当前 A/B 证据下 = 无关（非必要原因）】dc0ca77 把请求首选端点从 daily 翻成 production

core 提交 `1c0931a`（2026-10-16 11:55:48）在 3 处翻转端点序；repo 提交 `dc0ca77`（2026-10-16 11:57:44）把 core 指针 `fac08c5 → 1c0931a`，并在 repo 自己的配置副本上做同向翻转。

生成请求的实际生效路径（必须是这一条，否则归因不成立）：

```
src/index.ts:10                 import { AgyAdapter } from './host/adapter.ts'
src/host/adapter.ts:389         const customEndpoints = this.deps.endpointCandidates   // src/index.ts:213-226 未传入 → undefined
packages/core/src/client.ts:451 const endpoints = customEndpoints?.length ? customEndpoints : endpointCandidates()
packages/core/src/client.ts:108 return [...ENDPOINT_FALLBACKS]                           // ← 生效顺序在这里
packages/core/src/client.ts:6-11                                                        // ← dc0ca77 后的顺序：production 第一
src/host/client.ts:1            export * from '../../packages/core/src/client.ts'       // repo 侧只是 re-export core
安装副本 dist/index.js:25650-25654                                                      // 上机代码同为 production 第一
```

- 宿主进程环境无 `ANTIGRAVITY_BASE_URL` / `CLOUDCODE_*` 覆盖（`/proc/666391/environ` 实测为空），配置文件 `~/.dsh/profiles/web/cordis.patch.yml` 无 `endpointCandidates` 键 → 配置兜底不会被 env/overrides 绕开。
- 判定：**真实回归改动；在当前证据下 = 无关（非必要原因）**。理由：翻转本身不产生 429。T4 A 臂证明旧顺序（daily 第一）同样 daily=404 → sandbox=404 → production=429，最终仍 429 并写冷却；note #41 进一步用真实 project 复测 daily 仍 404（非 project 构造错误，见上）⇒ 翻转只改变「先在哪个端点失败」，不改变失败。会改判为必要原因的情形只剩一种：T3 复核推翻 daily 404 的真实性并证明 daily 健康。

### #2 【放大因素，预存在，非回归】429 → 立即 return（不试候选端点）+ 立即写冷却 + 换账号

两处代码都是**初始版本就有**的（`git log -L` 与初始 commit 可证），所以它们不是回归，而是把 #0 的「上游全端点失败」放大成「一次请求全池冷却」的机制：

```
packages/core/src/client.ts:478-480（初始 73fbb2f 同名同义，位于初始文件 477-479 行）
      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 429) {
        return { response: res, endpoint }
      }
```

```
src/host/adapter.ts:460-471（初始 7e6f3d0 已有；ef02239 仅插入 telemetry 行）
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            if (res.status === 429) {
              const resetHeader = res.headers.get('retry-after') || undefined
              if (this.deps.pool && account) {
                this.deps.pool.recordFailure(account.id, family, errText || 'Rate limit 429', resetHeader)
              }
              if (!hasEmitted && attempt < maxAttempts) {
                this.deps.log?.(`Rate limited (429) on ${accountId}, switching accounts...`)
                continue
              }
            } else if (res.status === 401 || res.status === 403) {
```

`maxAttempts` = 号池账号数（`src/host/adapter.ts:223`：`Math.max(1, this.deps.pool ? this.deps.pool.getAccounts().length : 1)`），5 个账号 ⇒ 单次生成最多对 5 个账号各打一次，每个账号被 429 打一次就写一次冷却 ⇒ **一次请求可把整池打成冷却**。

冷却时长（`packages/core/src/pool.ts:590-615`）：429 body 无 `retry-after`/reset 文本时（实测 body 见 §4），走 `Date.now() + Math.min(defaultCooldownMs * failures, maxCooldownMs)` = 900s×失败数、封顶 3600s。

- 判定：**放大因素**（必要共因，但不是本次代码差异）。

### #3 【无关，但影响诊断读数】1c0931a 的 quota 合并/端点偏好改动

同一次 `1c0931a` 还改了：`packages/core/src/quota.ts:20-24`（`mergeFallbackFamilyQuota` 改为字段级合并）、`quota.ts:542-543`（`!summaryFamilies.has(fam) || ...` 才用 discovery 的低值覆盖）、`packages/core/src/oauth.ts:42-47`（`AGY_ENDPOINTS` production 提前，被 `quota.ts:319-327` 的配额刷新轮转消费）。

- 这些都不在生成请求路径上：不会改变某次 `streamGenerateContent` 的成败。
- 危害是**诊断噪声**：`status.quotas.google.remainingFraction=1` 来自配额 API（`quota.ts:472-512` 按 summary bucket 的 `5h` 窗口取值），与「请求被 429」是两条互不推导的证据链。看到 1.0 不代表请求该成功，看到 429 也不代表配额真耗尽 —— 这正是 T3 必须验证的上游事实。
- 判定：**无关**（对请求成败零影响）；仅在解释「为什么配额显示充足却全池 429」时标记为**放大因素（误导性）**。

---

## 2. 证据表 A：直接回归（真实代码翻转；A/B 下不构成必要原因）

| commit | file:line | before | after | 影响 | 判定 |
|---|---|---|---|---|---|
| core `1c0931a` 2026-10-16 11:55:48 | `packages/core/src/client.ts:6-11` | `export const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'`；`ENDPOINT_FALLBACKS = [daily, daily-sandbox, production]` | `DEFAULT_ENDPOINT = 'https://cloudcode-pa.googleapis.com'`；`ENDPOINT_FALLBACKS = [production, daily, daily-sandbox]` | 生成请求首选端点由 daily 变 production；429 命中首端点即终止该账号本次尝试 | **真实翻转；A/B 下无关** |
| repo `dc0ca77` 2026-10-16 11:57:44 | `packages/core`（gitlink） | `fac08c5e101d04d373f92ab6fec9822e8afc659c` | `1c0931a7b625a8e66699e8011e3736d0ff997416` | 上述翻转进入 repo 与 dist（core 被 bundle） | **真实翻转（承载）；A/B 下无关** |
| repo `dc0ca77` | `src/common/types.ts:105-109` | `[daily, daily-sandbox, production]` | `[production, daily, daily-sandbox]` | 同向翻转 repo 配置默认值；**当前生成路径未消费它**（`adapter` deps 未传），故为同步改动而非生效路径 | 同向但非生效路径 |
| core `1c0931a` | `packages/core/src/types/config-types.ts:120-124` | `[daily, daily-sandbox, production]` | `[production, daily, daily-sandbox]` | core 配置默认值同向翻转；同上非生成路径 | 同向但非生效路径 |
| core `1c0931a` | `packages/core/src/oauth.ts:42-47` | `AGY_ENDPOINTS = [daily, production, daily-sandbox, autopush]` | `[production, daily, daily-sandbox, autopush]` | 只影响 `quota.ts:319-327` 配额/模型刷新端点偏好，不影响生成 | 无关（诊断面） |
| 安装产物 | `dist/index.js:25650-25654`（安装副本 sha256 `6b8e1fad…`） | 上一代 `73e0efbf…` 已含 dc0ca77 树（见 §5） | `["https://cloudcode-pa.googleapis.com","https://daily-cloudcode-pa.googleapis.com","https://daily-cloudcode-pa.sandbox.googleapis.com"]` | 上机代码确认 production 第一 | 生效证据 |

精确 diff（core `1c0931a`，`src/client.ts`）：

```diff
-export const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
+export const DEFAULT_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
 export const ENDPOINT_FALLBACKS: readonly string[] = [
   DEFAULT_ENDPOINT,
+  'https://daily-cloudcode-pa.googleapis.com',
   'https://daily-cloudcode-pa.sandbox.googleapis.com',
-  'https://cloudcode-pa.googleapis.com',
 ]
```

repo `dc0ca77` gitlink diff：

```diff
-Subproject commit fac08c5e101d04d373f92ab6fec9822e8afc659c
+Subproject commit 1c0931a7b625a8e66699e8011e3736d0ff997416
```

---

## 3. 证据表 B：预存在放大器（非回归，初始版本即有）

| 位置 | 代码要点 | 引入时间（可复核） | 影响 | 判定 |
|---|---|---|---|---|
| `packages/core/src/client.ts:478-480` | `401/403/400/429 → return { response, endpoint }`，不进入下一个候选端点循环 | `73fbb2f`（2026-09-09，初始）`git show 73fbb2f:src/client.ts` 第 477-479 行同义 | 429 不尝试 daily/sandbox 兜底 | **放大因素（必要共因）** |
| `src/host/adapter.ts:463-470` | 429 → `pool.recordFailure(...)` → `continue`（换账号） | `7e6f3d0`（2026-09-05，初始）`git log -L 455,485:src/host/adapter.ts` | 每个账号被 429 一次即写冷却；`maxAttempts`=账号数 ⇒ 单请求可全池冷却 | **放大因素** |
| `packages/core/src/pool.ts:590-615` | 冷却时长 = `retry-after` 解析值，或 `min(900s×failures, 3600s)` | `73fbb2f` 初始，`b4230b1` 未改该逻辑 | 无 retry 信息时 15/30/45/60 分钟递增 | 机制说明（非回归） |

判定要点：**只翻转端点顺序并不必然导致全池失效**；「全池」由这两处预存在机制放大。因此归因要分开写：*直接改动* = 端点序；*失效规模* = 429 不兜底 + 429 即写冷却。

---

## 4. 运行期与配置读数的判据（只读采集，不重复 T1 的上游请求）

- 安装副本 == 仓库 dist：`sha256sum` 两侧均为 `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`。
- 宿主：`ps -o pid,lstart` → `666391`，`STARTED 五 10月 16 17:16:13 2026`，命令行 `/usr/bin/node …/bin.js web --port 3080 …`；env 无端点覆盖。
- `/plugins/cloudcode-link/status`（GET，只读）：5/5 账号 `enabled=true`，`cooldowns` 均含 `google`，`quotas.google.remainingFraction=1`（`weeklyFraction=1`，`resetTime=2026-10-24T15:46:28Z`，`weeklyResetTime=2026-10-23T14:31:22Z`）。
- 冷却写入时刻反推（`~/.dsh/agy-accounts/pool.json` 与 `/status` 同值）：`cooldownUntil=1792256027943` → `2026-10-17T16:53:47Z`；因 `consecutiveFailures=5` 已进入封顶值 3600s，写入时刻 ≈ `2026-10-17T15:53:47Z` = **2026-10-17 23:53:47 CST**，即当前冷却由 10-17 深夜的真实请求产生，不是 10-16 安装瞬间。
- 冷却 reason 原文（无凭据）：`{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}` —— **无 `retryDelay`/reset 字段**，故冷却时长只能走 `min(900s×fails, 3600s)` 分支。

---

## 5. 最后已知可用版本与回归窗口（判据可复核）

### 5.1 代码级 last-known-good：`957cba6`（2026-10-14 11:37:46 +0800）

| 证据 | 命令 | 结果 |
|---|---|---|
| 提交内 dist 端点序 | `git show 957cba6:dist/index.js \| grep -A4 'const ENDPOINT_FALLBACKS'` | `daily → daily-sandbox → production` |
| 该提交 core 指针 | `git ls-tree 957cba6 packages/core` | `fac08c5e101d…` |
| 该 core 版本的端点序 | `git -C packages/core show fac08c5:src/client.ts \| sed -n '6,11p'` | `DEFAULT_ENDPOINT = daily`，production 最后 |
| 其 repo 配置序 | `git show 957cba6:src/common/types.ts \| grep -A4 DEFAULT_ENDPOINT_CANDIDATES` | `daily → daily-sandbox → production` |

连续性（排除中间另有一次翻转）：`ef02239 / 35359d8 / b9b2881 / a7192d8 / 8e81695 / 957cba6` 的 `HEAD:dist/index.js` 均为 daily 第一；`957cba6..dc0ca77` 只含 `dc0ca77` 一个提交。

> 说明：这是**代码/产物级**的最后已知可用。它是否真的能成功生成，本任务不作断言 —— T4 的 A 臂（daily 优先）与 T3 的 daily 端点测试才是运行期判据。

### 5.2 回归提交：`dc0ca77`（2026-10-16 11:57:44 +0800，父提交 `957cba6`）

- `git show dc0ca77:dist/index.js | grep -A4 'const ENDPOINT_FALLBACKS'` → `production → daily → daily-sandbox`（提交内产物已翻转，非「只改源码未重建」）。
- `git show dc0ca77 -- src/common/types.ts` → 配置默认值同步翻转。
- `git show dc0ca77 -- packages/core` → `fac08c5 → 1c0931a`。

### 5.3 回归窗口

| 阶段 | 时刻（CST） | 证据 |
|---|---|---|
| 代码翻转 | 2026-10-16 11:57:44 | `dc0ca77` 提交时间 |
| 首个含翻转的构建 | 2026-10-16 12:05:25 | 上一代安装产物 `73e0efbf…` mtime `2026-10-16T04:05:25Z`（`ops/verify/probe-2026-10-16T06-19-35-857Z.log` 记录安装副本 mtime/sha） |
| 安装副本 == `dc0ca77:dist` 的审计 | 2026-10-16 14:1x | `ops/audit/install-audit.md`：HEAD=`dc0ca77`，安装副本与 `HEAD:dist` 逐字节一致（`73e0efbf…`） |
| 换装当前产物 | 2026-10-16 15:42:06~07 | `ops/release/install-complete.json` + `ops/verify/t9-process-fresh-record.md`（`installCompletedUtc=2026-10-16T15:42:06+08:00`，sha `6b8e1fad…`） |
| host 重启（上一代 pid 581348） | 2026-10-16 15:42:17 | 同上（`new_pid=581348 new_start 15:42:17`） |
| 当前 host 启动 | 2026-10-16 17:16:13 | `ps -o lstart -p 666391` |
| 当前冷却写入 | 2026-10-17 23:53:47 | `cooldownUntil − 3600s`（§4） |

**结论**：回归窗口下界 = `dc0ca77`（2026-10-16 11:57:44 CST）；代码面此后无再次翻转（`git log dc0ca77..HEAD -- src/common/types.ts packages/core dist/index.js` 仅 `8edc033`，其 `HEAD:dist` 仍 production 第一，core 只到 `e52abe7`：oauth 回调端口测试修复）。产物面上机不晚于 2026-10-16 14:1x（审计证据），并持续到当前 host。

---

## 6. 其余提交逐条判定（2026-09-05 至今）

### repo

| commit | 日期 | 触及的请求相关面 | 判定 |
|---|---|---|---|
| `7e6f3d0` | 09-05 | 初始版本（daily 第一、429 立即 return、429 写冷却均已存在） | 基线 |
| `d02f711` | 09-08 | cache/pool 钉住、adapter/pool/quota 调整 | **无关**（未改端点序/模型 wire slug/鉴权头/429 分支） |
| `f5bed5e` | 09-09 | 抽出 core 子模块；core 初始 `73fbb2f` 端点序与 repo 一致（daily 第一） | **无关**（重构，语义等价） |
| `dbdb945` | 09-09 | 显式 accounts 注入、pool 恢复 | **无关** |
| `34c25de` | 09-09 | 更新 core + 重建 dist | **无关** |
| `ef02239` | 09-15 | 同步 core、stats；adapter 仅加 telemetry 行 | **无关** |
| `58b8e5a` | 09-15 | round-robin 等额配额轮转（选择面） | **无关**（不改变单次请求成败） |
| `7d797f3` | 09-17 | `inputModalities` 声明（展示面） | **无关** |
| `35359d8` / `b9b2881` | 10-06 / 10-07 | 模型目录 Gemini 4 支持、只显示上游模型（core `7ad4593`/`94b1423`）；未改 `ANTIGRAVITY_ROUTING` | **无关**（wire slug 未变） |
| `8e81695` / `a7192d8` | 10-09 | stats 迁移、账号别名（pool 显示面） | **无关** |
| `e22400f` + `348c6c6` | 10-13 | 真轮转 → 立即 revert；`git diff --stat e22400f^ 348c6c6 -- src/host/{adapter,pool}.ts src/client/index.ts` 输出为空 | **无关（净零）** |
| `957cba6` | 10-14 | UI/命令改名；adapter 仅注释与错误文案（`/agy`→`/ccl`） | **无关** |
| `dc0ca77` | 10-16 | **端点序翻转生效**（core 指针 + repo 配置 + 提交内 dist） | **真实翻转；A/B 下无关（非必要）** |
| `8edc033` | 10-16 | core `e52abe7`（oauth 回调端口可注入，测试面） | **无关** |
| `a7ebb95`/`af1cec5`/`0dc6c43`/`4dda09f`/`03fd33c` | 10-16 | 发布/验证/文档/provenance 流水线 | **无关** |

### core（submodule）

| commit | 日期 | 触及面 | 判定 |
|---|---|---|---|
| `73fbb2f` | 09-09 | 初始：daily 第一、429 立即 return、429 写冷却、`ANTIGRAVITY_ROUTING` 建立 | 基线 |
| `b4230b1` | 09-09 | `streamGenerateContent` 加 `timeoutMs: null`（禁用流超时） | **无关**（不改变 429/404 语义；注意：禁用超时会让挂起请求一直占用） |
| `3e2b1dd` | 09-09 | 类型加宽 | **无关** |
| `1a08cd5` | 09-09 | `thoughtSignature` 跨 chunk 保留（SSE 解析） | **无关** |
| `0fcea9c` | 09-15 | 配额感知的账号选择（选择面） | **无关** |
| `9ae37bb` | 09-15 | 聚合 stats、轻量配额刷新、邮箱脱敏 | **无关** |
| `22b2418` | 09-15 | 等配额时轮转（选择面） | **无关** |
| `bef5f33` / `ef0ad91` | 09-14 | stats/sqlite | **无关** |
| `797ca3b` / `1496136` / `59d9325` | 10-09 | 账号复活/别名（pool 展示面） | **无关** |
| `7ad4593` / `94b1423` | 10-06 / 10-07 | 模型目录与发现（展示面）；`git log -S 'ANTIGRAVITY_ROUTING' -- src/models.ts` 仍只有 `73fbb2f` | **无关** |
| `0820696` | 09-28 | `message-converter` 消息契约映射 | **无关**（不涉及端点/鉴权/429） |
| `846a301` + `fac08c5` | 10-13 | 真轮转 → revert；`git diff --stat 846a301^ fac08c5 -- src/pool.ts` 输出为空 | **无关（净零）** |
| `1c0931a` | 10-16 | **client.ts 端点序翻转**；quota 合并；`AGY_ENDPOINTS` 翻转；`models.ts` 仅加 `RUNTIME_MAX_OUTPUT_TOKENS` 7 行 | **真实翻转；A/B 下无关（非必要）** |
| `e52abe7` | 10-16 | oauth 回调端口可注入（`startCallbackListener({port, timeoutMs})`） | **无关**（认证回调面；不影响生成请求头） |

模型 slug 专项结论：`ANTIGRAVITY_ROUTING` / `resolveModelSlug` / `getAntigravityRequestModelId` 的 wire 映射自 `73fbb2f` 未变；`1c0931a` 对 `models.ts` 的 7 行全部是 `RUNTIME_MAX_OUTPUT_TOKENS` 新增（`packages/core/src/models.ts:597-603`），`dc0ca77`/`1c0931a` 对兜底模型列表的补充属目录展示面 ⇒ **上游 404/429 不能由本次模型 slug 变更解释**。

鉴权/请求头专项结论：`antigravityHeaders`、`anthropic-beta`、`loadCodeAssist/ensureProject` 均在 `packages/core/src/client.ts`，该文件 2026-09-05 至今只有 3 次改动（`73fbb2f` 初始、`b4230b1` 加 `timeoutMs: null`、`1c0931a` 只改端点 6 行）⇒ **鉴权头与 project 发现未变**。

---

## 7. 每条结论的复核命令（可直接跑）

```bash
# 0) 环境与产物一致性
cd /home/csy/Code/Github/dsh-cloudcode-link
sha256sum dist/index.js /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
git -C packages/core rev-parse --short HEAD        # 期望 e52abe7
git log -1 --format='%h %ai %s'

# 1) #1 端点序翻转（生效路径）
git -C packages/core show 1c0931a -- src/client.ts | sed -n '1,20p'
git -C packages/core show fac08c5:src/client.ts | sed -n '6,11p'
git show dc0ca77 -- packages/core
git show dc0ca77 -- src/common/types.ts
sed -n '6,11p' packages/core/src/client.ts
sed -n '103,110p' packages/core/src/client.ts
sed -n '451p;462p;478,480p' packages/core/src/client.ts
grep -n 'const ENDPOINT_FALLBACKS' -A4 dist/index.js

# 2) #2 429 不兜底 + 立即写冷却 + 上限=账号数
sed -n '476,481p' packages/core/src/client.ts
git show 73fbb2f:src/client.ts | sed -n '475,480p'        # 证明初始即如此
sed -n '460,471p' src/host/adapter.ts
sed -n '223p;227,230p' src/host/adapter.ts
sed -n '590,615p' packages/core/src/pool.ts

# 3) #3 quota 面（与生成无因果）
git -C packages/core show 1c0931a -- src/quota.ts src/oauth.ts
sed -n '319,327p' packages/core/src/quota.ts
curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status | jq '.pool.accounts[] | {id: .id[0:8], enabled, families: (.cooldowns|keys), google: .quotas.google}'

# 4) last-known-good / 回归窗口
git show 957cba6:dist/index.js | grep -A4 'const ENDPOINT_FALLBACKS'
git show dc0ca77:dist/index.js | grep -A4 'const ENDPOINT_FALLBACKS'
git log --format='%h %ai %s' 957cba6..dc0ca77
git log --format='%h %ai %s' dc0ca77..HEAD -- src/common/types.ts packages/core dist/index.js
git ls-tree 957cba6 packages/core; git ls-tree dc0ca77 packages/core
grep -n 'installCompletedUtc\|installedSha256\|new_pid' ops/release/install-complete.json ops/verify/t9-process-fresh-record.md
grep -n 'HEAD `dc0ca77`\|73e0efbf' ops/audit/install-audit.md
ps -o pid,lstart -p 666391
date -u -d @1792256027 '+%FT%TZ'; date -u -d @$((1792256027-3600)) '+%FT%TZ'

# 5) 排除项
git diff --stat e22400f^ 348c6c6 -- src/host/adapter.ts src/host/pool.ts src/client/index.ts   # 空
git -C packages/core diff --stat 846a301^ fac08c5 -- src/pool.ts                              # 空
git -C packages/core log --format='%h %s' -S 'ANTIGRAVITY_ROUTING' -- src/models.ts            # 仅 73fbb2f
git -C packages/core log --format='%h %s' -- src/client.ts                                     # 仅 3 个提交
```

---

## 8. 未证实项 / 边界（不许当结论用）

1. **daily 端点健康状态：证据分两层，结论倾向「daily 真的变了」**。(a) 上一轮笔记 #40 的 daily 404 极可能是跳过 `loadCodeAssist` 的构造错误（T3 任务描述已点名）；(b) 但 note #41 用真实 project `aicode-consumers` 复测 daily 的 `streamGenerateContent` 仍 404，且 daily 与 production 的 `loadCodeAssist` 返回同一 project。故「恢复 daily 优先」**不是已证修复**，按 #41 甚至救不了现场；其真实性仍待 T3 补齐响应头级别证据。
2. **production 429 是否为配额真耗尽未证**：配额 API 报 `remainingFraction=1` 与请求 429 相互矛盾，二者来源不同（§1 #3），只能由 T3 用原始响应头/buckets 定性（配额墙 vs 版本/鉴权闸门）。
3. **必要原因指向上游，已两次独立指向**：T4 A 臂（旧顺序）daily=404 → sandbox=404 → production=429，最终 429 并写冷却；note #41 用真实 project 复测 daily 仍 404。⇒ 顺序翻转不是必要原因，#1 判无关。残余风险：daily 404 的证据等级（#41 为 agent 笔记 + 单账号 3 请求）与 production 429 的响应头缺失（T3 负责补齐）；若 T3 推翻 daily 404，则 #1 需改判为必要原因。
4. **`b4230b1` 的 `timeoutMs: null`** 会取消流式请求超时；在当前 429 场景不构成失败原因，但若出现「请求挂住」现象需单列排查。
5. **cooldown 证据有时效**：T1/T4 的真实上游请求会继续刷新 `pool.json`；本报告的冷却时刻（10-17 23:53:47 CST）是采集时刻快照，复核请连同 `/status` 的 `updatedAt` 一起记录。
