# Robin Expert (`expert_ask`) — 通用智力外包与脑手分离设计文档

**日期**：2026-11-24  
**状态**：待审批  
**目标仓库**：`dsh-cloudcode-link` + DSH 全局 Skill（`robin-expert-first`）

---

## 1. 意图与背景（Intent & Why）

Google Gemini App（Robin API）具备**免费、响应迅速、推理与创作能力强**的特点，但**不支持原生工具调用（Tool Calling）**。  
目前 `dsh-cloudcode-link` 中已存在 `gemini_app_ask` 工具，但它只是一个被动的通用问答工具：
1. 工具描述过于宽泛，默认工作模型（如 Claude / DeepSeek）很少主动调用它；
2. 缺乏角色化引导，无法针对编码、代码审查、写作、数学推理等不同场景提供最佳提示词；
3. 每次需要参考本地代码时，默认模型必须先自己 `read` 文件再复制粘贴进 `prompt`，既浪费主模型上下文 Token，又容易截断。

本设计的目标是实现**“脑手分离”**：让支持工具调用的默认工作模型退居为**“手和眼”**（负责文件检索、读写、命令执行、测试验证与工具编排），而把**所有需要思考、推理、创作、编码、审查的工作**尽可能全部外包给 Robin API。

---

## 2. 目标、非目标与反目标（Goals / Non-Goals / Anti-Goals）

### Goals（目标）
1. **替换升级**：用通用专家工具 `expert_ask` 替换现有的 `gemini_app_ask`。
2. **全场景通用**：不仅支持 `coding`、`review`、`debug`、`architecture`，也支持 `writing`（文章/文案）、`math`（数学/逻辑推理）和 `general`（通用思考）。
3. **本地上下文直喂**：支持 `file_paths` 参数（含可选行号范围 `path:start-end`），由插件在本地直接读取文件内容并注入 Robin 上下文，避免默认模型重复吞吐大段代码。
4. **高主动委派率**：通过强引导性的工具描述 + 配套 DSH 全局 Skill（`robin-expert-first`），让默认工作模型在遇到思考/创作/编码/审查任务时优先调用 `expert_ask`。

### Non-Goals（非目标）
1. 不做跨客户端的独立 MCP Server（本次深度集成在 DSH 内部，直接复用 `dsh-cloudcode-link` 的 Robin 客户端、账号池与配置体系）。
2. 不在 Robin 之上强行模拟多轮工具调用（ReAct / XML Tool-Use）。
3. 不改变 Track A（`gemini-app-offload.ts`）对无工具请求的透明分流逻辑。

### Anti-Goals（反目标）
1. **禁止静默越界读文件**：`file_paths` 绝不允许读取当前工作区之外的敏感文件（如 `~/.ssh`、`/etc/passwd` 等）。
2. **禁止无意义往返**：极简单的单行修改、纯文件查找或纯命令执行不应强制走 `expert_ask`，避免拖慢交互体验。
3. **禁止静默吞错**：Robin 调用失败或文件读取失败时必须返回明确错误，不能返回空字符串或伪造成功。

---

## 3. 约束条件（Constraints）

1. **Robin API 无状态与无工具限制**：每次 `expert_ask` 调用都是独立的单轮请求，Robin 无法主动回调本地工具，所有必要上下文必须在单次请求中提供完整。
2. **上下文长度限制**：Robin 请求有上下文长度上限，插件侧读取 `file_paths` 时必须做单文件与总字符数截断保护，并在截断时明确标注。
3. **向后兼容配置**：`cordis.patch.yml` 与现有配置项 `geminiAppAskToolEnabled`（及环境变量 `DSH_GEMINI_APP_ASK_TOOL`）应继续控制该工具的开关，避免破坏用户现有配置。

---

## 4. 备选方案与选型（Approaches）

| 方案 | 核心思路 | 权衡 | 结论 |
| --- | --- | --- | --- |
| **方案 1：专家工具集 + 本地上下文直喂 + 强制委派规则** | 将 `gemini_app_ask` 升级为通用 `expert_ask`（支持 `role` 与 `file_paths`），配合 DSH Skill 强制默认模型“脑手分离”。 | 稳定性最高、Token 最省、完全复用现有账号池；依赖默认模型遵守工具描述与 Skill。 | **已选定** |
| **方案 2：Robin 伪工具调用代理（XML/JSON ReAct）** | 在适配器层教 Robin 输出 XML/JSON 工具调用指令并拦截执行。 | 理论上可完全不用默认模型，但 Robin 无原生工具训练与 `thoughtSignature`，多轮编辑极易格式幻觉或死循环。 | 放弃 |
| **方案 3：Subagent / Workflow 路由分流** | 仅在派发子代理时路由到 Robin。 | 无法覆盖主对话中日常写代码、改 Bug、写文章、做数学题的高频场景。 | 放弃 |

---

## 5. 详细设计（The How）

### 5.1 工具替换：`expert_ask`（替换 `gemini_app_ask`）

在 `src/host/gemini-app-ask-tool.ts`（或重命名为 `src/host/expert-ask-tool.ts` 并更新 `src/index.ts` 引用）中，将注册的工具名从 `gemini_app_ask` 替换为 `expert_ask`。

#### 输入参数 Schema
- `task`（`string`，必填）：需要专家完成的具体任务描述或问题。
- `role`（`enum`，可选，默认 `'general'`）：
  - `'coding'`：编写、重构、实现代码（要求输出可直接应用的完整代码或清晰 diff）。
  - `'review'`：代码审查、找 Bug、安全与架构评估（要求输出结构化问题清单与修复建议）。
  - `'debug'`：报错分析、根因定位与修复方案。
  - `'writing'`：文章、文档、文案、总结与翻译创作。
  - `'math'`：数学推导、算法证明、复杂逻辑推理（要求分步严谨推导）。
  - `'general'`：通用深度思考、方案对比与问答。
- `file_paths`（`string[]`，可选）：需要专家参考的本地文件路径列表，支持 `path/to/file.ts` 或 `path/to/file.ts:10-80` 行号范围格式。
- `context`（`string`，可选）：额外上下文（如报错日志、`git diff`、约束条件等）。
- `mode`（`'standard' | 'advanced'`，可选，默认 `'advanced'`）：默认使用推理能力更强的 `advanced` 模式；简单快速任务可传 `standard`。

#### 工具描述（Tool Description）
工具描述需明确传达“主思考引擎”定位，例如：
> Delegate thinking, reasoning, coding, code review, debugging, writing, math, and analysis tasks to the Expert (Robin API — fast and free). Prefer calling this tool for any non-trivial intellectual work instead of solving it yourself. Pass `file_paths` directly so the plugin reads files for the Expert without consuming your own context.

### 5.2 本地文件直喂与安全边界

插件在执行 `expert_ask` 时，若传入 `file_paths`：
1. **权威工作目录获取**：通过 DSH 的 `workingDirectory` 服务获取当前会话的真实工作目录（`ctx.workingDirectory.get(exec.agent.session)`），仅当 `workingDirectory` 服务或 `exec.agent?.session` 不可用时回退到 `process.cwd()`。
2. **路径解析与沙箱校验**：基于上述会话 `cwd` 解析相对路径；使用 `path.resolve` + `fs.realpathSync` 校验解析后的真实路径必须位于会话 `cwd` 之内，越界路径直接报错拒绝（防止路径穿越或软链接逃逸）。
3. **行号范围支持**：若路径带 `:start-end` 后缀（1-based 闭区间），仅截取对应行范围并附带行号前缀。
4. **大小与截断保护**：设置单文件上限（如 30,000 字符）与总注入上下文上限（如 100,000 字符，或复用/参考 `geminiAppOffloadMaxContextChars`），超出时按顺序截断并在末尾附加 `[truncated: ...]` 提示。
5. **Prompt 组装**：按 `System Prompt (by role)` + `Task` + `Context` + `Attached Files` 的清晰结构拼装后发送给 Robin API。

### 5.3 角色 System Prompt 路由

为每个 `role` 内置精炼的专家 System Prompt：
- `coding`：强调遵循现有代码风格、边界条件处理、无占位符、输出可直接落盘的代码或精确修改块。
- `review`：强调只报真实缺陷（逻辑错误、并发/空值/安全隐患、架构问题），给出具体位置与修复方案。
- `debug`：强调从现象到根因的因果链分析，给出可验证的修复步骤。
- `writing`：强调结构清晰、语言自然、贴合目标读者与体裁。
- `math`：强调分步推导、公式严谨、最终给出明确结论。
- `general`：强调直击本质、结构化分析、给出可执行结论。

### 5.4 配置与 UI 同步

- 保留 `geminiAppAskToolEnabled` 配置键名与 `DSH_GEMINI_APP_ASK_TOOL` 环境变量以保持向后兼容。
- 更新 `src/client/sections/ConfigSection.ts` 中的文案，将说明更新为 `专家委派工具 (expert_ask)`，准确反映其通用专家定位。

### 5.5 配套 DSH 委派规则：`robin-expert-first`（动态门控）

由 `dsh-cloudcode-link` 在 `expert_ask` 启用时动态注入/激活“脑手分离”委派规则（若 `geminiAppAskToolEnabled` 为 `false` 或插件未启用，则不注入该规则，避免模型尝试调用不存在的工具）：
1. **何时必须调用 `expert_ask`**：
   - 编写新功能、重构代码、修复非平凡 Bug（`role: "coding"` / `"debug"`）
   - 代码审查、PR/Diff 评估（`role: "review"`）
   - 撰写文章、报告、文案、翻译（`role: "writing"`）
   - 数学题、算法推导、复杂逻辑分析（`role: "math"`）
   - 架构设计、技术选型、复杂问题拆解（`role: "general"`）
2. **标准执行流**：
   - 编码类：默认模型用 `glob`/`grep` 定位文件 → 直接把 `file_paths` 和需求传给 `expert_ask` → 拿到结果后用 `edit`/`write` 落盘 → 跑测试验证。
   - 通用类（写作/数学/问答）：默认模型直接调用 `expert_ask` → 将专家结果呈现给用户（或按要求写入文件）。
3. **例外情况**：纯文件查找、纯命令执行、或 1-2 行的显而易见修改，默认模型可直接完成。

---

## 6. 留给实现者的细节（Left to the Builder）

1. 具体 `role` System Prompt 的措辞微调与单元测试覆盖（包括路径穿越拦截、行号截取、截断逻辑、参数校验、Robin 错误透传）。
2. `expert_ask` 的超时时间默认值与 `AbortSignal` 处理（可沿用现有 `gemini_app_ask` 的超时机制）。
3. `src/host/gemini-app-ask-tool.ts` 是否重命名为 `src/host/expert-ask-tool.ts`（建议重命名并清理旧引用）。
