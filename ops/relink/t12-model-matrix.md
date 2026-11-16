# T12 — 模型 × daily 矩阵：默认聊天路径是否可用

- 任务：`task-12`；执行：`worker-fix`（静态侦察 + 实测均派给二级 subagent）
- 结论时间：2026-11-16 18:52 CST
- 产物：本文件 + [`t12-arm1.json`](./t12-arm1.json) + [`t12-counter.txt`](./t12-counter.txt)
- 预算：生成请求 **1/3 次**（臂 1 即 200，按"命中 200 即停"未跑臂 2/3）

---

## 0. 一句话结论

**用户默认聊天路径不会落到 daily 不支持的 slug。**
用户选 `antigravity/gemini-3.8-flash` + 默认 effort（high）时，wire slug = **`gemini-3.8-flash-high`**；该 slug 在 **daily 端点实测 200 + 非空 SSE（正文 `Hello! How can I help you today?`）**。因此**不需要任何模型侧对策**，T3 的 2 行端点补丁即为最终改动。

> 覆盖面声明（防止误读）：本轮**只实测了默认路径 `gemini-3.8-flash-high`**；`-tiered` / `-low` / `-medium` 未验证，仍列为残余风险（见 §3），**不写成已覆盖**。

---

## 1. 默认模型路径（静态，file:line）

| 环节 | 事实 | 来源 |
|---|---|---|
| 插件默认模型 | `defaultModel: ''`（空 = 不指定） | `packages/core/src/types/config-types.ts:109`；`src/common/types.ts:130` |
| 插件默认 effort | 代码默认 `''`；本机**运行时覆盖**为 `high` | `packages/core/src/types/config-types.ts:110`；`~/.dsh/agy-link/runtime-overrides.json`（`defaultEffort:"high"`，legacy state dir 由 `src/common/config.ts:16-27` 选中） |
| 用户未选该 provider 时 | DSH 默认 selection 是 `deepseek-official/deepseek-flash`，**插件不参与**；DSH 不会自动取 provider 的 `listModels[0]` | DSH `packages/bundle/base/cordis.patch.yml:90-94`；`packages/api/session-controller/src/index.ts:325-337`（recon 结论） |
| 用户选 `gemini-3.8-flash` 后 effort 解析 | `defaultEffortFor` 优先 high → reasoning.defaultEffort | `packages/core/src/models.ts:462-467`；`src/host/adapter.ts:159-170` |
| effort → wire slug | `gemini-3.8-flash` 的 routing：low→`-low`、medium→`-medium`、**high→`gemini-3.8-flash-high`** | `packages/core/src/models.ts:519-531`（high 行 :524） |
| 请求体 model | `getAntigravityRequestModelId(options.model, options.reasoningEffort)` 查 ANTIGRAVITY_ROUTING，`requestBody.model = wireModel` | `src/host/adapter.ts:199`、`src/host/adapter.ts:404-406`；`packages/core/src/models.ts:627-629` |
| 端点 | `POST {endpoint}/v1internal:streamGenerateContent?alt=sse` | `packages/core/src/client.ts:465` |

**默认路径 wire slug 优先级**（recon 排序，按用户实际选择概率）：

1. `gemini-3.8-flash-high`（默认 effort=high，**本轮已实测 200**）
2. `gemini-3.8-flash-tiered`（仅当会话残留旧 catalog 的 tiered 串；wire 原样透传，`models.ts:635,645`）
3. `gemini-3.8-flash-low/-medium`（用户把 effort 拨到 low/off/medium）

---

## 2. 实测矩阵（daily 端点）

| 臂 | slug | 端点 | status | bytes | SSE 帧 | 正文 | 耗时 | 生成请求 |
|---|---|---|---|---|---|---|---|---|
| 1 | `gemini-3.8-flash-high` | `https://daily-cloudcode-pa.googleapis.com` | **200** | 1734 | 2 | `Hello! How can I help you today?` | 8634 ms | 1 |
| 2 | `gemini-3.8-flash` | — | 未执行（臂 1 已 200，按规则停） | — | — | — | — | 0 |
| 3 | `gemini-3.5-flash` | — | 未执行 | — | — | — | — | 0 |

- 账号 `acc_1788785623927_xhs7n`、project `aicode-consumers`、插件原样请求形状（注入开关全 false）。
- 历史可用 slug 补充：`gemini-3.5-flash-lite`（T3 已证 200）。
- 请求计数：**1/3**；空 stderr；无重试/回退；token 未过期未刷新。

---

## 3. 结论：是否需要模型对策？

**不需要。** 理由：

1. 最可能的默认路径（`gemini-3.8-flash` + high → `gemini-3.8-flash-high`）在 daily 实测 200。
2. DSH 不会在用户没选插件时自动用插件的 `listModels[0]`；插件内置 fallback 顺序只影响 picker 展示（`config-types.ts:127-140`），不构成"自动落到不支持 slug"的路径。
3. 现有 wire slug 全部走同一端点；端点换成 daily 后，原本 production 返回的 429 消失（T3/gen#4 对照）。

**残余风险（未测，不升格为结论）**：
- `gemini-3.8-flash-tiered` 与 `-low/-medium` 未在 daily 实测；若用户切 effort 后失败，最可能就是这两种 slug。若需覆盖，最小对策优先级（recon 建议）：
  1. `client.ts:478-480` 让 429 继续尝试下一端点（daily 已在候选内），约 2-4 行；
  2. 把 `-tiered` 等历史串在 adapter 做 wire 白名单重映射（`models.ts:627-662`），约 10-15 行；
  3. 改内置 fallback 顺序无效（只影响 picker）。
- 上表"残余风险"未花预算验证；如果 Lead 认为必要，可在 T13 的 ≤2 次端到端预算里顺带打一发 `-low` 或 `-tiered`（非默认路径，优先级低于部署验证）。

---

## 4. 与 T3 补丁的关系

- T12 未改变最小改动结论：仍为 `ENDPOINT_FALLBACKS` daily-first（2 行，`ops/relink/t3-patch.diff`）。
- 无需新增默认模型常量、无需过滤 catalog、无需 adapter fallback。

## 5. 脱敏 / 约束

- 生成请求 1 次（登记于 `t12-counter.txt`）；未写 repo、未写 `~/.dsh`、未重启 host、未改 `/usr/bin/agy`。
- 脱敏扫描：本目录产物凭据前缀命中 0、邮箱命中 0。
