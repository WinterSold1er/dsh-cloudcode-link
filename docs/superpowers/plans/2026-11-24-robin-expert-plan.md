# Robin Expert (`expert_ask`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `gemini_app_ask` with a general-purpose `expert_ask` tool in `dsh-cloudcode-link` that supports role-based system prompts (`coding`, `review`, `debug`, `writing`, `math`, `general`), sandboxed local `file_paths` injection (with `:start-end` line ranges and truncation), `advanced` mode by default, and dynamic `systemPrompt` section gating in DSH.

**Architecture:**
- `src/host/expert-ask-tool.ts` (replacing `src/host/gemini-app-ask-tool.ts`) implements `registerExpertAskTool` with role-specific system prompts, workspace-sandboxed `file_paths` reader (`ctx.workingDirectory.get(exec.agent.session)` with `process.cwd()` fallback), and Robin API delegation via `callGeminiApp`.
- `src/index.ts` wires `expert_ask` registration and dynamically registers/disposes a `systemPrompt` section (`tool:expert_ask`) via `ctx.inject(['systemPrompt'], ...)` only when `geminiAppAskToolEnabled` is `true`.
- `src/client/sections/ConfigSection.ts` updates the UI label/description to reflect `expert_ask`.

**Tech Stack:** TypeScript, Node.js >= 24 (`node:test`, `node:assert/strict`, `node:fs`, `node:path`), Cordis (`@deepseek-ai/cordis`), `tsdown`, `tsc`.

---

### Task 1: Implement `expert_ask` tool & sandboxed `file_paths` reader (TDD)

**Files:**
- Create: `src/host/expert-ask-tool.ts`
- Delete: `src/host/gemini-app-ask-tool.ts`
- Create: `test/expert-ask-tool.test.ts`

- [ ] **Step 1: Write failing tests in `test/expert-ask-tool.test.ts`**

Cover:
1. Rejects empty/missing `task` and invalid `role` / `mode`.
2. Defaults `role` to `'general'` and `mode` to `'advanced'`, injecting the role-specific system prompt into `callGeminiApp`.
3. Reads `file_paths` relative to `getCwd(exec)` (from `workingDirectory` service), supports `path:start-end` 1-based inclusive line ranges with line numbers, and formats them into the prompt.
4. Rejects path traversal (`../outside.txt`), absolute paths outside `cwd`, and symlinks pointing outside `cwd` (`fs.realpathSync` check).
5. Truncates oversized single files (> 30,000 chars) and total attached context (> 100,000 chars) with explicit `[truncated: ...]` markers.
6. Propagates `GeminiAppError` and generic errors cleanly without swallowing them.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/expert-ask-tool.test.ts`
Expected: FAIL (module `../src/host/expert-ask-tool.ts` not found).

- [ ] **Step 3: Implement `src/host/expert-ask-tool.ts`**

Key exports & behavior:
- `EXPERT_ROLES = ['coding', 'review', 'debug', 'writing', 'math', 'general'] as const`
- `ROLE_SYSTEM_PROMPTS: Record<ExpertRole, string>`
- `readSandboxedFiles(filePaths: string[], cwd: string, limits?)`:
  - Resolves `realCwd = fs.realpathSync(cwd)`.
  - Parses optional `:start-end` suffix (validates `1 <= start <= end`).
  - Resolves target path against `cwd`, checks `fs.realpathSync(resolved)` starts with `realCwd + path.sep` (or equals `realCwd`? No, must be a regular file inside `realCwd`, not a directory).
  - Reads UTF-8 text, slices line range if specified, enforces `maxFileChars = 30_000` and `maxTotalChars = 100_000` with `[truncated: ...]` markers.
- `registerExpertAskTool(tools, deps)`:
  - Registers tool named `'expert_ask'` with strong delegation description.
  - Parameters: `task` (required string), `role` (optional enum, default `'general'`), `file_paths` (optional string[]), `context` (optional string), `mode` (optional `'standard' | 'advanced'`, default `'advanced'`).
  - Resolves `cwd` via `deps.getCwd?.(exec) ?? process.cwd()`.
  - Calls `callGeminiApp` with assembled prompt and `system` prompt for the selected `role`.

- [ ] **Step 4: Remove `src/host/gemini-app-ask-tool.ts` and run tests**

Run: `node --test test/expert-ask-tool.test.ts`
Expected: PASS (all tests in `test/expert-ask-tool.test.ts` pass).

- [ ] **Step 5: Commit**

```bash
git add src/host/expert-ask-tool.ts test/expert-ask-tool.test.ts
git rm src/host/gemini-app-ask-tool.ts
git commit -m "feat: replace gemini_app_ask with general-purpose expert_ask tool"
```

---

### Task 2: Wire `expert_ask`, `workingDirectory`, and dynamic `systemPrompt` gating in `src/index.ts` & UI

**Files:**
- Modify: `src/index.ts`
- Modify: `src/client/sections/ConfigSection.ts`
- Modify: `test/expert-ask-tool.test.ts` (add test for `syncExpertAskRegistration` / `systemPrompt` gating if extracted as a helper, or test helper directly)

- [ ] **Step 1: Write failing test for dynamic `systemPrompt` gating helper**

In `test/expert-ask-tool.test.ts`, add tests for `EXPERT_FIRST_SYSTEM_PROMPT` / gating behavior:
- When `enabled = true` and `tools` + `systemPrompt` are available, both `expert_ask` tool and `tool:expert_ask` system prompt section are registered.
- When `enabled = false`, both are disposed and not active.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/expert-ask-tool.test.ts`
Expected: FAIL (helper not exported yet).

- [ ] **Step 3: Update `src/index.ts` and `src/client/sections/ConfigSection.ts`**

In `src/index.ts`:
- Replace `registerGeminiAppAskTool` import with `registerExpertAskTool` and `EXPERT_FIRST_SYSTEM_PROMPT` from `./host/expert-ask-tool.js`.
- Track `workingDirectorySvcRef` via `ctx.inject(['workingDirectory'], ...)` (optional/safe if not present) and pass `getCwd: (exec) => ...` to `registerExpertAskTool`.
- Track `systemPromptSvcRef` via `ctx.inject(['systemPrompt'], ...)` and register/dispose `systemPrompt.section({ name: 'tool:expert_ask', order: ..., text: EXPERT_FIRST_SYSTEM_PROMPT })` in sync with `geminiAppAskToolEnabled`.
- Clean up both disposers on plugin dispose.

In `src/client/sections/ConfigSection.ts`:
- Update label/description for `geminiAppAskToolEnabled` to `专家委派工具 (expert_ask)` and `在主 Agent 会话中注册 expert_ask 工具并启用“脑手分离”委派规则，将思考、编码、审查、写作与推理任务交给 Robin API`.

- [ ] **Step 4: Run full typecheck, build, and test suite**

Run:
- `pnpm check`
- `pnpm build`
- `pnpm test`
Expected: All pass with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/client/sections/ConfigSection.ts test/expert-ask-tool.test.ts
git commit -m "feat: wire expert_ask with workingDirectory sandbox and dynamic systemPrompt gating"
```

---

### Review Focus

1. **Symlink escape in `file_paths`**: A symlink inside `cwd` pointing to `/etc/passwd` passes `path.resolve` lexical checks; `fs.realpathSync` must be checked against `fs.realpathSync(cwd)` (covered in Task 1 Step 1).
2. **Invalid `:start-end` line range syntax**: e.g. `foo.ts:50-10` (`start > end`), `foo.ts:0-5`, or `foo.ts:abc` — must throw a clear validation error rather than silently returning empty text (covered in Task 1 Step 1).
3. **Non-existent or directory path in `file_paths`**: Passing a directory or missing file must throw a clear error naming the path (covered in Task 1 Step 1).
4. **Dynamic `systemPrompt` gating when `geminiAppAskToolEnabled` toggles**: Toggling config off must dispose both the tool and the `tool:expert_ask` prompt section so the model never tries to call a missing tool (covered in Task 2 Step 1).
5. **Missing `workingDirectory` service or `exec.agent?.session`**: Must gracefully fall back to `process.cwd()` without crashing (covered in Task 1 Step 1).
