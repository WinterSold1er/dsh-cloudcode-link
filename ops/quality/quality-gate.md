# T1 仓库质量门 — check / test / build 与 dist 一致性

- task: task-1（owner worker-repo）
- repo: /home/csy/Code/Github/dsh-cloudcode-link
- HEAD: `dc0ca77a29a317bd1948a291534cd69334085081`（`git status --porcelain` 空）
- 子模块: `1c0931a7b625a8e66699e8011e3736d0ff997416 packages/core (heads/main)`，子模块工作区干净
- 环境: node v26.9.0 / pnpm 11.7.0
- 结论: **PASS**（无阻塞问题；3 条非阻塞说明见文末）

## 1. 门禁命令与结果

| # | 命令 | cwd | 退出码 | 原始输出摘要 | 日志 |
|---|------|-----|--------|--------------|------|
| 1 | `pnpm check` | repo 根 | 0 | `$ tsc --noEmit`，无诊断输出 | ops/quality/root-check.log |
| 2 | `pnpm test` | repo 根 | 0 | `node --test "test/**/*.test.ts"` → `tests 255 / suites 56 / pass 255 / fail 0 / skipped 0 / todo 0 / duration_ms 7656.79` | ops/quality/root-test.log |
| 3 | `pnpm check` | packages/core | 0 | `$ tsc --noEmit`，无诊断输出 | ops/quality/core-check.log |
| 4 | `pnpm test` | packages/core | 0 | `tests 212 / suites 33 / pass 212 / fail 0 / skipped 0 / todo 0 / duration_ms 7602.10` | ops/quality/core-test.log |
| 5 | `pnpm build` | repo 根 | 0 | tsdown v0.22.14 / rolldown v1.2.7；`Cleaning 3 files`；`[CJS] dist/client.js 74.09 kB`；`[ESM] dist/index.js 1.25 MB`、`dist/index.d.ts 0.57 kB`；`✔ Build complete` | ops/quality/root-build.log（第 2、3 次：root-build-2.log / root-build-3.log） |
| 6 | `pnpm build` | packages/core | 0 | `dist/index.js 203.50 kB`、`index.js.map 404.02 kB`、`index.d.ts 56.01 kB`；构建后 `git -C packages/core status --porcelain` 为空 | ops/quality/core-build.log |
| 7 | `git status --short dist` | repo 根 | 0 | **空输出**（构建后无改动、无新增） | root-build.log 内联 |

测试非空跑证据：仓库根 `test/**` 实有 23 个 `*.test.ts`，packages/core 18 个；两次运行 `skipped 0 / todo 0`。
`test/**` 中 `it.skip / test.skip / describe.skip / .only / todo` 标记计数 = **0**（root）与 **0**（core）——不存在用跳过/only 掩盖失败的情况。

## 2. dist 一致性（核心主张）

对象文件：`dist/index.js`、`dist/client.js`、`dist/index.d.ts`（均为 git 跟踪文件）。

| 阶段 | sha256 index.js | sha256 client.js | sha256 index.d.ts |
|------|-----------------|------------------|-------------------|
| 构建前工作区 | 73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf | 3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717 | 3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e |
| `git show HEAD:dist/*` | 73e0efbf…2ebf | 3991a5a3…48717 | 3579872b…614e |
| `pnpm build` 第 1 次 | 73e0efbf…2ebf | 3991a5a3…48717 | 3579872b…614e |
| `pnpm build` 第 2 次 | 73e0efbf…2ebf | 3991a5a3…48717 | 3579872b…614e |
| `pnpm build` 第 3 次 | 73e0efbf…2ebf | 3991a5a3…48717 | 3579872b…614e |

- 三次连续构建 → 产物 sha256 完全一致，且与 `git show HEAD:dist/...` 逐字节相同 ⇒ **已提交 dist == 由当前 HEAD 源码可复现构建的产物**，既无“陈旧 dist”，也无构建不确定性。
- `git status --porcelain --untracked-files=all -- dist` 输出为空（含未跟踪文件检查），非仅 `--short`。
- 附加：`node --input-type=module --check < dist/index.js` EXIT=0；`node --check dist/client.js` EXIT=0（产物语法可解析）。
- dist 内确含本次更新特征串：`ccl`（index 20 行 / client 3 行）、`cloudcode`（20/3）、`weeklyFraction`（3/1）。

## 3. 复现命令（可直接照抄）

```bash
cd /home/csy/Code/Github/dsh-cloudcode-link
pnpm check && pnpm test
(cd packages/core && pnpm check && pnpm test && pnpm build)
pnpm build && git status --porcelain --untracked-files=all -- dist   # 必须为空
sha256sum dist/index.js dist/client.js dist/index.d.ts
```

## 4. 非阻塞说明（不是缺陷，但影响“干净”判读的边界）

1. **dist 洁净 ≠ 子模块洁净**：仓库根 `src/host/*.ts` 直接 import `../../packages/core/src/*.ts`（如 `src/host/quota.ts -> packages/core/src/quota.ts`），tsdown 将子模块源码内联进 `dist/index.js`。因此构建产物同时取决于子模块 commit。本次子模块固定在 `1c0931a7…` 且干净，若子模块指针移动而根仓未重构建，`git status --short dist` 仍可能为空——该命令只证明 dist 与自身 git 对象一致，不证明子模块内容。
2. `dist/client.js` 是浏览器侧 ModuleLoader 包（文件头 `window.__ModuleLoader__.load({ id: "dsh-cloudcode-link", factory: (require) => {…} })`），故在 `"type": "module"` 包中仍以 CJS 包装形式落盘，属于 DSH 客户端插件加载约定，非类型/模块格式错误；它不作为 node 的 import 目标。
3. `.gitignore` 第 5 行 `*.log`，故本节引用的 `ops/quality/*.log` 为有意不入库的原始日志；本文件（.md）不被忽略。

## 5. 未解决问题清单

- 无阻塞项。未修改任何 `src/**`、`packages/**` 源码 —— 全部门禁首轮即通过，不存在需要修复的失败。
- 未触碰 `test/**`、`scripts/**`、`docs/review/**`；无测试缺陷需要移交（见 ops/quality/findings.md）。
