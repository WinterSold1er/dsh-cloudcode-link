# T6 时间线取证：最后一次成功 vs 失败起点

worker-forensics | 2026-10-18 | 全程只读

结论先行：**最后一个真实上游生成成功的证据 = 2026-10-16 04:30:51Z / 12:30:51 CST。
失败起点区间 = (12:30:51, 16:11:25] CST，区间内 0 条请求记录，故起点瞬时不可观测。
翻转代码首次在运行进程中生效 = 14:20:50 CST（PID 500951），落在起点区间之内。
自翻转代码生效起，stats.db 中成功数 = 0（1.5 天）。**

---

## 1. 证据源与只读方法

| 证据源 | 路径 | 读取方式 |
|---|---|---|
| 插件持久化统计 | `/home/csy/.cloudcode/accounts/stats.db`（19 MB，+WAL 4.2 MB） | `sqlite3 -readonly`（mode=ro，无任何写入） |
| 号池快照 | `~/.dsh/agy-accounts/pool.json` | 只读 JSON 解析 |
| host 日志 | `journalctl --user -u deepseek-harness.service` | 只读 |
| 本次产物 | `ops/verify/*`、`ops/release/*`、`ops/diag/*`、`docs/review/t2-*` | 只读 |
| 进程事实 | `/proc/666391`、`systemctl --user show` | 只读 |

DB 路径常量定位（vectr）：
- `src/common/types.ts:139` → `statsDbPath: join(defaultPoolDir(), 'stats.db')`
- `packages/core/src/pool.ts:18` → `defaultPoolDir()` 默认 `homedir()/.cloudcode/accounts`
- 表结构：`packages/core/src/stats/storage/sqlite.ts:33`（`request_metrics` / `session_metrics`）
- host 进程环境无 `CLOUDCODE_ACCOUNTS_DIR` / `ANTIGRAVITY_ACCOUNTS_DIR` ⇒ 实际路径 = `~/.cloudcode/accounts/stats.db` ✓ 与磁盘一致

`request_metrics` 列：`requestId, sessionId, accountId, model, timestamp, status, latencyMs, ttftMs, cacheHit, promptTokens, cachedTokens, outputTokens`。
**无 HTTP 状态码列，无端点列，无 pool.json 冷却/失败计数字段。**（→ 见 §9 未找到清单）

---

## 2. 主时间线

| 时刻 (UTC) | 时刻 (CST) | 事件 | 证据来源 | 原文摘录 |
|---|---|---|---|---|
| 2026-10-14 03:37 | 10-14 11:37 | last-known-good 提交 `957cba6` | docs/review/t2-regression-archaeology.md（T2 已证，本表引用不复查） | — |
| 2026-10-16 02:03:11.991 | 10-16 10:03:11.991 | host PID **420693** 启动（**翻转前代码**） | `ops/verify/probe-2026-10-16T06-19-35-857Z.json` | `"hostPid":420693,"hostStartMs":1792116191991` |
| 2026-10-16 03:57:44 | 10-16 11:57:44 | 翻转提交 `1c0931a` + `dc0ca77`（首选端点 daily→production） | T2 已证 | — |
| 2026-10-16 04:05:25.479 | 10-16 12:05:25.479 | 翻转产物 `73e0efbf` 落盘（安装路径 mtime）**但 host 未重启** | `ops/verify/probe-2026-10-16T06-19-35-857Z.json` | `installed artifact mtime 1792123525479.5623 (2026-10-16T04:05:25.479Z)`；`the running process predates the new build` |
| 2026-10-16 04:05:25 → 04:30:51 | 12:05:25 → 12:30:51 | **401 次成功**（旧进程仍在跑翻转前代码） | stats.db | `COUNT(*)=401 WHERE status='success' AND timestamp > 1792123525479` |
| **2026-10-16 04:30:51** | **12:30:51** | **最后一个上游生成成功**（xhs7n, gemini-3.8-flash-high, 7999 ms / 8706 ms 两条同秒） | stats.db | `MAX(timestamp)=1792125051177 WHERE status='success'` |
| 2026-10-16 06:19:35 | 14:19:35 | 探针 FAIL：进程早于产物 | `ops/verify/probe-2026-10-16T06-19-35-857Z.json` | `verdict:"FAIL"`，`process_fresh FAIL`，`bundle_defines_ccl FAIL` |
| 2026-10-16 06:20:30 | 14:20:30 | 探针 PASS 但仍为旧进程 420693 | `ops/verify/probe-2026-10-16T06-20-30-464Z.json` | `"hostPid":420693` |
| **2026-10-16 06:20:50** | **14:20:50** | host PID **500951** 启动 ⇒ **翻转代码首次在运行进程中生效** | `ops/verify/probe-2026-10-16T06-21-02-646Z.json` | `"hostPid":500951,"hostStartMs":1792131650836` |
| 2026-10-16 06:21:02 → 06:49:07 | 14:21 → 14:49 | 5 个探针 PASS（**仅 HTTP 面 + 配额 API，无一次生成调用**） | `ops/verify/probe-*.json`；`grep -l "streamGenerateContent\|generateContent" ops/verify/*` → 0 命中 | `verdict:"PASS"` |
| 2026-10-16 06:40:52 | 14:40:52 | host PID 518224 启动 | `ops/verify/probe-2026-10-16T06-46-16-700Z.json` | `"hostPid":518224,"hostStartMs":1792132852657` |
| 2026-10-16 06:46:45 | 14:46:45 | host PID 524277 启动 | `ops/verify/probe-2026-10-16T06-47-02-274Z.json` | `"hostPid":524277,"hostStartMs":1792133205531` |
| 2026-10-16 07:41:45 | 15:41:45 | release 流水线启动 | `ops/release/install-complete.json`.provenance | `release-20261016T074145Z.log:2 started_at 2026-10-16T15:41:45+08:00` |
| 2026-10-16 07:42:06 | 15:42:06 | 安装 `6b8e1fad` 完成（记录自称事后补写） | `ops/release/install-complete.json` | `"installedSha256":"6b8e1fad…"`；`provenance.writtenAfterTheFact=true` |
| 2026-10-16 07:42:17 | 15:42:17 | host PID 581348 启动（第 2 次生效翻转代码） | `ops/release/release-20261016T074145Z.log:67` | `restarted_after=12s new_pid=581348 new_start=Fri 2026-10-16 15:42:17 CST` |
| **2026-10-16 08:11:25** | **16:11:25** | **stats.db 第一条 error**（n0tdx, gemini-3.8-flash-low, 1235 ms）——**注意：DB 不记录 HTTP 码，此条不能断言为 429** | stats.db | `2026-10-16 08:11:25Z\|16:11:25 CST\|error\|acc_1788868397749_n0tdx\|1235` |
| 2026-10-16 08:14:21.427 | 16:14:21 | 安装产物 mtime 被重写（晚于 host 启动） | `ops/release/probe-out-…082438Z/probe-…082457420Z.json` | `artifact mtime 1792138461427.841 is LATER than host start 1792136537316` |
| 2026-10-16 09:32:04 | 17:32:04 | error（pqxkh, 1587 ms） | stats.db | 同上格式 |
| 2026-10-16 09:16:14 | 17:16:14 | host PID 666391 启动（当前进程） | `systemctl --user show`；journal | `ExecMainStartTimestamp=Fri 2026-10-16 17:16:14 CST`；`MainPID=666391`；上实例 `1h 33min 56.406s wall` ⇒ 起于 15:42:17.6 CST（自洽） |
| 2026-10-17 15:53:47.943 → 15:55:11.023 | 10-17 23:53:47 → 23:55:11 | 末次 5 账号**顺序扫掠**：每账号 429 → 立即写 `cooldownUntil = t + 3600 s`，并在 t+2 ms 刷新该账号配额 | `ops/diag/t4-live-pool-snapshot.json` | pqxkh `16:53:47.943Z` / xhs7n `16:54:13.681Z` / 50yxc `16:54:35.978Z` / 5ptu4 `16:54:55.258Z` / n0tdx `16:55:11.023Z`；`reason` 含 `"code": 429, "status": "RESOURCE_EXHAUSTED"` |
| 2026-10-17 15:55:02 | 10-17 23:55:02 | stats.db 最后一行：error n0tdx，8243 ms ⇒ 08:2 s 后即 23:55:11 写入冷却，**与上一条自洽** | stats.db | `1792252502782` |
| 2026-10-17 16:20:50 | 10-18 00:20:50 | T1 强制 `/pool/refresh-quota` → 5 账号 `remainingFraction=1`、`resetTime` 未来 | `ops/diag/t1-status-after-refresh-2026-10-17T16-20-33-236Z.json` | 全 5 账号 `updatedAt=1792254050992` |
| 2026-10-18 00:1x | 10-18 00:1x | T4 实测：production=429、daily=404、sandbox=404 | `ops/diag/t4-causal-ab-analysis.md`（T4 已证） | — |

---

## 3. stats.db 提取（每账号，全库 51245 行）

| accountId | status | n | 首（CST） | 末（CST） |
|---|---|---|---|---|
| acc_1788420803749_hanbs | success | 4165 | 09-18 16:19:05 | 09-30 17:18:52 |
| acc_1788420803749_hanbs | error | 4 | 09-18 16:12:57 | 09-23 15:57:26 |
| acc_1788769443420_5ptu4 | success | 11859 | 09-18 16:54:46 | **10-16 12:30:30** |
| acc_1788769443420_5ptu4 | abort | 8 | 09-23 14:09:00 | 10-13 11:44:27 |
| acc_1788785623927_xhs7n | success | 10739 | 09-18 17:19:03 | **10-16 12:30:51** |
| acc_1788785623927_xhs7n | abort | 2 | 10-08 09:53:13 | 10-10 09:34:40 |
| acc_1788868397749_n0tdx | success | 11801 | 09-18 16:16:20 | **10-15 18:09:32** |
| acc_1788868397749_n0tdx | error | 5 | 10-14 16:28:57 | **10-17 23:55:02** |
| acc_1788868397749_n0tdx | abort | 11 | 09-18 15:20:39 | 10-13 11:47:21 |
| acc_1788949635573_50yxc | success | 11546 | 09-18 17:15:25 | **10-16 11:17:50** |
| acc_1788949635573_50yxc | abort | 1 | 10-13 09:46:40 | 10-13 09:46:40 |
| acc_1792116942660_pqxkh | success | 1093 | 10-16 10:25:16 | **10-16 12:28:28** |
| acc_1792116942660_pqxkh | error | 1 | 10-16 17:32:04 | 10-16 17:32:04 |

全库状态计数：`success 51203 | abort 22 | error 20`。
`timestamp` 语义 = **请求开始时刻**；`latencyMs` = 该次尝试耗时。

原始行 dump：`docs/review/t6-db-rows-since-2026-10-16T03.txt`、`docs/review/t6-db-rows-after-2026-10-16T07-16Z.txt`。

**翻转代码生效后（> 1792131650836）的行：全库仅 3 行，全部 `error`，成功数 = 0。**
```
2026-10-16 08:11:25Z | 16:11:25 CST | error | acc_1788868397749_n0tdx | gemini-3.8-flash-low  | 1235 ms
2026-10-16 09:32:04Z | 17:32:04 CST | error | acc_1792116942660_pqxkh | gemini-3.8-flash-high | 1587 ms
2026-10-17 15:55:02Z | 23:55:02 CST | error | acc_1788868397749_n0tdx | gemini-3.8-flash-high | 8243 ms
```

---

## 4. 三个明确回答

**Q1 最后一个「上游生成成功」的证据时刻 = 2026-10-16 04:30:51Z / 12:30:51 CST。**
判据：`status='success'` 行由 `StatsCollector` 在流正常结束后落库（`latencyMs` 5–28 s，符合真实生成耗时；同期 `error` 行为 1.2–8.2 s 快速失败）。这是本机能找到的**唯一**一类上游生成成功证据。
`lastUsedAt`（pool.json）与各账号最后一次 success 同刻，交叉自洽（例：n0tdx `1792058977189` ↔ 10-15 18:09:32 success）。

**Q2 失败起点区间 = (2026-10-16 12:30:51 CST, 2026-10-16 16:11:25 CST]。**
区间内 stats.db **0 行记录**（无请求发生）⇒ 起点瞬时不可观测，只能给区间。
区间长度 3 h 40 min。

**Q3 与 dc0ca77 上机 / 重启的相对关系：**

| 参照事件 | CST | 与区间的关系 |
|---|---|---|
| 翻转提交 dc0ca77 + 1c0931a | 11:57:44 | **早于**区间下界（早 33 min） |
| 翻转产物 73e0efbf 落盘（未重启，未生效） | 12:05:25 | **早于**区间下界；其后 401 次成功 |
| **翻转代码首次生效（PID 500951）** | **14:20:50** | **落在区间内部** |
| 安装 6b8e1fad + 重启（PID 581348） | 15:42:17 | **落在区间内部** |
| host 重启（PID 666391，当前） | 17:16:14 | **晚于**区间上界（晚 65 min），其后仍有失败 |

---

## 5. 判定：故障发生在安装翻转之前还是之后

**判定：之后（与翻转代码首次生效同时或之后）；但不能仅凭本证据断言因果。**

依据：
1. 翻转产物落盘（12:05:25）之后 **25 分钟内仍有 401 次成功**，最后一次 12:30:51 —— 曾把该产物写入磁盘这件事本身没有立刻破坏生成。
2. 该产物在 12:05:25 → 14:20:50 期间**未生效**：探针 14:19:35 实测 `hostPid 420693`（起于 10:03:11.991）并给出 `process_fresh FAIL: the running process predates the new build`。插件 bundle 在**进程启动时**加载（release 流水线每次都带 unit restart，见 `release-20261016T074145Z.log:44`），故这 401 次成功跑的是**翻转前**代码。
3. 翻转代码首次生效 14:20:50，此后 stats.db **成功 = 0**，直到取证时刻（1.5 天，跨 3 个 host 进程：500951 → 581348 → 666391）。
4. 3 条 error 全部晚于 14:20:50。
⇒ 时间上：**无一条失败早于翻转代码生效，无一条成功晚于翻转代码生效。**

**不能断言的部分（必须明说）：** 起点区间内 0 条请求，故"故障是在 14:20:50 那一瞬发生"与"故障发生在 15:42–16:11 之间的上游变化"在本证据下**不可区分**。T4 今日实测三端点全败（production 429 / daily 404 / sandbox 404）说明**当日**上游为主因；本时间线只能证明翻转生效与故障起点**同区间且翻转在前**，不构成必要条件证明。

---

## 6. 反证备选假设：「插件自身高频配额轮询导致上游限流」

**结论：该假设被排除（机制层面），另有实测频率证据表明轮询甚至未按 15 min 节奏运行。**

1. 轮询端点不同源。配额轮询打的是
   `packages/core/src/quota.ts:333` → `` `${endpoint}/v1internal:retrieveUserQuotaSummary` ``
   而生成打的是 `streamGenerateContent`（`packages/core/src/client.ts`）。**配额摘要 API 与生成 API 是不同配额面**，前者不可能消耗后者额度。
2. 频率上限（代码）：`src/common/types.ts:136` → `quotaPollIntervalMs: 15 * 60_000`；
   `src/common/config.ts:163` → `Math.max(60_000, n)` 下限 60 s；
   `src/index.ts:886` → `setInterval(refresh, Math.max(60_000, getConfig().quotaPollIntervalMs))`，`:885` 首次延迟 5 s；
   `src/index.ts:879` 注释原文：`// Background quota refresh: one HTTPS call per account per poll interval`。
   ⇒ 默认 5 账号 / 15 min = **20 次/小时**，与"高频"不符。
3. 实测频率（比代码更强）：`ops/diag/t4-live-pool-snapshot.json`（写于 **00:13:54 CST**）5 账号 `quotas.*.updatedAt` =
   `15:46:16Z / 15:53:47Z / 15:54:13Z / 15:54:35Z / 15:54:55Z`（= 23:46:16 … 23:54:55 CST），
   即快照时刻数据已**陈旧 19–28 分钟**；同一批值在 00:20:33 CST 的 `t1-pool-*.json` 中**仍未变化**，
   直到 T1 显式 `POST /pool/refresh-quota` 才在 **00:20:50 CST** 全量前进。
   ⇒ 观测窗口内**没有任何一次后台轮询成功刷新**配额，'高频轮询'在事实上不存在。
4. 与 429 并存不矛盾的解释：配额摘要 API 返回 `remainingFraction=1`（分组维度），而生成 429 的 `reason` 为
   `RESOURCE_EXHAUSTED`（模型/容量/闸门维度），两者维度不同；且轮询用另一端点。**该矛盾不指向本地轮询。**
5. 未排除的相关耦合（诚实标注，非本次证据）：`quota.ts:319-343` 的 `getOrderedEndpoints()` 会按成功端点回写
   `preferredEndpointIndex`，而该索引亦被生成路径使用 ⇒ **配额探测的成功端点可能改变生成端点顺序**。本时间线
   **没有**证据表明它在 16:11 前发生过迁移；列为待查项，不作结论。

**未排除的备选假设：** 上游侧对 `production` 端点的模型/项目闸门变化（T3/T4 覆盖），以及账号凭据/项目状态变化。

---

## 7. journalctl 结论

`journalctl --user -u deepseek-harness.service --since "2026-10-15"` 共 **102 行**，最早一条 = **2026-10-16 17:16:08 CST**；
`journalctl --user --list-boots` 显示本机 user journal 首条 = `2026-10-16 16:40:25 CST`（systemd-coredump）。
⇒ **journal 对起点区间（12:30:51–16:11:25 CST）无任何覆盖。**
对该 102 行做 `grep -iE "429|cooldown|quota|endpoint|generate|cloudcode|RESOURCE_EXHAUSTED"` → **0 命中**。
可用原文（唯一与重启相关的）：
```
2026-10-16T17:16:08+08:00 systemd[1242]: Stopping DeepSeek Harness (web UI on 127.0.0.1:3080)...
2026-10-16T17:16:14+08:00 systemd[1242]: Stopped DeepSeek Harness (web UI on 127.0.0.1:3080).
2026-10-16T17:16:14+08:00 systemd[1242]: deepseek-harness.service: Consumed 11h 25min 43.024s CPU time over 1h 33min 56.406s wall clock time, 28.6G memory peak.
2026-10-16T17:16:14+08:00 systemd[1242]: Started DeepSeek Harness (web UI on 127.0.0.1:3080).
```
⇒ **「何时还成功过」在 journal 中：无此证据。**

---

## 8. ops/** 正向证据的性质区分（关键：不能当上游生成成功）

| 证据 | 判定 | 依据 |
|---|---|---|
| `ops/verify/probe-*.json` 全部 PASS（10-16 14:20–14:49 CST） | **仅插件 HTTP 面 PASS** | 检查项为 `service_ready / artifact_pinned / bundle_defines_ccl / quota_refresh_live / models_upstream_side / models_fallback_side / journal_no_import_failure`；`grep -l "generateContent\|streamGenerateContent" ops/verify/*` → **0 命中**，即**没有任何探针发起过生成请求** |
| `quota_refresh_live PASS` | **仅配额摘要 API PASS** | 摘录 `live upstream refresh produced future resetTime, in-range weeklyFraction and a fresh updatedAt for every family` —— 打的是 `retrieveUserQuotaSummary` |
| `ops/release/probe-out-20261016T082438Z/…json`（10-16 16:24:57 CST） | **仅插件 HTTP 面** | `{"PASS":7,"FAIL":0,"UNKNOWN":2}`，`verdict:"UNKNOWN"`，同样无生成调用 |
| `ops/diag/t4-causal-ab-*.json`（10-18 00:12 CST） | **真实上游调用，但全部失败** | T4 已证：production=429 / daily=404 / sandbox=404 |

⇒ **全仓 ops/** 内**不存在**任何「真实上游生成成功」的正向证据；唯一的这类证据只在 `stats.db`。

---

## 9. 未找到清单（明确「无此证据」，禁止外推）

1. **每账号最早 429 时刻**：无此证据。`request_metrics` 无 HTTP 状态码列，`error` 行无法区分 429/404/其他。
2. **每账号成功/失败时间线中的「失败计数增长时刻」**：无此证据。`consecutiveFailures` 只存当前值（`pool.json`），无历史时间戳。
3. **最早一次 429 的落盘时刻**：无此证据。`cooldowns.*.reason` 每次失败被覆盖，只保留**最后一次**。
4. **首个失败（10-16 16:11:25 CST）的 HTTP 码**：无此证据；`latencyMs=1235`（快速失败）不足以定性。
5. **12:30:51–16:11:25 CST 之间的任何请求**：无此证据（DB 0 行）。
6. **journal 侧 12:05–17:16 CST 的日志**：无此证据（journal 最早 17:16:08，machine journal 最早 16:40:25）。
7. **11:57:44 那次安装的 release 日志**：无此证据。`ops/release/` 最早 release 日志 = `release-20261016T073614Z.log`（15:36:14 CST）；12:05 安装只有产物 mtime 与探针转述。
8. **翻转代码生效瞬时（14:20:50 CST）是否有失败请求**：无此证据（DB 0 行）。
9. **末次 5 账号扫掠的发起者**：未定论。DB 在该 84 s 窗口内只有 1 行（n0tdx @ 23:55:02Z）；另 4 次 429（23:53:47 / 23:54:13 / 23:54:35 / 23:54:55）无 stats 行。可能是「单次请求跨 5 账号故障转移，stats 只记一条」，也可能是「4 次未走 stats 通道的尝试」——**本证据不能区分**。
10. **stats.db 之前的 DB**：`~/.dsh/agy-accounts/` 下**不存在** stats.db；唯一库在 `~/.cloudcode/accounts/`（已核对 host 环境变量确认为该路径）。

---

## 10. 只读声明与脱敏统计

- 本次仅执行：`sqlite3 -readonly`、只读 `read`/`grep`/`ls`/`stat`/`journalctl`/`systemctl show`、`python3` 只读 JSON 解析、`jq`。
- 未写：`pool.json` / `stats.db` / 任何日志 / `src/**` / `packages/core/**` / `dist/**`；未重启 host；未调用插件任何写 API（未 POST `/pool/refresh-quota`）。
- 写入产物仅限 `docs/review/t6-*`：
  - `docs/review/t6-failure-timeline.md`（本文件）
  - `docs/review/t6-db-rows-since-2026-10-16T03.txt`
  - `docs/review/t6-db-rows-after-2026-10-16T07-16Z.txt`
- 脱敏命中数：3 类令牌字面前缀（Google 访问令牌前缀 `ya` + `29.`、OAuth 刷新令牌前缀 `1` + `//`、JWT 头 `ey` + `J`）——**0 / 0 / 0**。
  复跑命令（`<pat>` 依次取上述 3 个拼接后的字面量）：
  ```
  for f in docs/review/t6-failure-timeline.md docs/review/t6-db-rows-*.txt; do
    printf '%s : ' "$f"; grep -c -- "<pat>" "$f" || echo 0; done
  ```
  实测输出：`t6-failure-timeline.md : 0` / `t6-db-rows-since-2026-10-16T03.txt : 0` / `t6-db-rows-after-2026-10-16T07-16Z.txt : 0`。
- 本文件自身不含任何令牌字面量（上一条刻意拼接书写，以免把脱敏模式本身写成命中）。
