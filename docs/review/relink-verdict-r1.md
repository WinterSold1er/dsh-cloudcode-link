# T4 对抗审查 r1 — 配方真实性与可复现性

- 审查员：reviewer（task-11，rev2，owner=reviewer）
- 审查时间：2026-11-16 18:37–18:58 CST（10:37–10:58Z）；独立基线 2026-11-16T09:28:26Z
- 审查对象：`ops/relink/t1-*`（出口矩阵）、`ops/relink/t2-*`（官方契约）、`ops/relink/t3-*`（配方/补丁/200 证明）
- 基线状态（只读，本人实测）：host `MainPID=2685153`、`NRestarts=0`、启动 11:42:18 CST；`/usr/bin/agy` sha256 `b5385638…cbcfc9`；Clash `Google=Main：🇺🇲 美国 | V2 | 02`、`漏网之鱼=总模式`；出口 ipinfo.io→`96.126.100.194/US`。
- 本审查全程未重启 host、未改 `/usr/bin/agy`、未写 `/tmp/agy-fix`、未切换 Clash selector、未发任何上游生成请求（T3 的 4/4 预算未经我消耗）。

---

## VERDICT: REJECT

REJECT 范围＝**T1 报告的证据陈述**（B1–B3）；**T2 与 T3 配方本身经复核真实、可复现**（§2/§3），不因本次 REJECT 失效。整改只需更正 T1 文档与标注（§7），**无需重跑实验、无需改代码、无需重启宿主**。

判定依据：T1 报告把两处**未发生的验证**写成已验证，并把 probe 自造的 body 写成“插件 body”。原始证据文件本身是诚实的（矛盾数据都保留着），但报告结论行与证据不符，违反本轮验收口径“每一条‘已证’必须能复现”。

---

## 1. 一句话对照

| 工作流 | 核心断言 | 本次复核 | 判定 |
|---|---|---|---|
| T1 | 三臂 429、139B 响应体 sha256 相同；CLI 五出口全 ineligible；生成请求 3 次；selector 切过且已恢复 | **全部属实**（§4.1） | 核心通过 |
| T1 | “ipinfo.io 全程 429”“ipapi.co 交叉互证（两源同一 IP）”“插件身份＋插件 body” | 前两条不属实；第三条“插件身份”属实、“插件 body”不属实（§4.2 B1–B3） | **REJECT** |
| T2 | 官方 UA/头集合/body 契约来自真实抓包；UA 版本对比精确；daily 有 200 抓包 | 属实（§3） | 通过 |
| T3 | 插件原样代码＋daily＋flash-lite＝200；同账号同模型 production＝429；补丁 `git apply --check` OK、tsc 0、212 tests pass | 配方与补丁属实（§2）；两项未证明项不得升格 | 通过（带已披露限制） |

---

## 2. T3 配方核验（通过）

### 2.1 补丁本身（本人亲自复跑）

```
$ cd /home/csy/Code/Github/dsh-cloudcode-link
$ git apply --check --verbose ops/relink/t3-patch.diff
正在检查补丁 packages/core/src/client.ts...
RC=0
$ git apply --numstat ops/relink/t3-patch.diff
1	1	packages/core/src/client.ts
```

- 当前工作区 `packages/core/src/client.ts:6-11` 是 production-first（与补丁上下文逐字匹配）；补丁后顺序＝`[daily, DEFAULT_ENDPOINT, daily.sandbox]`，`DEFAULT_ENDPOINT` 常量值未改。
- 补丁与 `t3-proof.json.minimal_change.diff_numstat`（1 insertion / 1 deletion）一致；与 `t3-proof.log` §6 一致。
- `endpointCandidates()`（`packages/core/src/client.ts:104-110`）在显式 `ANTIGRAVITY_BASE_URL`/自定义 baseUrl 时仍只返回该端点 ⇒ 补丁不改变显式覆盖语义。
- 429 语义核实（`streamGenerateContent`，`client.ts:444-491`）：遇 401/403/400/**429 立即 return，不试下一端点 ⇒ “重排首端点”确实是能改变命中端点的最小改动，与 T3 的说法一致。

### 2.2 类型与测试（本人亲自复跑）

```
$ cd /tmp/relink-patch/verify-final/packages/core && \
  /home/csy/Code/Github/dsh-cloudcode-link/node_modules/.bin/tsc --noEmit -p .
TSC_EXIT=0

$ cd /tmp/relink-patch/verify-final/packages/core && node --test "test/**/*.test.ts" | tail -8
ℹ tests 212
ℹ suites 33
ℹ pass 212
ℹ fail 0
```

补丁副本 `/tmp/relink-patch/verify-final/packages/core/src/client.ts` 确实是 daily-first（该副本由 pristine rsync + `git apply` 生成）。

**口径更正（非阻断）**：T3 写的 “repo tests 212 pass” 实际是 **`packages/core` 子仓**测试（18 个测试文件）；根仓（`/home/csy/Code/Github/dsh-cloudcode-link`）全量测试是 **255 pass / 0 fail**（23 个文件，本人实跑）。两个数都真实，但“仓库测试”标签应写清是哪个仓。

### 2.3 200 的来源（真实上游，非 mock）

- `t3-evidence/b-plugin-daily-flashlite.json`（gen#3）：
  `status=200`、`contentType="text/event-stream"`、`bytes=1451`、`sseEventCount=4`、`dataLinesObserved=4`、`firstText="Hi there! How can I help you today?"`、`endpointHit=https://daily-cloudcode-pa.googleapis.com`、`injection={headers:false,clientMetadata:false,patchedCore:false}`、`impl="plugin-core (packages/core/src/client.ts streamGenerateContent, pristine headers/body)"`、`durationMs=3092`。
- probe 源码（`/tmp/relink-build/probe/probe.mjs`）确实 `import` 的是插件源码副本（`probe.mjs:191` 动态 import `packages/core/src/client.ts`），调用 `client.streamGenerateContent()`（`:348`），并用插件真实的 `client.antigravityRequestEnvelope()` 生成 requestId/sessionId（`:316`）；`status`、`bytes`、`firstText` 均来自真实 `fetch` 响应流解析（`:361-399`），无硬编码文本。
- 该副本的 `client.ts` 与 repo 当前文件 sha256 完全相同（`97d33e0b…0455`）⇒ “插件原样代码”成立。
- 非 mock：mock-server 的应答文本是 `Hello from the mock SSE stream.`（`/tmp/relink-build/probe/mock-server.mjs:18-20`），与 gen#3 的 firstText 不同；gen#3 的 endpoint 是 https daily，不是 127.0.0.1。
- 非复用：4 次生成请求时间两两不同（10:14:56 / 10:21:26 / 10:23:22 / 10:26:14Z），各自有独立证据文件；gen#3 与 gen#4 仅端点不同（10:23 vs 10:26），不构成“一次请求充当多臂”。
- 对照：`t3-evidence/d-production-flashlite.json` 同账号（`acc_1788785623927_xhs7n`）、同模型（`gemini-3.5-flash-lite`）、同注入（`patchedCore:false`）、仅 endpoint=production → `429`、139B、`sseEventCount=0`。与 T1 三臂 429 的事实一致。

### 2.4 T3 未证明项（按 Lead 指令，不升格）

1. **补丁未在运行中的 host 内实测**（预算用尽）——`t3-proof.log:74`、`t3-proof.json.limitations[0]` 自述。
2. **HMR/`requires_host_restart:false` 未在本机验证**——`t3-proof.json.activation.residual_risk` 自述“未在本机实测”，该布尔值不得当作已证事实。
3. **模型是否必须 flash-lite 未隔离**——`t3-proof.log:75` 自述。
4. **插件路径 200 的原始 SSE 帧未持久化**——`b-plugin-daily-flashlite.json` 明确 `sseRawPersisted:false`，`t3-evidence/b-plugin-daily-flashlite.sse.txt` 首行标注 “derived-from probe.mjs output — raw SSE frames NOT persisted”。因此该 200 的“SSE 正文”是 probe 解析后的摘要（content-type + 4 个 data 事件 + 模型文本），不是原始帧；这是已披露的弱化，不是伪造，但也不得被引作“原始 SSE 抓包”。
5. 小口径瑕疵：`t3-evidence/counter.txt` gen#3 时间写 `10:24:06Z`，证据 JSON 是 `10:23:22.240Z`（差 44s，是文件落盘时刻而非请求时刻）；probe 计数器含 mock 运行（`.probe-counts.json` 最终 generate=6，而证据账本只登记 4 次上游），不能当上游预算计数器用。

---

## 3. T2 核验（通过）

### 3.1 官方 UA 与头集合（抓包＝直接证据）

本人直接读原始抓包（只读）：

```
$ grep -aE 'User-Agent|^  [A-Za-z-]+:' 20261116T081811Z-33.req.txt
  Host: daily-cloudcode-pa.googleapis.com
  User-Agent: antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)
  Transfer-Encoding: chunked
  Authorization: Bearer ***REDACTED***
  Content-Type: application/json
  Accept-Encoding: gzip
```

- `t2-contract-diff.md:49` 的 UA 全串与抓包逐字符一致（35/2/9 三个 req 文件三处一致）。
- 官方头集合只有 6 个（Host/UA/Transfer-Encoding/Authorization/Content-Type/Accept-Encoding），**无** `X-Goog-Api-Client`、`Client-Metadata`、`Accept`、`x-client-version`（`grep -c 'x-goog\|Client-Metadata' 35.req.txt` → 0）。
- 同一抓包目录 resp：`status line: HTTP/1.1 200 OK`、`Content-Type: text/event-stream`、`grep -c '^data: '` → 3，含真实模型输出（`Hi! How can I help you today?`）⇒ “daily 被抓包观测到 200”成立。
- 抓包未被改写：`mitm.py` 中 `User-Agent` 0 命中、`antigravity/cli` 0 命中；`rules.json.off` 存在，各响应头 `rewritten: no`。

### 3.2 二进制证据（本人复跑字面量与反汇编）

```
$ python3 -c "d=open('/usr/bin/agy','rb').read(); print(d.count(b'1.3.5'), hex(d.find(b'1.3.5')))"
1 0xabeb833
$ python3 -c "…print(d.count(b'antigravity/cli'), d.count(b'aidev_client'), hex(d.find(b'aidev_client')), d.count(b'cl=%d'), hex(d.find(b'cl=%d')))"
antigravity/cli count 0; aidev_client 1 0x52a831a; cl=%d 1 0x5210968
$ objdump -d --start-address=0x7a37ce0 --stop-address=0x7a380e0 --no-show-raw-insn /usr/bin/agy
# 解析 lea 目标字符串得到：User-Agent / X-Goog-Request-Reason / Content-Type (+ application/json)
```

- `X-Goog-Request-Reason` 文件偏移 `0x535527b`（与 `t2-contract-diff.md:60` 一致）。
- `t2-binary-findings.md:171` **自己承认**：`antigravity/cli` 作为整体串在二进制 count=0，UA 只能算推断（抓包已证）。因此 T2 **没有**把“猜的头”写成“官方头”；反而把“定义已证/发送未证”的单列了出来（行 13 `X-Goog-Request-Reason`）。
- UA 版本对比精确：官方 `1.3.5 / cl=998863838 / arch=amd64 / auth_method=consumer` vs 插件 `2.8.0 / cl=963137146 / arch=x64 / 无 auth_method`；插件 UA 来自 `packages/core/src/client.ts:111-116`（本人在源码核对），`cl` 与版本均可用 env 覆盖但默认值如上。

---

## 4. T1 核验

### 4.1 通过项（核心断言属实）

| 断言 | 复核方式 | 结果 |
|---|---|---|
| 三臂真实发出、各 1 次 | `t1-arm-{A,B,C}.json` 时间/trace-id/latency | 10:08:11Z / 10:08:26Z / 10:08:38Z，trace-id 三不同（`173817ed…`/`f4255eb8…`/`27d1de61…`），`attempts=1` |
| body 三臂逐字节一致 | `jq -j '.request_body' \| sha256sum` | 362 B，三者均 `8d9647890ce6f8b7b82ac466db3c324499225016fc3b527cd7964fb5967f40bb` |
| 响应体 139 B 且三臂 sha 相同 | `jq -j '.response_body' \| sha256sum` | 三者均 `73cfb6949dc395773288a9a10695a70a6b45901d933cc7ed532bb95845406453`，len=139 |
| 生成请求计数=3 | 时间戳+证据文件 | 3 次（预算 4，余 1）；无 retry、无第二端点 |
| selector 切过 | `/connections` 采样中目标节点承载的 Google 域连接 | R1 US-V2-02=44、R2 US-V1-03=14、R3 JP=21、R4 SG=17、R6 HK=30（按“每快照 Google 域连接数求和”口径可逐项复现） |
| selector 已恢复 | `t1-clash-after.json` vs 本人基线 `/proxies` | `Google=Main：🇺🇲 美国 | V2 | 02`、`漏网之鱼=总模式`，与基线一致；`restore_failures=0` |
| CLI 资格探针 | `t1-cli-log-R*.txt` 原文 | R1 `server_oauth.go:114`、R2/R3/R4/R6 `:133` 均 “not available in your location”；R5 为 `loadCodeAssist EOF`（报告如实记“无判定”，未把 classifier 标签当地区结论） |
| `/usr/bin/agy` 未被改 | `sha256sum` | 前后均 `b5385638…cbcfc9`；mtime 仍 10 月 16 日；root-owned |
| 出口 IP 与声称一致 | `t1-ipinfo-R*.{json,ipapicom.json}` | R1 23.247.137.105/US、R2 96.126.100.194/US、R3 139.162.81.14/JP、R4 64.118.136.254/SG、R6 203.175.14.47/HK；本人基线中 `美国节点(URLTest)=US V1|03` 且 ipinfo.io 实测 `96.126.100.194`，与 R2 归属互相印证 |

> 计数口径说明：本人最初按“去重连接”算得 15/11/16/10/14，与报告数字不符；按“每快照 Google 域连接数求和”重算得 44/14/21/17/30，与报告**完全一致**。报告数字可复现，此项不构成缺陷。

### 4.2 阻断缺陷（必须更正）

#### B1 — “ipinfo.io 全程 429（限流）”不属实

报告位置：`ops/relink/t1-matrix.md:46`；`ops/relink/t1-run.json` `deviations[0].what`（“returned HTTP 429 … for essentially the whole run”）。

复现命令与真实输出：

```
$ cd ops/relink
$ for r in 1 2 3 4 5 6; do printf 'R%s ' $r; cat t1-ipinfo-R$r.json | tr -d '\n'; echo; done
R1 {"error":"empty_response","curl_rc":28}
R2 {"error":"empty_response","curl_rc":28}
R3 {"ip":"139.162.81.14",...,"city":"Tokyo","country":"JP",...}
R4 {"ip":"64.118.136.254",...,"city":"Queenstown Estate","country":"SG",...}
R5 {"error":"empty_response","curl_rc":28}
R6 {"status":429,"error":{"title":"Rate limit hit",...}}
```

即：**3 次 curl 超时（rc=28）、2 次 HTTP 200 成功、1 次 429**；`.err` 文件也显示 `curl: (28) Operation timed out`。写“全程 429”与原始文件不符。

#### B2 — “ipapi.co 交叉互证（同一行两源返回同一 IP）”不属实

报告位置：`ops/relink/t1-matrix.md:46`。复现命令与真实输出：

```
$ for r in 1 2 3 4 5 6; do printf 'R%s ' $r; head -c 90 t1-ipinfo-R$r.ipapi.json; echo; done
R1 {"error":true,"reason":"RateLimited",...}
R2 {"error":true,"reason":"RateLimited",...}
R3 {"error":true,"reason":"RateLimited",...}
R4 {"error":true,"reason":"RateLimited",...}
R5 Please contact us for a trial account or sign up for a paid plan at https://ipapi.co/pricing
R6 <!DOCTYPE html>…Just a moment…
```

`ipapi.co` **六行零可用数据**。真正出现的“两源同一 IP”只在 R3/R4（`ipinfo` + `ip-api.com` 相同），R1/R2/R6 只有 `ip-api.com` 单源，R5 无地理。报告把它写成 `ipapi.co` 交叉互证，属于把未发生的验证写成已做；`t1-matrix-data.json.rows[*].egress_source` 本身也只写 `ip-api.com`，报告与自身结构化数据矛盾。

影响：出口 IP 的可信度被夸大。实际结论（五个有判定出口全 ineligible、三臂 429）**不受影响**——CLI 日志与 `/connections` 链路是独立证据，本人已复核。

#### B3 — “插件 body”不属实（C1 行；身份部分属实）

报告位置：`ops/relink/t1-matrix.md:16`（C1：“直连 cloudcode-pa（插件身份 + 插件 body）”）。身份头确实是插件真实头（`t1-probe.sh:179-188`：三次请求都走 `PLUGIN_UA="antigravity/hub/2.8.0 (…cl=963137146)"` + `X-Goog-Api-Client` + `Client-Metadata`），但 **body 是 `t1-probe.sh` 手工构造的官方 CLI checkpoint 形状 body**：

```
$ sed -n '160,172p' ops/relink/t1-probe.sh
    "requestId": "checkpoint/00000000-0000-4000-8000-000000000000",
    ...
    "userAgent": "antigravity",
    "requestType": "checkpoint",
```

而插件本身：
- 类型只允许 `requestType: 'AGENT'`、`userAgent: 'ANTIGRAVITY'`（`packages/core/src/client.ts:95-102`）；
- requestId 格式是 `agent/<trajectoryId>/<step>`（`client.ts:435`）；
- `packages/core/src` 与 `src/` 中 `checkpoint` 出现 **0 次**（本人 grep）。

因此 C1 的“插件 body”是错误归属：实际是“**官方 CLI checkpoint 形状 body＋插件头**”（身份头确是插件真实头：`PLUGIN_UA="antigravity/hub/2.8.0 (…cl=963137146)"` + `X-Goog-Api-Client` + `Client-Metadata`，见 `t1-probe.sh:179-185`；三次真实请求的 probe 身份臂均为 A，日志/JSON 的 `arm=A` 与此一致）。这不影响“同一 body 换出口仍 429”的结论，但会让读者误以为 T1 已用插件真实请求（AGENT body）证明 production 429；真正的插件路径证明在 T3（gen#3/gen#4）。

### 4.3 其他（非阻断，建议说明）

- **N1 命名澄清（非缺陷）**：`t1-arm-B/C.json` 的 `arm` 字段为 `"A"`、日志打印 `arm=A`，这是 **probe 的身份臂**（三次真实请求都固定用 A＝插件头，符合矩阵“身份固定”的说法），不是实验臂 B/C；实验臂 B/C 只是 egress 行 R2/R3 的别名。建议在矩阵里加一句区分，避免读者误判为标签错误。
- **D2**：`t1-run.json.deviations[0]` 与 B1 同源措辞（“essentially whole run 429”），需与 `.err` 原文对齐。
- **D3**（T3，非阻断）：`repo tests 212` 实为 `packages/core` 测试（根仓 255）；`counter.txt` gen#3 时间 `10:24:06Z` 与证据 `10:23:22.240Z` 差 44 s；probe 计数器对所有 generate op 计数（含 mock 验证与 18:39 的一次非登记增量，最终 generate=6 ≠ 上游账本 4），不能当上游预算计数器。

---

## 5. 约束与安全核验

| 约束 | 结果 | 证据 |
|---|---|---|
| 不重启 DSH host | **未重启** | 基线 09:28Z `MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST；复核时（18:55Z 前）完全相同 |
| 不改 `/usr/bin/agy` | **未改** | sha256 `b5385638…cbcfc9`，mtime 2026-10-16 14:25 |
| 不写 `/tmp/agy-fix` | 未见 T1/T2/T3 证据产物写该目录 | `/tmp/agy-fix` 下 17:25 后有 120 个文件更新，但内容属 `gate2/`（单补丁 CLI 实验）、`review2/`、`finalize/`，与 T1/T2/T3 的产物无关；本次不据此判 T1 违规（无法归因到 T1 进程） |
| 不改 Clash 配置 | 未改 | `~/.config/clash-meta/config.yaml` mtime 2026-10-27 15:14 |
| 不改 repo 工作区 | 未改 tracked 文件 | `git status --porcelain` 仅 `M ops/restart/.last-restart-pid`（mtime 2026-10-16，属旧改动，非本会话）；`packages/**`、`src/**`、`dist/**` 无改动 |
| 凭据/邮箱脱敏 | 通过 | `ops/relink/**` 扫 `ya29.`/`1//0`/`eyJhbGciOi` → 0 文件；`*@gmail.com` → 0；`Bearer <25+ 字符>` → 0 |
| 审查员未越权 | 未重启/未改二进制/未切 selector/未发上游请求 | 本人全程只读 + `git apply --check`（不写入） |

---

## 6. T1/T2/T3 结论关系（防止后续误引）

1. T1 的结论是**负结论**（production 三出口 429；地区闸门在测试范围内不成立；身份/端点/项目闸门仅列候选）。T1 **不能**用来证明“身份闸门”或“插件 body 导致 429”。
2. T3 证明的是：**插件原样代码（真实 headers/envelope）在 daily 端点 200，production 端点 429**；identity 不需要改。T2 的契约差量与该结果不矛盾（官方无 x-goog/Client-Metadata，但插件多发的头被服务端容忍）。
3. T2 的“官方 UA 1.3.5”由抓包直接证明；二进制里 `antigravity/cli` 字面量 count=0，T2 已如实标注为推断，不得反过来写成“二进制已证 UA”。
4. T3 的两项未证明项（补丁未在宿主内实测、模型未隔离）分别由 T12/T13 接手，**本轮不得升格为已证**；HMR 免重启机制亦未实测。

---

## 7. 整改要求（reopen 条件）

1. 更正 `t1-matrix.md:46` 与 `t1-run.json.deviations[0]`：如实写 ipinfo 的 3 超时/2 成功/1 限流，及实际使用的源（`ip-api.com`；R3/R4 另有 `ipinfo` 互证；`ipapi.co` 全失败）。
2. 更正 C1 行（`t1-matrix.md:16`）：把“插件 body”改为“官方 CLI checkpoint 形状 body＋插件真实头”，或重跑一次用插件真实 envelope/AGENT body 的直连臂；不得再写“插件 body”。
3. 在矩阵里补一句实验臂/身份臂命名说明（`t1-arm-*` 的 `arm=A` 是身份臂，不是实验臂 B/C 写错）；随附更新 `t1-run.log` 标签更佳。
4. T3 口径更正：`repo tests 212` → `packages/core tests 212（根仓 255）`；`counter.txt` gen#3 时间改为证据值；注明 probe 计数器含 mock、不能当上游预算计数。
5. T3 保持两条未证明项为“未证”；`activation.requires_host_restart=false` 必须附“未在本机实测”的限定（现 `residual_risk` 已有，但布尔字段易被单独引用，建议改为 `unverified`）。

以上 1–2 为 REJECT 阻断项；3–5 为随附更正。整改完成后可进入第 2 轮复核（无需重跑上游请求）。

---

## 8. 复核命令清单（全部只读/无副作用）

```bash
cd /home/csy/Code/Github/dsh-cloudcode-link

# 基线/宿主
date -u; systemctl --user show deepseek-harness.service -p MainPID -p NRestarts -p ExecMainStartTimestamp
sha256sum /usr/bin/agy; stat -c '%y' ~/.config/clash-meta/config.yaml

# T1 三臂
for a in A B C; do jq -j '.response_body' ops/relink/t1-arm-$a.json | sha256sum; done
for a in A B C; do jq -j '.request_body'  ops/relink/t1-arm-$a.json | sha256sum; done
for r in 1 2 3 4 5 6; do printf 'R%s ' $r; cat ops/relink/t1-ipinfo-R$r.json; echo; done
for r in 1 2 3 4 5 6; do printf 'R%s ' $r; head -c 90 ops/relink/t1-ipinfo-R$r.ipapi.json; echo; done
jq -r '.arm' ops/relink/t1-arm-{A,B,C}.json

# T2 抓包与二进制
grep -aE 'User-Agent|^  [A-Za-z-]+:' /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T081811Z-33.req.txt
grep -c '^data: ' /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T081812Z-35.resp.txt
python3 -c "d=open('/usr/bin/agy','rb').read(); print(d.count(b'1.3.5'),hex(d.find(b'1.3.5')),d.count(b'antigravity/cli'))"
objdump -d --start-address=0x7a37ce0 --stop-address=0x7a380e0 --no-show-raw-insn /usr/bin/agy

# T3 补丁与测试
git apply --check --verbose ops/relink/t3-patch.diff; git apply --numstat ops/relink/t3-patch.diff
(cd /tmp/relink-patch/verify-final/packages/core && /home/csy/Code/Github/dsh-cloudcode-link/node_modules/.bin/tsc --noEmit -p . ; echo TSC_EXIT=$?)
(cd /tmp/relink-patch/verify-final/packages/core && node --test "test/**/*.test.ts" | tail -8)
jq -c '{status,contentType,bytes,sseEventCount,firstText,sseRawPersisted}' ops/relink/t3-evidence/b-plugin-daily-flashlite.json

# 敏感信息
grep -rEl 'ya29\.|1//0|eyJhbGciOi' ops/relink; grep -rhoE '[A-Za-z0-9._%+-]+@gmail\.com' ops/relink
```

（注：`packages/core` 内 `tsc` 的路径按实际 checkout 拼写；本审查使用 `/home/csy/Code/Github/dsh-cloudcode-link/node_modules/.bin/tsc`，实测 `TSC_EXIT=0`。）

---

## 9. 最终裁定

- **REJECT**：T1 报告三处证据陈述不成立（B1/B2/B3），不能按“已证”口径通过。
- **T2 通过**：UA/头/body 契约均来自真实抓包与可复现二进制偏移；无“猜的头写成官方头”。
- **T3 配方通过**：补丁 `git apply --check`、`tsc`、`212（core）/255（root）` 测试均实跑通过；200 为真实上游且非 mock/非复用；两项未证明项按 Lead 指令不升格。
- 本 REJECT 不否定“daily 端点＋端点重排”的修复方向；仅要求 T1 证据陈述回到可复现口径后再行第 2 轮复核。

---

# r2 复核（2026-11-16 19:12–19:35 CST）— 覆盖 r1 的最终裁定

- 复核对象：T1 v2（`t1-matrix.md`/`t1-run.json`/`t1-matrix-data.json`/`t1-repro.md`/`t1-verification.log`）、T12（`t12-model-matrix.md`/`t12-arm1.json`/`t12-counter.txt`）、T13（`t13-deploy.md`/`t13-*.json`/`t13-inotify.log`），以及仍在的 T2/T3。
- 复核方式：本人逐项复跑命令；未重启 host、未发上游生成请求、未改 `/usr/bin/agy`、未写 `/tmp/agy-fix`、未切 Clash selector。
- 基线：host `MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST；`/usr/bin/agy` sha `b5385638…`（10-16 mtime）。

## VERDICT r2: REJECT

**唯一阻断：T13 的“HMR 已生效/已装载”未证明。** T1 v2、T2、T3、T12 全部通过（逐条见下）；T13 的文件级部署事实全部为真，但“已装载”这一核心结论未达到本轮验收口径——`e2e` 走的是 repo 源码而非已部署 dist，且没有内存态/行为级判别器。按 Lead 指令记为 **“未证明已装载”**并给出最小补强实验（§r2-5.3）。

## r2-1 T1 v2 复验（PASS，B1/B2/B3 全部闭环）

| 项 | 复核命令（本人实跑） | 真实输出 | 判定 |
|---|---|---|---|
| B1 ipinfo 三态 | `for i in 1 2 3 4 5 6; do head -c 80 t1-ipinfo-R$i.json; done` | R1/R2/R5 `{"error":"empty_response","curl_rc":28}`；R3 `139.162.81.14`；R4 `64.118.136.254`；R6 `{"status":429,…Rate limit hit}` | **已修**（3 超时/2 成功/1 限流） |
| B2 ipapi.co | `head -c 80 t1-ipinfo-R$i.ipapi.json` | R1–R4 `RateLimited`；R5 付费墙；R6 `<!DOCTYPE html>…Just a moment…` | **已修**（0 行可用） |
| B2 双源 | `t1-verification.log §V5` | R1/R2/R6 `single-source`；R3/R4 `MATCH`；R5 `none` | **已修**（仅 R3/R4 双源） |
| B3 body 归属 | C1 行 + `grep -rn checkpoint packages/core/src src` + `t1-probe.sh:163/170/171` | C1 已改“插件真实身份头 + 官方 checkpoint 形状手造 body（非插件真实 body）”；`checkpoint` 0 命中；probe body `requestId=checkpoint/0000…`/`userAgent=antigravity`/`requestType=checkpoint`，插件类型只允许 `AGENT/ANTIGRAVITY`、requestId=`agent/<uuid>/<step>` | **已修** |
| D1 勘误 | `t1-run.json.deviations[0]` | `corrected_at=19:10`、`correction_reason` 明写“原表述 429 for essentially the whole run 过度概括，数据未重跑，仅更正陈述” | **已修** |
| V1 三臂 | `jq` 三臂 status/endpoint/sha/bytes | A/B/C 均 `429`、production、`73cfb6949dc39577…`、139 B | 属实 |
| V2 R5 | `t1-matrix-data.json.rows[4].cli_probe` | `verdict=ineligible_zero_quota`、**`verdict_genuine=false`**、`effective_verdict=no_verdict_transport_error` | R5 未按判定计入 |
| V7 计数 | `t1-run.json.counter` | `generation_requests_used=3 / budget=4 / cli_probe_runs=6`；A 18:08:09、B 18:08:24、C 18:08:36 | 属实 |
| V8 selector | `curl /proxies`（本人只读） | `Google=Main：🇺🇲 美国 | V2 | 02`、`漏网之鱼=总模式`（与 r1 基线一致） | 已恢复 |
| V9/V10 | 75 文件扫描 + 消息去重 | `checked_files=75 files_with_hits=0`；ineligible 消息 `unique_texts=1`，R5 无该行 | 属实 |

**R5 专项确认**：`t1-verification.log` §V2 打印的是探针原始 `verdict` 字段（R5 仍显示 `ineligible_zero_quota`），但同一行 `None|None` 且 §10-V2 明确以 `t1-matrix-data` 的 `verdict_genuine=false → effective no_verdict_transport_error` 为准；矩阵行 R5、C2 均写“无判定”。**没有把 R5 的 transport error 当判定**。§V2 日志行本身建议补 effective 列（非阻断）。

## r2-2 T2（PASS，沿用 r1）

T2 产物未变（`t2-*` mtime 仍 17:39–18:08），r1 的复核结论继续有效：官方 UA 由抓包直接证明（`antigravity/cli/1.3.5 (…cl=998863838; auth_method=consumer)`），二进制 `1.3.5` count=1 @0xabeb833、`antigravity/cli` count=0（T2 自标推断）、`setHeaders` 三元组经 objdump 复核；官方 6 头无 x-goog/Client-Metadata；daily 200 抓包 3 个 `data:` 帧。无新增缺陷。

## r2-3 T3（PASS，沿用 r1；补丁已应用状态复核）

- T3 产物未变；repo 现已被 T13 应用同一补丁，因此对当前树跑正向 `git apply --check` 会失败（预期，已应用）：
  - `git -C packages/core diff --stat` → `src/client.ts | 2 +-`（1+/1-，仅 `ENDPOINT_FALLBACKS` 重排）。
  - `git apply --check -R ops/relink/t3-patch.diff` → **RC=0** ⇒ 当前树与补丁逐字对应。
  - 对 `git -C packages/core show HEAD:src/client.ts` 的 pristine 内容正向 `git apply --check` → **RC=0** ⇒ 补丁仍可从 HEAD 复现。
- 根仓全量测试（当前 patched 树）本人实跑：**255 pass / 0 fail**。

## r2-4 T12 复验（PASS，带 2 个非阻断 caveat）

**模型映射 file:line 逐条与代码一致（本人读源码核对）**：

| 声明 | 代码位置（实测） | 核对 |
|---|---|---|
| `gemini-3.8-flash` + high → `gemini-3.8-flash-high` | `packages/core/src/models.ts:518-527`，high 行 `:524` | 一致 |
| `getAntigravityRequestModelId(model, effort)` | `models.ts:627-629` | 一致 |
| adapter 取 wireModel | `src/host/adapter.ts:199` | 一致 |
| 请求体 `requestBody.model = wireModel` | `src/host/adapter.ts:404-406` | 一致 |
| 默认 effort 解析（high 优先） | `models.ts:462-467`；运行时 override `~/.dsh/agy-link/runtime-overrides.json` `defaultEffort:"high"` | 一致 |
| 插件默认值 | `packages/core/src/types/config-types.ts:109-110`（`defaultModel:''`, `defaultEffort:''`） | 一致 |

**200 证据**（`t12-arm1.json`）：`ts=2026-11-16T10:39:29.083Z`、`status=200`、`contentType=text/event-stream`、`bytes=1734`、`sseEventCount=2`、`firstText="Hello! How can I help you today?"`、`endpoint=https://daily-cloudcode-pa.googleapis.com`、`model=gemini-3.8-flash-high`、`injection` 全 false、`coreSrc=/tmp/relink-build/...`（pristine probe）、`durationMs=8634`。请求计数：`t12-counter.txt` `gen=1`（文档 1/3）与产物一致；`arm1.json.counts.generate=6` 是共享的全局 probe 计数器（含此前运行），不是本臂次数。

**残余风险如实保留**（`t12-model-matrix.md` §3）：`-tiered`/`-low`/`-medium` 未实测、未升格；文档还给出 429 兜底与白名单两类备选，未擅自实现。**PASS**。

非阻断 caveat：
1. 与 T3 相同，**原始 SSE 帧未持久化**；`t12-arm1.json` 是 probe 摘要（status/contentType/事件数/firstText），且无 `sseRawPersisted` 标注。probe 源码已审计（真实 fetch 解析、无硬编码文本），mock 应答文本为 `Hello from the mock SSE stream.` 与本证据不同 ⇒ 非 mock；但“原始帧”不可得。
2. `t12-counter.txt` 时间 `18:39:44` 与证据 `18:39:29.083Z`（=18:39:29 CST）差 15 s，是落盘时刻而非请求时刻（与 T3 counter 同类小瑕疵）。

## r2-5 T13 复验（文件级 PASS；**装载未证明 → REJECT 阻断**）

### r2-5.1 文件级事实（全部本人复跑为真）

| 项 | 实测 |
|---|---|
| dist 两处 sha | repo `dist/index.js` = 安装副本 = `677d9a81e70ba139a417e5fff5e7c784d3efdd6fa97a34f359b7db6e77f7ce82` |
| 旧版备份 | `/tmp/relink-t13-deploy/backup-index.js` sha `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`（size 1250243） |
| 安装副本 stat | inode 5819482、size 1250243、mtime 1794826906、mode 644（与文档一致） |
| 安装副本内容顺序 | `const ENDPOINT_FALLBACKS = ["https://daily-cloudcode-pa.googleapis.com","https://cloudcode-pa.googleapis.com","…sandbox…"]` |
| core diff | `git -C packages/core diff --stat` → `src/client.ts 2 +-`；内容仅 `ENDPOINT_FALLBACKS` 1+/1- |
| root dist diff | `git diff dist/index.js` → 同序重排 1+/1- |
| 构建测试 | `/tmp/relink-t13-build/test.log` → `tests 255 / pass 255 / fail 0`；`unshare -rn`（无外网）下运行 |
| profile 触发 | `cordis.patch.yml` 尾部只有追加注释 `# t13-recomp 20261116T110145Z`；备份 sha `f38700c2…`、size 14489 |
| host 未重启 | `MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST（19:12/19:22 两次核对一致） |
| 路由健康 | `/status` 200（enabled/transport=direct/dormantReason=null/catalog discovered 16）、`/pool` 200（5 账号） |
| LCA daily | `t13-lca-daily.json` → `loadCodeAssist @ daily` 200、`project=aicode-consumers`、`ineligibleTiers=null` |
| e2e | `t13-e2e.json` → 200、SSE、2052 B、3 事件、`Hello! How can I help you today?`、`endpoint=daily` |

### r2-5.2 为什么“已装载”未证明（阻断理由）

1. **e2e 没有经过已部署 dist**：`t13-deploy.json.e2e.command` 明写 `PROBE_CORE_SRC=.../packages/core/src/client.ts`，`t13-e2e.json.injection.coreSrc` 也是 **repo 源码**，不是 `~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js`。它证明的是“补丁源码走 daily 得 200”，**不是“运行中的宿主已加载新 dist”**。文档 §4 的“口径说明”已承认这一点，但 §0/标题仍写“已通过 HMR recomposition 生效”——该断言强于证据。
2. **没有内存态判别器**：`/status` 的 keys 为 `askTool/auth/catalog/defaultEffort/defaultModel/dormantReason/enabled/lastRun/plugin/pool/poolAuth/transport`，没有 `build`/`distSha256`/`startedAt`/`uptime`；`diff status-before status-after` 只有配额模型列表与时间戳变化（quota 刷新），`catalog` 前后都是 `{source:"discovered",count:16}`、`lastRun` 前后都是 null。`journalctl … | grep -ciE 'reload|recompos|hmr|cloudcode'` = **0**（与 recon“patch 路径静默”一致）。
3. **inotify 证据真实但不能归因读者**：`t13-inotify.log` 共 84 事件（4 OPEN/79 ACCESS/…），部署自读 burst `906.834–906.865`（`time.time()%1000`，对应 epoch 1794826906.8x），触发后 `909.432 ['OPEN']+['ACCESS']`（≈2.2 s 后）；空闲对照 `inotify-idle.log` 仅 83 字节 `watching …`（0 事件）。这些是**真实原始事件**，但 inotify 不提供读进程 pid/cmdline；该 ACCESS 由谁发起是“排除本脚本自读 + 空闲零读”的推断，不能排除其他并发进程。它能证明“文件被重读”，不能单独证明“宿主模块被替换”。
4. **catalog 状态本可做判别器，但没采到**：`ModelCatalog` 是进程内对象，插件每次 `apply` 都 `new ModelCatalog(...)` 并 `void catalog.refreshIfNeeded()`（`packages/core/src/models.ts:330-350,357-366`；`src/index.ts:171-177`），初始 `source:"fallback"`，发现完成后才变 `"discovered"`。成功 recomposition 会有一段 `fallback` 瞬态；T13 的 60 ms 轮询只记录 HTTP code（`pollfast.log` 全是 `200`），没记 `catalog.source`，因此错过该判别信号。`status-before/after` 都在发现完成后（discovered 16），无法区分旧实例/新实例。
5. 结论：按本轮口径，**“HMR 已生效/已装载”= 未证明**；`e2e 走部署后默认端点顺序 → 200` 应改写为“补丁源码默认顺序 → 200”。T13 文档 §3.3/§4 已如实标注缺口，但 §0 的断言不得按“已证”接受。

### r2-5.3 最小补强实验（建议，二选一；无需重跑 T1/T2/T3/T12）

**A（首选，零生成、零重建，约 1 分钟）：catalog 瞬态 + 同窗 inotify 关联**

1. 起 inotify 探针 watch 安装副本 dist（同 `inotify_probe.py`）。
2. 向 `~/.dsh/profiles/web/cordis.patch.yml` 再 append 一条注释触发 HMR；同时以 **10–20 ms** 轮询 `GET http://127.0.0.1:3080/plugins/cloudcode-link/catalog`（记录 `source`/`count`），持续 15 s。
3. 判据：出现 `source:"fallback"`（或 count 从 fallback 集合变 16）**且**同一秒内 dist 出现 OPEN/ACCESS ⇒ 新插件实例 + 新字节被重新读入，**已装载**；若全程 `discovered 16` 且 dist 无新读 ⇒ **未装载**（HMR 未生效，需走控制性 remount 或重启，由 Lead 决策）。
4. 若发现瞬态过短抓不到：把轮询降到 5 ms，或直接用 B。

**B（决定性、可长期复用，需 1 行产品代码 + 重建/部署）**

- 在 `/status` payload 增加 `distSha256`/`build`（`src/index.ts:345-362`；recon 已建议 C 方案），重建 dist、覆盖安装副本、再次 append 注释触发 HMR；GET `/status` 返回**新 sha** ⇒ 新代码已装载；仍返回旧值/无字段 ⇒ 未装载。该实验把“装载”变成永久可重复的证伪点。
- 成本：1 次重建 + 1 次部署；无上游请求；风险与 T13 本次相同（几十~几百 ms 的 adapter 缺口）。

**C（行为级，可选，消耗 1 次生成）：** 通过运行中的宿主（DSH 会话/插件 provider）发 1 次 `gemini-3.8-flash-high` 生成：旧代码 production-first → 429，新代码 daily-first → 200（`t13-deploy.json.e2e.generations_used=1/2`，尚余 1 次）。

> 附：`e2e` 应改为“经宿主”的路径（GUI/会话或插件 provider），不要再以 probe 直连源码充当“部署后 e2e”。

## r2-6 约束 / 安全（本轮复核）

- host 未重启：`MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST（19:12/19:22 两次）。
- `/usr/bin/agy` 未改：sha `b5385638…cbcfc9`、mtime 10-16；`/tmp/agy-fix` 19:00 后新增文件 **0**；Clash 配置 mtime 仍 10-27。
- T12/T13 产物凭据前缀扫描 0、`*@gmail.com` 0；T13 未写 `/tmp/agy-fix`。
- repo 状态（T13 预期改动）：`M dist/index.js`、`M packages/core`（`src/client.ts` 1+/1-，未提交）、profile `cordis.patch.yml` 仅追加注释；无任何 commit/push。
- 唯一“运行态变更”是安装副本 dist + profile 注释；`/status`、`/pool` 仍 200，未观察到 404 窗口（poll 260×200）。

## r2-7 最终裁定

- **T1 v2：PASS**（B1/B2/B3 全部闭环；V1–V10 命令↔输出可复现；R5 未被当判定）。
- **T2：PASS**（沿用 r1，无变化）。
- **T3：PASS**（沿用 r1；补丁已应用，反向/正向 apply check 均 RC=0；255/0 测试）。
- **T12：PASS**（模型映射 file:line 与源码一致；daily 200 证据真实；计数 1/3；残余风险保留；原始 SSE 帧未持久化与 counter 15 s 属非阻断 caveat）。
- **T13：文件级 PASS；装载证明 FAIL（未证明已装载）**。
- **r2 最终：REJECT**（唯一阻断＝T13“HMR 已生效”未证；按 Lead 指令写“未证明已装载”）。完成 §r2-5.3 的 A 或 B 后，r3 可直接转 APPROVE（T1/T2/T3/T12 无需再跑）。

---

# r3 复核（2026-11-16 19:57–20:12 CST）— 覆盖 r2 的最终裁定

- 复核对象：T13 A/B 补强产物（`t13-status-field.diff`、`t13-hmr-proof.{md,json}`、`t13-b-proof.json`、`t13-b-status-series.jsonl`、`t13-b-inotify.log`、`t13-hmr-*.jsonl`、`t13-e2e-installed.{json,log}`）；T1/T2/T3/T12 沿用 r2（产物未变）。
- 复核方式：本人逐项复跑 + 自己做了“阴性对照 / append-only / mtime-only 身份变化 + append”三组最小实验；未重启 host、未改代码字节、未发上游生成请求。
- 基线：host `MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST；`/usr/bin/agy` sha `b5385638…`。

## VERDICT r3: APPROVE

r2 的唯一阻断（“未证明已装载”）已闭环：**运行中 host 的 `/status` 返回的新代码独有字段 `distSha256` = 安装副本 sha = repo dist sha**，且 host PID 未变（非重启），另有可复现的因果重载证据与“安装副本字节”上的真实 200。T1 v2/T2/T3/T12 继续 PASS。

**唯一非阻断瑕疵**：`/tmp/relink-t13c/e2e/METHOD.md` 把“末尾追加的 export”写成 **44 字节**，实测为 **55 字节**（`\n` + `export { streamGenerateContent, ENDPOINT_FALLBACKS };\n` = 1 + 54 = 55；文件大小差 1250537−1250482=55）。字节级完整性由 sha 前缀比对独立证明，不受该数字影响；请更正为 55（或注明“54 字节行 + 前导换行”）。

## r3-1 内存级判别器（item 1：PASS）

本人实测：

```
$ curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status | jq -c '{distSha256,has_build:(has("build")),enabled,catalog}'
{"distSha256":"adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd","has_build":false,"enabled":true,"catalog":{"source":"discovered","count":16}}
$ sha256sum dist/index.js ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd  dist/index.js
adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd  ~/.dsh/profiles/web/.../dist/index.js
```

- 字段来源（`t13-status-field.diff` 与 `git diff src/index.ts` 逐字相同）：新增 `createHash`/`fileURLToPath` import、模块加载时 `selfSha256 = sha256(readFileSync(import.meta.url))`、`/status` payload `distSha256: selfSha256`；`git diff --stat` = **13 insertions / 0 deletions**（`grep -c '^+'` 14 行含 `+++` 文件头），无请求路径/端点/鉴权行为改动（仅模块加载时一次自哈希读 + 诊断字段）。
- 该字段是**新代码独有**：r2 时（`677d9a81`）`/status` 无 `distSha256`；t13b 中间版（`e79aee63`）有 `build`+`distSha256`；当前最终版（`adba7687`）只有 `distSha256`、无 `build`。当前 `/status` 既无 `build`、又返回 `adba7687` ⇒ 运行的模块是**最终版 adba7687**，不是旧缓存，也不是中间版。
- 旧 dist 备份均存在：`6b8e1fad…`（`/tmp/relink-t13-deploy/backup-index.js`）、`677d9a81…`（`/tmp/relink-t13b/backup-index.js`）、`e79aee63…`（`/tmp/relink-t13c/backup-index.js`）。
- host 未重启：`MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST（本人实验前后各查一次，均不变）。

> 逻辑闭环：新代码字段存在 + 值等于磁盘 sha + PID 未变 ⇒ 只能是运行期热重载装载了新 dist。这一条本身已足以推翻 r2 的“未证明已装载”。

## r3-2 因果翻转与阴性对照（item 2：PASS）

### 上游产物复核（原始序列可直接验算）

- `t13-hmr-proof.json` run2：append `1794828845117` → dist `OPEN/ACCESS/CLOSE` 于 **+2217/+2280/+2317 ms**（第二次 burst +2317…+2389 ms）；`/catalog` 出现 `source:"fallback", count:12` **81 个样本**（`1794828847142–1794828848831`，1.689 s），`/status` 独立出现 28 个 fallback 样本；766 个 catalog 样本 0 非 200。
- run3：**字节完全相同、仅 mtime 变化**（identity `ino:size:mtimeMs` 改变）→ 同样 +2305/+2373 ms 读取、fallback/12 1.66 s ⇒ 证明重载按“模块身份”而非内容 hash。
- run1/run4 阴性对照：模块身份不变时 append 注释 → **0 个 inotify 目标事件**、1330/665 个 catalog 样本全部 `discovered/16`。
- `t13-b-status-series.jsonl` 637 行 = 62+125+215+235 四轮（本人 `jq` 计数一致）；round4 有 **87 个 `hasDistSha=false` 样本**（`1794829159225–1794829181994`）——磁盘=旧、缓存=新 → append 后重载拾取旧 → 字段消失 → 磁盘=新再 append → 字段回来（双向因果）。
- `t13-b-inotify.log` 含各轮 dist OPEN/ACCESS/CLOSE 原始行（`pid=-` 是 inotify 不提供读者的固有限制，文档未伪造 pid）。

### 本人最小实验（三组，全部实跑）

| 组 | 操作 | 结果 |
|---|---|---|
| 阴性对照（无操作 7 s） | 只 watch dist + 轮询 | **142 样本、0 inotify 事件、0 fallback、`distSha=adba7687` 恒定、0 非 200** |
| append-only（dist 身份不变） | append 注释，15 s | **311 样本、0 事件、0 fallback、`distSha` 恒定**——与 run1/run4 一致：**仅改 patch 而不改模块身份不会重载**（patch 触发 reconcile，但模块不变则不复读） |
| 正例（mtime-only 身份变化 + append） | `os.utime(dist)`（**字节不变**，sha 前后均 `adba7687`）+ append，15 s | **7 个事件**，首个在 **+2.349 s**（两次 OPEN/ACCESS burst）；`/catalog` fallback/12 **36 个样本**（3.034–4.853 s，1.82 s）；332 样本 0 非 200；`/status` 全程 `distSha256=adba7687=磁盘`；host PID 未变 |

结论：**重载机制可复现、方向性明确**（身份变化 + patch 触发 → 新实例 + 重读 dist；无变化 → 无重载）。说明：Lead 口述的“append 注释即可”严格说需要 **patch 变化 + 模块身份变化**两个都满足；append-only 是有效的阴性对照，正例需要 mtime/size/ino 变化（本次用 mtime-only，字节未改，已披露）。

## r3-3 安装副本 e2e（item 3：PASS；仅 44→55 字节笔误）

本人复算 `/tmp/relink-t13c/e2e`：

```
安装副本 dist  size=1250482  sha=adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd
dist-copy.mjs  size=1250537  sha=12c1cef58a42d30d9ca0be69cddb7e414a97d50a97d332772914eb56778cb407
前缀 head -c 1250482 dist-copy.mjs | sha256sum = adba7687…   （== 安装副本，逐字一致）
后缀 tail -c +1250483 dist-copy.mjs = "\nexport { streamGenerateContent, ENDPOINT_FALLBACKS };\n"（55 B）
runner.mjs sha = ea1fb3c786cf7a85fd8061136a536c1cef7ac2b1131b1e4fdf46b572e42d3941
```

- 唯一改动 = 末尾 export（前缀 sha 一致 + 大小差 55 B）；`distCopyShaBeforeExport=adba7687` 与 `distCopyShaMatchesInstalled=true` 属实。
- runner：import `dist-copy.mjs`，调用 bundle 内真实 `streamGenerateContent(token, body, …, undefined, undefined)`（**不传 endpoints/proxyUrl**），并断言 `ENDPOINT_FALLBACKS[0]=daily`；1 次生成、无重试。
- 结果（`t13-e2e-installed.json` + `.sse.txt`）：`status=200`、`content-type=text/event-stream`、`1526 B`、**2 个 `data:` 帧**、`modelVersion=gemini-3.8-flash-n`、正文含 `Hello! How can I help you today?`、`endpoint=https://daily-cloudcode-pa.googleapis.com`（首端点 200 即止，未 failover）、`generationRequests=1`；原始 SSE 帧已落盘（`.sse.txt` 含两条 data 行，长 base64 已脱敏）。
- 与 r2 的缺口对比：r2 的 e2e 走 repo 源码；本轮改为**安装副本 dist 的字节副本**（+1 行 export），因此该 200 证明的是“已部署的同一份 dist 代码”走 daily 成功，而非仅源码。
- **笔误**：`METHOD.md` 写“末尾追加的 44 字节”，实测 **55 字节**；其余表项（安装副本/additional 前后 sha、runner sha）全部与实测一致。

## r3-4 安全 / 约束（本人复核）

- host 未重启：`MainPID=2685153`、`NRestarts=0`、start 11:42:18 CST（含我三组实验前后）。
- `/usr/bin/agy` sha `b5385638…cbcfc9`、mtime 10-16 未变；`/tmp/agy-fix` 19:35 后新增文件 **0**。
- r3 新产物脱敏：`ya29.`/`1//0`/`eyJhbGciOi` 0 命中、`*@gmail.com` 0；e2e 日志只出现 `Bearer ****`，token 未打印/未 refresh。
- repo 预期改动：`M src/index.ts`（13 行诊断字段）、`M dist/index.js`、`M packages/core`（端点 1+/1-，未提交）；profile `cordis.patch.yml` 追加了若干注释（含我复现用的两条 `# t4-r3-review*`，纯注释、可删）。
- 我自己的实验只改了安装副本 **mtime**（正例 mtime-only 身份变化，字节 sha 前后一致），未改任何代码字节、未重启、未改 `/usr/bin/agy`、未写 `/tmp/agy-fix`。

## r3-5 最终裁定

- **T13 装载证明：PASS**。`/status.distSha256 == installed == repo`（`adba7687…`）且 PID 未变 ⇒ 运行中的 host 已装载最终 dist；因果重载与阴性对照由 t13a/t13b 原始序列 + 本人三组实验共同证明；安装副本 e2e 以真实 200/SSE/模型输出闭环。
- **T13 笔误**：`METHOD.md` 的 44 字节应为 55 字节（非阻断；完整性由 sha 前缀证明）。
- **T1 v2 / T2 / T3 / T12：PASS**（沿用 r2，产物本轮未变）。
- **r3 最终：APPROVE**。r2 的“未证明已装载”阻断已解除；剩余已披露限制（T3 插件路径原始 SSE 帧未持久化、T12 的 `-tiered/-low/-medium` 未实测、counter 时间差）不改变结论。修复已在运行 host 生效（dist `adba7687`、daily-first、`/status` 200、无需重启）。
