# T5 对抗审查裁定 r1

- 审查员：reviewer（task-5，独立复算/复跑，全程只读他人产物）
- 采样窗口：UTC `2026-10-17T16:04Z` – `2026-10-17T17:15Z`（CST 10-18 00:04 – 01:15）
- 基线锚点：见本文件 §4；工作记忆 note #42/#43/#44
- 被审查产物：`ops/diag/t1-*`、`docs/review/t2-regression-archaeology.md`、`ops/diag/t3-*`、`ops/diag/t4-*`、`docs/review/t6-*`、`docs/review/t7-onset-attribution.md`

---

## VERDICT: REJECT

阻断项 2 条（D1 事实性假声明、D2 观测列填入推断值），轻微项 1 条（D3 脱敏自命中）。
**两条阻断项均不改变团队的最终修复指向**（429 立即 return + 冷却写入口），但都属于"证据列里写了日志/命令并不支持的东西"，按铁律必须回改后再交付。

---

## D1（阻断）T7 §3.2 的"逐字相同"是假声明，一条 diff 即可推翻

**原文（`docs/review/t7-onset-attribution.md:153-164`）**

> `fac08c5` 里 `AGY_ENDPOINTS` 与 HEAD **逐字相同**（production 在 index 0）。
> ⇒ **该耦合是预存在的、翻转前后一致；既非 1c0931a 新增，也非其改动。**

**复现命令与真实输出**

```bash
$ cd /home/csy/Code/Github/dsh-cloudcode-link
$ git -C packages/core show fac08c5:src/oauth.ts | grep -A5 'export const AGY_ENDPOINTS'
export const AGY_ENDPOINTS: readonly string[] = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]

$ grep -A5 'export const AGY_ENDPOINTS' packages/core/src/oauth.ts
export const AGY_ENDPOINTS: readonly string[] = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
]

$ diff <(git -C packages/core show fac08c5:src/oauth.ts | grep -A5 'export const AGY_ENDPOINTS') \
       <(grep -A5 'export const AGY_ENDPOINTS' packages/core/src/oauth.ts)
2d1
<   'https://daily-cloudcode-pa.googleapis.com',
3a3
>   'https://daily-cloudcode-pa.googleapis.com',
[exit code: 1]
```

**谁改的（精确到 hunk）**

```bash
$ git -C packages/core show --stat --format='%h %ci %s' 1c0931a | head -4
1c0931a 2026-10-16 11:55:48 +0800 feat(models,quota): update upstream model line-up, fix 5h quota refresh and reset time calculation
 src/client.ts             |  4 ++--
 src/models.ts             |  7 +++++++
 src/oauth.ts              |  2 +-
 src/quota.ts              | 21 ++++++++++++++++++---
 src/types/config-types.ts |  6 +++++-
 ...
$ git -C packages/core show 1c0931a -- src/oauth.ts | tail -9
 export const AGY_ENDPOINTS: readonly string[] = [
-  'https://daily-cloudcode-pa.googleapis.com',
   'https://cloudcode-pa.googleapis.com',
+  'https://daily-cloudcode-pa.googleapis.com',
   'https://daily-cloudcode-pa.sandbox.googleapis.com',
```

**缺陷定性**：`fac08c5` 的 index 0 是 **daily**，不是 production；把顺序从 daily-first 翻成 production-first 的正是核心提交 `1c0931a`（即 dc0ca77 所 bump 的指针）。因此"逐字相同""翻转前后一致""非其改动"三句均不成立。该句被标为"已用 git show 核对"，属把未复现的断言写成已验证。

**影响面（重要，决定不是重写而是回改）**：
- T7 的 Q3 结论"`preferredEndpointIndex` 不能改变生成首选"**仍然成立**，我已独立复核（见 §3 核对表 V15/V16），其依据是读点收敛性，与 AGY_ENDPOINTS 的取值无关。
- 但"翻转的爆炸半径"被写小了：`1c0931a` 同时翻转了**配额侧** `AGY_ENDPOINTS` 与**生成侧** `DEFAULT_ENDPOINT_CANDIDATES`（后者由 dc0ca77 的 `src/common/types.ts` 翻转，且确在生效路径上，见 V12）。
- 修法：把该段改为"耦合机制预存在（fac08c5 已有 `preferredEndpointIndex` 与 `getOrderedEndpoints`），但 `AGY_ENDPOINTS` 的**顺序**由 1c0931a 翻转为 production-first"，并撤掉"逐字相同"与"非其改动"。

---

## D2（阻断）T4 真值表 A 臂的"逐端点状态码"没有任何日志/JSON 支撑

**原文（`ops/diag/t4-causal-ab-analysis.md:19`，表头为"逐端点状态码（按请求顺序）"）**

> | **A**（pre-dc0ca77 顺序） | daily → sandbox → production | **3** | daily=`404`、sandbox=`404`、production=`429` | ... |

**复现命令与真实输出**

```bash
$ grep -n '404' ops/diag/t4-causal-ab-2026-10-17T16-12-25-360Z.log
83:  fix step: https://daily-cloudcode-pa.googleapis.com -> 404 (requests so far 6/8)
84:  fix step: https://daily-cloudcode-pa.sandbox.googleapis.com -> 404 (requests so far 7/8)
89:VERDICT: H1 REJECTED ...（结论行，非观测）
```

即：整份运行日志里 **404 只出现在 FIX 臂**；A 臂整块（该 log 第 63–76 行）只有候选顺序、`upstream requests actually issued: 3 -> [...]`、最终 `http status: 429`、`continued to next candidate: true`，**没有任何逐端点状态码**。

JSON 侧同样缺失：

```bash
$ node -e 'const A=require("./ops/diag/t4-causal-ab-2026-10-17T16-12-25-360Z.json").results.find(r=>r.arm==="A");console.log(Object.keys(A).join(","))'
arm,note,candidateOrder,requestsIssued,endpointsProbed,endpointReturnedByPlugin,httpStatus,ms,continuedToNextCandidate,stoppedAt,resourceExhausted,notFound,bodyExcerpt,cooldownWritten,cooldownNote
```

（对照：FIX 臂独有 `steps` 字段，其中记录 `[{endpoint,status,excerpt}]`，即 429/404/404 的来源是 **FIX 臂**，不是 A 臂。）

**缺陷定性**：A 臂的 `daily=404 / sandbox=404` 是从"`continuedToNextCandidate=true` ⇒ 前两个候选不是 429"加 FIX 臂/T3 的同主机状态**推**出来的，值是**真的**（T3 S2/S3 与 FIX steps 独立佐证），但被填进了名义上是观测值的列，且未标注"推断"。这违反本轮验收口径"真值表与日志逐行一致"。

**修法（二选一，都很小）**：① 在 A 行把 404 标为 `404（推断：continuation 语义 + FIX 臂/T3 同主机实测）`；② 给 A 臂 recorder 加 per-attempt `steps`（FIX 臂已有该字段，复用即可），重跑后由日志直接支撑。

---

## D3（轻微，不阻断但需回改）T4 脱敏扫描产物自命中

```
$ grep -c -E '1[/]/' ops/diag/t4-redaction-scan.txt   → 1
$ grep -c -E 'e[y]J'  ops/diag/t4-redaction-scan.txt  → 1
```

来源是该文件第 2 行的模式标签行（`patterns: oauth_access_prefix=…, oauth_refresh_prefix=…, jwt_prefix=…`）。**无任何真实凭据泄漏**（命中处后面 0 个字符，是裸模式字面量），且同一文件已在 SOURCES 段正确区分"模式字面量≠泄漏"。但交付门禁若按前缀 grep 产物，该文件会被计 2 命中，"全队 0 命中"因此不能成立。修法：标签改用字符类写法（与 T3 `t3-redaction-selftest.mts` 的做法一致）。

---

## 独立复核为"真实、不糊弄"的部分（要点，逐条命令见 evidence-checklist-r1.md）

| 组 | 结论 |
|---|---|
| 基线 | 我独立采样：5/5 账号 google 冷却中且 `remainingFraction=1.0`（全满），与 T1 C1/C6 完全一致；`cooldownUntil` 人类时间已换算（§4） |
| T1 全景 | 闸门 JSON 5/5 `enabled=true, healthy=false`、`selectedAccountId=null`、`suppressed=true`；3/3 生成请求 429（2+1 分两次运行、不同账号/不同 body sha，**非同一请求复用**）；连接计数 production 2 条 / daily 0 / sandbox 0；`client.ts:478-480`、`adapter.ts:256/266-289/463-471`、`net.ts:8-17` 逐行核对相符；零消耗复跑 `{0,0,0}` 且 pool sha 前后相同；E2/E3/E5 三条勘误与产物一致（E2 已改产物、E3 如实标注"计数不可用"、E5 的 guard 在 `t1-live.mts:339` 真实存在） |
| T3 | LCA 先于生成（run1 LCA `16:11:06.960Z` 在所有 stream 之前；run2 同构）；S1–S6 = 2 次运行的 **6 个不同生成请求**，无复用；脱敏自检我**亲自重跑**：6/6 ok、`EXIT=0`、输出与原产物逐字节相同，且被测 redactor 是从 shipped 脚本里切出真实源码 `new Function` 求值，不是 mock |
| T4 | 预算计数用 undici `diagnostics_channel('undici:request:create')`；run1 `issued=7`（B1+A3+FIX3）、run2 `issued=1`，合计 8 = 真值表请求数之和；FIX 臂**真跑过**（日志 5/8→6/8→7/8 带真实 429/404/404）；pool.json 与冷却 sha/标志 unchanged；"仅 1 个账号"已在 §局限自曝 |
| T2 | dc0ca77 亲验：父提交 `957cba6`、`2026-10-16 11:57:44 +0800`、diff 正是 `src/common/types.ts` 的候选顺序翻转；且该列表**确实在生效路径**（`src/host/adapter.ts:389/400/433-438` 把它作为 `customEndpoints` 传给 core `streamGenerateContent`） |
| T6 | 401 次成功我用 SQL 精确复现（`timestamp>1792123525479` ⇒ **401**，首 04:05:25.834Z、末 04:30:51.177Z=MAX success）；翻转生效后成功数 **0**；首条 error 行 `1792138285432`（n0tdx，latencyMs 1235）存在；`07:16Z` 之后 3 行全 error 与产物一致；PID 链 500951→581348→666391 有 probe 文件佐证 |
| T7 | 退避反解我**独立重算 5/5 命中到毫秒**（`until − min(900000×cf, 3600000)`），且与 `pool.ts:590-616` 逐字相符；Δ6ms（pqxkh vs DB 1792138285432）与 Δ2ms（n0tdx vs DB+1235ms）复现成立；`preferredEndpointIndex` 读点仅 quota.ts 167/323/343/371、`src/` 0 命中、`getOrderedEndpoints` 仅被 fetchAvailableModels/fetchQuotaSummary 调用（vectr_trace 亲跑）；§6 三项不可判定如实列出，未发现把不可判定写成已证 |
| 完整性 | 本轮 `src/**`、`packages/core/**`、`dist/**` 无改动（HEAD `03fd33c`、core `e52abe7`、dist sha `6b8e1fad…` 与安装副本一致），host `MainPID=666391` 未重启 |

---

## §4 我的基线锚点（T1 是否造假的对锚）

采样 `2026-10-17T16:04:22Z`（CST 10-18 00:04:22），`/status` 与 `/pool` 均 HTTP 200：

| 账号 | google `cooldownUntil` (UTC) | CST | 距采样 | consecutiveFailures | remainingFraction | weeklyFraction |
|---|---|---|---|---|---|---|
| csy19960309 | 16:53:47.943Z | 00:53:47 | +2955s | 5 | **1** | 1 |
| uduhulekuxa852 | 16:54:13.681Z | 00:54:13 | +2981s | 7 | **1** | 0.2786 |
| a01072666232 | 16:54:35.978Z | 00:54:35 | +3003s | 7 | **1** | 0.2207 |
| zejnalovusif99 | 16:54:55.258Z | 00:54:55 | +3022s | 7 | **1** | 0.2805 |
| a01098776566 | 16:55:11.023Z | 00:55:11 | +3038s | 10 | **1** | 0.2695 |

- `mode=round-robin`、`defaultCooldownMs=900000`、`maxCooldownMs=3600000`；`activeAccountIds` 三族均指向 `pqxkh`（**不是**"无账号"）。
- **核心矛盾锚**：配额接口报 `remainingFraction=1`，实调 429 ⇒ 任何"429 因配额耗尽/配额接口也报 0"的表述都与基线冲突。
- host：`MainPID=666391`、`ExecMainStartTimestamp=Fri 2026-10-16 17:16:14 CST`（= 09:16:14Z，CST 勿当年份）、`NRestarts=0`；dist 安装副本 mtime `08:31:53Z` **早于**进程启动 ⇒ 运行进程装载的是当前 bundle，"改了没重启所以没生效"在本轮为假。

---

## §5 脱敏逐产物命中（我的非自匹配重扫）

写法：`ya29[.]` / `1[/]/` / `e[y]J`（`grep -oE` 计数）。

- **命中 0/0/0**：`ops/diag/t1-*`（全部 json+log+md）、`ops/diag/t3-*`（json/log/md/mts/log）、`ops/diag/t4-*` 的 json/log/md、`docs/review/t2-regression-archaeology.md`、`docs/review/t6-failure-timeline.md`、`docs/review/t6-db-rows-*.txt`、`docs/review/t7-onset-attribution.md`。
- **非 0**：`ops/diag/t4-redaction-scan.txt`（`1[/]/`=1、`e[y]J`=1，见 D3）；脚本内的模式定义属预期（`ops/diag/t4-causal-ab.mts` 7 处、`ops/diag/t4-redact-scan.py` 2 处、上一轮遗留的 `endpoint-ab.mts` / `daily-project-retest.mts` / `daily-project-retest-*.analysis.md`）。
- 所有命中处其后均为 0 个字符 ⇒ **无真实凭据落盘**；`Authorization` 仅在产物中以 `Bearer <REDACTED>` 与长度 260/261 出现。

---

## §6 本次审查的边界

1. 我**未重跑**会产生上游流量或写他人写域的脚本（`t1-live.mts` / `t3-endpoint-contract.mts` / `t4-causal-ab.mts`，其输出目录硬编码为 `ops/diag`）。T3 脱敏自检（0 上游、仅 stdout）我重跑了。因此 T1/T3/T4 的"退出码"以产物内一致性与我复算的数据为准，未做端到端复跑。
2. T1 E1 的旧行号 `client.ts:481-484` 仍留在 `t1-live-*.log:85-86` 与 `t1-plugingate-*.json:64` 中；勘误 E1 已明说"产物文本未回改，以本条为准"，脚本与 md 已用 478-480 ⇒ 属**已披露残留**，不计缺陷，但建议回改以免后人只 grep 产物。
3. T7 §6 三项不可判定我确认**仍不可判定**（DB 无端点/状态码列、无端点日志、无运行时取值导出），任何把它们写成已证的版本都应再次打回。

---
---

# r2 复验（task-5 revision 4 → 5，2026-10-18 01:20–01:35 CST）

## VERDICT: APPROVE

D1 / D2 / D3 三条全部闭环，未引入新糊弄，未发现新反例。r1 中"我自己的一处口径瑕疵"在 §r2.5 自纠。

---

## r2.1 D1 闭环（T7 §3.2 重写）——准确，且比 r1 更强

| 被验项 | 我的独立命令 | 真实输出 | 判定 |
|---|---|---|---|
| 耦合机制预存在 | `git -C packages/core show fac08c5:src/quota.ts \| grep -n 'preferredEndpointIndex\|getOrderedEndpoints'` | `162 private preferredEndpointIndex = 0` / `314 private getOrderedEndpoints()` / `318` / `324` | PASS（与 (a) 段逐字相符） |
| 顺序由 1c0931a 翻转 | `git -C packages/core show 1c0931a -- src/oauth.ts \| tail -8` | `-daily` / `+daily` 换位，production 落到 index 0 | PASS（与 (b) 段逐字相符） |
| 该提交未动索引逻辑 | `git -C packages/core show 1c0931a \| grep -c 'preferredEndpointIndex'` | `0` | PASS |
| quota.ts hunk 头 | `git -C packages/core show 1c0931a -- src/quota.ts \| grep -n '^@@'` | `@@ -20,8 +20,13 @@ mergeFallbackFamilyQuota(` / `@@ -434,6 +439,14 @@` / `@@ -457,6 +470,7 @@` / `@@ -488,6 +502,7 @@` / `@@ -524,7 +539,7 @@`（5/5 中） | PASS |
| 爆炸半径仅配额路径 | `grep -rn 'AGY_ENDPOINTS' src packages/core/src` | 仅 `quota.ts:16(import)/320/323/343/371` + `oauth.ts:42(定义)`；`src/` 0 命中 | PASS |
| **新增**：生成候选数组亦被翻转 | `git -C packages/core show fac08c5:src/client.ts \| grep -n -A6 'export const ENDPOINT_FALLBACKS'` | fac08c5 `DEFAULT_ENDPOINT = daily`、数组 `[daily, daily-sandbox, production]`；HEAD 为 production-first | PASS（(b) 末句成立） |
| **新增**：线上产物数组字面量 | `sed -n '25646,25660p' dist/index.js`；`sed -n '27782,27795p' dist/index.js` | `25650 const ENDPOINT_FALLBACKS = [` 后为 production/daily/daily-sandbox；`27786 const AGY_ENDPOINTS = [` 后同为 production-first | PASS（行号与内容同 R6/R7） |
| R2/R3：429 分支未随翻转改动 | **单命令** `git -C packages/core show fac08c5:src/client.ts \| grep -n -A3 'res.status === 401'`，再 diff 两修订 | `478:` 分支 / `479 return {…}` / `480 }`；`diff` → **IDENTICAL** | PASS（r1 的教训已按"单命令单输出"落实） |

**覆盖性自检**（T7 声称 §8.1 覆盖全篇"相同/一致/无改动"类断言）：我 grep 全篇 `逐字相同|完全一致|无改动|同为|一致|相同`，实质出现处为 `:64`（401 行 → R14/R15）、`:92`（478 分支"同为…逐字相同…未改动" → R2/R3，正文已内联指向）、`:176`（r1 错误的自我披露，非断言）、`:368/390/391/395`（小节标题与整改摘要）。**全部有 R 行支撑，无遗漏。**

## r2.2 D2 闭环（T4 A 行拆栏 + 观测/推断分离）——诚实，无残留冒充

**被引用日志行逐行核对（11/11 命中）**

```bash
L=ops/diag/t4-causal-ab-2026-10-17T16-12-25-360Z.log
for n in 50 52 53 65 67 68 78 82 83 84 88; do printf '%3d: %s\n' "$n" "$(sed -n "${n}p" "$L" | cut -c1-120)"; done
 50: upstream requests actually issued: 1 -> ["https://cloudcode-pa.googleapis.com"]
 52: http status: 429 | resourceExhausted: true | ms: 5196
 53: continued to next candidate: false | stopped at: https://cloudcode-pa.googleapis.com
 65: upstream requests actually issued: 3 -> ["daily…","…sandbox…","production…"]
 67: http status: 429 | resourceExhausted: true | ms: 20959
 68: continued to next candidate: true | stopped at: https://cloudcode-pa.googleapis.com
 78: --- ARM A-prime SKIPPED --- arm A already probed sandbox …
 82:   fix step: production -> 429 (requests so far 5/8)
 83:   fix step: daily -> 404 (requests so far 6/8)
 84:   fix step: sandbox -> 404 (requests so far 7/8)
 88: upstream generation requests issued: 7 (budget 8, no retries)
```

| 被验项 | 我的命令 | 真实输出 | 判定 |
|---|---|---|---|
| A 行是否拆出观测/推断 | `sed -n '18,24p' ops/diag/t4-causal-ab-analysis.md` | A 行 `production=429 **本臂观测**（.log:67）`；`daily/sandbox=404 **推断**（无本臂日志，来源：同 run FIX 臂 .log:83/84）` | PASS |
| 是否把 FIX 观测冒充 A 观测 | `grep -n '404' t4-causal-ab-analysis.md` | 4 处：`:13` 归 FIX 臂；`:22` A 行标"推断"；`:24` FIX 行标"本臂逐 step 观测"；`:31/:34` 明写"来源标注为推断，不冒充实测" | PASS |
| 机制解释是否成立 | `sed -n '451,465p' packages/core/src/client.ts` | `451 const endpoints = customEndpoints?.length ? customEndpoints : endpointCandidates()`；`462 for (const endpoint of endpoints) {` ⇒ 多候选调用只回传单个 `Response`，逐端点状态只有单候选调用可得 | PASS |
| 是否偷偷补跑上游请求 | `stat` + `sha256sum` T4 原始产物 | json/log mtime `00:12:25 / 00:13:39 CST`（早于整改 `01:21`），json sha 仍 `443cf715…` ⇒ 方案 (a) **零新增请求**确证 | PASS |

## r2.3 D3 闭环（脱敏）——全产物 0 命中

用自己的非自匹配写法重扫全部 t1/t3/t4/t6/t7 产物**及我自己的两份交付件**：

```bash
for f in ops/diag/t1-* ops/diag/t3-* ops/diag/t4-* docs/review/t2-regression-archaeology.md \
         docs/review/t6-failure-timeline.md docs/review/t6-db-rows-*.txt \
         docs/review/t7-onset-attribution.md docs/review/verdict-r1.md docs/review/evidence-checklist-r1.md; do
  [ -f "$f" ] || continue
  a=$(grep -oE 'ya2[9]\.' "$f" | wc -l); b=$(grep -oE '1[/]/' "$f" | wc -l); c=$(grep -oE 'e[y]J' "$f" | wc -l)
  [ $((a+b+c)) -gt 0 ] && printf 'HIT %s => %s/%s/%s\n' "$(basename "$f")" "$a" "$b" "$c"
done
# 输出：（空）—— 无任何文件命中
```

- 逐文件命中数：**全部 0 / 0 / 0**；r1 唯一非零的 `ops/diag/t4-redaction-scan.txt` 已归零（扫描器与产物标签、替换串均改字符类写法）。
- T4 自扫 `ARTIFACT_TOTAL_HITS=0 / SOURCE_TOTAL_HITS=0 / GRAND_TOTAL_EXCLUDING_SELF=0 / SELF_OUTPUT hits=0` 与我的独立重扫一致。
- T7 R11 `0/0/0` 一致；R14/R15/R16 我复现为 `436`（首 04:00:01Z、末 04:30:51Z）、`401`、`0`。

## r2.4 T7 §6 三项不可判定：未被悄悄写成已证

| # | §6 表述 | 我的核验 | 判定 |
|---|---|---|---|
| 1 | 12:30:51 及 12:00–12:31 全部 401 行的**端点归属**不可判定 | `.schema` 复读：`request_metrics` 无 endpoint / 无 http status 列 | 仍不可判定 |
| 2 | **production 429 的起始时刻**不可判定 | `cooldowns.*.reason` 仅存最后一次失败；DB 无状态码列 | 仍不可判定 |
| 3 | **daily / sandbox 在 16:11:22 的状态**不可判定 | 16:40:54 的 A/B 未测 sandbox（`grep -c sandbox` = 0），16:51 复测只测 daily | 仍不可判定 |

§6 另两条（运行时 `preferredEndpointIndex` 取值、stats 行↔尝试次数对应）同样保留。**本轮无任何一处把这三项升格为结论。**

## r2.5 自纠（审查员口径瑕疵，非被审方问题）

r1 §5 写"T1 全部产物 0 命中"——结论正确，但当时的多文件循环回显有缺陷、未逐行打印全表；r2 用纯字面前缀重扫并逐文件判定，确认全部 0。
另注：`ops/diag/t1-live-analysis.md` §10 与 `docs/review/t7-onset-attribution.md` §7 中的模式说明文本采用**字符类写法**（形如 `1[/]/`、`e[y]J`、`ya2[9]\.`），**不构成字面前缀命中**，是刻意为之的反自匹配写法，应保留。

## r2.6 完整性再确认

HEAD `03fd33c`、core `e52abe7`、`dist/index.js` sha `6b8e1fad…`（与安装副本一致）、host `MainPID=666391` 未重启；本轮整改仅触碰 `docs/review/t7-onset-attribution.md`、`ops/diag/t4-causal-ab-analysis.md`、`ops/diag/t4-redaction-scan.txt`、`ops/diag/t4-redact-scan.py`，未改 `src/**`、`packages/core/**`、`dist/**`，未新增上游请求。

**最终裁定：APPROVE**（r1 的 2 阻断 + 1 轻微全部闭环）。
