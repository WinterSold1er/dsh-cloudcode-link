# T2 契约提取 · 抓包证据核对（t2-traffic）

> 结论先行：官方 agy 1.3.5 的一次真实 `agy -p "hi"` 全链路请求已在 `/tmp/agy-fix/mitm/capture/` 中留存**原文 dump**（非 mitmproxy 二进制 flow）。实测契约与 #59 的核心假设（UA / loadCodeAssist 38B body / model / project）**逐字符一致**；并补出了 #59 未覆盖的部分：请求头极简（无 x-goog-api-client 家族）、`request` 六键包装、`requestId`/`labels` 形态、SSE 外层包裹、12 个工具声明、以及「ineligibleTiers 存在但 HTTP 仍 200」这一关键门禁语义。
>
> 全程只读 `/tmp/agy-fix/**`；未运行 `/usr/bin/agy`、未起代理、未监听端口、未写入该目录。

---

## 1. 证据来源与可信度

| 项 | 实测 | 来源 |
|---|---|---|
| 来源归属 | 另一会话（fix-gate2 / mitm 台）留存的只读产物 | `/tmp/agy-fix/mitm/README.md`、`/tmp/agy-fix/gate2/*` |
| 抓包格式 | **文本 dump**，每 flow 两文件 `<UTC时间戳>-<seq>.req.txt|.resp.txt`；含 request line / 头块 / body（`[readable text]` + 完整 hexdump）。**不是** har/jsonl/mitmproxy flow 二进制 | `ls /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com`（`file` 显示 ASCII text） |
| 覆盖规模 | 208 个 dump（`*req.txt` + `*resp.txt`），8 个 host 目录 | `find /tmp/agy-fix/mitm/capture -name '*.req.txt' -o -name '*.resp.txt' \| wc -l` → 208 |
| 采集窗口 | 2026-11-16T07:45:15Z – 08:20:12Z（= 15:45–16:20 CST） | `ls -1 *.req.txt \| head -1` / `tail -1` |
| 官方客户端进程 | `pid 2856760`（主）、`pid 2846602`（前一轮）；**另有 `pid 2838002` 是 curl 探针，非客户端流量，已排除** | 各 dump 首行 `=== INTERCEPT <ts> pid <n> seq <n> ===` |
| 触发动作 | `agy -p "hi"`（非交互；user 文本内含 `<USER_REQUEST> hi </USER_REQUEST>`） | `20261116T081812Z-35.req.txt:23` |
| 是否被中间人改写 | **否**。`rules.json` 已停用为 `rules.json.off`，全部响应标 `rewritten: no`；`mitm.py` 中 `User-Agent` / `antigravity/cli` 出现 0 次（仅落盘时脱敏 `Authorization`/`Cookie`） | `grep -c 'User-Agent' mitm.py` → 0；`grep -c antigravity/cli mitm.py` → 0；`cat rules.json.off` |
| 凭证泄漏 | 落盘脱敏后重扫：真实 token 形态（OAuth access / refresh / JWT 三段式）**0 命中**；仅 1 个文件的可解码失败二进制体内出现随机字节巧合前缀（详见缺口 G2） | 严格正则重扫 208 文件 → `{}` |

> 因此下文所有 header 值都是**真客户端发出的字节**，不是代理注入值。

---

## 2. 主契约证据表（官方 1.3.5，pid 2856760）

### 2.1 请求行 / URL

| 字段 | 实测值 | 来源（文件:行） | 提取命令 |
|---|---|---|---|
| 生成端点 | `POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse HTTP/1.1` | `20261116T081812Z-35.req.txt:12`（另 `…081811Z-33:2`） | `grep -n 'request line:' *.req.txt` |
| 资格端点 | `POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist HTTP/1.1`（**无 query**） | `20261116T081540Z-2.req.txt:2`（session request line）/`:12`（request line） | 同上 |
| 传输 | 明文 HTTP/1.1 over MITM TLS（对上游是 TLS1.3；客户端侧 Go TLS + 自签 CA） | `…080904Z-2.req.txt` 头部 `proxy request line: CONNECT` + `protocol: TLS TLSv1.3` | `grep -n 'protocol:' *.req.txt` |

### 2.2 请求头（逐项）

| 字段 | 实测值 | 来源 | 备注 |
|---|---|---|---|
| `Host` | `daily-cloudcode-pa.googleapis.com`（CONNECT 阶段带 `:443`） | `…081812Z-35.req.txt:14` | |
| `User-Agent` | `antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)` | `…081812Z-35.req.txt:15`、`…081540Z-2.req.txt:5` | 与 #59 逐字符一致 |
| `Authorization` | `Bearer`（值为真实 OAuth access token，落盘已脱敏，**本报告只记录 scheme**） | `…081812Z-35.req.txt:17` | 无 `x-goog-api-key` |
| `Content-Type` | `application/json` | `…081812Z-35.req.txt:18` | 仅带 body 的请求发 |
| `Accept-Encoding` | `gzip` | `…081812Z-35.req.txt:19` | |
| `Content-Length` / `Transfer-Encoding` | loadCodeAssist：`Content-Length: 38`；streamGenerateContent：`Transfer-Encoding: chunked`（无 CL） | `…081540Z-2.req.txt:6`；`…081812Z-35.req.txt:16` | |
| **不存在的头**（关键反证） | `x-goog-api-client`、`x-client-version`、`x-cloudaicompanion-*`（请求向）、`client-metadata`、`X-Goog-Api-Key`、`Accept` 均**未发送** | 67 个请求头并集只有 10 种 | `python3` 聚合全部 `*.req.txt` 头块（见命令附录 A） |
| 请求头全量并集（67 flow） | `Host`(67) `User-Agent`(67) `Authorization`(43) `Content-Type`(42) `Accept-Encoding`(41) `Content-Length`(40) `Proxy-Connection`(2) `Accept`(2) `Transfer-Encoding`(2) `Cookie`(1) | 同上 | `Accept`/`Proxy-Connection` 只出现在 curl 探针；`Cookie` 出现在 play 主机火焰类日志，非本契约 |

### 2.3 请求体

| 字段 | 实测值 | 来源 | 命令 |
|---|---|---|---|
| loadCodeAssist body 全量（38 字节，一字不差） | `{"metadata":{"ideType":"ANTIGRAVITY"}}` | `20261116T081540Z-2.req.txt:21-23` | `sed -n '21,24p'` |
| 生成请求 body 长度 | 34,669 字节（checkpoint 变体 942 字节） | `…081812Z-35.req.txt:21`、`…081811Z-33.req.txt:21` | `grep -n '^--- BODY'` |
| 顶层 key（6 个，顺序即序列化顺序） | `project`, `requestId`, `request`, `model`, `userAgent`, `requestType` | `…081812Z-35.req.txt:23` | `python3` json 解析（命令附录 B） |
| `project` | `"aicode-consumers"` | 同上 | |
| `model` | agent 请求 = `gemini-4-hydrogen-medium`；标题生成请求 = `gemini-3.5-flash-lite` | `…081812Z-35` / `…081811Z-33` body | |
| `userAgent` | `"antigravity"`（与头里的完整 UA 串不同，是短名） | body | |
| `requestType` | `agent`（主对话）/ `checkpoint`（会话标题） | body | |
| `requestId` 形态 | `agent/<cascade_id>/<epoch_ms>/<trajectory_id>/<step_index>`，如 `agent/f3e5ee7e-…/1794817091999/2e579052-…/1`；checkpoint 为 `checkpoint/<uuid>` | body | |
| `request` 子键（6 个） | `contents`, `systemInstruction`, `tools`, `labels`, `generationConfig`, `sessionId` | body | |
| `request.contents` | 仅 1 条，`role:"user"`，`parts:[{text}]`（本请求 426 B，含 `<USER_REQUEST>hi</USER_REQUEST>` + `<ADDITIONAL_METADATA>` 本地时间 2026-11-16T16:18:11+08:00 + `<USER_SETTINGS_CHANGE>`） | body | |
| `request.systemInstruction` | `role:"user"`，`parts:[{text}]` 18,579 B，开头 `<identity> You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team …` | body | |
| `request.tools` | 12 个 `functionDeclarations`：`read_file, run_command, manage_task, send_message, schedule, invoke_subagent, define_subagent, manage_subagents, write_file, edit_file, search_web, ask_question`（每个含 `name/description/parameters`） | body | |
| `request.labels` | `cascade_id`, `root_cascade_id`, `trajectory_id`, `request_id`(`<trajectory>-0`), `last_step_index`(`"0"`), `model_enum` = **`MODEL_PLACEHOLDER_M526`**, `used_claude`/`used_claude_conservative`/`used_non_gemini_model` = `"false"`（全部字符串值） | body | |
| `request.generationConfig` | `{"maxOutputTokens":262144,"thinkingConfig":{"includeThoughts":true,"thinkingLevel":"MEDIUM"}}` | body | |
| `request.sessionId` | `"-3750763034362895579"`（字符串化的负数 int64） | body | |
| 包装层级 | 无 `request.contents[].parts[].functionCall` 往返（本请求只有 1 轮用户文本，纯首轮），故**未产生** thoughtSignature 回传路径 | body | |

### 2.4 响应

| 字段 | 实测值 | 来源 | 命令 |
|---|---|---|---|
| 状态码 | `200 OK`（正确 token） | `…081812Z-35.resp.txt:2` | `grep -n 'status line' *.resp.txt` |
| `Content-Type` | `text/event-stream` + `Content-Disposition: attachment` | `…081812Z-35.resp.txt:4-5` | |
| 是否 SSE | **是**。3 帧 `data: ` 行，外层包 `{"response": {...}, "traceId": "...", "metadata": {}}`；`usageMetadata` 递增（6968→7805 prompt） | `…081812Z-35.resp.txt:21,23,25` | `grep -c '^data: '` |
| 帧内结构 | `response.candidates[0].content.role="model"`，`parts[0].text`（尾帧为 `thoughtSignature` + 空 text），末帧 `finishReason:"STOP"`；`response.modelVersion:"gemini-4-hydrogen"`（**响应不带 `-medium` 后缀**）；`responseId`、`traceId` | 同上 | |
| token 计费 | `promptTokenCount 7805 / candidatesTokenCount 13 / totalTokenCount 7858 / thoughtsTokenCount 40` | 同上 | |
| 流式响应头 | **无** `x-cloudaicompanion-trace-id` | `grep -c x-cloudaicompanion-trace-id …35.resp.txt` → 0 | |
| loadCodeAssist 200 头 | `x-cloudaicompanion-trace-id: <hex16>`、`Content-Type: application/json; charset=UTF-8`、`Content-Encoding: gzip`（640 B 线缆 / 1501 B 解码）、`Server: ESF`、`Alt-Svc: h3=":443"` | `20261116T081540Z-2.resp.txt:3-18` | |
| loadCodeAssist 200 body | `currentTier{id:"standard-tier", name:"Antigravity", userDefinedCloudaicompanionProject:true, usesGcpTos:true}`；`allowedTiers[1]` 同上 + `isDefault:true`；**`cloudaicompanionProject:"aicode-consumers"`**；`ineligibleTiers[0]{reasonCode:"UNSUPPORTED_LOCATION", tierId:"free-tier", reasonMessage:"Your current account is not eligible for Antigravity…"}`；`gcpManaged:false`；`paidTier{id:"g1-pro-tier", name:"Google AI Pro", availableCredits[{creditType:"GOOGLE_ONE_AI", minimumCreditAmountForUsage:"50"}]}`；`manageSubscriptionUri` 含账号邮箱（本报告打码为 `z***@gmail.com`） | `…081540Z-2.resp.txt:20-58`（`currentTier` :23、`cloudaicompanionProject` :42、`ineligibleTiers` :43、`paidTier` :53） | 命令附录 B |
| 关键语义 | **`ineligibleTiers` 存在时 HTTP 仍是 200**：门禁是客户端本地判定（读到 `reasonCode=UNSUPPORTED_LOCATION` 即中止），客户端可见错误串为 `"Eligibility check failed: Your current account is not eligible for Antigravity, …"`，不是 HTTP 4xx | `…081540Z-2.resp.txt` + `/tmp/agy-fix/gate2/exp/control/out_1.txt` | `head -1 out_1.txt` |
| 异常流 | 401：`WWW-Authenticate: Bearer realm="…", error="invalid_token"`（curl 探针，pid 2838002）；404：curl 探针路径；**客户端自身全部 200** | `…074515Z-2.resp.txt`、`/tmp/agy-fix/mitm/selftest-rewrite-headers.txt` | |

### 2.5 同一次运行里的其它端点（补全契约面）

| 端点 | 方法/URL | body | 响应要点 | 来源 |
|---|---|---|---|---|
| fetchAvailableModels | `POST /v1internal:fetchAvailableModels` | `{"project":"aicode-consumers"}` | 200（响应体 gzip 落盘不可解码，见 G2） | `…080901Z-3.req.txt:23` |
| fetchAdminControls | `POST /v1internal:fetchAdminControls` | 同上 | 200 | `…080901Z-5.req.txt` |
| fetchUserInfo | `POST /v1internal:fetchUserInfo` | 同上 | 200 | `…080901Z-7.req.txt` |
| retrieveUserQuotaSummary | `POST /v1internal:retrieveUserQuotaSummary` | 同上 | 200（11 次调用，最频繁） | `…080901Z-9.req.txt` |
| listExperiments | `POST /v1internal:listExperiments` | 同上 | 200 | `…082012Z-49.req.txt` |
| writeTrajectoryAcls | `POST /v1internal:writeTrajectoryAcls` | 同上 | 200 | `…080901Z-*.req.txt` |
| fetchConfig（另一 host！） | `GET https://aicode.googleapis.com/v1alpha:fetchConfig`（**GET、无 body**，UA 同为 antigravity/cli/1.3.5，带 Authorization） | — | 200；`experimentConfig{enabledExperimentIds[26], experimentFlags[402]}`、`availableExperiences[15]`、`agySurfaceConfig{agentExperiences[10], webSearchExperiences, imageGenerationExperiences, commitMessageExperiences, tieredFlashLiteExperiences, tieredFlashExperiences, tieredProExperiences, audioTranscriptionExperiences}` | `aicode.googleapis.com/20261116T080904Z-2.req.txt:10`（GET 行）、`aicode.googleapis.com/20261116T081805Z-2.resp.txt`（响应体） |
| 调用节奏 | 一次 `agy -p "hi"` 触发 **8 次 loadCodeAssist**（seq 2,10,14,22,26,28,38,46）与 11 次 quota | — | 说明 loadCodeAssist 是**按连接/轮次反复调用**，不是启动一次缓存 | 文件名 seq 序列 |

---

## 3. 与 #59 逐条对照

> 说明：`vectr_recall(note_id=59)` 在本工作区返回 **not found**（本库最新 #14–#19/#64，无 #59）。下列对照严格按父任务转述的 #59 假设逐条核对，未做任何补充假设。

| #59 假设 | 实测 | 判定 | 证据 |
|---|---|---|---|
| UA = `antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)` | 逐字符相同（含 `cl=998863838`、`auth_method=consumer`、分号+空格分隔） | **一致** | `…081812Z-35.req.txt:15` |
| loadCodeAssist body 仅 `{"metadata":{"ideType":"ANTIGRAVITY"}}` | 38 字节，完全相同（无 pluginVersion/pluginType/platform —— 那是本会话 curl 探针发的，属**误归因风险点**） | **一致** | `…081540Z-2.req.txt:23`；对照 `…074608Z-4.req.txt`（curl 版） |
| 生成 model = `gemini-4-hydrogen-medium` | agent 请求实测 `gemini-4-hydrogen-medium`；但同一客户端另有 `gemini-3.5-flash-lite`（checkpoint 请求），且响应 `modelVersion` 为 `gemini-4-hydrogen` | **一致（需补注）** | `…081812Z-35.req.txt:23`、`…081811Z-33.req.txt:23` |
| project = `aicode-consumers` | 一致；且证据链显示该值来自 loadCodeAssist 响应 `cloudaicompanionProject`，随后被填进 6 个端点的 `{"project":…}` | **一致（来源已澄清）** | `…081540Z-2.resp.txt:42` → `…080901Z-3.req.txt:23` |
| ——（#59 未提及） | 请求头**没有** x-goog-api-client / x-client-version / x-cloudaicompanion-* / client-metadata | **新增** | 头并集 10 种（附录 A） |
| ——（#59 未提及） | `request` 六键包装 + `requestId` 模板 + `labels.model_enum=MODEL_PLACEHOLDER_M526` + 12 个工具名 | **新增** | `…081812Z-35.req.txt:23` |
| ——（#59 未提及） | SSE 帧外层 `{"response":…,"traceId":…}`；`Content-Disposition: attachment`；流式响应无 trace-id 头 | **新增** | `…081812Z-35.resp.txt:4-5,21` |
| ——（#59 未提及） | `ineligibleTiers` 与 `currentTier=standard-tier` **同时存在且 200** —— 门禁不是 HTTP 层 | **新增（与 #14 呼应）** | `…081540Z-2.resp.txt:23,43` |

---

## 4. 可供二进制静态分析交叉验证的「字面量清单」

1. `{"metadata":{"ideType":"ANTIGRAVITY"}}` —— 38 B 常量应整段出现在 rodata（或由结构体 + `ideType` 字段名拼接，则 `ideType`/`ANTIGRAVITY` 两常量必在）。
2. UA 模板：`antigravity/cli/%s (aidev_client; os_type=%s; arch=%s; cl=998863838; auth_method=consumer)` —— `cl=998863838` 是硬编码常量，`os_type=`/`arch=` 为格式串。
3. 模型枚举 → 名字映射：`MODEL_PLACEHOLDER_M526` ↔ `gemini-4-hydrogen-medium`（labels 里发枚举，body 里发名字，说明二进制内有枚举→字符串表）。
4. `requestId` 模板：`agent/%s/%d/%s/%d` 与 `checkpoint/%s`。
5. SSE 解析：`data: ` 前缀 + 外层 `response` 键 + `candidates[].content.parts[].text`；`thoughtSignature` 逐帧回传。
6. `thinkingLevel` 取值域：`LOW` / `MEDIUM`（本次 MEDIUM，checkpoint 用 LOW）+ `includeThoughts:true`。
7. `maxOutputTokens: 262144` 常量。
8. 门禁字符串链：`ineligibleTiers` / `reasonCode` / `UNSUPPORTED_LOCATION` / 本地错误 `Eligibility check failed: `（gate2 日志可给完整串）。
9. 端点字面量：`v1internal:loadCodeAssist`、`v1internal:streamGenerateContent?alt=sse`、`v1internal:retrieveUserQuotaSummary`、`v1internal:fetchAvailableModels`、`v1alpha:fetchConfig`。
10. host 常量：`daily-cloudcode-pa.googleapis.com`、`aicode.googleapis.com`。

---

## 5. 缺口清单（必须如实标注）

| ID | 缺口 | 影响 | 处置建议 |
|---|---|---|---|
| G1 | 无 mitmproxy 二进制 flow / har，只有文本 dump；header 顺序=写盘顺序，不保证与线上字节序一致 | 无法给「字节级 header 顺序」证据 | 可接受；如需字节序，另会话用 `mitmdump -nr` 存 flow 再解析 |
| G2 | 辅助端点响应体（fetchAvailableModels / quota / fetchUserInfo / fetchAdminControls / listExperiments）落盘时被二次 UTF-8 编码（`BODY [readable text] (not valid UTF-8)`，gzip 体被破坏） | **模型清单、配额明细、账号信息不可读** | 需另一会话修 capture 脚本后重抓；本次只用 loadCodeAssist + 两条 stream 的完整响应 |
| G3 | 只覆盖 consumer 账号、单次 `agy -p "hi"`、纯首轮 | 未覆盖：401 刷新后重试（仅 curl 探针 401）、多轮 tool-call 往返（functionResponse/thoughtSignature 回传）、多模态、Claude/非 Gemini 路径（`used_claude=false`） | 如需 tool-call 契约，另跑一次带工具调用的会话 |
| G4 | 全部为 Linux/amd64，UA 中 `os_type`/`arch` 只有 linux/amd64 观测值 | Windows/macOS UA 未验证 | 交给二进制侧静态推算格式串 |
| G5 | `vectr` 中 #59 缺失（note_id=59 not found，本库最新为 #64） | 对照只能按父任务转述假设执行，无法核对 #59 原文措辞 | 请父任务确认 #59 所属 session/workspace 后回填一次校准 |
| G6 | 未验证 `?alt=sse` 能否省略、`requestType`/`labels` 是否必填 | 复刻客户端时可能带多余/缺失字段 | 抓包只能证明「发了什么」，不能证明「服务端要求什么」 |
| G7 | 208 文件中 1 个（play 主机）二进制体内出现随机字节命中 token 前缀正则，但严格 token 形态 0 命中 | 仅为脱敏扫描噪声，非泄漏 | 已在 §1 记录，无需重抓 |

---

## 6. 命令附录（可复现，均为只读）

**A. 头字段并集**
```bash
cd /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com
python3 - <<'EOF'
import glob,re,collections
names=collections.Counter(); ex={}
for f in sorted(glob.glob('*.req.txt')):
    t=open(f,encoding='utf-8',errors='replace').read()
    m=re.search(r'headers:\n(.*?)\n\n',t,re.S)
    if not m: continue
    for line in m.group(1).splitlines():
        mm=re.match(r'\s+([A-Za-z0-9-]+):\s*(.*)',line)
        if mm: names[mm.group(1)]+=1; ex.setdefault(mm.group(1),set()).add(mm.group(2)[:80])
for k,c in names.most_common(): print(c,k,list(ex[k])[:2])
EOF
```

**B. 请求/响应 JSON 解析（body 在 `[readable text]` 与 `[hexdump]` 之间）**
```bash
cd /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com
python3 - <<'EOF'
import json,re
for f in ['20261116T081812Z-35.req.txt','20261116T081540Z-2.resp.txt']:
    t=open(f,encoding='utf-8',errors='replace').read()
    b=t.split('[hexdump]')[0].split('(printable ratio 1.00)')[-1]
    d=json.loads(b); print(f, list(d.keys()))
EOF
```

**C. 官方客户端 vs 探针分流**
```bash
cd /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com
grep -l 'antigravity/cli/1.3.5' *.req.txt | wc -l   # 官方
grep -l 'curl/8.23.0' *.req.txt | wc -l            # 探针，需排除
```

---

## 7. 总结（约 280 字）

一次 `agy -p "hi"` 就把契约钉住了。头很薄：只有 Host、UA、Bearer、application/json、gzip 与 chunked，没有任何 x-goog-api-client 家族头，说明二进制没有模拟官方 SDK 的元数据头；身很重：34.7 KB 六键包，`request` 内嵌 18.6 KB 身份提示、12 个工具声明与 `labels`，`MODEL_PLACEHOLDER_M526` 指代 `gemini-4-hydrogen-medium`，另有标题生成请求走 `gemini-3.5-flash-lite`。loadCodeAssist 的 38 字节 body、`aicode-consumers` 与 UA 均与 #59 一致，且 project 实际取自响应的 `cloudaicompanionProject`。

最有价值的是门禁语义：受限账号下 loadCodeAssist 仍返回 200，只在 body 给 `ineligibleTiers`（`UNSUPPORTED_LOCATION`），由客户端本地判定中止——修复点应在二进制判定处，而非 HTTP 层。响应是 SSE，帧外层包 `response`，`modelVersion` 为 `gemini-4-hydrogen`（无 `-medium` 后缀），复刻时不可按请求 model 等长匹配。证据全部取自另一会话留下的 208 个只读 dump（07:45–08:20Z），未运行二进制、未起代理，命令可复现；缺口在辅助端点响应体不可解码、单账号单轮覆盖。
