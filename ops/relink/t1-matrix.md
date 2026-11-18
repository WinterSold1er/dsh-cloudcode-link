# T1 — 出口/条件矩阵：什么条件下 cloudcode-pa 返回 200

- 任务：看板 task-8（T1 出口/条件矩阵）
- 执行：`worker-egress`（编排）+ 3 个一级子代理：`recon-clash`（Clash 只读侦察）、`recon-request`（请求规格侦察，0 请求）、`exp-egress`（出口/资格/直连实验）
- 时间：2026-11-16 17:30–18:20 CST
- 修订：**v2 2026-11-16 19:10 CST**，按审查员第 1 轮 **B1/B2/B3** 更正证据陈述（实验数据未重跑、未改上游请求）；逐条核对见 §10，日志 `ops/relink/t1-verification.log`
- **一句话结论：本任务没有出现 200。** 出口地区（US×2 / JP / SG / HK）在本次测试范围内**不改变任何结果**：五个有判定出口的 CLI 资格探针结论一致（R5 德国为 transport error、无判定），三臂直连横跨 US/US/JP 全部 429 且响应体 139 B 字节完全相同。地区闸门假设已被更强的外部证据取代（见 §5）。

> 本文件是**汇总结论**；每条数据都能在 §9 的证据文件里逐字节复核。所有“已证/推断”均显式标注；全称断言（“一致/相同/互证”等）在 §10 给出命令与真实输出的对应关系。

---

## 1. 结论（先看）

| # | 结论 | 等级 | 依据 |
|---|---|---|---|
| C1 | 直连 `cloudcode-pa.googleapis.com`（**插件真实身份头 + 官方 checkpoint 形状手造 body**，非插件真实 body，见 §3）在 US/JP 三个出口全部 **429 RESOURCE_EXHAUSTED**，三臂响应体 sha256 相同 | **已证**（本任务实测） | §3、`t1-arm-{A,B,C}.json`、§10-V1 |
| C2 | 换出口不改变 CLI 资格判定：US×2 / JP / SG / HK 五个有判定出口全部 `not available in your location`；德国为 transport error、无判定 | **已证**（5 个有判定出口） | §2、`t1-cli-probe-R*.json`、§10-V2 |
| C3 | 插件的 429 与 CLI 的 location-ineligible 是**两层**：前者是生成 API 配额，后者是 CLI/loadCodeAssist 资格检查 | **已证**（两者同时发生、互不替代） | §3/§4 |
| C4 | “地区闸门（换区即 200）”不成立 | **已证（测试范围内）** | C1+C2 + §5 |
| C5 | 出口地区不是拦路石：同账号同网络，官方 CLI 对 `daily-cloudcode-pa` 的生成请求拿到 **HTTP 200 + SSE**（16:18 CST） | **已证（外部抓包，已复核文件存在且内容相符）** | §5、抓包路径 |
| C6 | 真正的差异候选：**端点（production vs daily）**、**客户端身份头 / body 形状**、**429 不兜底** | **强候选（未在本任务内证伪/证实）** | §5、交 T2/T3 |
| C7 | 账号/项目闸门（`aicode-consumers` 项目配额耗尽）**未被排除** | **未排除** | §4 |

**最小可复制配方：未找到（无 200）。** §5 的 CLI 200 配方属于另一个会话的证据，只作对照，不是本任务实测。

---

## 2. 出口矩阵（实测：CLI 零配额资格探针 × 出口 IP）

探针：官方未打补丁 `/usr/bin/agy` 的**副本** + 一次性 HOME（号池账号 index 3，`z***@gmail.com`），`agy -p hi --output-format json`；ineligible 时 CLI 在本地中止、**不发** `streamGenerateContent`。
出口 IP 取证：Clash API 临时把 `漏网之鱼` 钉到 `Google.now` 同节点 → 裸 curl（走 TUN）取地理 → 立即恢复并独立复查（**不是**用 7890/7891 代理，那个出口不是 Google 组）。

| 行 | 地区 | 节点（精确串，取自 `Google.all`） | 出口 IP / 国家（实测） | CLI 资格探针 | 命中日志原文（截断） | 直连臂 |
|---|---|---|---|---|---|---|
| R1 | US 当前 | `Main：🇺🇲 美国 \| V2 \| 02` | `23.247.137.105` / US, San Jose CA | **ineligible**（21.6s） | `server_oauth.go:114] Account ineligible: … not currently available in your location.` | **A → 429** |
| R2 | US 备选 | `Main：🇺🇲 美国 \| V1 \| 03` | `96.126.100.194` / US, Fremont CA | **ineligible**（9.4s） | `server_oauth.go:133] … not available in your location.` | **B → 429** |
| R3 | JP | `Main：🇯🇵 日本 \| V2 \| 01` | `139.162.81.14` / JP, Tokyo | **ineligible**（9.5s） | 同上（`:133`） | **C → 429** |
| R4 | SG | `Main：🇸🇬 新加坡 \| V2 \| 01` | `64.118.136.254` / SG | **ineligible**（8.1s） | 同上（`:133`） | 未打（预算/收手） |
| R5 | DE | `Main：🇩🇪 德国 \| V1 \| 01` | **无可用地理**（ipinfo / ip-api / ipapi.co 三源均未返回） | **无判定**（`no_verdict_transport_error`，13.0s；原始 JSON verdict 字段仍写 ineligible，但 `verdict_genuine=false`） | `eligibility check failed: … Post "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist": EOF` | 未打 |
| R6 | HK | `Main：🇭🇰 香港 \| V2 \| 01` | `203.175.14.47` / HK, Sham Shui Po | **ineligible**（9.5s） | 同上（`:133`） | 未打 |

**出口地理的来源必须逐行区分（B1/B2 更正）**：
- `ipinfo.io` 原始响应：R1/R2/R5 = `{"error":"empty_response","curl_rc":28}`（**超时**）；R3/R4 = 200 且含 `ip/city/country`；R6 = 429 Rate limit。→ **3 超时 / 2 成功 / 1 限流**，不是“全程 429”。
- `ipapi.co`（`.ipapi.json`）：R1–R4 = `RateLimited`；R5 = 付费墙文本；R6 = Cloudflare HTML。→ **0 行可用**。
- 实际工作源是 `ip-api.com`（`.ipapicom.json`）：5/6 行成功（R1–R4、R6），R5 超时。
- 因此：**双源同 IP 互证只有 R3、R4**（ipinfo + ip-api 返回同一 IP）；**R1/R2/R6 只有 ip-api 单源**；R5 无地理。详见 §10-V3/V4/V5。

补充（排除“切了没走”）：探针窗口内 `/connections` 采样计数 R1 US-V2-02×44、R2 US-V1-03×14、R3 JP×21、R4 SG×17、R6 HK×30（`t1-connections-R*.log`）——selector 切换**确实生效**。

注意事项（不影响判定，但必须写清）：
- R1 跑在官方 CLI **副本构建 1** 上；副本在 R1 与 R2 之间**自我更新**（215 MB→265 MB，`cl=998863838` 构建 → 更新版），R2–R6 跑在**更新后构建**上。日志行号 `:114 → :133` 即佐证；**两种构建的消息文本相同**（逐字比对见 `t1-cli-log-R*.txt`）。`/usr/bin/agy` 本身 sha256 前后一致（`b5385638…`），未被改动。
- R5 的 transport EOF 被如实记为“无判定”，**没有**把分类器的 ineligible 标签当成地区结论。

---

## 3. 直连三臂（同一账号、同一 body；**插件真实身份头 + 官方 checkpoint 形状手造 body**）

- 身份头固定 **arm A = 插件真实头**（`User-Agent: antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)` + `X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1` + `Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_LINUX","pluginType":"GEMINI"}`）。**[B3] 本臂只隔离了身份头，没有隔离插件真实 body。**
- 端点固定：`POST https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`（**无** fallback、**无** retry；每臂前先 `--dry-run`）
- **body 不是插件真实 body**：它是按官方 CLI checkpoint 形状**手造**的固定 body（`t1-probe.sh` 内联生成，见 `t1-probe.sh:163/170/171`）：
  `requestId: "checkpoint/00000000-0000-4000-8000-000000000000"`、`requestType: "checkpoint"`、`userAgent: "antigravity"`（小写）、`model: gemini-3.5-flash-lite`、`project: aicode-consumers`。
  插件代码只产生 `requestType: 'AGENT'`（`packages/core/src/client.ts:98`）、`userAgent: 'ANTIGRAVITY'`（`:99`）、`requestId: \`agent/${trajectoryId}/${step}\``（`:435`）；`grep -rn 'checkpoint' packages/core/src src` = **0 命中**（§10-V6）。⇒ 本臂无法隔离“插件 body 形状”这一混杂因素，交 T2。
- 三臂 body 逐字节一致：362 B，`sha256=8d9647890ce6f8b7b82ac466db3c324499225016fc3b527cd7964fb5967f40bb`（这是“同 body 跨出口”的实验设计，不代表它是插件 body）
- 账号：号池 index 3 `z***@gmail.com`，token 未过期（`2026-11-16T10:34:38Z`），未触发刷新
- 每臂 `attempts=1`

| 臂 | 出口（行） | 出口 IP / 国家 | 状态码 | 耗时 | 响应体 |
|---|---|---|---|---|---|
| A | R1 US 当前 | 23.247.137.105 / US | **429** | 1638 ms | 139 B，sha256 `73cfb694…6453` |
| B | R2 US 备选 | 96.126.100.194 / US | **429** | 1374 ms | **同一 139 B**，sha256 相同 |
| C | R3 JP | 139.162.81.14 / JP | **429** | 1368 ms | **同一 139 B**，sha256 相同 |

响应体原文（三臂一致，逐字节；sha256 见 §10-V1）：

```json
{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}
```

**观察**：横跨美国两个不同 IP 与日本一个 IP，production 端点返回**完全相同**的 429。若存在“出口地区闸门”，三臂不应字节级相同。

---

## 4. 判定矩阵：地区闸门 / 客户端身份闸门 / 账号-项目闸门

| 假设 | 本任务证据 | 判定 |
|---|---|---|
| **地区闸门**（换出口即 200） | 5 个有判定出口的 CLI 资格结论一致（全 ineligible）；三臂直连 US/US/JP 全部 429 且响应体相同 | **不成立（测试范围内：美西×2、东京、新加坡、香港；德国无判定）** |
| **客户端身份闸门** | 同账号下：官方 CLI（`antigravity/cli/1.3.5 … auth_method=consumer`，daily 端点）→ 200；插件真实头 + checkpoint 形状手造 body（`antigravity/hub/2.8.0` + 两个插件独有头，production 端点）→ 429 | **强候选，交 T2/T3**（本任务未做身份 vs body 的正交对拍，不写成已证） |
| **账号/项目闸门** | `loadCodeAssist` 给的 `cloudaicompanionProject=aicode-consumers`；插件 5 号池账号 14:55 全 429；本次单账号 3/3 429 RESOURCE_EXHAUSTED | **未排除**（项目级配额耗尽与账号级限流在本任务数据下不可区分） |
| **端点闸门** | CLI 200 在 `daily-cloudcode-pa`；插件 429 在 `cloudcode-pa`（production） | **强候选，交 T2/T3** |

> 纪律：上表只有“地区闸门不成立”是**本任务实测**的结论；“身份/端点/项目”均为**候选**，不把推断写成已证。另：因三臂 body 为手造 checkpoint 形状（§3），本任务数据**不能**用来判断“插件真实 body 是否被接受”。

---

## 5. 为什么“地区闸门”被取代（Lead 18:15 下发的外部证据，已复核文件存在）

1. 官方 CLI 日志的 `not available in your location` 出现在 `server_oauth.go:114/133`，是 **CLI 的资格检查**（`loadCodeAssist`）分支，不等价于生成 API 被拒。
2. 铁证（**已复核抓包文件存在且内容相符**）：同一账号、同一网络，官方 CLI 于 **2026-11-16T08:18:11Z（16:18 CST）** 向 `daily-cloudcode-pa.googleapis.com` 发出
   `POST /v1internal:streamGenerateContent?alt=sse`（`User-Agent: antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)`），
   拿到 **`HTTP/1.1 200 OK` + `Content-Type: text/event-stream`**（`Date: Mon, 16 Nov 2026 08:18:13 GMT`）。
   路径：`/tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T081811Z-33.{req,resp}.txt`（`=== RESPONSE … status line: HTTP/1.1 200 OK`）。
3. ⇒ 出口地区不是拦路石；拦路石在「插件走 production + 429 不兜底 + 身份/body 形状与官方不同」。

本任务数据与该结论一致：出口怎么换都不变（C1/C2），而端点/身份一换（CLI+daily）就 200（C5）。

---

## 6. 请求计数（如实登记）

| 类别 | 次数 | 明细 |
|---|---|---|
| **生成请求（计入预算 4 次）** | **3** | A `18:08:09`、B `18:08:24`、C `18:08:36`；每臂 1 次、`attempts=1`、无重试、无第二端点 |
| CLI 零配额资格探针 | 6 | R1–R6，全部在本地 ineligible 中止；**无一次** `generation_success_quota_consumed` |
| Token 刷新请求 | 0 | token 未过期 |
| 预算余额 | **1** | 未使用（收到 Lead 收手指令后未再发任何请求/未再切 selector） |

> 说明：Lead 18:15 消息预期“应为 0 次生成请求”；实际 A/B/C 三臂在收手指令到达**之前**已完成（18:08），故如实登记为 3，不篡改为 0。

---

## 7. 约束遵守与完整性

| 约束 | 结果 | 证据 |
|---|---|---|
| 不改 `~/.config/clash-meta/config.yaml` 落盘 | 未修改 | `t1-run.json.integrity.config_yaml_modified=false` |
| selector 切换可逆并恢复原值 | **已恢复并独立复验**：`Google.now=Main：🇺🇲 美国 \| V2 \| 02`、`漏网之鱼.now=总模式`（与 P0/recon 快照一致）；`restore_failures=0` | `t1-clash-before/after.json`；§10-V8 复跑输出 |
| 不改 `/usr/bin/agy` | sha256 前=后=`b5385638…cbcfc9` | `t1-run.json.integrity` |
| 不写 pool.json / 账号目录 | 未写（一次性 HOME + 纯内存刷新） | `t1-run.json.integrity.pool_json_or_account_dirs_modified=false` |
| 不写 `/tmp/agy-fix/**` | 未写（仅只读引用抓包） | `t1-run.json.integrity.agy_fix_dir_written=false` |
| 不重启 host | 本次执行的命令记录中未出现 systemctl/重启类命令 | `t1-run.log`（命令全录） |
| 并发干扰 | `interference=false`：P0 到收尾的每次读取中 `Google.now` 均与快照一致 | `t1-run.json.interference.checks` |

**偏离（D1–D6，全部如实记录在 `t1-run.json.deviations`）**
- D1 `ipinfo.io` 逐行原始响应 = **3 超时 / 2 成功 / 1 限流**（非全程 429）→ 工作源改用 `ip-api.com`（5/6 行）；`ipapi.co` **0 行可用**；双源同 IP 互证仅 R3/R4。三源同窗口并发取，附带影响窗口约 8 s。
- D2 首次 R1 调用因 shell 引号 bug 未启动探针进程 → 已用 `pgrep`+无产物证明**零请求、零配额**，不计入。
- D3 基线 CLI 探针与 P1/R1 合并为一步（省时，无额外请求）。
- D4 CLI **副本**运行中自我更新（`/usr/bin/agy` 未变）。
- D5 DE 行 transport EOF，无判定。
- D6 `t1-request-spec.md` 曾含明文邮箱，已打码为 `z***@gmail.com`（备份 `/tmp/t1-request-spec.md.bak`）。

---

## 8. 复跑命令（最小）

```bash
# 0) Clash secret（config L31 是带引号的值 + 中文注释）
SECRET=$(python3 - "$HOME/.config/clash-meta/config.yaml" <<'PY'
import re,sys
t=open(sys.argv[1],encoding='utf-8').read()
print(re.search(r'^secret:\s*"([^"]*)"',t,re.M).group(1))
PY
)
API=http://127.0.0.1:9090
# 1) 记录原值 / 切节点 / 校验 / 恢复（节点名必须从 /proxies 的 Google.all 取）
curl -s -H "Authorization: Bearer $SECRET" $API/proxies/Google | python3 -m json.tool | head
curl -s -X PUT -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
     --data '{"name":"Main：🇺🇸 美国 | V1 | 03"}' $API/proxies/Google
# 2) 出口地理（临时把 漏网之鱼 钉到 Google.now 同节点 → 裸 curl → 立即恢复；trap 兜底）
#    完整可执行序列见 ops/relink/t1-repro.md
# 3) 零配额资格探针（官方未打补丁 CLI 副本，避免自我更新污染 /usr/bin/agy）
cp /usr/bin/agy /tmp/t1-agy-official && chmod +x /tmp/t1-agy-official
AGY_CLI_DISABLE_AUTO_UPDATE=true ops/relink/t1-cli-probe.sh \
  --out /tmp/cli.json --account 3 --bin /tmp/t1-agy-official
# 4) 直连臂（1 次、无重试；先 dry-run）
ops/relink/t1-probe.sh --arm A --account 3 --dry-run
ops/relink/t1-probe.sh --arm A --account 3 --out ops/relink/t1-arm-A.json
```

完整版（含 trap 恢复、脱敏、计数）见 `ops/relink/t1-repro.md`、`ops/relink/t1-switch.sh`、`ops/relink/t1-row.sh`。

---

## 9. 证据索引

| 文件 | 内容 |
|---|---|
| `ops/relink/t1-clash-recon.{md,json,log}` | Clash 规则/组/节点/端口认证/TUN 解释；`Google` 组 chain、规则行号、切换与恢复、ipinfo 方法 |
| `ops/relink/t1-request-spec.{md,log}` | 端点候选、插件头全集、body 规格、token 来源与刷新、CLI 探针规格 |
| `ops/relink/t1-matrix-data.json` | §2/§3 结构化数据（rows/arms_summary/conclusion_inputs，无结论） |
| `ops/relink/t1-run.json` | 计数、时间戳、before/after、integrity、deviations、restore_failures、found_200 |
| `ops/relink/t1-arm-{A,B,C}.json` | 三臂完整请求/响应（Authorization 已打码） |
| `ops/relink/t1-cli-probe-R*.json`、`t1-cli-log-R*.txt` | 6 行资格探针结果与日志原文 |
| `ops/relink/t1-connections-R*.log` | 探针窗口内 `/connections` 采样（证明实际出口） |
| `ops/relink/t1-ipinfo-R*.{json,ipapi.json,ipapicom.json}` | 出口地理三源原始响应（ipinfo / ipapi.co / ip-api.com） |
| `ops/relink/t1-clash-before.json` / `t1-clash-after.json` | selector 前后快照（恢复证明） |
| `ops/relink/t1-probe.sh` / `t1-cli-probe.sh` / `t1-row.sh` / `t1-switch.sh` | 可复跑脚本 |
| `ops/relink/t1-repro.md` | 完整复跑手册 |
| `ops/relink/t1-verification.log` | §10 全部核对命令的真实输出（2026-11-16 19:10 复跑） |
| `/tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T081811Z-33.{req,resp}.txt` | 外部证据：CLI 对 daily 端点 200 + SSE（只读引用） |

---

## 10. 证据对应表（全称断言逐条核对，2026-11-16 19:10 复跑）

> 完整输出见 `ops/relink/t1-verification.log`；下面每行给出命令与真实输出摘要。

| # | 断言 | 命令（在仓库根执行） | 真实输出 |
|---|---|---|---|
| V1 | 三臂响应体“相同” | `for a in A B C; do python3 -c "import json;d=json.load(open(f'ops/relink/t1-arm-{a}.json'));print(d['http_status'],d['body_sha256'][:16],d['response_body_bytes'])"; done` | `A 429 73cfb6949dc39577 139` / `B 429 73cfb6949dc39577 139` / `C 429 73cfb6949dc39577 139` |
| V2 | 5 个有判定出口“结论一致” | `for i in 1 2 3 4 5 6; do python3 -c "import json;print(json.load(open(f'ops/relink/t1-cli-probe-R{i}.json'))['verdict'])"; done` + `t1-matrix-data.json` 的 `verdict_genuine/effective_verdict` | R1–R4、R6 `ineligible_zero_quota`（genuine=true）；**R5 genuine=false → effective `no_verdict_transport_error`** |
| V3 | ipinfo“3 超时 / 2 成功 / 1 限流” | `for i in 1 2 3 4 5 6; do printf 'R%s ' $i; head -c 80 ops/relink/t1-ipinfo-R$i.json; echo; done` | R1/R2/R5 `{"error":"empty_response","curl_rc":28}`；R3 `"ip": "139.162.81.14"`；R4 `"ip": "64.118.136.254"`；R6 `"status": 429 … Rate limit hit` |
| V4 | ipapi.co“0 行可用” | `for i in 1 2 3 4 5 6; do printf 'R%s ' $i; head -c 80 ops/relink/t1-ipinfo-R$i.ipapi.json; echo; done` | R1–R4 `"reason": "RateLimited"`；R5 `Please contact us for a trial account or sign up for a paid plan…`；R6 `<!DOCTYPE html>…Just a moment…`（Cloudflare） |
| V5 | “双源互证只有 R3/R4” | 见 `t1-verification.log` §V5（逐行比对 ipinfo.ip 与 ip-api.query） | R1/R2/R6 `single-source`（仅 ip-api：23.247.137.105 / 96.126.100.194 / 203.175.14.47）；R3/R4 `MATCH`；R5 `none` |
| V6 | body 是手造 checkpoint、不是插件 body | `grep -rn 'checkpoint' packages/core/src src \| wc -l`；`sed -n '98,100p;435p' packages/core/src/client.ts`；`sed -n '163p;170p;171p' ops/relink/t1-probe.sh` | `0`；`requestType: 'AGENT'` / `userAgent: 'ANTIGRAVITY'` / `requestId: string` / `requestId: \`agent/${trajectoryId}/${step}\``；`"requestId": "checkpoint/0000…"` / `"userAgent": "antigravity"` / `"requestType": "checkpoint"` |
| V7 | 生成请求 3 次 | `python3 -c "import json;c=json.load(open('ops/relink/t1-run.json'))['counter'];print(c['generation_requests_used'],c['generation_budget'],c['cli_probe_runs'])"` | `3 4 6`；臂明细 A `18:08:09` / B `18:08:24` / C `18:08:36`，均 429 |
| V8 | selector 已恢复 | `curl -s -H "Authorization: Bearer $SECRET" http://127.0.0.1:9090/proxies \| python3 -c "import json,sys;p=json.load(sys.stdin)['proxies'];print(p['Google']['now'],p['漏网之鱼']['now'])"` | `Main：🇺🇲 美国 \| V2 \| 02` / `总模式`（与 `t1-clash-before.json` 一致） |
| V9 | 两种 CLI 构建的 ineligible 消息正文“相同” | `cat ops/relink/t1-cli-log-R{1,2,3,4,5,6}.txt \| grep -h 'Account ineligible:' \| sed 's/.*Account ineligible: //' \| sort -u \| wc -l` | `1`（R1–R4、R6 逐字相同；R5 无该行，与“无判定”一致） |

---

## 11. 脱敏自检

`grep -cE 'ya29[.]|1[/]/|ey[J]'` 对 `ops/relink/t1-*` **全部为 0**（含本文件、`t1-verification.log`）；明文邮箱 0（`z***@gmail.com`）；Clash secret 与 Bearer token 均未写入产物（仅 `***`/变量引用）。

> 复核命令：`for f in ops/relink/t1-*; do printf '%s %s\n' "$(grep -cE 'ya29[.]|1[/]/|ey[J]' "$f")" "$f"; done`
