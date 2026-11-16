# T3 — 最小可复制配方 → 插件侧改动证明

- 任务：`task-10`（T3）；执行：`worker-fix`（只编排；harness/构建/请求/patch 由二级 subagent 执行）
- 结论时间：2026-11-16 18:31 CST
- 产物：本文件 + [`t3-patch.diff`](./t3-patch.diff) + [`t3-proof.json`](./t3-proof.json) + [`t3-proof.log`](./t3-proof.log) + `t3-evidence/`（关键原始 JSON/SSE 副本，已脱敏）
- 临时构建：`/tmp/relink-build`（repo rsync 副本，node_modules 软链）；**repo 工作区零改动**（`git status` 中本任务只新增 `ops/relink/t3-*`）

---

## 0. 一句话结论

**插件现有代码不需要改 UA / 请求头 / body 大小写；唯一必要变量是端点。**
把生成端点从 `cloudcode-pa.googleapis.com`（production）换成 **`daily-cloudcode-pa.googleapis.com`**，配合模型 **`gemini-3.5-flash-lite`** 与 LCA 返回的 project **`aicode-consumers`**，插件原样代码即可拿到 **200 + 非空 SSE**（实测正文 `Hi there! How can I help you today?`）。

最小改动 = **2 行补丁**（`ENDPOINT_FALLBACKS` 把 daily 移到首位）。**不需要重启 host**：重打 dist → 覆盖 profile 副本 → 触发 profile recomposition/HMR 重载即可（见 §5）。

---

## 1. 已验证配方（真实上游 200）

| 项 | 值 | 来源 |
|---|---|---|
| 端点 | `https://daily-cloudcode-pa.googleapis.com` | gen#3 实测 |
| 方法/路径 | `POST /v1internal:streamGenerateContent?alt=sse` | gen#3 |
| 模型 | `gemini-3.5-flash-lite` | gen#2/#3 |
| project | `aicode-consumers` | 插件 `loadCodeAssist` 真实响应 |
| 账号 | 号池 `acc_1788785623927_xhs7n`（index 1） | pool.json |
| 出口 | host 本机 TUN 默认路由（未设 proxy env、未切 Clash selector） | 与 T1 收官状态一致 |
| 身份/请求头/body | **全部保持插件默认**（UA `antigravity/hub/2.8.0 …`、`X-Goog-Api-Client`、`Client-Metadata`、body `userAgent:"ANTIGRAVITY"` / `requestType:"AGENT"`） | gen#3 探针注入开关全 false |

**gen#3 原始输出（插件真实代码路径，零改动）：**

```json
{"ts":"2026-11-16T10:23:22.240Z","op":"generate","account":"acc_1788785623927_xhs7n",
 "model":"gemini-3.5-flash-lite","endpoint":"https://daily-cloudcode-pa.googleapis.com",
 "status":200,"contentType":"text/event-stream","bytes":1451,
 "firstText":"Hi there! How can I help you today?","sseEventCount":4,
 "injection":{"headers":false,"clientMetadata":false,"patchedCore":false,"ua":null,
 "coreSrc":"/tmp/relink-build/packages/core/src/client.ts"},
 "durationMs":3092}
```

---

## 2. 证据表（4 次生成预算，全部登记）

| # | UTC | 端点 | 请求体 | 身份 | 结果 | 判读 |
|---|---|---|---|---|---|---|
| 1 | 10:14:56 | daily | 官方 34.7KB 生成体（捕获 -35）原样 | 官方 CLI | **404** NOT_FOUND（114B） | body 内嵌捕获账号 session/cascade 作用域 ID，换号后按 ID 找不到实体；与端点无关 |
| 2 | 10:21:26 | daily | 官方 942B checkpoint 体（捕获 -33）仅换 requestId | 官方 CLI | **200**，1444B，4 帧，`gemini-3.5-flash-lite`，usage 119 | 配方成立（官方契约在号池账号上复现成功） |
| 3 | 10:23:22 | daily | **插件默认 body**（AGENT/ANTIGRAVITY） | **插件默认头** | **200**，1451B，4 帧，正文 `Hi there! How can I help you today?` | **插件原样代码在正确端点下成功** |
| 4 | 10:26:14 | production | 同 #3 | 同 #3 | **429** RESOURCE_EXHAUSTED（139B 固定体） | 同账号同模型相隔 2 分钟，唯一差异=端点 ⇒ **端点是决定性变量** |

非生成元数据（2 次 `loadCodeAssist`，同账号同出口、背靠背 13s 内）：

| # | 身份 | 结果 |
|---|---|---|
| 1 | 插件默认（antigravity/hub/2.8.0 + IDE 头） | **200**，`ineligibleTiers=null`，`currentTier=free-tier`，`project=aicode-consumers` ⇒ **插件身份不被资格闸门拦** |
| 2 | 官方 `@google/gemini-cli@0.68.0`（UA `GeminiCLI/0.68.0/…` + IDE_UNSPECIFIED + 无 IDE 头） | 200 但 `ineligibleTiers=[UNSUPPORTED_CLIENT]`（"请迁移到 Antigravity"） ⇒ 换身份反而更差，**身份补丁作废** |

请求计数：**生成 4/4 已用尽**；`loadCodeAssist` 2 次（非生成）。计数器原文见 `t3-proof.log` §1-§2。

---

## 3. 与 T1 / T2 结论的拼接

- **T2**：官方 `agy 1.3.5` 的生成只走 **daily**（production 从未出现在官方生成流量里）；插件默认 production-first，且遇 429 立即返回、不试下一候选——这正好解释"为什么插件总撞 429"。
- **T1**：6 个境外出口对官方 CLI 全部 `ineligible`（`not available in your location`）——那是 **loadCodeAssist 资格层**（HTTP 仍 200、客户端本地中止），与生成 API 的 429 是两层；出口无需再试。
- **本任务**：插件身份 LCA `ineligibleTiers=null` ⇒ 资格层并不拦插件；生成 429 纯粹是**端点（production）**问题。daily + flash-lite 在插件原样代码上 200。

---

## 4. 最小改动（`t3-patch.diff`）

```diff
diff --git a/packages/core/src/client.ts b/packages/core/src/client.ts
@@ -5,8 +5,8 @@ import { fnv1a64Signed } from './sessions.ts'
 export const DEFAULT_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
 export const ENDPOINT_FALLBACKS: readonly string[] = [
-  DEFAULT_ENDPOINT,
   'https://daily-cloudcode-pa.googleapis.com',
+  DEFAULT_ENDPOINT,
   'https://daily-cloudcode-pa.sandbox.googleapis.com',
 ]
```

- **1 insertion / 1 deletion（2 行）**；`DEFAULT_ENDPOINT` 常量值与导出语义不变。
- 效果：不设任何 env 时 `endpointCandidates()` 首元素 = daily；失败仍依次回退 production → sandbox。
- 影响面：`loadCodeAssist` / `onboardUser` / `streamGenerateContent` 等所有走 `endpointCandidates()` 的调用默认首选 daily；`quota.ts` 有独立端点列表，不受影响。
- 验证（干净副本，`/tmp/relink-patch/VERIFY-FINAL.md`）：`git apply --check` OK、`tsc --noEmit` exit=0、仓库测试 **212 pass / 0 fail**、patched `endpointCandidates()` 首元素 = daily、显式 `ANTIGRAVITY_BASE_URL` 回归不变。
- 历史呼应：`dc0ca77` 曾把首选端点从 daily 翻成 production，是"全池 429"的放大器；本补丁 = 把默认顺序恢复为 daily-first。

**被否掉的更小方案（如实记录）：**

| 方案 | 结论 |
|---|---|
| 改插件配置 `baseUrl` | ❌ 生成路径不消费 `config.baseUrl`（全仓库仅 config 解析处出现，无消费者）——属死配置 |
| 设 `ANTIGRAVITY_BASE_URL` env | ⚠️ 可行（`client.ts:104` 请求时读 env），但 host 进程启动时无该变量，改 env 需重启 host ⇒ 不作为首选 |
| 身份补丁（cand-b/b2：UA/Client-Metadata/body 大小写） | ❌ 已实测身份不改变闸门，且 GeminiCLI 身份反而 `UNSUPPORTED_CLIENT` |
| onboard 补丁（cand-c） | ❌ LCA 已 eligible、project 已存在；onboard 是写操作，无需 |

---

## 5. 生效机制：是否需要重启 host？

**不需要重启 host（证据强，但未在运行 host 上实测）。**

插件在 host 进程内，运行中加载的是 **profile 里的复制件**：
`~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js`
（sha256 `6b8e1fad…` == repo `dist/index.js`；是复制非软链）。

落地步骤（由 Lead 决策；本任务未执行任何写 profile / 重载动作）：

1. repo 根 `pnpm build` —— root 打包经 `src/host/client.ts:1` 的 `export * from '../../packages/core/src/client.ts'` 直接吃 core 源码，新 `dist/index.js` 即含补丁。
2. 备份并把新 `dist/index.js` 覆盖到 profile 副本（**保留旧文件以便回滚**）。
3. 触发 recomposition：让 profile 的 `cordis.patch.yml` **内容**变化一次（最轻：加一行注释），或使用 plugin_manager 的启停动作。DSH 的 HMR loader 监听该文件内容变化 → `reconcileProfile()` 比对 inode/size/mtime → evict → **重新 import** 插件包；插件日志/启动记录显示 hmr 条目已激活。
4. 验证：`GET /plugins/cloudcode-link/status` 正常；再发 1 次真实生成确认 200（会花 1 次生成预算，需 Lead 批准）。

注意：
- 单纯 `cp` 覆盖**不会**自动触发（HMR root 为空列表），必须让 profile 配置内容变化一次。
- 失败不回退旧码；恢复旧 `dist/index.js` 再触发一次即可，**仍无需重启**。
- `dist/client.js`（web 客户端半）有 immutable cache rev，本次补丁只动 host 半，不影响；若要一起重装建议 bump 版本号。
- 兜底（Lead 若坚持保守）：`scripts/deploy/restart-host.sh --schedule [--force]` —— **会杀掉当前会话与并行会话**；执行者不得自行重启。

依据：`/tmp/relink-recon/RESTART.md`（DSH 源码级：HMR 默认启用、监听 profile patch 内容、installed packages below `node_modules` "takes effect without a restart"）。

---

## 6. 复现命令（不改 repo，不改 host）

```bash
# 探针：插件真实代码路径（packages/core/src/client.ts streamGenerateContent）
PROBE_ALLOW_UPSTREAM=1 \
PROBE_ENDPOINTS=https://daily-cloudcode-pa.googleapis.com \
PROBE_ACCOUNT_DIR=acc_1788785623927_xhs7n \
PROBE_MODEL=gemini-3.5-flash-lite \
PROBE_PROJECT=aicode-consumers \
PROBE_PROMPT=hi PROBE_TIMEOUT_MS=90000 \
node /tmp/relink-build/probe/probe.mjs
# 期望：status=200, contentType=text/event-stream, sseEventCount>=1, firstText 非空
```

注意：`/tmp/relink-build` 是本次会话的临时目录；跨会话复现需重新 rsync（`--exclude node_modules --exclude .git` + node_modules 软链），探针脚本源码即本仓库 `packages/core`。

---

## 7. 限制与未验证（不得升格为结论）

1. **补丁本身未在运行 host 内实测**（生成预算 4/4 已用尽）。补丁只改变端点选择；daily 端点在**同账号、同模型、同代码路径**下已由 gen#3 证明 200。
2. **模型是否必须 `gemini-3.5-flash-lite` 未单独隔离**：本轮 daily 只用 flash-lite 验证；历史记录里 daily + 旧 Gemini 模型曾 404。故配方把模型一并写死为 flash-lite。
3. daily 是日构建入口，可用性可能波动；补丁保留 production/sandbox 回退（且 daily 404 时会继续切下一候选）。
4. HMR recomposition 路径来自源码级证据，**未在本机执行**；不能保证 100% 一次成功。
5. T1 的 6 个境外出口 ineligible 属资格层，与本任务生成 429 无关；本轮未再尝试出口。
6. 号池账号 `lastUsedAt` 仍是 31 天前属正常：本次请求走的是探针直连（未改插件 pool 状态；请求成功后插件自身 stats/cooldown 不会因探针而更新）。

---

## 8. 脱敏与预算

- 生成请求 **4/4**（登记见 `t3-proof.json.upstream_request_budget` 与 `t3-proof.log` §1）；`loadCodeAssist` 2 次（非生成）。
- token 全程未打印（仅 `Bearer ****`）；SSE 中 `thoughtSignature` 长 base64 已替换为 `<BASE64_REDACTED len=N>`。
- 三类凭据前缀（access-token / refresh-token / JWT）扫描：本目录 4 个产物 + `t3-evidence/` 全部命中均为 **0**；邮箱类 PII 命中 тоже 0。
  扫描工具：`ops/diag/t4-redact-scan.py`（上一轮已存在的脱敏扫描器）；连续字面量故意不写入本文件，避免自命中。
- repo 工作区：本任务只新增 `ops/relink/t3-*`；未改 `packages/**`、`src/**`、`dist/**`、`~/.dsh`、`/usr/bin/agy`、`/tmp/agy-fix`。
