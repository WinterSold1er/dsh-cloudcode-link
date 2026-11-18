# T5 证据核对清单 r1（逐条：断言 → 我的独立命令 → 真实输出 → 判定）

审查员：reviewer ｜ 窗口 UTC `2026-10-17T16:04Z`–`17:15Z` ｜ 裁定见 `docs/review/verdict-r1.md`
判定口径：**PASS** = 我用独立命令复现了同一事实；**FAIL** = 断言与我能复现的事实不符（见 verdict D1/D2/D3）。
脱敏写法：本文件一律用字符类 `ya29[.]` / `1[/]/` / `e[y]J`，避免把模式字面量变成命中。

---

## A. 基线与环境（我的锚点，用于判定 T1 是否造假）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| A1 | 5/5 账号 google 冷却中 | `curl -s /plugins/cloudcode-link/pool \| node -e '…'` | 5 账号 `cooldownUntil` 全部 > now（16:53:47.943Z … 16:55:11.023Z），cf=5/7/7/7/10 | PASS |
| A2 | 5/5 `remainingFraction=1`（配额满却 429） | 同上 | 全部 `gRem=1`；weekly=1/0.2786/0.2207/0.2805/0.2695 | PASS |
| A3 | host 未重启、装载当前 bundle | `systemctl --user show deepseek-harness.service -p MainPID -p ExecMainStartTimestamp -p NRestarts`；`stat` dist | `MainPID=666391`、`Fri 2026-10-16 17:16:14 CST`（09:16:14Z）、`NRestarts=0`；安装副本 mtime `08:31:53Z` < 启动时刻 | PASS |
| A4 | repo dist == 安装副本 | `sha256sum dist/index.js /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js` | 两者均 `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`（1250243 B） | PASS |
| A5 | 本轮无人改代码/产物基底 | `git status --porcelain; git rev-parse HEAD; git -C packages/core rev-parse HEAD` | 仅 `M ops/restart/.last-restart-pid` + 未跟踪产物；HEAD `03fd33c`；core `e52abe7` | PASS |

## B. T1（`ops/diag/t1-*`）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| B1 | 闸门：5/5 enabled 但 healthy=false | `node -e 'JSON.parse(t1-plugingate-…16-20-33…).accounts'` | 5 行 `enabled true healthy false`，`cooldownUntil` 逐账号与 A1 相同 | PASS |
| B2 | `selectAccount('google')` 返回 null | 同上读 `selectedAccountId/gateBlocked/familyStatus` | `selectedAccountId=null`、`gateBlocked=true`、`familyStatus.suppressed=true, reason=rate_limited` | PASS |
| B3 | 沙箱池与实盘池字节相同（未误改实盘） | 同上读 `livePoolSha256Before/sandboxPoolSha256` | 均 `c5c973d4b7dc…`（16:20 快照） | PASS |
| B4 | 3/3 生成请求 429（**非同一次请求复用**） | `node -e` 读 t1-upstream + t1-endpointcontact 的 `results` | run1 两条：pqxkh/project `170252d3…`/6279ms、xhs7n/project `605254fb…`/1084ms；run2 一条：xhs7n/6974ms/独立代理；均 `httpStatus 429` | PASS |
| B5 | 每次 429 只对 production 建 1 条 CONNECT，daily/sandbox 0 条 | `node -e` 读 t1-upstream `proxyContacts` | `["cloudcode-pa.googleapis.com:443","cloudcode-pa.googleapis.com:443"]`（2 次请求 2 条，无 daily/sandbox 主机） | PASS |
| B6 | 第 2 次调用的连接计数不可用（E3 测量假象）已如实标注 | 读 md §4 行 82 + `packages/core/src/net.ts:8-17` | md 写"计数不可用，见勘误 E3"；代码确为 `perProxyAgents` 按 proxyUrl 复用隧道 ⇒ 假象解释成立 | PASS |
| B7 | 代码位置：429 立即 return，不试下一候选 | `sed -n '470,495p' packages/core/src/client.ts` | `478: if (res.status === 401 \|\| 403 \|\| 400 \|\| 429) { return { response: res, endpoint } }` | PASS |
| B8 | 候选顺序 production 优先 | `sed -n '1,15p' packages/core/src/client.ts` | `ENDPOINT_FALLBACKS = [production, daily, daily-sandbox]` | PASS |
| B9 | 闸门代码位置 | `grep -n 'selectAccount\|RATE_LIMIT\|recordFailure' src/host/adapter.ts` | `256 selectAccount`、`286 RATE_LIMIT`、`466 recordFailure`（`463 if (res.status === 429)`） | PASS |
| B10 | 配额刷新 HTTP 200 / 33497ms / 冷却不变 | `node -e` 读 t1-refresh-quota | `httpStatus 200`、`elapsedMs 33497`、`cooldownComparison` 5 行全 `cooldownUnchanged:true`（cf/remainingFraction 前后同值） | PASS |
| B11 | 零消耗复跑 `{generate:0, refresh:0, probes:0}` 且 pool 未动 | `node -e` 读 t1-live-…16-49-29… | `counts={0,0,0,pluginHttpGet:5}`、`livePoolUntouched=true`、sha before==after `6f2f4323…`、`gate.gateBlocked=true` | PASS |
| B12 | E2 已改产物（`pluginHttpGet` 原报 3 实为 2） | 读 t1-endpointcontact json | `counts.pluginHttpGet: 2` | PASS |
| B13 | E5 的 guard 真实存在于脚本 | `grep -n maxUpstream ops/diag/t1-live.mts` | `339: if (maxUpstream === 0) throw new Error('probe skipped…')`，`350: if (maxUpstream > 0) counts.nonGenerateProbes++` | PASS |
| B14 | E1 的旧行号已在 md/脚本修正 | `grep -rn 'client.ts:478' ops/diag/t1-live.mts ops/diag/t1-live-analysis.md` | 脚本 `315/478` 与 md `18/25/97/148` 均为 `478-480` | PASS（残留见下） |
| B15 | E1 残留 | `grep -n 481 ops/diag/t1-live-…16-20-33….log t1-plugingate-…json` | log 85/86、json 64 仍是 `481-484`；勘误 E1 已声明"产物文本未回改，以本条为准" | PASS（已披露；建议回改） |

## C. T2（`docs/review/t2-regression-archaeology.md`）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| C1 | dc0ca77 首端点 daily→production | `git show dc0ca77 -- src/common/types.ts` | `+ 'https://cloudcode-pa.googleapis.com'` 提前，daily/sandbox 后移（6 行改动） | PASS |
| C2 | 父提交 = last-known-good `957cba6` | `git show --format='%ci%nparent:%P' dc0ca77` | `2026-10-16 11:57:44 +0800`、`parent:957cba65ab553f0587c48c6f7c964961ac40d217` | PASS |
| C3 | 该顺序**在生效路径**上（非死配置） | `grep -n endpointCandidates src/host/adapter.ts` + `sed` | `389 const customEndpoints = this.deps.endpointCandidates` → `400/433-438` 传入 core `streamGenerateContent` | PASS |
| C4 | 必要原因/放大因素被区分 | 读 md §1 #0/#1/#2 + T4 真值表 | #0 上游（必要，超出本仓）、#1 翻转（真实回归改动但**非**必要原因）、#2 429 立即 return + 写冷却（**预存在放大因素**） | PASS |
| C5 | last-known-good 时间与 core 指针可复核 | `git ls-tree 957cba6 packages/core` | `fac08c5e101d04d373f92ab6fec9822e8afc659c` | PASS |
| C6 | 与 T6/T7 时间线一致 | 交叉比对 | T6：翻转生效 06:20:50Z、末次成功 04:30:51Z、首错 08:11:25Z；T2 的"回归窗口下界=dc0ca77"与之不冲突 | PASS |

## D. T3（`ops/diag/t3-*`）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| D1 | 真先 `loadCodeAssist` 再打端点 | `node -e` 读两份 json 的 `requests.detail` + `loadCodeAssistProduction.at` | run1：`started 16:11:06.832Z` → LCA `16:11:06.960Z`(200) → 4 次 stream 之后；run2：LCA `16:13:33.178Z`(200) → 2 次 stream | PASS |
| D2 | S1–S6 = 6 个不同生成请求，无复用 | 同上比对两 run 的 total/detail/streams | run1 `total=5`(1 LCA+4 gen)、run2 `total=3`(1 LCA+2 gen) ⇒ 6 条 gen 观测 = S1–S6，逐条 at 不同 | PASS |
| D3 | 429/404 分布与端点作用域 | 读 t3 json `streams` | production 429（S1，561ms）、daily 404（S2/S5）、sandbox 404（S3/S6）、production 复测 slug 429（S4） | PASS |
| D4 | 脱敏自检：6/6 ok、EXIT=0、非 mock | **亲自重跑** `cd /tmp && node <repo>/ops/diag/t3-redaction-selftest.mts; echo EXIT=$?` | 6 行 `[ok]`、`samples: 6 failures: 0`、`non-credential text untouched: true`、`EXIT=0`；输出与原 `.log` 逐字节一致 | PASS |
| D5 | 自检测的是 shipped redactor | 读 selftest 12-19 行 | 从 `t3-endpoint-contract.mts` 切出 `const redact = …` 源码 `new Function` 求值，并与 legacy 正则做等价比对 + payload 泄漏检查 | PASS |

## E. T4（`ops/diag/t4-*`）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| E1 | 8 次请求与 undici diagnostics_channel 计数一致 | `node -e` 读两 run 的 `requestBudget` | run1 `{issued:7, limit:8, counter:"undici diagnostics_channel 'undici:request:create'"}`（B1+A3+FIX3）、run2 `issued:1` ⇒ 7+1=8 | PASS |
| E2 | B 臂：1 次请求、429、不继续 | 读 json `results[B]` + log 48-57 | `requestsIssued 1`、`endpointsProbed=[production]`、`httpStatus 429`、`continuedToNextCandidate false` | PASS |
| E3 | A 臂：3 次请求、末日标 429、继续 | 读 json `results[A]` + log 63-71 | `requestsIssued 3`、`stoppedAt production`、`httpStatus 429`、`continuedToNextCandidate true` | PASS |
| E4 | **A 臂"逐端点状态码 daily=404/sandbox=404"** | `grep -n 404 t4-…16-12-25….log`；`node -e` 打印 A 的 keys | 404 只出现在 **FIX** 臂（log 83/84）与结论行（89）；A 的 keys 中**无** per-endpoint status 字段 | **FAIL（D2）** |
| E5 | FIX 臂真跑过（非推理） | `sed -n '80,95p' log` | `fix step: production -> 429 (5/8)`、`daily -> 404 (6/8)`、`sandbox -> 404 (7/8)`，随后 `upstream generation requests issued: 7` | PASS |
| E6 | 本次实验未写 pool/冷却 | 读 json + log | `poolFileUnchanged true`、`cooldownsUnchanged true`、`pool.json sha256: c5c973d4…` | PASS |
| E7 | A' 跳过有日志依据 | `sed -n '78p' log` | `--- ARM A-prime SKIPPED --- arm A already probed sandbox …no extra upstream request spent` | PASS |
| E8 | 局限自曝（仅 1 账号） | 读 md §局限 | "A/B/FIX 三臂只做了 **1 个账号**… 预算 8 次不允许" | PASS |
| E9 | 无空 catch / TODO / 恒真断言 | `grep -nE 'catch\s*(\([^)]*\))?\s*\{\s*\}|TODO\|FIXME\|as any\|expect\(true\)' t1/t3/t4 *.mts` | 0 命中 | PASS |
| E10 | 结论由数据分支生成而非硬编码 | `sed -n '340,382p' ops/diag/t4-causal-ab.mts` | verdict 由 `a?.httpStatus`/`b?.httpStatus`/`fixOk` 分支拼出，H1 CONFIRMED 与 REJECTED 两条互斥路径都在代码里 | PASS |

## F. T6（`docs/review/t6-*`）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| F1 | 401 次成功（12:05:25–12:30:51 CST） | `sqlite3 -readonly …stats.db "SELECT COUNT(*) … status='success' AND timestamp>1792123525479"` | **401**；`MIN=1792123525834`、`MAX=1792125051177` | PASS |
| F2 | 最后一个成功 | `SELECT … ORDER BY timestamp DESC LIMIT 3` | `1792125051177 / 2026-10-16 04:30:51 / xhs7n / gemini-3.8-flash-high / 8706`（同秒 7999 一条） | PASS |
| F3 | 首条 error 行 | `WHERE timestamp=1792138285432` | `2026-10-16 08:11:25 \| error \| n0tdx \| gemini-3.8-flash-low \| 1235` | PASS |
| F4 | 翻转生效后成功数 = 0（1.5 天） | `COUNT(*) … status='success' AND timestamp>1792131650000`（=06:20:50Z） | **0** | PASS |
| F5 | `07:16Z` 之后仅 3 行且全为 error | `SELECT COUNT(*),SUM(success),SUM(error) … >1792125360000` | `3 \| 0 \| 3`，与 `t6-db-rows-after-*.txt` 三行一致 | PASS |
| F6 | 库/表/列与 md 一致，且无端点、无状态码列 | `sqlite3 '.schema'` | `request_metrics(requestId,sessionId,accountId,model,timestamp,status,latencyMs,ttftMs,cacheHit,promptTokens,cachedTokens,outputTokens)`；**无 endpoint / 无 http status** | PASS |
| F7 | 翻转代码首次生效 PID 500951 @ 06:20:50Z | `node -e` 读 `ops/verify/probe-2026-10-16T06-21-02-646Z.json` | `pid 500951, startMs 1792131650836 (2026-10-16T06:20:50.836Z), verdict PASS` | PASS |
| F8 | 翻产物但未重启（F1 前提） | 读 `ops/verify/probe-2026-10-16T06-19-35-857Z.json` | `pid 420693, startMs 1792116191991, verdict FAIL` | PASS |
| F9 | PID 链 500951→581348→666391 | `grep -rl '581348' ops/verify ops/release` | `t9-process-fresh-record.md`、`superseded/probe-2026-10-16T07-58-21-063Z.json` 等命中 | PASS |
| F10 | `ops/verify` 内无生成调用证据 | `grep -l 'streamGenerateContent\|generateContent' ops/verify/* \| wc -l` | `0` | PASS |

## G. T7（`docs/review/t7-onset-attribution.md`）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| G1 | 退避公式 = `min(900000×failures, 3600000)` | `sed -n '585,620p' packages/core/src/pool.ts` | `605/610: cooldownUntil = Date.now() + Math.min(this.data.defaultCooldownMs * failures, this.data.maxCooldownMs)` | PASS |
| G2 | 5 个反解时刻 | 我独立重算 `until − min(900000×cf,3600000)`（node，读 `endpoint-ab-…08-41-07-515Z.json` 的 `cooldownsBefore`） | 08:11:22.471 / 23.009 / 23.639 / 25.426 / 26.665（Z），与 T7 表**逐毫秒相同** | PASS |
| G3 | Δ6ms 交叉命中 | 比对 `1792138285432`（08:11:25.432Z）vs pqxkh 反解 `25.426Z` | 差 **6 ms** | PASS |
| G4 | Δ2ms 交叉命中 | `25.432Z + 1235ms = 26.667Z` vs n0tdx 反解 `26.665Z` | 差 **2 ms** | PASS |
| G5 | 冷却非 16:41 实验所写 | 读该 json | `cooldownStateUnchanged: true`、`requestBudget.issued=2` | PASS |
| G6 | `getOrderedEndpoints` 只被 QuotaService 调用 | **vectr_trace** `getOrderedEndpoints` | `Called by (2): fetchAvailableModels quota.ts:356, fetchQuotaSummary quota.ts:328` | PASS |
| G7 | `preferredEndpointIndex` 读点仅 4 处、`src/` 0 命中 | `grep -rn preferredEndpointIndex src packages/core/src --include='*.ts'` | 仅 `packages/core/src/quota.ts:167,323,343,371` | PASS |
| G8 | 生成候选不读 quota 状态 | `sed -n '103,109p' packages/core/src/client.ts` | `endpointCandidates()` 只读 `customBaseUrl` / `ANTIGRAVITY_BASE_URL`，否则 `[...ENDPOINT_FALLBACKS]` | PASS |
| G9 | **"fac08c5 的 AGY_ENDPOINTS 与 HEAD 逐字相同（production 在 index 0）"** | `git -C packages/core show fac08c5:src/oauth.ts \| grep -A5 'export const AGY_ENDPOINTS'` + `git -C packages/core show 1c0931a -- src/oauth.ts` | fac08c5 = `[daily, production, daily-sandbox, autopush-sandbox]`；1c0931a 把 daily 与 production 对调 ⇒ 与 HEAD **不**相同 | **FAIL（D1）** |
| G10 | §6 三项不可判定未被写成已证 | 读 md §6 1-5 项 | 端点归属、production 429 起点、daily/sandbox 在 16:11 的状态、运行时索引取值、stats 行↔尝试对应，均列为"未找到/无法获得" | PASS |
| G11 | T7 自身脱敏 0 | `grep -c -E 'ya29[.]' / '1[/]/' / 'e[y]J' docs/review/t7-onset-attribution.md` | `0 / 0 / 0` | PASS |

## H. 脱敏（全队逐产物，非自匹配写法）

| 产物组 | `ya29[.]` | `1[/]/` | `e[y]J` | 备注 |
|---|---|---|---|---|
| `ops/diag/t1-*.json` / `t1-*.log` / `t1-live-analysis.md` | 0 | 0 | 0 | 全部 |
| `ops/diag/t3-*.json` / `t3-*.log` / `t3-endpoint-contract.analysis.md` / `t3-redaction-selftest.{mts,log}` | 0 | 0 | 0 | 自检脚本用片段拼接，未引入字面量 |
| `ops/diag/t4-*.json` / `t4-*.log` / `t4-causal-ab-analysis.md` | 0 | 0 | 0 | — |
| `ops/diag/t4-redaction-scan.txt` | 0 | **1** | **1** | 模式标签行自命中（D3），无真实凭据 → **r2 已修，见 J6** |
| `ops/diag/t4-causal-ab.mts` / `t4-redact-scan.py` | 7 / 2 | 7 / 2 | 7 / 2 | 脚本内的模式定义，属预期（该文件自己也标为 SOURCES） |
| `docs/review/t2-regression-archaeology.md` | 0 | 0 | 0 | — |
| `docs/review/t6-failure-timeline.md` / `t6-db-rows-*.txt` | 0 | 0 | 0 | — |
| `docs/review/t7-onset-attribution.md` | 0 | 0 | 0 | — |
| 上一轮遗留 `endpoint-ab.mts` / `daily-project-retest.mts` / `daily-project-retest-*.analysis.md` | 命中 | 命中 | 命中 | 非本轮产物，模式字面量/历史自命中 |

结论：**无任何真实凭据落盘**；唯一需要回改的是 `t4-redaction-scan.txt` 的标签行。

---

## I. 复跑命令汇总（审查员原样执行过的）

```bash
# 基线
curl -sS http://127.0.0.1:3080/plugins/cloudcode-link/status
curl -sS http://127.0.0.1:3080/plugins/cloudcode-link/pool
systemctl --user show deepseek-harness.service -p MainPID -p ExecMainStartTimestamp -p NRestarts
sha256sum dist/index.js /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js

# T3 脱敏自检（0 上游请求，仅 stdout）
cd /tmp && node /home/csy/Code/Github/dsh-cloudcode-link/ops/diag/t3-redaction-selftest.mts; echo EXIT=$?

# T6/T7 的真实数据源（只读）
sqlite3 -readonly /home/csy/.cloudcode/accounts/stats.db \
  "SELECT COUNT(*) FROM request_metrics WHERE status='success' AND timestamp>1792123525479;"      # 401
sqlite3 -readonly /home/csy/.cloudcode/accounts/stats.db \
  "SELECT COUNT(*) FROM request_metrics WHERE status='success' AND timestamp>1792131650000;"      # 0

# T7 反解（我自己的实现，不调用他人脚本）
node -e 'const j=require("./ops/diag/endpoint-ab-2026-10-16T08-41-07-515Z.json");
for(const a of j.cooldownsBefore){const g=a.cooldowns.google;const b=Math.min(900000*g.consecutiveFailures,3600000);
console.log(a.id,new Date(g.cooldownUntil-b).toISOString())}'

# D1 反例
git -C packages/core show fac08c5:src/oauth.ts | grep -A5 'export const AGY_ENDPOINTS'
git -C packages/core show 1c0931a -- src/oauth.ts | tail -9

# D2 反例
grep -n '404' ops/diag/t4-causal-ab-2026-10-17T16-12-25-360Z.log
node -e 'console.log(Object.keys(require("./ops/diag/t4-causal-ab-2026-10-17T16-12-25-360Z.json").results.find(r=>r.arm==="A")).join(","))'

# H 脱敏（非自匹配）
grep -rInoE 'ya29[.]' ops/diag docs/review | head
grep -rInoE '1[/]/' ops/diag docs/review | head
grep -rInoE 'e[y]J' ops/diag docs/review | head
```

---

# r2 追加（task-5 revision 4→5）：D1/D2/D3 复验逐条

判定口径同前；本轮只看 diff 与重跑输出。**最终裁定 APPROVE**。

## J. D1 闭环（T7 §3.2 重写）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| J1 | 耦合机制在 fac08c5 已存在 | `git -C packages/core show fac08c5:src/quota.ts \| grep -n 'preferredEndpointIndex\|getOrderedEndpoints'` | `162 private preferredEndpointIndex = 0`；`314 private getOrderedEndpoints()`；`318`；`324` | PASS |
| J2 | `AGY_ENDPOINTS` 顺序由 1c0931a 翻转 | `git -C packages/core show 1c0931a -- src/oauth.ts \| tail -8` | `-daily` / `+daily` 换位 → production 落到 index 0 | PASS |
| J3 | 该提交未触碰索引逻辑 | `git -C packages/core show 1c0931a \| grep -c 'preferredEndpointIndex'` | `0` | PASS |
| J4 | quota.ts hunk 头逐条可核 | `git -C packages/core show 1c0931a -- src/quota.ts \| grep -n '^@@'` | 5 条：`-20,8+20,13`、`-434,6+439,14`、`-457,6+470,7`、`-488,6+502,7`、`-524,7+539,7` | PASS |
| J5 | 该常量只被配额路径使用 | `grep -rn 'AGY_ENDPOINTS' src packages/core/src` | `quota.ts:16/320/323/343/371` + `oauth.ts:42`；`src/` 0 命中 | PASS |
| J6 | 脱敏闭环（D3）全产物 0 | 见 §K | 全部文件 `0/0/0` | PASS |
| J7 | 生成候选数组亦被 1c0931a 翻转（新增断言） | `git -C packages/core show fac08c5:src/client.ts \| grep -n -A6 'export const ENDPOINT_FALLBACKS'` | fac08c5 `DEFAULT_ENDPOINT = daily`、`[daily, daily-sandbox, production]`；1c0931a diff 将其改为 production-first | PASS |
| J8 | 线上产物数组字面量（强证据替换 grep -o） | `sed -n '25646,25660p' dist/index.js`；`sed -n '27782,27795p' dist/index.js` | `25650 const ENDPOINT_FALLBACKS = [` → production 第一；`27786 const AGY_ENDPOINTS = [` → production 第一 | PASS |
| J9 | R2/R3：429 分支"未改动"可复跑 | 单命令 `git -C packages/core show fac08c5:src/client.ts \| grep -n -A3 'res.status === 401'` + `diff` 对 1c0931a | `478/479/480` 三行；`diff` → **IDENTICAL** | PASS |
| J10 | §8.1"覆盖全篇绝对化断言"是否属实 | `grep -n '逐字相同\|完全一致\|无改动\|同为\|一致\|相同' docs/review/t7-onset-attribution.md` | 实质 5 处（`:64 :92 :176 :368 :390`）分别由 R14/R15、R2/R3、自我披露、小节标题/摘要覆盖 | PASS |
| J11 | R14/R15/R16 输出 | `sqlite3 -readonly …`；`grep -c sandbox` | `436`（04:00:01Z–04:30:51Z）、`401`、`0` | PASS |

## K. D3 闭环（脱敏全产物，我的独立重扫）

写法：`grep -oE 'ya2[9]\.'` / `'1[/]/'` / `'e[y]J'`（命令内以字符类书写，避免自命中；三者分别等价于字面前缀 访问令牌/刷新令牌/JWT 头）。

| 产物 | 结果 |
|---|---|
| `ops/diag/t1-*`（29 个 json + 4 个 log + md） | 0 / 0 / 0 |
| `ops/diag/t3-*`（json ×2、log ×2、analysis.md、mts ×2、selftest.log） | 0 / 0 / 0 |
| `ops/diag/t4-*`（json ×2、log ×2、analysis.md、`.mts`、`t4-redact-scan.py`、`t4-redaction-scan.txt`、`t4-live-pool-snapshot.json`） | 0 / 0 / 0 |
| `docs/review/t2-regression-archaeology.md` / `t6-failure-timeline.md` / `t6-db-rows-*.txt` / `t7-onset-attribution.md` | 0 / 0 / 0 |
| 我自己的 `verdict-r1.md` / `evidence-checklist-r1.md` | 0 / 0 / 0 |
| 命中文件总数 | **0** |

## L. D2 闭环（T4 A 行拆栏）

| # | 断言 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|---|
| L1 | 被引用的 11 个日志行号全部存在且语义相符 | `for n in 50 52 53 65 67 68 78 82 83 84 88; do sed -n "${n}p" <log>; done` | 11/11 命中：B 臂 50/52/53，A 臂 65/67/68，A'78，FIX 82/83/84，总数 88 | PASS |
| L2 | A 行 404 已标"推断"并给出可核来源 | `sed -n '18,24p' ops/diag/t4-causal-ab-analysis.md` | `production=429 本臂观测（.log:67）`；`daily/sandbox=404 推断（来源 FIX 臂 .log:83/84）` | PASS |
| L3 | 无"FIX 观测冒充 A 观测"残留 | `grep -n '404' ops/diag/t4-causal-ab-analysis.md` | 4 处全部正确归属（`:13` FIX、`:22` A 标推断、`:24` FIX 逐 step、`:31/:34` 说明） | PASS |
| L4 | 机制解释成立 | `sed -n '451,465p' packages/core/src/client.ts` | `451` 取候选、`462 for (const endpoint of endpoints)` ⇒ 多候选调用只回传一个 `Response` | PASS |
| L5 | 整改未偷偷补跑上游请求 | `stat` + `sha256sum` T4 原始产物 | mtime `00:12:25 / 00:13:39 CST` < 整改 `01:21`；json sha `443cf715…` 未变 | PASS |

## M. r2 完整性

| # | 断言 | 命令 | 输出 | 判定 |
|---|---|---|---|---|
| M1 | 无代码/产物基底变动 | `git rev-parse HEAD; git -C packages/core rev-parse HEAD; sha256sum dist/index.js` | `03fd33c` / `e52abe7` / `6b8e1fad…` | PASS |
| M2 | host 未重启 | `systemctl --user show deepseek-harness.service -p MainPID --value` | `666391` | PASS |
| M3 | 本轮仅 4 个文档/脚本被改 | `stat -c '%y %n'` 关键产物 | `t7-…md 01:23` / `t4-…analysis.md 01:21` / `t4-redaction-scan.txt 01:21` / `t4-redact-scan.py 01:19` | PASS |
| M4 | T7 §6 三项仍为不可判定 | 读 §6 + `.schema` + `grep -c sandbox` | 三项均未升格为结论 | PASS |
