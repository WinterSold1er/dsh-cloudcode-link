# T1 findings — 测试/仓库缺陷清单

task-1（worker-repo）扫描结论：**无需要 Lead 派单的测试缺陷，无源码缺陷。**

## 判定依据（真实运行，非推断）

- 根包 `pnpm test`：`tests 255 / pass 255 / fail 0 / skipped 0 / todo 0`，退出码 0（ops/quality/root-test.log）。
- `packages/core` `pnpm test`：`tests 212 / pass 212 / fail 0 / skipped 0 / todo 0`，退出码 0（ops/quality/core-test.log）。
- `test/**` 中 `it.skip` / `test.skip` / `describe.skip` / `.only` 标记：根 0 处、core 0 处（`test/**` 共 23 个测试文件，core 18 个）。未发现“跳过/屏蔽以伪通过”。
- 两次 `pnpm check`（root、core）均 0 诊断，未发现靠 `any`/`@ts-ignore` 压制的证据性线索（该维度由 T5 reviewer 深入核验）。

## 移交建议

无。以下两条为观察记录，不需要改测试，仅提示判读边界：

1. dist 洁净判据不覆盖 git 子模块内容 —— `packages/core` 为 submodule（`1c0931a7b625a8e66699e8011e3736d0ff997416`，干净），根包 src 直接引用其源码并被内联进 `dist/index.js`。
2. `dist/client.js` 为浏览器 `window.__ModuleLoader__` 包装（DSH 客户端插件约定），非 ESM/CJS 误用。

---

# T6 findings — core 测试间歇失败（端口争用）

task-6（worker-repo）结论：**core 侧根因已定位并修复**（详见 ops/quality/flake-report.md）；以下 2 条需要 Lead 派单，本人未改（超出本任务写范围或会扩大改动面）。

## F1（需派单：root `test/**` 所有者）root `test/pool-auth.test.ts` 仍写死 51121

- 证据：修复后并跑两个 root suite，其中一个失败 —— `test/pool-auth.test.ts:24 actual 'manual' expected 'auto'`，`pass 254 / fail 1`（ops/quality/evidence/residual-root-conc-B.log）。
- 反例（期望）：root 的该用例与 core 现版本一致地注入空闲端口（`callbackPort: await freePort()`，并断言 URL 用该端口），使两个 root suite 并发也全绿。
- 影响：任何“多人/多 agent 同时跑 `pnpm test`”的场景仍可复现同一 flake（root 侧）。
- 注：root `src/host/pool-auth.ts` 已透传 core 的 `PoolAuthFlowDeps.callbackPort`，无需再改 src。

## F2（弱测试，交 Lead 决定）core `test/pool-auth.test.ts` 第 4 个用例离线时静默通过

- 位置：`packages/core/test/pool-auth.test.ts` —— `catch (err) { if (String(err).includes('fetch failed')) return // offline: skip }`。
- 问题：网络不可达时该用例**无任何断言地返回**，测试计数仍记 pass，属“假通过”模式（断言恒真等价物）。
- 建议（未实施）：改为显式 `t.skip('offline')` 或断言“离线”分支为 UNKNOWN 并让 CI 可见，而不是静默 pass。
- 未实施原因：修改会改变离线环境下的套件结果（可能由绿转红），需 Lead/测试所有者决策，且本次任务聚焦端口争用。
