# T15 — 关闭 T12 残余风险：effort 切换后的 wire slug × daily

- 执行：`worker-fix`（执行由二级 subagent `t15-runner` 完成）
- 时间：2026-11-16 20:13 CST
- 预算：上游生成 **2/2**（low 1 次、medium 1 次，各 1 次无重试；high 已在 T12 证过 200）
- 产物：本文件 + [`t15-arm1-low.json`](./t15-arm1-low.json) + [`t15-arm2-medium.json`](./t15-arm2-medium.json) + [`t15-counter.txt`](./t15-counter.txt)
- 约束：未写 repo、未改 `/usr/bin/agy`、未写 `/tmp/agy-fix`、未重启 host、token 只读、脱敏 0 命中

---

## 0. 一句话结论

**T12 残余风险已关闭（`gemini-3.8-flash` 家族）**：effort 可产生的三个 wire slug —— `gemini-3.8-flash-low`、`gemini-3.8-flash-medium`、`gemini-3.8-flash-high` —— 在 **daily 端点全部 200 + 合法 SSE**。`-tiered` 在当前代码路径与当前 catalog 下**不可达**，无需测试。**不需要任何 slug 重映射对策。**

---

## 1. 静态确认：effort → wire slug（file:line）

### 1.1 映射表（`gemini-3.8-flash`）

`packages/core/src/models.ts:519-531`：

| effort | wire slug | 行号 |
|---|---|---|
| `off` / `''` | `gemini-3.8-flash-low` | `:519`（`off:`） |
| `minimal` | `gemini-3.8-flash-low` | `:521` |
| `low` | `gemini-3.8-flash-low` | `:522` |
| `medium` | `gemini-3.8-flash-medium` | `:523` |
| `high` | `gemini-3.8-flash-high` | `:524` |
| `xhigh` | `gemini-3.8-flash-high` | `:525` |

解析函数 `getAntigravityRequestModelId(modelId, effort)`：`models.ts:627-663`
- effort 为空/`off` → `r.off ?? …`（`:648-649`）；
- 其它 effort → `r.routing[effortKey]`（`:652-654`；`xhigh` 由表项 `:525` 直接映射到 `-high`）；
- 调用点：`src/host/adapter.ts:199`（生成前 `wireModel = getAntigravityRequestModelId(options.model, options.reasoningEffort)`）。

### 1.2 `-tiered` 是否可达

| 检查 | 结论 | 依据 |
|---|---|---|
| effort 映射会产生 `-tiered` 吗 | **不会**：表内没有 tiered 值 | `models.ts:519-531` |
| 若用户直接选到 `xxx-tiered` 呢 | 会原样透传（`isWireModel` 分支命中，最后 `return resolvedId`） | `models.ts:631-637`、`:647` |
| 当前 catalog 里有 tiered 吗 | **没有**：live `/catalog`（discovered，16 模型）无任何 `-tiered` id | 实测 `GET :3080/plugins/cloudcode-link/catalog` |
| 结论 | **当前不可达**（UI 选不到、effort 产不出） | 以上三条 |

> 未来条件风险（如实标注，不当作现状）：若上游 quota 以后重新广告 `gemini-3.8-flash-tiered`，它会进入 discovered catalog 并可被用户直接选中、原样发往上游；届时应按本文方法补测该 slug。

---

## 2. 实测矩阵（daily + 账号 `acc_1788785623927_xhs7n` + 插件默认 body/headers）

条件：`endpoint=https://daily-cloudcode-pa.googleapis.com`、`project=aicode-consumers`、`PROBE_MODEL` 直接给 wire slug、**未设任何 UA/header/clientMetadata/patch 注入**（probe `injection` 全 false）。

| 臂 | wire slug | 可达来源 | status | contentType | bytes | SSE 帧 | 正文片段 | 耗时 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `gemini-3.8-flash-low` | effort = off / minimal / low | **200** | `text/event-stream` | 1530 | 2 | `Hello! How can I help you today?` | 12092 ms | `t15-arm1-low.json` |
| 2 | `gemini-3.8-flash-medium` | effort = medium | **200** | `text/event-stream` | 2064 | 3 | `Hello! How can I help you today?` | 5926 ms | `t15-arm2-medium.json` |
| — | `gemini-3.8-flash-high` | effort = high / xhigh | **200** | `text/event-stream` | 1734 | 2 | `Hello! How can I help you today?` | 8634 ms | T12 `t12-arm1.json`（前序已验证） |

- 两臂均**未发生重试/failover**；`PROBE_ENDPOINTS` 单端点。
- 请求计数：`t15-counter.txt`（arm=1/2 各 1 次，累计 2/2）。
- token：发前校验未过期（`expiresInSeconds=3148`），未 refresh。

---

## 3. 结论表

| slug | 是否可达 | daily 状态码 | 判定 |
|---|---|---|---|
| `gemini-3.8-flash-low` | 是（off/minimal/low） | **200** | ✅ 可用 |
| `gemini-3.8-flash-medium` | 是（medium） | **200** | ✅ 可用 |
| `gemini-3.8-flash-high` | 是（high/xhigh） | **200**（T12） | ✅ 可用 |
| `gemini-3.8-flash-tiered` | **否**（catalog 无、effort 不产生） | 未测（不可达） | ⏸ 排除 |
| `gemini-3.8-flash-extra-low` / `-thinking` | 否（3.8 家族映射不产生；wire 分支虽可透传但 catalog 无此 id） | 未测（不可达） | ⏸ 排除 |

**是否需要最小对策：不需要**——没有出现 404/429，因此无 slug 重映射改动。T12 的"未验证 slug"风险对 `gemini-3.8-flash` 家族已闭环。

---

## 4. 未覆盖范围（不升格为已证）

1. 只测了 **daily 端点**、**单个账号**（xhs7n）、**单轮短 prompt**。
2. 只覆盖 **`gemini-3.8-flash` 家族**；其它家族（`gemini-3.7-flash`、`gemini-3.6-flash`、`gemini-3.5-flash`、`gemini-3.1-pro`、claude/gpt-oss）的 effort 路由未实测——若用户选那些模型，其 wire slug 仍属未验证（`models.ts:532-570` 有各自映射）。
3. `-tiered` 的"不可达"是**当前 catalog 快照**结论；上游若变更模型清单需复测（见 §1.2 条件风险）。
4. probe 只保存 `firstText` 前 200 字符与帧数，未持久化原始 SSE 帧（与 T3/T12 同口径）。

## 5. 脱敏

- `t15-*.json` / `t15-counter.txt` 三类凭据前缀（access-token / refresh-token / JWT）命中 **0**；邮箱命中 0。
- token 全程未打印（仅 `Bearer ****`）。
