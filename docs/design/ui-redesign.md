# Antigravity 客户端 UI 重构（awwwards 级打磨）

范围：`src/client/**`（`index.ts` 重写、新增 `theme.ts` / `account-models.ts` / `poll-state.ts`、`brand-icons.ts` 增补两枚图标）。测试为行为优先的两层结构：`test/client-account-models.test.ts`（直接 import 数据层做行为断言）与 `test/client-ui-redesign.test.ts`（B* 行为断言 + S* 结构审计，结构审计均为计数/形状式断言， sabotage 即翻红）。后端、路由、槽位契约零改动。

## 设计方向（Why）

这是一块嵌在设置页里的**运营面板**，不是营销页。它的高水准不来自装饰，而来自三件事：**纪律、诚实、节奏**。

1. **令牌纪律**：整套界面只有一套设计语言 —— 8pt 间距体系、11→20px 的模块化字号阶、语义状态色（light/dark 双套、均按 WCAG AA 校准）、三层阴影、统一的运动曲线与时长。组件里不再散落任何硬编码颜色；颜色字面量只允许出现在 `theme.ts` 的 token 定义块内（测试 4 用正反两向断言把这条纪律钉死）。品牌色（Gemini/Claude/OpenAI）作为「美术素材」保留在 `brand-icons.ts`，与界面色彻底分离。
2. **状态诚实**：每个异步面都同时具备 loading（骨架屏，不是转圈刷屏）/ empty（带下一步动作）/ error（带重试）/ stale（上次更新时间）。轮询失败**绝不**清空已展示数据——只打上「轮询中断 · 上次成功 HH:MM:SS」的标记，且**任何一次成功轮询都会清除该标记**（哪怕状态 JSON 一字不差；去抖只跳 `setStatus`，不跳 `pollOk`/时间戳恢复，见 `poll-state.ts` 的 `applyPollOutcome`，行为测试 `client-ui-redesign.test.ts` B1）；模型刷新失败保留旧清单并展示 `refreshError`；模型端点不可用时同样保留最近一次成功发现的数据、来源标签跟随数据而非最后一次尝试，只有面板 truly 没有 payload 时才回退到额度同步数据，且**明确标注来源**（「来源：最近一次额度同步」），绝不假装是新数据。
3. **克制的动效**：瞬态动效 120–240ms、曲线 `cubic-bezier(0.22, 1, 0.36, 1)`，只做一件事——解释结构的变化（入场级差、额度条从 0 填充、模型行逐个浮现），`prefers-reduced-motion` 一刀切断。唯一的持续型动效是账号冷却条的 2.2s 呼吸阴影（`agy-cooldown-breathe`），它表达「正在持续等待」，**只有真实冷却元素可用**——模型行的重置时间不再挂呼吸（结构审计 S3 钉死）。字体沿用宿主字体变量 + 等宽数字（tabular-nums），无外部字体、无新依赖。

## 布局

单一入口：设置页 Gear → Antigravity（`settings.section`，聊天界面不再注入任何按钮 —— 用户明确要求「不需要聊天界面加按钮，而是在设置页面里有入口就行」）。面板内为大块导航 tablist：**总览 / 账号 / 模型 / 用量统计 / 诊断 / 配置**，键盘支持 ArrowLeft/Right/Home/End（roving tabindex），每个分区是 `role="tabpanel"`。

- **总览**：可调度账号、授权状态、默认模型、目录模型数、最近请求五张统计卡 + 每账号额度快照（点「查看模型」直达模型分区）。
- **账号**：原有全部能力原样保留（添加/浏览器授权流/手动授权码/取消/设为主用/同步/专属代理/移除/清除冷却/额度条/需重新登录徽标），卡片入场级差。
- **模型**：见下节。
- **用量统计**：四张统计卡 + 打开「请求明细与会话统计」抽屉（Requests/Sessions 双表、分页、Escape 关闭、点击遮罩关闭）。
- **诊断**：插件状态/休眠原因/构建校验(catalog/source/lastError/endpointErrors)/最近运行/auth+poolAuth 阶段；未上报的字段诚实显示「未上报」。
- **配置**：仅四个后端允许的键（defaultModel / defaultEffort / askTool / baseUrl），askTool 为 `role="switch"`，baseUrl 明确提示「后端不回显该值」。

## 模型面板数据流（核心新能力）

```
GET  {api}/pool/account-models?id=<id>      → AccountModelsPayload (source: 'api')
POST {api}/pool/account-models {id, refresh:true}
        ├─ 成功 → 新清单；后端刷新失败也回 200+旧数据+refreshError → 展示警示条、保留旧清单
        └─ 404 account_not_found / 网络失败
              → 回退 buildQuotaFallbackPayload(account)   (source: 'quota-fallback'，界面标注来源)
```

- 面板状态机：`idle | loading | ok | error`。**渲染永远吃 `panel.payload`，与 status 无关**：payload 选择、失败保留、来源标签一致性全部收敛在 `account-models.ts` 的纯函数里（`selectPanelPayload` / `markPanelLoadFailure` / `markPanelRefreshFailure` / `markPanelSuccess`），`index.ts` 只做 glue；GET 首次加载失败与 POST 刷新失败一样绝不写 `payload: null`（行为测试：`client-account-models.test.ts` #1/#3/#4/#5，结构审计：`client-ui-redesign.test.ts` S2）。
- **灰度差异**：跨账号「已发现模型并集」为分母；某模型仅本账号有 → 徽标「本账号独有」；其它账号也有 → 「其它账号也支持」；账号头部展示覆盖计数 `n/union`（例 18/24）。
- **搜索/筛选**：面板内搜索 modelId/名称，厂商 chips（Gemini/Claude/GPT-OSS，`aria-pressed`）。
- `known:false`/空清单 → 诚实空态「尚未发现该账号的模型清单」+「点击刷新发现模型」（POST refresh）。
- 每行：模型名（title=modelId）+ 剩余占比条（渐变令牌分档 high/med/low/cool）+ 重置倒计时（`↻ HH:MM (XhYm)`，由自计时叶子组件 `ResetCountdown` 承载：1 秒 interval 只随组件挂载，页面级每秒 setState 已废除；SVG 品牌渐变 id 按尺寸缓存，渲染不再扰动 id）。

## Token 表（节选，完整见 `src/client/theme.ts` 的 agy-tokens 块）

| 族 | Token | 值 |
|---|---|---|
| 间距 | `--agy-space-1..6` | 4 / 8 / 12 / 16 / 24 / 32 px（8pt 网格） |
| 字号 | `--agy-font-xs…2xl` | 11 / 12 / 13 / 14 / 16 / 20 px |
| 字体 | `--agy-font-family` | `var(--dsw-font-family, …)`（复用宿主）+ `--agy-font-mono` + tabular-nums |
| 圆角 | `--agy-radius-sm/md/lg/pill` | 6 / 8 / 12 / 999 px |
| 阴影 | `--agy-shadow-1/2/3` | 接触 / 悬浮 / 浮层三层 |
| 运动 | `--agy-dur-fast/base/slow` | 120 / 180 / 240 ms |
| 曲线 | `--agy-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)`；stagger 55 ms |
| 表面 | `--agy-bg-*`/`--agy-border-*`/`--agy-text-*` | 映射宿主 `--dsw-alias-*`，dark 覆盖块统一反相 |
| 状态 | `--agy-{ok,warn,danger,info,neutral}-{bg,border,text}` | 亮色 #047857/#b45309/#b91c1c/#1d4ed8，暗色 #34d399/#fbbf24/#f87171/#93c5fd（AA） |
| 额度 | `--agy-quota-{high,med,low,cool}-grad` + 文本色 | ≥30% / 10–30% / <10% / 冷却中 四档 |
| 焦点 | `--agy-focus-ring` | `:is(button,input,a,[tabindex]):focus-visible` 2px 描边 |

## 动效表

| 编排 | 实现 | 时长 |
|---|---|---|
| 分区入场级差 | `.agy-rise` + `--i` 序数 × 55ms（tab 切换整块重挂载） | 240ms |
| 额度条填充 | `.agy-progress-fill` `scaleX 0→1`（transform-origin: left） | 240ms |
| 模型行逐个浮现 | `.agy-model-row` 级差（封顶 12 行） | 240ms |
| 冷却条呼吸 | `.agy-cooldown-breathe` 缓入缓出阴影脉动（仅账号冷却条；模型行不挂） | 2.2s 循环 |
| 抽屉滑入 | `.agy-drawer` translateX 入场 | 240ms |
| 骨架微光 | `.agy-skeleton::after` shimmer | 1200ms 循环（仅加载期） |
| 总开关 | `@media (prefers-reduced-motion: reduce)` → `animation/transition: none` | — |

## 无障碍与性能决策

- 键盘：tablist roving tabindex + 方向键；抽屉 Escape 关闭；焦点环仅 `focus-visible`。
- 语义：`aria-expanded`/`aria-controls`（明细与模型面板；id 一律由 `modelsPanelDomId(accId)` 这个单一 helper 生成，账号卡「明细」按钮在账号 tab 展开时卡内就有同 id 的紧凑明细面板，模型 tab 按钮对应模型 tab 面板——`aria-controls` 永远指向真实渲染的 DOM——模型面板在骨架/空池/筛选空/正常列表每个展开分支都挂载同一 `modelsPanelDomId` 容器，结构审计 S1 以分支计数钉死）、`aria-pressed`（筛选 chips）、`aria-selected`（tabs/分段）、`aria-modal` 抽屉、toast `role="status" aria-live="polite"`、纯图标按钮全部 `aria-label`、装饰性 svg `aria-hidden`、骨架 `aria-hidden` + `.agy-sr-only` 播报。
- 对比度：状态文本色按亮/暗两套分别校准至 AA；徽标与表格行用半透明底 + 强色文本。
- 性能：无新依赖、无网络字体、无图片资产；状态轮询 3s，JSON 比对去抖只跳 `setStatus`（不跳 pollOk 恢复与时间戳）；统计轮询 10s；倒计时 1s interval 只属于自计时叶子 `ResetCountdown`（页面级 1s setState 已废除）；模型自动拉取 effect 以账号 id 指纹为依赖、`loading/error` 面板不自动重试、成功数据按 60s TTL 到期才重拉（`collectStalePanelAccounts`，测试 #10）；组件级 `<style>` 只注入一份 THEME_CSS。
- 配置表单回填：`cfgDrafts` 用 `undefined` 表示「用户从未编辑」；status 未加载时绝不写入 `''`（否则空串伪装成用户编辑、字段永不回填）；用户编辑过（含清空）的值永不被后端值覆盖（`seedConfigDrafts`，测试 B2）。

## 验证清单（已执行）

- [x] `npx tsc --noEmit` → 0 错误（TSC_EXIT=0）
- [x] `npm test` → **tests 345 / pass 345 / fail 0**（`client-account-models.test.ts` 11 项行为测试 + 重写后的 `client-ui-redesign.test.ts` 12 项（3 行为 + 9 结构审计）；旧 client-audit 全部保持绿）
- [x] 破坏自证（在 /tmp 副本执行，工作区源码未动）：payload 选择被改为恒走 fallback → #1/#3/#6/#7 红；成功轮询不恢复 pollOk → B1 红；配置回填不执行 → B2 红；卡内 aria-controls 硬编码另一 id → S1 红；失败分支写回 `payload: null` → S2 红；模型行重新挂 2.2s 呼吸 → S3 红；顶层 1s setState tick 复活 → S4 红
- [x] 禁改区零触碰：`src/host/**`、`src/index.ts`、`packages/**`、`src/common/**`、`dist/**`、其它测试
- [x] 无 TODO/占位符、无空 catch（每个 catch 都有明确降级路径与用户可见反馈）、无新增依赖

## 已知边界

- 本环境无法开浏览器截图做视觉 QA（awwwards 技能的 visual QA 环节需由 Lead/集成方在真实宿主里目检）。
- `dist/client.js` 已在集成轮重建（sha256 `2d105b53…`，116987 B）并由集成成员装入运行 profile；本 UI 收尾轮按团队约定不 build、只改 `src/client/**` 源码与其测试，收尾改动与 dist 的同步同样由集成成员在下一次构建完成并重跑 `npm test` 确认。
- 倒计时依赖客户端时钟；重置时间以 ISO 字符串解析，跨时区显示宿主本地时间；不可解析的 reset 时间戳显示为空（绝不渲染 `NaN:NaN`，测试 #11）。
