# T16 — 账号一致性：全部号池账号 × daily 真实生成

- 执行：`worker-fix`（执行由二级 subagent `t16-runner` / `t16b-runner` 完成）
- 时间：2026-11-16 20:24–20:29 CST（补测 20:29）
- 预算：上游生成 **4/4**（3 个账号各 1 次 + 补测第 5 个账号 1 次；全部无重试、无非 200）
- host 未重启（PID 2685153 / ActiveEnter 11:42:18 未变）
- 产物：本文件 + `t16-acc-{pqxkh,n0tdx,50yxc,5ptu4}.json` + [`t16-summary.json`](./t16-summary.json) + [`t16-counter.txt`](./t16-counter.txt)

---

## 0. 一句话结论

**5/5 个号池账号现在都有真实 daily 200 证据**：本轮实测 4 个（primary `pqxkh`、历史 fail 最多 `n0tdx`、`50yxc`、补测 `5ptu4`），加上前序任务已多次验证的 `xhs7n`，全部在 daily 端点 + 插件默认 body/headers 下返回 **200 + 非空 SSE**。

> **样本量如实声明**：每个账号在 daily 上只有 **1 次成功证据（n=1）**；`xhs7n` 除外（T3/T12/T13/T15 多次）。n=1 只证明"当下可用"，不代表长期稳定性或配额行为。

---

## 1. 方法（安装副本直连，非源码路径）

1. 安装副本 `~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js`，sha256 = `adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd`（= 已部署版本）；
2. **逐字节复制**为 `/tmp/relink-t16/dist-copy.mjs`（复制后 sha 不变），仅在末尾追加一行 `export { streamGenerateContent, ENDPOINT_FALLBACKS };`（T13 同法）；
3. 宿主依赖软链：`@deepseek-ai/dsh-llm` → installer `node_modules/…`；`@deepseek-ai/dsh-tools` → installer `packages/core/tools`；
4. `ENDPOINT_FALLBACKS[0] === 'https://daily-cloudcode-pa.googleapis.com'` 断言通过；调用
   `streamGenerateContent(token, body, timeout, undefined, undefined)` —— **不传 proxyUrl、不传 endpoints**（无 endpoint 覆盖）；
5. body/headers 为插件默认形状（零注入）：
   `{project:'aicode-consumers', model:'gemini-3.8-flash-high', request:{contents:[{role:'user',parts:[{text:'hi'}]}],generationConfig:{}}, requestType:'AGENT', userAgent:'ANTIGRAVITY', requestId:'agent/t16/<account>/1'}`；
6. 每账号 token 只读、发前校验 `token.expiry` 未过期；未 refresh。

---

## 2. 逐账号结果

| # | account | 角色 | status | bytes | `data:` 帧 | 正文片段 | 耗时 | 实际 endpoint |
|---|---|---|---|---|---|---|---|---|
| 1 | `acc_1792116942660_pqxkh` | primary | **200** | 1378 | 3 | `Hello` | 5119 ms | daily |
| 2 | `acc_1788868397749_n0tdx` | 历史 fail 最多（13） | **200** | 1830 | 2 | `Hello! How can I help you today?` | 45980 ms | daily |
| 3 | `acc_1788949635573_50yxc` | 抽检第 3 个 | **200** | 1909 | 3 | `Hello` | 21602 ms | daily |
| 4 | `acc_1788769443420_5ptu4` | 补测（原未测） | **200** | 1818 | 2 | `Hello! How can I help you today?` | 11106 ms | daily |
| — | `acc_1788785623927_xhs7n` | 前序任务已多次验证 | **200**（T3/T12/T13/T15，daily） | 1451–2064 | 2–4 | `Hello! How can I help you today?` | 3–12 s | daily |

补充观测（非阻断）：n0tdx 45.98 s、50yxc 21.6 s、5ptu4 11.1 s 才完成，均 200；daily 首 token 延迟在账号间差异较大，属性能观测，不是失败。

---

## 3. 判定

| 问题 | 回答 |
|---|---|
| 本轮 4 个账号是否都能用 | **4/4 是**（daily，200 + 非空 SSE，各 1 次即成功） |
| 5/5 账号在 daily 上是否都可用 | **5/5 有真实 daily 200 证据**：pqxkh / n0tdx / 50yxc / 5ptu4（本轮各 1 次）+ xhs7n（前序多次）。**其中每个账号 n=1，仅证明当下可用** |
| 是否发现非 200/错误体 | 无；因此没有错误体可记，也没有触发"停手"分支 |
| 是否需要代码/配置改动 | 不需要（本轮只做验证） |

---

## 4. 约束与局限（不升格）

1. 每个账号在 daily 上只有 **1 次短 prompt** 的成功证据（n=1）；`xhs7n` 多次。不代表长期稳定性、配额上限或高峰时段表现。
2. 未覆盖长上下文、工具调用、多轮、thinking 档位等场景。
3. 只测 **daily** 端点；production 已知 429（T3/T1），本轮未再测。
4. 账号可用性可能随上游配额/风控变化；本快照仅对应 2026-11-16 20:29 CST。
5. 未验证"插件 round-robin 选择账号 + 用户 GUI 聊天"整链（属 T14 用户侧验收清单）。

## 5. 脱敏

- `t16-*.json` / `t16-counter.txt` 三类凭据前缀（access-token / refresh-token / JWT）命中 **0**；邮箱命中 0；只记录 `Bearer ****`。
- token 全程未打印、未写入产物。
- 未写 repo 工作区、未改 `/usr/bin/agy`、未写 `/tmp/agy-fix`、未重启 host。
