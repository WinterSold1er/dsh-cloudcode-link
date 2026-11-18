# T2 二进制静态分析结论：`/usr/bin/agy`（Antigravity CLI v1.3.5）

- 目标：`/usr/bin/agy`，ELF64 x86-64 PIE，Go，215,060,688 B，`root:root`，`stripped`，BuildID `4e4b3429007879fa6551bc3e1fd040e3`
- 执行者：`worker-contract/t2-binary`（只读分析，未运行 `/usr/bin/agy`，未改二进制，未重启 host）
- 所有偏移均为**文件偏移**（`.rodata`/`.noptrdata`/`.text` 三段的 vaddr == file offset，已用 `readelf -SW` 核对）
- 方法：`readelf -S/ -n`、`strings -a -n 6 -t x`、自写 Go `pclntab` 解析器恢复被 strip 的函数名（159,657 个）、自写 RIP-relative xref 扫描器（向量化，覆盖 4 字节对齐全偏移）、`objdump -d --start-address/--stop-address` 定点反汇编。脚本在 `ops/relink/t2-scratch/`（`parse_pclntab.py`、`xref3.py`、`annotate.py`、`trace.py`）。

> 去符号表后仍可从 `.lrodata` 起始处的 Go pclntab（magic `f1 ff ff ff 00 00 01 08`，文件偏移 `0x14922e0`）恢复函数名；
> `.text` 真实基址不是段首 `0x5e2e000`，而是 `0x5e2e080`（用 2 万个函数的 Go 序言命中率判定：`0x5e2e080` 命中 14798/20000，`0x5e2e000` 仅 3191/20000）。

---

## 1. 结论表

| # | 字段 | 值 | 证据命令 | 命中行号/偏移 | 置信度 |
|---|---|---|---|---|---|
| 1 | 应用版本常量 | `1.3.5`（全二进制**仅 1 处**） | `python3 -c` 计数 + `dd ... \| xxd` | 文件偏移 `0xabeb833`（`.noptrdata`），上下文 `"CORE\0" "1.3.5\nDate: \0"` | 已证 |
| 2 | Go 工具链版本 | `go1.28-20260921-RC02 cl/985595000 +644cd61a4a X:fieldtrack,boringcrypto,simd` | `dd if=/usr/bin/agy bs=1 skip=$((0xabeb160)) count=512 \| strings -a` | `0xabeb160` 起 `.go.buildinfo`（段 size 仅 `0x70`） | 已证 |
| 3 | Go 工具链 CL vs 应用 CL | 工具链 `cl/985595000`；应用 CL `998863838`（16 处） | `python3` 计数 | `998863838` 首处 `0x5bad918`；`"changelist 998863838 with baseline 998863838 in a mint client based on //depot/google3"` @ `0x5e26990` | 已证（两者是不同 CL，勿混用） |
| 4 | ELF note / 构建 | `GNU ABI: Linux 3.2.0`；BuildID `4e4b3429…`；入口 `0x5e2e000` | `readelf -n /usr/bin/agy` | `.note.ABI-tag`、`.note.gnu.build-id` | 已证 |
| 5 | UA 构造函数 | `codeassistclient.UserAgent` | `grep codeassistclient.UserAgent funcs.txt` + `objdump` | 函数 `0x7a371c0`–`0x7a37ce0` | 已证 |
| 6 | UA 参数格式串 | `"os_type=%s"`(10) `"arch=%s"`(7) `"cl=%d"`(5) `"auth_method=%s"`(14) | xref → `objdump -d --start-address=0x7a371c0` | `0x5274879`、`0x522f31b`、`0x5210968`、`0x52d61bb`；引用点 `0x7a372a5` / `0x7a372f3` / `0x7a3742e` / `0x7a37520` | 已证 |
| 7 | UA 字面片段 | `"antigravity"`(11) `"aidev_client"`(12) 分隔符 `"; "`(2) | 同上 | `0x528ddf8`（`0x7a37227` 作默认值）、`0x52a831a`（`0x7a3739d`）、`0x51fd70c`（`0x7a37ab8` 传给 `strings.Join`） | 已证 |
| 8 | UA 最终组装 | 两分支：`fmt.Sprintf("%s/%s/%s (%s)", …)`(13) 与 `fmt.Sprintf("%s/%s (%s)", …)`(10)；括号内 = `strings.Join(parts, "; ")` | 反汇编 | 格式串 `0x52bfb64`@`0x7a37bb1`（4 参，`$0xd`，`0x7a37bcc`）、`0x527488d`@`0x7a37c6a`（3 参，`$0xa`，`0x7a37c85`）；`strings.Join` @`0x7a37ac4`，分隔符 len=`$0x2` | 结构已证；三段具体取值=推断 |
| 9 | UA 参数 append 顺序 | `os_type → arch → cl → auth_method`（外加 `%s/%s`、`host_path=%s`、`proxy_client=%s`、`purpose=%s` 等可选段） | `trace.py` 逐 `fmt.Sprintf` 调用点 | `0x7a372c0`/`0x7a3730e`/`0x7a37449`/`0x7a37540`/`0x7a37709`/`0x7a377d7`/`0x7a378f7`/`0x7a37a10` | 已证 |
| 10 | `cl=` 数值来源 | 字符串经 `strconv.Atoi` 转 int 再 `%d`（`runtime.convT64`） | `objdump` | `0x7a373e2 call strconv.Atoi`、`0x7a37412 call runtime.convT64` | 已证 |
| 11 | 生成请求 path | `v1internal:streamGenerateContent`（1 处）；另有 `v1internal:generateContent`、`:loadCodeAssist`、`:onboardUser`、`:retrieveUserQuota`、`:countTokens`、`:fetchAvailableModels` 等 60+ 条 | `python3` 正则计数 | `0x563a09b`（`streamGenerateContent`）；`:generateContent` @`0x5639fb0` | 字面量已证；具体调用点=缺口 |
| 12 | 查询参数 | `alt=sse`（2 处） | 同上 | `0x5407d0f` | 已证（字面量）；拼接点=缺口 |
| 13 | Host 清单 | `cloudcode-pa.googleapis.com`(4)、`daily-cloudcode-pa.googleapis.com`(1)、`autopush-cloudcode-pa.sandbox.googleapis.com`(1)、`preprod-daily-cloudcode-pa.sandbox.googleapis.com`(1)；**无** `sandbox-cloudcode` 独立串 | 正则 `[a-z0-9.-]*cloudcode[a-z0-9.-]*` | `0x53f70b9`、`0x541dc4c` 等 | 已证（字面量） |
| 14 | Endpoint 拼装 | `constructCodeAssistEndpoint` → `fmt.Sprintf("%s/%s:%s", …)`（8 字节格式串，3 参）；`constructResourceURL` → `fmt.Sprintf("%s/%s/%s", …)` | `objdump` 两函数 | 格式串 `0x524547c`@`0x7a36940+`；`0x5245484`@`0x7a36ca0+` | 已证 |
| 15 | Header（`setHeaders`） | `"User-Agent"` → `UserAgent()` 返回值；`"X-Goog-Request-Reason"`；`"Content-Type"` → `"application/json"` | `objdump -d --start-address=0x7a37ce0 --stop-address=0x7a380e0` | `User-Agent` `0x5274757` @`0x7a37da4`（`$0xa`）；`call 0x7a371c0` @`0x7a37d83`；`X-Goog-Request-Reason` `0x535527b`@`0x7a37ee5`；`Content-Type` `0x52a7b76`@`0x7a37fd2`；`application/json` `0x52fd8d9`@`0x7a38018` | 已证 |
| 16 | `x-goog-api-client` | **键在**（1 处）；值=运行时拼接 | `strings`/计数 | `0x5312e87`，小写形式；引用点含 `codeassistclient.map.init.2+0x131`（`0x7a15b91`）、`genai.appendSDKHeaders` | 键已证；值=缺口 |
| 17 | `x-client-version` | **不存在**（0 处） | `grep -c` / `python3 count` | — | 已证（缺失） |
| 18 | `client-metadata` | 仅 `client-metadata.json`（文件名，1 处），**不是 HTTP 头** | 计数 + 上下文 | `0x54578ff` | 已证 |
| 19 | `x-cloudaicompanion*` | 实际串为 `x-cloudaicompanion-trace-id`（1 处），非 `x-cloudaicompanion` | 计数 + 上下文 | `0x53ae04a` | 已证 |
| 20 | 其它确认存在的头 | `x-goog-user-project`(2)、`x-goog-api-key`(1) | 计数 | `0x533465c`、`0x52d7b8b` | 键已证；值=缺口 |
| 21 | Body JSON tag | 存在：`json:"model"`(3)、`json:"request"`(1)、`json:"requestId"`(2)、`json:"userAgent"`(1)、`json:"project"`(1)、`json:"contents"`(1)、`json:"sessionId"`(1)、`json:"metadata"`(2)、`json:"tools"`(1) | 计数 | 见证据片段 §2.6 | 已证 |
| 22 | Body JSON tag（缺失） | **无** `json:"generationConfig"`、`json:"systemInstruction"`、`json:"labels"`、`json:"requestType"`（`requestType` 仅作为标识符出现 10 次，非 tag） | 计数 | — | 已证（缺失） |
| 23 | model 取值 | `gemini-4-argon`、`gemini-4-argon-high`、`gemini-4-argon-medium`、`gemini-4-argon-low`；以及 `gemini-3*` 系列与 `Gemini 3.5 Flash (High)` 等 display name | 正则 `gemini-4-[a-z0-9-]+` | `0x52d614b` 等 | 已证；**`gemini-4-hydrogen-medium` 不存在（推翻假设）** |
| 24 | project 相关字段 | `cloudaicompanionProject`(11)、`duetProject`(2)、`pluginType`(2)、`ideType`(4)、`GOOGLE_CLOUD_PROJECT`(1)、path `v1internal:listCloudAICompanionProjects`(1) | 计数 | `0x56e8747`、`0x56e907c`、`0x56e90e0`、`0x5683562`、`0x534497e` | 字段名已证 |
| 25 | `aicode-consumers` 回退常量 | **不存在**（0 处） | 计数 | — | 已证（缺失）→ 假设中"响应 project=aicode-consumers"不能由本二进制字面量支持 |
| 26 | token 本地文件名 | 由 `fmt.Sprintf("antigravity-%s", …)` 构造；`antigravity-oauth-token` 字面量**不存在** | 计数 | 格式串 `0x52d622b`；`antigravity-oauth-token` count=0 | 构造方式已证；具体后缀=缺口 |
| 27 | `auth_method` 取值 | 候选字面量：`personal_consumer`(1)、`gemini_api_key`(4)、`consumer`(55，多义) | 计数 | — | 缺口（值运行时决定） |

---

## 2. 原始证据片段（脱敏）

### 2.1 版本与构建

```
$ readelf -n /usr/bin/agy
  Build ID: 4e4b3429007879fa6551bc3e1fd040e3
$ dd if=/usr/bin/agy bs=1 skip=$((0xabeb160)) count=512 | strings -a
 Go buildinf:
Lgo1.28-20260921-RC02 cl/985595000 +644cd61a4a X:fieldtrack,boringcrypto,simd
$ python3 -c "...d.count(b'1.3.5')..."      -> n=1  off=0xabeb833
$ dd if=/usr/bin/agy bs=1 skip=$((0xabeb800)) count=112 | xxd
  ... "data:CORE\0" "1.3.5\nDate: \0\0" ...      # .noptrdata
```

### 2.2 UA 构造（反汇编节选，`objdump -d --start-address=0x7a371c0 --stop-address=0x7a37ce0`）

```
7a37222  mov   $0xb,%ecx              ; len 11
7a37227  lea   0x528ddf8              ; "antigravity"
7a37246  call  metadata_provider.SafeGetMetadata
7a372a5  lea   0x5274879              ; "os_type=%s"
7a372ac  mov   $0xa,%ebx              ; len 10
7a372c0  call  fmt.Sprintf
7a372f3  lea   0x522f31b              ; "arch=%s"
7a372fa  mov   $0x7,%ebx
7a3730e  call  fmt.Sprintf
7a3739d  lea   0x52a831a              ; "aidev_client"
7a373e2  call  strconv.Atoi
7a37412  call  runtime.convT64
7a3742e  lea   0x5210968              ; "cl=%d"
7a37435  mov   $0x5,%ebx
7a37449  call  fmt.Sprintf
7a37520  lea   0x52d61bb              ; "auth_method=%s"
7a37527  mov   $0xe,%ebx
7a37540  call  fmt.Sprintf
...
7a37ab8  lea   0x51fd70c              ; "; "
7a37abf  mov   $0x2,%esi
7a37ac4  call  strings.Join
7a37bb1  lea   0x52bfb64              ; "%s/%s/%s (%s)"
7a37bb8  mov   $0xd,%ebx
7a37bc5  mov   $0x4,%edi              ; 4 个参数
7a37bcc  call  fmt.Sprintf
7a37c6a  lea   0x527488d              ; "%s/%s (%s)"
7a37c71  mov   $0xa,%ebx
7a37c7e  mov   $0x3,%edi              ; 3 个参数
7a37c85  call  fmt.Sprintf
```

推导：`params := strings.Join([]string{"aidev_client", "os_type=<GOOS>", "arch=<GOARCH>", "cl=<998863838>", "auth_method=<…>"}, "; ")`，
`UA := fmt.Sprintf("%s/%s/%s (%s)", <name>, <product>, <version>, params)` 或 `fmt.Sprintf("%s/%s (%s)", <name>, <version>, params)`。
即形状为 `antigravity/<x>/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=…)`。
`aidev_client` 是**独立字面量**（len 12），`antigravity` 是**独立字面量**（len 11，且是空值时的默认值，见 `0x7a37217/0x7a37222` 分支）。

### 2.3 setHeaders（`0x7a37ce0`–`0x7a380e0`）

```
7a37d83  call  0x7a371c0             ; UserAgent(...)
7a37da4  lea   0x5274757             ; "User-Agent"
7a37dab  mov   $0xa,%ebx             ; len 10
7a37db0  call  0x6282b40             ; (*http.Header).Set 语义
...
7a37ee5  lea   0x535527b             ; "X-Goog-Request-Reason"
7a37fd2  lea   0x52a7b76             ; "Content-Type"
7a38018  lea   0x52fd8d9             ; "application/json"
```

### 2.4 头键存在性（对 `/usr/bin/agy` 的直接计数命令）

```bash
python3 - <<'EOF'
d=open('/usr/bin/agy','rb').read()
for k in ['x-goog-api-client','x-client-version','client-metadata','x-cloudaicompanion',
          'x-goog-user-project','x-goog-api-key','x-goog-request-reason']:
    print(k, d.count(k.encode()))
EOF
# x-goog-api-client 1 | x-client-version 0 | client-metadata 1 | x-cloudaicompanion 1
# x-goog-user-project 2 | x-goog-api-key 1 | x-goog-request-reason 0（大小写：二进制用 "X-Goog-Request-Reason"）
```

### 2.5 端点字面量

```bash
python3 - <<'EOF'
import re,collections
d=open('/usr/bin/agy','rb').read()
print(collections.Counter(m.group(0) for m in re.finditer(rb'[a-z0-9.\-]*cloudcode[a-z0-9.\-]*',d)))
print(collections.Counter(m.group(0) for m in re.finditer(rb'v1internal:[A-Za-z]+',d)))
EOF
# hosts: cloudcode-pa.googleapis.com, daily-cloudcode-pa.googleapis.com,
#        autopush-cloudcode-pa.sandbox.googleapis.com, preprod-daily-cloudcode-pa.sandbox.googleapis.com
# paths: v1internal:streamGenerateContent / :generateContent / :loadCodeAssist / :onboardUser /
#        :retrieveUserQuota / :countTokens / :fetchAvailableModels / :listCloudAICompanionProjects ...
```

### 2.6 Body 结构（`json:"…"` tag 计数）

```
json:"model" 3 | json:"request" 1 | json:"requestId" 2 | json:"userAgent" 1 | json:"project" 1
json:"contents" 1 | json:"sessionId" 1 | json:"metadata" 2 | json:"tools" 1
json:"generationConfig" 0 | json:"systemInstruction" 0 | json:"labels" 0 | json:"requestType" 0
```

### 2.7 project / 配置

```
cloudaicompanionProject 11 | duetProject 2 | pluginType 2 | ideType 4
GOOGLE_CLOUD_PROJECT 1     | aicode-consumers 0
v1internal:listCloudAICompanionProjects 1 | v1internal:onboardUser 1
```

### 2.8 model 取值

```
gemini-4-argon / gemini-4-argon-high / gemini-4-argon-medium / gemini-4-argon-low
（另见 gemini-3-flash-preview、gemini-3-pro-image、display "Gemini 3.5 Flash (High)" 等；
  未出现 gemini-4-hydrogen-medium）
```

---

## 3. 未确认项 / 缺口清单

1. **UA 三段的具体取值**：`"%s/%s/%s"` 的第 2、3 段在 `UserAgent` 内来自运行期（间接接口调用 / client 字段 `0xf8/0x100`），未定位到字面量；`cli` 这一段的字符串**未直接命中**（`antigravity/cli` 作为整体串 count=0），因此 `antigravity/cli/1.3.5` 只能算**推断**。第 1 段默认值 `"antigravity"` 已证。
2. **`x-goog-api-client` 的值**：键已证（`0x5312e87`），值在 `genai.appendSDKHeaders` / `codeassistclient.map.init.2` 中运行期拼接，未解出完整格式串。
3. **端点调用点**：`v1internal:streamGenerateContent`、`alt=sse`、两个 host 串**没有直接的 RIP-relative lea 引用**（PIE 下经 `.data.rel.ro` 字符串头 + RELA 重定位间接引用，磁盘数据里的指针为 0/重定位占位），本次时间盒内未解析 `.rela.dyn`，故"哪个函数用哪个 host + 如何拼 `alt=sse`"属缺口。
4. **`cloudaicompanionProject` 的读写点**：字段名已证，但 `loadCodeAssist` 响应解析处、以及 project 回退逻辑（是否用 `GOOGLE_CLOUD_PROJECT` / `duetProject` / 硬编码）未定位；`aicode-consumers` 在本二进制中不存在。
5. **`auth_method` 的实际取值**：候选字面量存在（`personal_consumer`、`gemini_api_key`），但 UserAgent 里该值由接口/配置决定，未确证为 `consumer`。
6. **body 顶层完整结构**：只有 JSON tag 存在性证据，未恢复出 `CodeAssistRequest` 的字段顺序与嵌套（`request` 内层 `contents/model/generationConfig/systemInstruction` 的归属）。
7. 未使用另一会话产物（`/tmp/agy-fix/gate2/flow.txt`、`func.txt`）；本报告结论全部可由上述对 `/usr/bin/agy` 的直接命令复现。

---

## 4. 总结（200–300 字）

静态证据支持"CLI 用固定 UA 模板 + 运行期参数拼接"的判断：`codeassistclient.UserAgent`（`0x7a371c0`）里依次 `fmt.Sprintf("os_type=%s")`、`("arch=%s")`、`("cl=%d")`、`("auth_method=%s")`，并用字面量 `aidev_client` 与分隔符 `"; "` 经 `strings.Join` 合成括号段，最后走 `"%s/%s/%s (%s)"` 或 `"%s/%s (%s)"` 两条路径；`antigravity`（11 字节）是空值默认段。头方面 `setHeaders` 只硬编码 `User-Agent`、`X-Goog-Request-Reason`、`Content-Type: application/json`；`x-goog-api-client` 键存在但值在 `appendSDKHeaders`/map init 中拼接，`x-client-version` 完全不存在，`client-metadata` 只是本地文件名 `client-metadata.json`，`x-cloudaicompanion` 实为 `x-cloudaicompanion-trace-id`。两条原假设被推翻：`gemini-4-hydrogen-medium` 与 `aicode-consumers` 在二进制中均不存在（实际 model 家族是 `gemini-4-argon{,-high,-medium,-low}`）。

最关键的三条命令：
1. `python3 ops/relink/t2-scratch/parse_pclntab.py > funcs.txt && grep -n 'codeassistclient.UserAgent' funcs.txt`（去符号后恢复函数名，得到 `0x7a371c0`）
2. `objdump -d --start-address=0x7a371c0 --stop-address=0x7a37ce0 --no-show-raw-insn /usr/bin/agy`（UA 格式串与 `cl=%d`/`auth_method=%s` 的 lea 证据）
3. `objdump -d --start-address=0x7a37ce0 --stop-address=0x7a380e0 --no-show-raw-insn /usr/bin/agy`（`User-Agent` / `X-Goog-Request-Reason` / `Content-Type: application/json` 三元组与 `call 0x7a371c0`）
