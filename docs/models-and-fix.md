# 上游模型清单梳理与模型及配额修复实施报告

> **报告编号**：MF-20261016-01  
> **实施人员**：analyzer (静态与根因分析专家)  
> **日期**：2026-10-16  
> **涉及代码库**：`dsh-cloudcode-link` 及核心子模块 `packages/core`

---

## 一、上游 Google Cloud Code PA 当前模型清单梳理

基于现场捕获的生产环境（`cloudcode-pa.googleapis.com`）与日常金丝雀环境（`daily-cloudcode-pa.googleapis.com`）的真实 API 响应（`v1internal:fetchAvailableModels`），我们对当前上游提供的全部模型进行了系统梳理与对比。

### 1. 完整公共模型清单（21 个模型）

Google 上游共返回 25 个模型条目，其中 4 个为内部代码补全及预览模型（`chat_20706`、`chat_23310`、`tab_flash_lite_preview`、`tab_jump_flash_lite_preview`），通过 `isInternalModel()` 自动过滤排除。其余 21 个对用户开放的公共模型清单如下：

| 模型 Slug | 上游 Display Name | 归属家族 | 特性与 Reasoning/Thinking 支持 | 最大输出 Tokens | 模态支持 |
|---|---|---|---|---|---|
| `gemini-3.8-flash-tiered` | (自动推导 Gemini 3.8 Flash) | `google` | 支持三档思考级别 (`LOW`, `MEDIUM`, `HIGH`) | 65,536 | 文本 / 图像 |
| `gemini-3.6-flash-high` | Gemini 3.6 Flash (High) | `google` | 预设高思考级别 (`HIGH`) | 65,536 | 文本 / 图像 |
| `gemini-3.6-flash-medium` | Gemini 3.6 Flash (Medium) | `google` | 预设中思考级别 (`MEDIUM`) | 65,536 | 文本 / 图像 |
| `gemini-3.6-flash-low` | Gemini 3.6 Flash (Low) | `google` | 预设低思考级别 (`LOW`) | 65,536 | 文本 / 图像 |
| `gemini-3.5-flash-low` | Gemini 3.5 Flash (Medium) | `google` | 支持 Token Budget 思考调节 | 65,536 | 文本 / 图像 |
| `gemini-3.5-flash-extra-low` | Gemini 3.5 Flash (Low) | `google` | 支持极低思考消耗 | 65,536 | 文本 / 图像 |
| `gemini-3-flash-agent` | Gemini 3.5 Flash (High) | `google` | Agent 专用高思考版本 | 65,536 | 文本 / 图像 |
| `gemini-3-flash` | Gemini 3 Flash | `google` | 标准 Flash 架构，支持 thinkingLevel 调节 | 65,536 | 文本 / 图像 |
| `gemini-3.1-pro-high` | Gemini 3.1 Pro (High) | `google` | 强推理高思考版本 (Budget 10001) | 65,535 | 文本 / 图像 |
| `gemini-3.1-pro-low` | Gemini 3.1 Pro (Low) | `google` | 强推理低思考版本 (Budget 1001) | 65,535 | 文本 / 图像 |
| `gemini-pro-agent` | Gemini 3.1 Pro (High) | `google` | 强推理 Agent 专版 | 65,535 | 文本 / 图像 |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | `google` | 极速轻量 Flash 模型 | 65,536 | 文本 / 图像 |
| `gemini-3.1-flash-image` | Gemini 3.1 Flash Image | `google` | 图像多模态优化模型 | 65,536 | 文本 / 图像 |
| `gemini-2.5-pro` | Gemini 2.5 Pro | `google` | 经典上一代旗舰 Pro 模型 | 65,535 | 文本 / 图像 |
| `gemini-2.5-flash` | Gemini 3.5 Flash Lite | `google` | 经典上一代 Flash 模型 | 65,536 | 文本 / 图像 |
| `gemini-2.5-flash-lite` | Gemini 3.5 Flash Lite | `google` | 经典极速轻量模型 | 65,536 | 文本 / 图像 |
| `gemini-2.5-flash-thinking` | Gemini 3.5 Flash Lite | `google` | 思考优化试验模型 | 65,536 | 文本 / 图像 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | `anthropic` | 原生 Thinking (Max 64k) | 64,000 | 文本 / 图像 |
| `claude-opus-4-6-thinking`| Claude Opus 4.6 (Thinking) | `anthropic` | 原生 Thinking (Max 64k) | 64,000 | 文本 / 图像 |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | `openai` | 开源大权重推理模型 | 32,768 | 纯文本 |

---

## 二、模型定义与目录配置更新

针对梳理结果，我们在核心库及主插件中全面扩展并对齐了兜底模型目录及模型元数据配置：

1. **兜底模型目录扩展 (`DEFAULT_FALLBACK_MODELS`)**：
   - 文件：`packages/core/src/types/config-types.ts` 和 `src/common/types.ts`
   - 新增并保留了上游活跃主力模型：
     - `gemini-3-flash` (Gemini 3 Flash)
     - `gemini-2.5-pro` (Gemini 2.5 Pro)
     - `gemini-2.5-flash` (Gemini 2.5 Flash)
     - `gemini-3.1-flash-lite` (Gemini 3.1 Flash Lite)
   - 现行兜底模型完整包含：
     - `gemini-3.8-flash` (`low`, `medium`, `high`)
     - `gemini-3.7-flash` (`low`, `medium`, `high`，保持向前兼容)
     - `gemini-3.6-flash` (`low`, `medium`, `high`)
     - `gemini-3.5-flash` (`low`, `medium`, `high`)
     - `gemini-3.1-pro` (`low`, `high`)
     - `gemini-3-flash`
     - `gemini-2.5-pro`
     - `gemini-2.5-flash`
     - `gemini-3.1-flash-lite`
     - `claude-sonnet-4-6`
     - `claude-opus-4-6-thinking`
     - `gpt-oss-120b-medium`

2. **最大输出 Token 显式注册 (`RUNTIME_MAX_OUTPUT_TOKENS`)**：
   - 文件：`packages/core/src/models.ts`
   - 补充登记：
     - `'gemini-3-flash': 65536`
     - `'gemini-2.5-pro': 65535`
     - `'gemini-2.5-flash': 65536`
     - `'gemini-2.5-flash-lite': 65536`
     - `'gemini-2.5-flash-thinking': 65536`
     - `'gemini-3.1-flash-lite': 65536`
     - `'gemini-3.1-flash-image': 65536`

---

## 三、5H 额度两大根因修复实施

### 修复 1：重构 `mergeFallbackFamilyQuota` 消除反向阻断
* **文件**：`packages/core/src/quota.ts:19-27`
* **原逻辑问题**：
  原代码为 `if (prev && typeof prev.remainingFraction === 'number') return prev`。当上游摘要接口未返回 Gemini 组进入单模型兜底时，若本地账号之前存过旧额度，直接返回旧对象，把上游实时抓取到的最新额度与未来重置时间全部丢弃。
* **重构后逻辑**：
  ```typescript
  export function mergeFallbackFamilyQuota(
    prev: FamilyQuotaInfo | undefined,
    fallback: FamilyQuotaInfo,
  ): FamilyQuotaInfo {
    if (!prev) return fallback
    return {
      ...prev,
      remainingFraction: fallback.remainingFraction ?? prev.remainingFraction,
      resetTime: fallback.resetTime ?? prev.resetTime,
      updatedAt: fallback.updatedAt ?? Date.now(),
    }
  }
  ```
  **效果**：既保留了 `prev` 中特有的历史周额度（`weeklyFraction`, `weeklyResetTime`）与描述信息，又确保 5H 额度（`remainingFraction`）、重置时间戳（`resetTime`）及刷新时间（`updatedAt`）始终被最新鲜的数据覆盖。

### 修复 2：单模型遍历中的短路判断修复
* **文件**：`packages/core/src/quota.ts:530`
* **原逻辑问题**：
  循环处理单模型时，原判断为 `else if (familyQuotas[fam]!.remainingFraction === undefined)`。由于第一个模型就已经赋予了数字，导致后续所有 Gemini 模型都被短路跳过，无法对比出家族内的最低余量。
* **重构后逻辑**：
  引入 `summaryFamilies` 集合追踪。当该家族未出现在 `summary` 中时，允许循环持续对比模型级余量：
  ```typescript
  else if (!summaryFamilies.has(fam) || familyQuotas[fam]!.remainingFraction === undefined) {
    const curRemaining = familyQuotas[fam]!.remainingFraction ?? 1
    if (remaining < curRemaining) {
      familyQuotas[fam]!.remainingFraction = remaining
      familyQuotas[fam]!.resetTime = resetTime
    }
    // ...
  }
  ```

### 修复 3：`summaryOnly` 模式下的 Google 盲区防御
* **文件**：`packages/core/src/quota.ts:440`
* **改动**：在轻量刷新模式下，若 `retrieveUserQuotaSummary` 返回的 groups 中不包含 Google 组，主动触发 `fetchAvailableModels` 兜底，保证在会话启动前的轻量刷新中 Google 额度也能同步更新。

### 修复 4：上游端点优先级校正（稳定生产优先）
* **涉及文件**：
  - `packages/core/src/oauth.ts:38` (`AGY_ENDPOINTS`)
  - `packages/core/src/client.ts:6` (`DEFAULT_ENDPOINT`, `ENDPOINT_FALLBACKS`)
  - `packages/core/src/types/config-types.ts:120` (`DEFAULT_ENDPOINT_CANDIDATES`)
  - `src/common/types.ts:105` (`DEFAULT_ENDPOINT_CANDIDATES`)
* **改动**：统一将现网稳定端点 `https://cloudcode-pa.googleapis.com` 调整为第一首选项，日常灰度端点 `https://daily-cloudcode-pa.googleapis.com` 降级为备选项。

---

## 四、编译与测试验证

### 1. 自动化测试验证
* **测试用例修复与更新**：
  - `packages/core/test/quota.test.ts` & `test/quota.test.ts`：更新 `mergeFallbackFamilyQuota` 测试用例，严格断言其保留周额度的同时更新 5H 额度与重置时间。
  - `packages/core/test/models.test.ts` & `test/models.test.ts`：扩展断言，验证新增模型存在性及 `DEFAULT_FALLBACK_MODELS` 长度。
* **执行结果**：
  - `pnpm -C packages/core check && pnpm -C packages/core test`：**通过，0 错误，0 失败**。
  - `pnpm check && pnpm test`：**通过，0 错误，0 失败**。
  - `pnpm -C packages/core build && pnpm build`：**打包构建完全成功，生成最新 dist/**。

### 2. 本机真实账号刷新现场验证
使用修改后的代码对真实账号 `acc_1788785623927_xhs7n` 进行实测刷新：
* **刷新前（昨日旧数据）**：
  - `remainingFraction`: `0.2681512` (27%)
  - `resetTime`: `'2026-10-15T12:07:40Z'` (已过期，导致 UI 隐藏倒计时)
  - `updatedAt`: `1792057950309`
* **刷新后（现场实测结果）**：
  - `remainingFraction`: **`1.0` (100% 成功同步实时额度)**
  - `resetTime`: **`'2026-10-16T08:49:25Z'` (未来时间点，UI 倒计时正常计算恢复)**
  - `weeklyFraction`: `0.27856246` (周额度正常同步)
  - `updatedAt`: `1792122554250` (时间戳立即刷新)

**结论**：5H 额度刷新不变与倒计时缺失两大根因已彻底消除，新模型清单已全部就绪。
