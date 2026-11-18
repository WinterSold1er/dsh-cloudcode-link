# T2 契约差量交付：官方 agy 1.3.5 真实请求 vs 插件请求

- 角色：`worker-contract/t2-integrate`（整合与交付，未生成子代理）
- 输入：`ops/relink/t2-binary-findings.md`、`ops/relink/t2-plugin-findings.md`、`ops/relink/t2-traffic-findings.md`
- 独立复核：本轮亲自复跑 10 条只读命令（见 §8.1），三份分报告的结论均按“抓包 > 二进制 > 源码”重排，**未直接采信分报告结论**
- 时间：2026-11-16 18:0x CST；抓包窗口 2026-11-16 15:45–16:20 CST（07:45–08:20Z）
- 只读边界：未运行 `/usr/bin/agy`、未起代理、未写 `/tmp/agy-fix`、未改 `/usr/bin/agy`、未改源码；唯一写入是本文件

---

## 1. 结论摘要（TL;DR）

官方 agy 1.3.5 的真实生成契约很短：`POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`，UA 是 `antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)`，请求头只有 Host/User-Agent/Authorization/Content-Type/Accept-Encoding（有体时加 Content-Length 或 chunked），**没有** x-goog-api-client、Client-Metadata、x-client-version 家族；body 是 6 键 protojson：`project=aicode-consumers`、`requestId=agent/<cascade>/<ms>/<trajectory>/<step>`、`model=gemini-4-hydrogen-medium`、`userAgent=antigravity`、`requestType=agent`。

插件最关键的差异有 5 个：①身份段是 `hub/2.8.0`、cl=963137146、**无 auth_method**、arch 写 `x64`；②多发 `X-Goog-Api-Client`、`Client-Metadata`、`Accept: text/event-stream`；③端点首选 production（实测 429 的那台），官方这次只走 daily；④`requestType/userAgent` 用大写 `AGENT/ANTIGRAVITY`，`requestId` 少 cascade 与 epoch-ms 两段，`labels` 少 4 个键，`request` 多一个 `toolConfig`；⑤429 立即返回、不切候选。

429 判定：现有证据**能解释“为什么插件总是撞 429”**（首选端点就是 429 的那台 + 429 不回退），**不足以证明“429 由 UA/身份过期直接造成”**（同一 host 的 loadCodeAssist 用插件头也返回 200，429 body 是配额型）。身份差异是“已证差异”，不是“已证原因”。

---

## 2. 证据源与可信度

| 级别 | 证据源 | 覆盖 | 可信度与限制 |
|---|---|---|---|
| A（最高） | `/tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/` 文本 dump，208 个文件，`pid 2856760` 为官方客户端 | 线上真实字节：请求行、头、34.7 KB body、SSE 响应 | 线上事实最高证据；但文本 dump 经落盘重排（G1），且辅助端点响应体损坏（G2） |
| B（高） | `/usr/bin/agy` 静态：pclntab 函数名、`objdump`、字面量计数 | UA 构造、`setHeaders` 三元组、host/path 常量、proto 描述符 | 字面量与结构可证；“未找到 ≠ 不存在”，且 tag 搜索会漏 `,omitempty`（见 C1） |
| C（高） | `packages/core/src/*.ts`、`src/**` 源码 | 插件实际发送面 | file:line 可复核；但“代码写了”≠“运行时一定走到” |

### 2.1 三处冲突及取舍

**C1（body JSON tag 缺失）**：分报告称二进制中无 `generationConfig/systemInstruction/labels/requestType` 的 `json:"..."` tag，但抓包 body 里这些键实际存在。
- 本轮复核结论：**分报告的搜索方法是错的，不是二进制缺字段**。①精确匹配 `json:"generationConfig"`（带右引号）会漏掉真实 tag：`0x9facaf0` 处是 `json:"generationConfig,omitempty"`，`0x9fc0307` 处是 `json:"systemInstruction,omitempty"`，`0x9edc3eb` 处是 `json:"labels,omitzero"`（这些 tag 是否属于 cloudcode 请求结构体无法由上下文断定，但“二进制里没有这些 tag”这句话本身不成立）；②更关键的是 body 走 **protojson**：`0x563936d` 处的 `google.internal.cloud.code.v1internal` 描述符文本里可见 `user_agent ... R\tuserAgent`、`request_type ... R\x0brequestType`，同一区段还有 `project`、`request_id → requestId`、`model`。JSON 键名来自 proto 描述符，不来自 Go struct tag，所以 `json:"requestType"` 计数为 0 是必然的。
- 取舍：**body 事实以抓包为准**；二进制只用来解释“键从哪来”（protojson 命名），不用来否定抓包。

**C2（`X-Goog-Request-Reason`）**：二进制 `setHeaders`（`0x7a37ce0–0x7a380e0`）硬编码了该头键（`0x535527b`，引用点 `0x7a37ee5`），但抓包 43 条请求的头并集里没有它。
- 取舍：写“**二进制定义了该头，抓包未观测到**（可能仅在特定 RPC/条件触发，或落盘遗漏）”，**不断言官方在生成路径发送**。

**C3（`x-goog-api-client`）**：二进制有该字面量（小写，`0x5312e87`，1 处），抓包 cloudcode 请求 0 命中。
- 复核：该字面量上下文紧邻 `generationConfig`、`systemInstruction`、`vertexDatasetName`（genai/vertex SDK 头常量区），且 `vscode_cloudshelleditor`、`google-cloud-sdk` 在二进制中 **0 命中**；`setHeaders` 只硬编码 3 个头键。
- 取舍：判定“**官方 cloudcode 路径不发该头**”；插件那个 `google-cloud-sdk vscode_cloudshelleditor/0.1` 值在官方二进制中无出处，属插件自造。

---

## 3. 官方契约事实表

| # | 字段 | 官方值（1.3.5，linux/amd64） | 证据（命令 + 偏移 / 文件:行） | 置信 |
|---|---|---|---|---|
| 1 | 生成 URL | `POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` | `…081812Z-35.req.txt:2,12` | 已证 |
| 2 | UA 全串 | `antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)` | `…081812Z-35.req.txt:5,15`；`…081540Z-2.req.txt:5`；`…080901Z-9.req.txt:5`（三处逐字符一致） | 已证 |
| 3 | UA 组装格式 | 两分支 `"%s/%s/%s (%s)"`（4 参）/`"%s/%s (%s)"`（3 参），括号段 `strings.Join(parts, "; ")`；parts 顺序 `aidev_client → os_type → arch → cl → auth_method` | `objdump -d 0x7a371c0–0x7a37ce0`：`0x52bfb64`、`0x527488d`、`0x51fd70c`（`"; "`，len 2）；字面量 `antigravity` `0x528ddf8`、`aidev_client` `0x52a831a` | 结构已证 |
| 4 | 产品段 `cli` | UA 第二个 `/` 段为 `cli` | 抓包已证；二进制中该段**无独立字面量**（运行时/构建期注入），来源=缺口 | 已证/来源推断 |
| 5 | 版本 | `1.3.5`，全二进制仅 1 处 | 计数命中 `off=0xabeb833`，上下文 `"file:data:CORE\0" "1.3.5\nDate: "` | 已证 |
| 6 | `cl` | `998863838`（`cl=%d`，先 `strconv.Atoi` 再 `runtime.convT64`） | `0x5210968`（`cl=%d`）、`0x7a373e2 call strconv.Atoi`；字符串 `998863838` 在二进制多处存在 | 已证 |
| 7 | `auth_method` | `consumer`（`auth_method=%s` 格式串） | `0x52d61bb`（`auth_method=%s`）、`0x7a37520` lea | 值已证（抓包） |
| 8 | os/arch 拼写 | `os_type=linux; arch=amd64` | `…081812Z-35.req.txt:5`；格式串 `os_type=%s` `0x5274879`、`arch=%s` `0x522f31b` | 已证 |
| 9 | 请求头集合（生成） | `Host`、`User-Agent`、`Transfer-Encoding: chunked`、`Authorization: Bearer`、`Content-Type: application/json`、`Accept-Encoding: gzip`；**无 Accept** | `…081812Z-35.req.txt:4-9`（proxy 段 4-9，真实段 14-19） | 已证 |
| 10 | 请求头集合（loadCodeAssist） | 同上但 `Content-Length: 38`（无 Transfer-Encoding） | `…081540Z-2.req.txt:4-9,14-19` | 已证 |
| 11 | 全部请求头并集 | daily 目录 67 个 `*.req.txt`，其中 43 个含 `headers:` 块（41 个官方客户端 + 2 个 curl 探针，另 2 个探测文件只有 CONNECT 段）：客户端只有两种头集合——39 条 `Host/User-Agent/Authorization/Content-Type/Accept-Encoding/Content-Length`，2 条生成请求用 `Transfer-Encoding: chunked` 替代 Content-Length；**无 Accept**。`Accept: */*` 只出现在 curl 探针，不计入客户端契约 | 本轮 §8.1-E 脚本输出 | 已证 |
| 12 | x-goog 家族（请求向） | 0 命中：无 `x-goog-api-client`、`x-client-version`、`Client-Metadata`、`x-cloudaicompanion-*` | `grep -c` 全部 req.txt → 无文件命中；二进制 `x-client-version` count=0、`client-metadata` 仅 `client-metadata.json` 文件名 | 已证 |
| 13 | `X-Goog-Request-Reason` | 二进制定义（`setHeaders`），抓包未观测 | 二进制 `0x535527b`@`0x7a37ee5`；抓包 43 条 0 命中 | 定义已证/发送未证（C2） |
| 14 | `Accept-Encoding` | `gzip` | `…081812Z-35.req.txt:9,19` | 已证 |
| 15 | 传输 | 生成用 `Transfer-Encoding: chunked`（body 以 chunk 写出）；loadCodeAssist/quota 用 `Content-Length` | 抓包各行 | 已证 |
| 16 | loadCodeAssist body | 38 B：`{"metadata":{"ideType":"ANTIGRAVITY"}}`（单键） | `…081540Z-2.req.txt:21-24`，`Content-Length: 38` | 已证 |
| 17 | 生成 body 顶层键 | 6 键、顺序 `project,requestId,request,model,userAgent,requestType` | 本轮 §8.1-F 解析输出 | 已证 |
| 18 | `project` | `"aicode-consumers"`（取自 loadCodeAssist 响应 `cloudaicompanionProject`，非本地常量；二进制中 `aicode-consumers` 0 命中） | body + `…081540Z-2.resp.txt:42` | 值已证/来源已证 |
| 19 | `model`（agent） | `gemini-4-hydrogen-medium`（二进制无此字面量 → 服务端模型选择回填） | `…081812Z-35.req.txt` body；二进制 count=0 | 值已证/来源推断 |
| 20 | `model`（checkpoint） | `gemini-3.5-flash-lite` | `…081811Z-33.req.txt` body | 已证 |
| 21 | `userAgent`（body 内） | `"antigravity"`（小写短名，≠ 头里的全串） | body | 已证 |
| 22 | `requestType` | `agent`（主对话）/ `checkpoint`（标题生成） | 两条 body | 已证 |
| 23 | `requestId` | `agent/<cascade_id>/<epoch_ms>/<trajectory_id>/<step>`；checkpoint 为 `checkpoint/<uuid>` | `…081812Z-35`：`agent/f3e5ee7e-…/1794817091999/2e579052-…/1` | 已证 |
| 24 | `request` 子键（agent） | 6 个：`contents`、`systemInstruction`、`tools`、`labels`、`generationConfig`、`sessionId`；**无 `toolConfig`** | body | 已证 |
| 25 | `request` 子键（checkpoint） | 4 个：`contents`、`systemInstruction`、`generationConfig`、`sessionId`（无 tools/labels） | `…081811Z-33` body | 已证 |
| 26 | `labels`（agent） | 9 键全字符串：`cascade_id`、`root_cascade_id`、`trajectory_id`、`request_id`（`<trajectory>-0`）、`last_step_index`=`"0"`、`model_enum`=`MODEL_PLACEHOLDER_M526`、`used_claude`/`used_claude_conservative`/`used_non_gemini_model`=`"false"` | body | 已证 |
| 27 | `generationConfig` | agent：`{"maxOutputTokens":262144,"thinkingConfig":{"includeThoughts":true,"thinkingLevel":"MEDIUM"}}`；checkpoint：`thinkingLevel:"LOW"` | body | 已证 |
| 28 | `sessionId` | 字符串化的负 int64，`"-3750763034362895579"` | body | 已证 |
| 29 | 配额端点 | `POST /v1internal:retrieveUserQuotaSummary`，body 30 B `{"project":"aicode-consumers"}`，UA 与生成**同一个全串** | `…080901Z-9.req.txt:2,12,5,22-26` | 已证 |
| 30 | 生成响应 | `HTTP/1.1 200 OK`、`Content-Type: text/event-stream`、3 个 `data: {"response":…}` 帧 | `…081812Z-35.resp.txt:2-3`；`grep -c '^data: '` → 3 | 已证 |

---

## 4. 插件契约事实表

| # | 字段 | 插件值 | file:line | 代码摘录 |
|---|---|---|---|---|
| 1 | 生成 UA | `antigravity/hub/${ANTIGRAVITY_HUB_VERSION\|\|'2.8.0'} (aidev_client; os_type=…; arch=x64; cl=${ANTIGRAVITY_HUB_CL\|\|'963137146'})`，**无 auth_method** | `packages/core/src/client.ts:111-116` | ``return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})` `` |
| 2 | os 映射 | darwin/win32/linux；arch 映射 arm64/x64 | `client.ts:114-115` | `process.arch === 'arm64' ? 'arm64' : 'x64'` |
| 3 | 头集合 | 6 个：Authorization/Content-Type/Accept/User-Agent/X-Goog-Api-Client/Client-Metadata | `client.ts:119-138` | 见 §4 摘录 |
| 4 | Accept | `text/event-stream`（全部 RPC 都设） | `client.ts:129` | `Accept: 'text/event-stream'` |
| 5 | X-Goog-Api-Client | `google-cloud-sdk vscode_cloudshelleditor/0.1` | `client.ts:131` | 官方二进制无此值（count=0） |
| 6 | Client-Metadata | `{ideType:'ANTIGRAVITY', platform:'PLATFORM_*', pluginType:'GEMINI'}` | `client.ts:132-136` | JSON 字符串，键序固定 |
| 7 | 端点候选 | production → daily → daily-sandbox | `client.ts:7-11`、`client.ts:102-108` | `DEFAULT_ENDPOINT` + 2 个 fallback |
| 8 | 429 行为 | 401/403/400/429 **立即 return**，不切候选 | `client.ts:478-480` | `if (res.status === 401 \|\| … \|\| res.status === 429) { return … }` |
| 9 | 404 行为 | 记 `lastResponse` 后继续下一候选；全败时 endpoint 误标 `endpoints[0]` | `client.ts:477`、`client.ts:487-489` | |
| 10 | loadCodeAssist body | `{"metadata":{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}}` | `client.ts:237-243` | 3 键，比官方多 platform/pluginType |
| 11 | project 来源 | `loadCodeAssist` → `listCloudAICompanionProjects` → `onboardUser/getOperation` → sha1 派生确定性 UUID 兜底 | `client.ts:357-401`、`client.ts:222-265` | 与官方“直接用响应 project”不同，多了兜底分支 |
| 12 | 生成 body | `{project, model, request{contents, systemInstruction?, generationConfig, tools?, toolConfig?, sessionId, labels}, requestType:'AGENT', userAgent:'ANTIGRAVITY', requestId}` | `adapter.ts:311-332` | 6 个顶层键同名 |
| 13 | requestType / userAgent | 大写 `AGENT` / `ANTIGRAVITY` | `adapter.ts:329-330` | |
| 14 | toolConfig | `{functionCallingConfig:{mode:'AUTO'}}`（有工具时） | `adapter.ts:325` | 官方 body 无此键 |
| 15 | requestId | `agent/${trajectoryId}/${step}` | `client.ts:435` | 缺 cascade_id 与 epoch_ms |
| 16 | labels | `last_step_index`、`trajectory_id`、`used_claude`、`used_claude_conservative`，有映射时加 `model_enum` | `client.ts:426-433` | 缺 `cascade_id`/`root_cascade_id`/`request_id`/`used_non_gemini_model` |
| 17 | sessionId | `fnv1a64Signed(sessionId)` 字符串化负 int64 | `client.ts:424`、`sessions.ts:94-128` | 形状与官方一致 |
| 18 | 配额 UA | `antigravity/1.1.15 linux/amd64` | `quota.ts:62-66` | ``return `antigravity/${version} ${os}/${arch}` `` |
| 19 | 配额请求 | `POST /v1internal:retrieveUserQuotaSummary`，body `{}`，头仅 Authorization/Content-Type/User-Agent | `quota.ts:333-341` | 官方 body 是 `{"project":…}`、UA 是全串 |
| 20 | 模型 slug 空间 | 无 `gemini-4-*`；路由表为 `gemini-3.5-flash-*`/`gemini-3-flash-agent`/`gemini-pro-agent` 等，默认拼 `-low` | `models.ts:472-478`、`models.ts:627-645` | 与官方 `gemini-4-hydrogen-medium` 不同族 |
| 21 | 429 上层处理 | `recordFailure` 写冷却 + 换账号（不是换端点） | `adapter.ts:366-374` | |

---

## 5. 逐字段差量表（核心）

“是否可能是闸门”按四档：**高 / 中 / 低 / 否**，只表示“差异 + 机制上可能影响准入判定”的可能性，不表示已证因果。

| # | 字段 | 官方值 | 插件值 | 差异 | 是否可能是闸门 | 证据 |
|---|---|---|---|---|---|---|
| 1 | 产品线 | `antigravity/cli/…` | `antigravity/hub/…` | 身份族不同：CLI vs IDE 插件 | **中**：服务端可能按产品线做路由/能力集，但无隔离实验 | 抓包 `…35.req.txt:5`；`client.ts:116` |
| 2 | 版本 | `1.3.5` | `2.8.0` | 语义版本完全不同族 | 中低：版本号通常只记录；但与产品线绑定，可能是白名单维度 | 抓包；`client.ts:112` |
| 3 | `cl` | `998863838` | `963137146` | 构建号不同 | 中低：CL 号常被用作灰度/实验分组键，可能改变路由 | 抓包；`client.ts:113` |
| 4 | `auth_method` | `consumer` | **缺失** | 少一个 UA 参数段 | **中**：官方显式声明认证方式，服务端可能据此区分消费者/服务账号 | 抓包；`client.ts:116` |
| 5 | os/arch 拼写 | `os_type=linux; arch=amd64` | `os_type=linux; arch=x64` | `amd64` vs `x64` | 低：纯字符串，通常不参与准入 | 抓包；`client.ts:115` |
| 6 | UA 全串 | 见 §3#2 | `antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)` | 4 处不同（产品线/版本/cl/无 auth_method） | **中**：作为整体身份指纹，差异已被证实；因果未证 | 两侧 |
| 7 | `Client-Metadata` | **不发** | `{ideType,platform,pluginType}` | 多发一个头 | 低：多余头通常被忽略；但可能触发不同路由分支，不能完全排除 | 抓包并集；`client.ts:132-136` |
| 8 | `X-Goog-Api-Client` | **不发**（cloudcode 路径） | `google-cloud-sdk vscode_cloudshelleditor/0.1` | 多发一个头，且值在官方二进制无出处 | 低：同上；官方 genai 路径才带该头 | 抓包并集；`client.ts:131`；二进制 C3 |
| 9 | `X-Goog-Request-Reason` | 二进制定义、抓包未观测 | **不发** | 插件缺（或官方仅在条件路径发） | 否/低：官方正常生成时抓包也没有，说明非必需 | C2 |
| 10 | `Accept` | **不发** | `text/event-stream` | 插件多一个协商头 | 低：官方无 Accept 仍收到 `text/event-stream` 响应 | 抓包 `…35.resp.txt:3`；`client.ts:129` |
| 11 | `Accept-Encoding` | `gzip` | 未显式设；`net.ts:33-37` 只透传 init，实际由 undici 默认补（未抓插件侧流量，未观测） | 可能多出 `deflate` | 否：传输层协商 | 抓包；`client.ts:119-138` 无该键 |
| 12 | `Authorization` | `Bearer <token>` | `Bearer <token>` | 一致（仅 scheme 记录） | 否 | 两侧 |
| 13 | `Content-Type` | `application/json` | `application/json` | 一致 | 否 | 两侧 |
| 14 | 端点 host / 顺序 | 本次只观测到 `daily-cloudcode-pa` | 首选 `cloudcode-pa`（production），再 daily、daily-sandbox | 首选端点不同 | **高**：production 实测 429、官方 daily 实测 200；这是最直接的机制差 | 抓包；`client.ts:7-11`；`ops/diag/endpoint-ab-…analysis.md` |
| 15 | path / query | `/v1internal:streamGenerateContent?alt=sse` | 同 | 一致 | 否 | 两侧 |
| 16 | loadCodeAssist body | `{"metadata":{"ideType":"ANTIGRAVITY"}}`（38 B） | 同结构 + `platform` + `pluginType`（多 2 键） | 多 2 个 metadata 键 | 低：同 host 下插件 LCA 返回 200，说明被接受 | 抓包；`client.ts:237-243` |
| 17 | `project` 值与来源 | `aicode-consumers`，直接取响应 | 优先同源，失败时 `onboardUser`/sha1 UUID 兜底 | 兜底值可能不是 `aicode-consumers` | 中：非 LCA project 在 daily 上可能 404（T3 已排除“daily 404 = project 喂错”，但兜底路径未单独测） | 抓包；`client.ts:357-401` |
| 18 | `model` 命名 | `gemini-4-hydrogen-medium` / `gemini-3.5-flash-lite` | 无 `gemini-4-*`，默认 `gemini-3-…-low/high` | 模型族与 slug 都不同 | **中高**：daily 的 404 可能由模型 slug 不存在造成（时间/身份/模型三重混杂，未隔离） | 抓包；`models.ts:472-478,627-645` |
| 19 | `requestId` 格式 | `agent/<cascade>/<ms>/<trajectory>/<step>` | `agent/<trajectory>/<step>` | 少 cascade 段与 epoch-ms 段 | 中：服务端可能用它做幂等/追踪/归属，格式不符可能降级或拒绝 | 抓包；`client.ts:435` |
| 20 | `requestType` | `agent` / `checkpoint`（小写枚举） | `AGENT`（大写） | 大小写不同 | **中**：二进制存在 `requestType is unspecified` 错误串，暗示有枚举校验；大写可能被判 unknown | 抓包；`adapter.ts:329`；二进制 `0x53a3af5` |
| 21 | body `userAgent` | `antigravity`（小写短名） | `ANTIGRAVITY`（大写） | 大小写不同 | 中低：同名不同值，可能进入不同统计/路由桶 | 抓包；`adapter.ts:330` |
| 22 | `request` 子键 | 6 键（无 `toolConfig`） | 7 键（多 `toolConfig.functionCallingConfig.mode=AUTO`） | 多一个键 | 低：多余字段通常被忽略；严格 proto 校验会 400 而非 429 | 抓包；`adapter.ts:325` |
| 23 | `labels` | 9 键（含 cascade/root/request_id/used_non_gemini_model） | 4–5 键 | 缺 4 个键 | 中低：标签多用于分析/计费归属，缺 cascade 可能影响会话关联 | 抓包；`client.ts:426-433` |
| 24 | `generationConfig` | 含 `maxOutputTokens` + `thinkingConfig` | 仅在调用方给参数时才带；默认可能为空对象 | 可能缺 `thinkingConfig` | 低：能力差异，不像准入闸门 | 抓包；`adapter.ts:319-323` |
| 25 | `sessionId` | `"-3750763034362895579"` | `fnv1a64Signed(...)` 负 int64 字符串 | 形状一致 | 否 | 抓包；`client.ts:424` |
| 26 | 传输编码 | chunked（生成） | `JSON.stringify` 定长 body → Content-Length | 编码方式不同 | 否 | 抓包；`client.ts:453-457` |
| 27 | 429 回退 | 不适用（官方未观测 429） | 429 立即 return，不切候选 | 机制差 | **高**：把 production 的 429 直接升级为全局失败，屏蔽 daily/sandbox | `client.ts:478-480` |
| 28 | 配额 UA / body | 全串 UA + `{"project":…}`（30 B） | `antigravity/1.1.15 linux/amd64` + `{}` | UA 与 body 都不同 | 中低：影响额度探测与冷却，不直接导致生成 429 | 抓包 `…080901Z-9`；`quota.ts:62-66,333-341` |

---

## 6. “身份过期”与 429 判定（分开回答）

### 6.1 插件 UA 到底是不是 1.1.15？——**不是，任务前提需纠正**

- 生成路径 UA 由 `client.ts:111-116` 生成：`antigravity/hub/2.8.0 (…; arch=x64; cl=963137146)`，与 `1.1.15` 无关。
- `1.1.15` 只出现在 `quota.ts:62-66` 的 `agyUserAgent()` 默认值，用于配额/模型发现的辅助请求（`quota.ts:333-341`、`quota.ts:361-369`）。
- 更关键的反向事实：**官方 1.3.5 的配额请求也不用 `1.1.15`**，而是与生成完全相同的全串 UA（`…080901Z-9.req.txt:5`）。所以 `1.1.15` 是插件里的**陈旧常量**，不是“官方曾用、现已过期”的身份。

### 6.2 hub 2.8.0 / 无 auth_method / cl 不同，算不算“身份过期”？

| 维度 | 已证差异 | 未证后果 |
|---|---|---|
| 产品线 + 版本 | `cli/1.3.5` vs `hub/2.8.0`（抓包 + 源码双向可证） | 服务端是否按产品线/版本做白名单或路由，**无证据**；没有“只改 UA”的隔离实验 |
| `auth_method` | 官方有 `consumer`，插件无 | 是否被用作准入键，**无证据**；同一 host 的 LCA 用插件头返回 200，说明头本身未被拒 |
| `cl` | `998863838` vs `963137146` | CL 号若参与灰度分组，可能改变路由；**未验证** |
| 兜底身份 | 官方 body `userAgent=antigravity`（小写）、`requestType` 小写枚举 | 大小写是否被严格校验，**无证据**（但二进制有 `requestType is unspecified` 错误串，存在校验的可能性） |

**结论**：“身份与官方不一致”是**已证事实**；“身份过期导致 429”是**未证推断**。把 `hub 2.8.0` 直接写成“1.1.15 过期”是错的——两者是不同路径的不同常量。

### 6.3 现有证据能否解释 429？——分四问

| # | 子问题 | 判定 | 依据 |
|---|---|---|---|
| ① | 端点选择（production 首试）+ 429 不切候选 | **能解释“为什么插件总是撞 429”**（机制层） | `client.ts:7-11` 首选 production；`client.ts:478-480` 429 立即 return；`ops/diag/endpoint-ab-2026-10-16T08-41-07-515Z.analysis.md`：同 body/header 只换端点，production 429、daily 404；`daily-project-retest-…`：用真实 project `aicode-consumers` 打 daily 仍 404 → 429 只出现在 production |
| ② | 官方走 daily 且实测成功 | **证明 daily 对 CLI 身份在 11-16 可用；不能证明“换端点就能修插件”** | 抓包 `…081812Z-35` 200；但插件侧 daily 观测是 10-16、模型 `gemini-3-flash-high`、身份 hub —— 时间/模型/身份三重混杂 |
| ③ | UA/header 差异对 429 的直接因果 | **无证据** | 反证倾向：T3 探针在 production 上用插件 UA/头 + 同 token 调 loadCodeAssist 返回 200（`ops/diag/t3-endpoint-contract-2026-10-17T16-11-32-229Z.log:90`），说明头/UA 未被拒；429 body 是 `RESOURCE_EXHAUSTED` 配额型，不是 `INVALID_ARGUMENT`/`PERMISSION_DENIED`；无“只改 UA”的 A/B |
| ④ | 地区/账号因素 | **未排除** | T3 跨账号复现 production 429，且 10-16 冷却快照显示 5 个账号均处于 google 家族冷却；出口 US；官方账号响应含 `paidTier{id:"g1-pro-tier", …}` 与 credits（`…081540Z-2.resp.txt:53`），插件账号层级未核对；官方账号虽有 `ineligibleTiers[0].reasonCode=UNSUPPORTED_LOCATION` 仍成功生成 → 该标记不是硬闸门，但不能据此排除账号级 entitlement |

**总判定**：现有证据**能解释“插件为什么总是撞 429”这一表现**（首选 production + 429 不回退），但**不足以单独解释 429 的根因**（身份/端点/模型/账号四者混杂，且无隔离实验）；根因判定**需实验验证**（§7 第 5 条）。

---

## 7. 可落地建议（均为“建议未验证”，按性价比排序）

| 序 | 建议 | 预期影响 | 风险 / 代价 |
|---|---|---|---|
| 1 | **429 也继续尝试下一候选**：把 `client.ts:478-480` 的 429 从“立即 return”改为“记录后继续循环”，并把实际 endpoint 写进冷却 `reason` | 即使 production 限流，daily/sandbox 仍有机会；排障可归因到端点 | 可能增加上游请求量与限流面；daily 当前对插件身份返回 404，收益未证 |
| 2 | **UA 对齐 CLI 身份并做成开关**：`cli/1.3.5`、`cl=998863838`、`arch=amd64`、补 `auth_method=consumer` | 若服务端按 UA 路由/灰度，可解锁 daily；也让线上日志可与官方基线对齐 | 未验证；伪装官方 CLI 身份存在合规与封禁风险，需产品侧确认 |
| 3 | **模型 slug 使用官方命名**（`gemini-4-hydrogen-medium`，`labels.model_enum=MODEL_PLACEHOLDER_M526`），并在 404 时区分“模型不存在”与“实体不存在” | 直接验证 daily 404 是否由模型造成 | 模型可用性依赖账号；若上游不认该 slug 会得到 400/404 |
| 4 | **A/B 掉多余头**：分别关闭 `Client-Metadata`、`X-Goog-Api-Client`、`Accept` 各打 1 次 | 排除“多余头触发不同路由”的低概率假设，成本极低 | 每次 1 个请求预算；统计力弱（单次） |
| 5 | **做一次判定性实验（预算 1–2 次）**：固定账号/端点(daily)/模型(`gemini-4-hydrogen-medium`)/body，仅切换 UA（hub vs cli） | 一次性判定“身份 vs 模型/端点” | 需真实 token 与配额；单账号单轮，结论有置信上限 |
| 6 | **不要走“改二进制/绕门禁”路线**：以官方客户端为基线复刻，门禁语义（`ineligibleTiers` 本地判定）保持只读观察 | 避免把可解释的准入问题变成不可维护的补丁 | 与“尽快恢复”目标存在张力，需要 lead 决策 |

---

## 8. 证据命令附录（可直接复制，均为只读）

### 8.1 本轮亲自复跑的命令与输出摘要

| 编号 | 命令 | 本轮观测输出 |
|---|---|---|
| A | `python3 -c "d=open('/usr/bin/agy','rb').read(); print(d.count(b'1.3.5'), hex(d.find(b'1.3.5')))"` | `1 0xabeb833`（版本常量唯一） |
| B | `objdump -d --start-address=0x7a371c0 --stop-address=0x7a37ce0 --no-show-raw-insn /usr/bin/agy` | lea 目标含 `0x528ddf8`(antigravity)、`0x5274879`(os_type=%s)、`0x522f31b`(arch=%s)、`0x5210968`(cl=%d)、`0x52a831a`(aidev_client)、`0x52d61bb`(auth_method=%s)、`0x51fd70c`("; ")、`0x52bfb64`(%s/%s/%s (%s))、`0x527488d`(%s/%s (%s)) |
| C | `objdump -d --start-address=0x7a37ce0 --stop-address=0x7a38100 --no-show-raw-insn /usr/bin/agy` | lea 目标含 `0x5274757`(User-Agent)、`0x535527b`(X-Goog-Request-Reason)、`0x52a7b76`(Content-Type)、`0x52fd8d9`(application/json) |
| D | `python3` 计数：`x-client-version`、`client-metadata.json`、`X-Goog-Request-Reason`、`x-goog-api-client`、`gemini-4-hydrogen-medium`、`aicode-consumers`、`vscode_cloudshelleditor`、`google-cloud-sdk`、`PLATFORM_LINUX` | 依次 `0 / 1 / 1 / 1 / 0 / 0 / 0 / 0 / 0` |
| E | `/tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/` 下解析 `*.req.txt` 的 `headers:` 块并统计 | 67 个 req 文件、43 个含 `headers:` 块：41 个官方客户端 + 2 个 curl 探针；客户端只有 2 种头集合（39 条 Content-Length、2 条 chunked），**无 Accept**；x-goog 家族 0 |
| F | 解析 `20261116T081811Z-33.req.txt`、`…081812Z-35.req.txt` body（`[readable text]` 与 `[hexdump]` 之间） | 顶层 6 键；`antigravity`/`agent`/`gemini-4-hydrogen-medium`/`aicode-consumers`；labels 9 键 |
| G | `sed -n '1,24p' …081540Z-2.req.txt` | `Content-Length: 38`；body `{"metadata":{"ideType":"ANTIGRAVITY"}}` |
| H | `grep -n '^  \(Host\|User-Agent\|…\)' …081812Z-35.req.txt` | 第 4–9 行（proxy 段）与 14–19 行（真实段）各 6 个头，无 Accept |
| I | `python3` 搜 `json:"generationConfig"` / `json:"generationConfig,omitempty"` / `json:"systemInstruction,omitempty"` / `json:"labels,omitzero"` | 前 0、后 1/1/1；`0x563936d` 处 proto 描述符含 `request_type … requestType` |
| J | `sed -n '111,138p;237,243p;417,439p;476,481p' packages/core/src/client.ts` | 与 §4 摘录一致 |

### 8.2 复现用命令（预期输出已注明）

```bash
# 1) 版本常量与 UA 参数格式串（预期：1 0xabeb833；四个格式串偏移各 1 处）
python3 -c "d=open('/usr/bin/agy','rb').read(); print(d.count(b'1.3.5'), hex(d.find(b'1.3.5'))); print([ (k, d.count(k), hex(d.find(k))) for k in [b'cl=%d',b'auth_method=%s',b'os_type=%s',b'arch=%s'] ])"

# 2) UA 构造反汇编（预期：出现 0x528ddf8/0x52a831a/0x5274879/0x522f31b/0x5210968/0x52d61bb 六个 lea）
objdump -d --start-address=0x7a371c0 --stop-address=0x7a37ce0 --no-show-raw-insn /usr/bin/agy | grep -E 'lea|call' | head -80

# 3) setHeaders 三元组（预期：User-Agent / X-Goog-Request-Reason / Content-Type / application/json 四个 lea）
objdump -d --start-address=0x7a37ce0 --stop-address=0x7a38100 --no-show-raw-insn /usr/bin/agy | grep -E 'lea .*# ' | head -40

# 4) 头键存在性（预期：x-client-version 0、client-metadata.json 1、X-Goog-Request-Reason 1、x-goog-api-client 1）
python3 -c "d=open('/usr/bin/agy','rb').read(); [print(k, d.count(k)) for k in [b'x-goog-api-client',b'x-client-version',b'client-metadata.json',b'X-Goog-Request-Reason',b'gemini-4-hydrogen-medium',b'aicode-consumers']]"

# 5) 抓包头并集（预期：43 条请求、8 个 header 名、无 x-goog 家族、Accept 仅 curl 探针）
cd /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com
python3 - <<'PY'
import glob,re,collections
names=collections.Counter()
for f in sorted(glob.glob('*.req.txt')):
    t=open(f,encoding='utf-8',errors='replace').read()
    m=re.search(r'\nheaders:\n(.*?)\n\n',t,re.S)
    if m:
        for line in m.group(1).splitlines():
            mm=re.match(r'\s+([A-Za-z0-9-]+):',line)
            if mm: names[mm.group(1)]+=1
print(names.most_common())
PY

# 6) 官方三条主请求的头与 body 尺寸（预期：生成 34669 B/chunked、LCA 38 B、quota 30 B）
grep -n 'BODY (' /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T081812Z-35.req.txt \
  /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T081540Z-2.req.txt \
  /tmp/agy-fix/mitm/capture/daily-cloudcode-pa.googleapis.com/20261116T080901Z-9.req.txt

# 7) 插件关键行（预期：UA/头/body/429 分支逐行命中）
sed -n '111,138p;237,243p;417,439p;476,481p' packages/core/src/client.ts
sed -n '311,332p' packages/core/src/adapter.ts
sed -n '62,66p;332,341p' packages/core/src/quota.ts
```

---

## 9. 缺口清单（必须如实标注）

| ID | 缺口 | 影响 |
|---|---|---|
| K1 | 官方只观测到 **daily**，抓包中无 production 请求；可能只是“本次没触发回退” | 不能断言“官方永不使用 production” |
| K2 | 官方 UA 的 `cli` 段在二进制中无独立字面量，来源未定位（构建注入？ldflags？） | “产品段为何是 cli”只有抓包事实，没有代码级解释 |
| K3 | `X-Goog-Request-Reason` 的触发条件与取值未知（二进制只证明键存在） | 无法判断插件是否应补该头（C2） |
| K4 | 二进制未确认 `requestType` 的序列化路径（proto 描述符 vs 手写 JSON） | C1 的结论是“protojson 高度可能”，不是 100% 证明 |
| K5 | 抓包 G2：辅助端点（quota/fetchAvailableModels/fetchUserInfo/…）响应体二次 UTF-8 编码损坏 | 无法读到模型清单、配额明细，模型 slug 归因只能靠推断 |
| K6 | 单账号、单轮、纯首轮 `agy -p "hi"` | 未覆盖多轮 tool-call、401 刷新后重试、Claude 路径 |
| K7 | 插件侧 429 证据来自 10-16 的端点 A/B 与冷却快照，官方抓包是 11-16 | 两批证据相隔约 30 天，上游可能已变化；不能做严格同期对照 |
| K8 | 官方账号响应含 `paidTier`/credits（Google AI Pro），插件 5 账号层级未核对 | 无法排除“账号 entitlement”这一混杂因素 |
| K9 | 无任何“只改 UA”的隔离实验 | **无法证明服务端到底校验什么**；本报告所有“闸门=中/高”都是机制可能性，不是因果 |
| K10 | 抓包为文本 dump，header 顺序=写盘顺序 | 不能给字节级头序证据（通常无关） |

---

## 10. 脱敏声明

- 本文件只写 `Authorization` 的 **scheme（Bearer）**，不写任何 token 值；正文与附录均未包含完整凭据。
- 本文件对三类凭据前缀（OAuth access token / refresh token / JWT 三段式）做了自检，命中数 **0**；为避免把敏感字面量本身写进文档，自检命令里的前缀正则不在此复写（用占位符 `<credential-prefix-regex>` 表示）：

```bash
grep -cE '<credential-prefix-regex>' ops/relink/t2-contract-diff.md   # 预期：0
```

- 官方响应中的账号邮箱在抓包侧已打码，本文件不转写任何邮箱。
- 行数自检：`wc -l ops/relink/t2-contract-diff.md`（目标 250–450）。
