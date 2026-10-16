# 审查员最终门禁裁决与核验报告 (Reviewer Verdict Report)

- **审查对象**：
  - 复现专员交付物：`research/reproduction/e2e-evidence.md` 及原始报文 JSON
  - 分析专员交付物：`docs/analysis/code-walkthrough.md` 及 `docs/root-cause/root-cause-report.md`
- **审查员 (Gatekeeper)**：reviewer
- **审查标准**：Team Adversarial Gatekeeper 规则（严格对抗式审查、严打凭空推论与模糊解释）
- **最终裁决**：**`VERDICT: APPROVE`**

---

## 一、 对抗式审查总体结论

经过对现场原始抓包、面板状态 Dump、单接口刷新前后对比、前端渲染源码、后端配额解析源码以及历史单测的逐项独立核查，审查员确认：
1. **证据链真实确凿**：不存在任何虚构或假想推论，所有论断均建立在真实的 Google PA API 上游报文与面板脱敏数据之上；
2. **逻辑链路完全闭环**：代码行号精确到行（精确对应 `src/client/index.ts`、`packages/core/src/quota.ts`、`packages/core/src/oauth.ts`、`packages/core/test/quota.test.ts`），上游 JSON 字段对比分明；
3. **用户核心问题完全解答**：对“为什么面板中不显示 5H 额度剩余时间”与“为什么 5H 额度刷新后数值保持不变”两个核心问题给出了完全一致、互为印证的定性与定量解答。

---

## 二、 逐项对抗式核验证据清单

### 1. 现场抓包与日志核验（核验严禁凭空推论）

审查员独立读取并验证了 `research/reproduction/` 下的所有原始报文数据：

| 证据项 | 文件与关键数据 | 审查员独立复核结果 |
|---|---|---|
| **面板现场 Dump** | `research/reproduction/dsh-panel-pool-data.json`<br>- Account 1: `resetTime: "2026-10-15T12:07:40Z"`, `remainingFraction: 0.2681512`<br>- Account 3: `resetTime: "2026-10-15T12:40:20Z"`, `remainingFraction: 0.7408026`<br>- Account 4: `resetTime: "2026-10-15T12:55:25Z"`, `remainingFraction: 0.20182386` | **核验属实**。当前现场时间为 `2026-10-16`，上述账号的 5H 重置时间均停留在昨天（距今已过去 14 小时以上），证明时间戳确实严重过期滞后。 |
| **刷新前后对比** | `research/reproduction/refresh-comparison.json`<br>- 目标账号：`acc_1788785623927_xhs7n`<br>- `beforeRefresh.google.updatedAt`: `1792057950309`<br>- `afterRefresh.google.updatedAt`: `1792057950309`<br>- `remainingFraction`: 刷新前后均为 `0.2681512` | **核验属实**。调用额度刷新接口后，Anthropic 额度立即更新，而 Google 额度的时间戳与数值完全被原样保留，证明刷新操作对 Google 额度确实彻底失效。 |
| **上游端点差异抓包** | `research/reproduction/upstream-quota-summary-daily.json`<br>VS<br>`research/reproduction/upstream-quota-summary-prod.json` | **核验属实**：<br>1. `daily-cloudcode-pa` 返回 200 OK，但 `body.groups` 仅有 1 个组（`Claude and GPT models`），Gemini 组完全缺失；<br>2. `cloudcode-pa` (prod) 返回 200 OK，且包含 2 个组（包含 `Gemini Models`，含 `gemini-5h` 与 `gemini-weekly`）。 |

### 2. 代码级根因核验（核验严禁模糊解释）

审查员对分析报告所引用的代码逻辑进行了针对性对抗核查：

#### (1) 为什么面板中不显示 5H 额度剩余时间？
- **前端判定**：
  在 `src/client/index.ts:175-177`：
  ```typescript
  const d = new Date(resetTimeStr);
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return { resetText: '' };
  ```
  在 `src/client/index.ts:1228`：
  ```typescript
  resetStr ? h('span', { style: { color: 'var(--agy-text-secondary)', fontSize: '11px', fontWeight: 500 } }, `↻ ${resetStr}`) : null
  ```
  **核验结论**：由于后端存储的 `resetTime` 为昨天的过期时间戳（`2026-10-15T12:07:40Z`），`diffMs` 计算结果为负数（约 -52,000,000 ms），`formatQuotaWindow` 立即短路返回空字符串 `{ resetText: '' }`，进而导致前端 DOM 渲染节点为 `null`，倒计时文本从 UI 上完全消失。

#### (2) 为什么 5H 额度刷新后数值保持不变？
- **后端死锁逻辑**：
  在 `packages/core/src/oauth.ts:198-200`：
  ```typescript
  export const AGY_ENDPOINTS: readonly string[] = [
    'https://daily-cloudcode-pa.googleapis.com', // daily 端点排在首位
    'https://cloudcode-pa.googleapis.com',
  ```
  在 `packages/core/src/quota.ts:323-348` (`fetchQuotaSummary`)：
  只要排在第一位的 `daily-cloudcode-pa` 返回 200 OK，函数直接 `return` 结果，不再尝试 `cloudcode-pa`。
  由于 `daily-cloudcode-pa` 的响应中无 Gemini 组，`familyQuotas['google']` 未被初始化。
- **致命 Fallback 冻结**：
  代码进入模型级配额降级逻辑 `packages/core/src/quota.ts:521-526`：
  ```typescript
  if (!familyQuotas[fam]) {
    familyQuotas[fam] = mergeFallbackFamilyQuota(account.quotas[fam], {
      remainingFraction: remaining,
      resetTime,
      updatedAt: now,
    })
  }
  ```
  查看 `packages/core/src/quota.ts:19-25` 中的 `mergeFallbackFamilyQuota` 实现：
  ```typescript
  export function mergeFallbackFamilyQuota(
    prev: FamilyQuotaInfo | undefined,
    fallback: FamilyQuotaInfo,
  ): FamilyQuotaInfo {
    if (prev && typeof prev.remainingFraction === 'number') return prev
    return fallback
  }
  ```
  **核验结论**：如果账号历史数据中曾经存在过 `prev.remainingFraction`（哪怕是多天前的旧值），该函数**无条件直接返回 `prev`**！上游实时请求返回的最新 `fallback` 数据被硬生生丢弃。并且后续第 527 行的 `else if (familyQuotas[fam]!.remainingFraction === undefined)` 分支因此无法进入，最终导致内存与持久化存储中的 `remainingFraction`、`resetTime` 和 `updatedAt` 永远无法被刷新。
- **历史单测印证**：
  审查员在 `packages/core/test/quota.test.ts:383-406` 发现了编写此函数的原意是：“防止 summary 偶发丢字段时被不完整的单模型兜底冲掉”。然而，这种简单的 `return prev` 设计没有引入时间窗口有效性判断，彻底演变成了一个“永久缓存死锁”的致命缺陷。

---

## 三、 对用户核心问题的最终闭环解答

1. **用户问题 1：为什么面板中不显示 5H 额度剩余时间？**
   - **根本原因**：前端只展示未来的重置倒计时（`diffMs > 0`）。而后端由于更新死锁，存储的 5H `resetTime` 始终停留在昨天的过期时间点（`diffMs <= 0`）。前端检测到时间戳已过期，主动隐藏了倒计时节点，表现为“剩余时间不显示”。

2. **用户问题 2：为什么 5H 额度刷新后数值保持不变？**
   - **根本原因**：双重缺陷叠加：
     1. 上游请求优先访问了 Google 的灰度端点 `daily-cloudcode-pa.googleapis.com`，该端点在 `retrieveUserQuotaSummary` 中移除了 Gemini 组，导致插件无法从汇总接口拿到 Google 额度；
     2. 插件转而执行单模型配额 fallback，但 `mergeFallbackFamilyQuota` 存在严重设计缺陷，一旦账号存有历史数值就无条件拒绝更新、复用旧数据，导致刷新返回的永远是旧快照，数值永久冻结。

---

## 四、 审查员门禁裁决

- [x] **事实证据充分度**：具备上游真实报文（daily vs prod 对比）、面板池数据 Dump、单账号刷新前后 Diff 报文，无凭空猜测。
- [x] **代码解释精确度**：精确到文件、行号及具体函数实现，且有历史测试用例佐证。
- [x] **问题解答闭环度**：完全解答用户提出的两大核心疑问，两项异常具有完整的因果统一性。
- [x] **无糊弄与走捷径**：分析深入底层协议与架构缺陷，非表面现象描述。

**最终门禁裁定：`VERDICT: APPROVE`**

---
*报告生成时间：2026-10-16*  
*审查员：reviewer*
