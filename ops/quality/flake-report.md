# T6 core 测试间歇失败（端口争用）— 复现、根因、修复、验证

- task: task-6（owner worker-repo），write_scopes = packages/**
- repo: /home/csy/Code/Github/dsh-cloudcode-link，submodule packages/core
- 修复前基线 commit: 1c0931a7b625a8e66699e8011e3736d0ff997416（core 子模块）
- 结论: **根因假设「端口争用」成立且已用实验证明**；修复后并发/顺序全绿；**残留 1 处**：root `test/pool-auth.test.ts` 仍写死 51121（不属本任务范围，见第 6 节）

## 1. 复现与失败率（原始运行，非推断）

| 场景 | 次数 | 失败 | 原始证据 |
|------|------|------|----------|
| 修复前，顺序跑 `packages/core` 全套 | 12 | **0** | ops/quality/flake-before-1..12.log；每次 `tests 212 / pass 212 / fail 0` |
| 修复前，**6 路并发**跑单文件 `test/pool-auth.test.ts` | 6 | **5** | ops/quality/evidence/pre-fix-conc-*.log |
| 修复前，2 路并发跑单文件 | 2 | **1** | ops/quality/evidence/exp2-a.log(exit 0) / exp2-b.log(exit 1) |
| 修复前，另起进程占住 51121 再跑单文件 | 1 | **1** | ops/quality/evidence/pre-fix-holder-51121.log |
| 修复后，**6 路并发**跑单文件 | 6 | **0** | ops/quality/evidence/postfix-conc-*.log |
| 修复后，顺序跑 core 全套 | 12 | **0** | ops/quality/flake-after-1..12.log，`212/212` |
| 修复后，2 个完整 core suite 并发 | 2 | **0** | /tmp/flake/postfix-fullA|B.log，`212/212` 各 |
| 修复后，root suite 与 core suite 并发 | 2 | **0** | root `255/255`、core `212/212` |
| 修复后，仍占住 51121 跑 core 全套 | 1 | **0** | /tmp/flake/fix-hold-test.log，`212/212` |
| 修复后，**2 路并发 root suite**（残留） | 2 | **1** | ops/quality/evidence/residual-root-conc-B.log |

失败原文（与审查员所见一致）：

```
✖ PoolAuthFlow begin produces a PKCE authorize URL and auto mode (13.409049ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      at TestContext.<anonymous> (file:///home/csy/Code/Github/dsh-cloudcode-link/packages/core/test/pool-auth.test.ts:24:10)
    actual: 'manual',
    expected: 'auto',
```

关键量化结论：**顺序执行 12 次全绿（0%），6 路并发 5/6 失败（83%）**。所以这不是“随机 1/6”，而是**只有在有其他进程同时在跑（并发 suite / 残留监听 / 宿主端在跑授权）时才出现**的争用型 flake；审查员看到的“约 1/6”与其所在团队当时多 agent 并发跑测试的环境一致。

现场端口证据（`ss -ltnpH | grep :51121`）：core 测试运行期间，持有者正是 `test/pool-auth.test.ts` 的子进程（例如 pid=534679）；每 100ms 采样一次，该端口在一次文件执行内被连续占用约 5.3 秒。

## 2. 根因链（逐环定位）

1. `packages/core/src/oauth.ts:34` `export const OAUTH_CALLBACK_PORT = 51121` —— 全机唯一固定回调端口；`startCallbackListener()` 直接 `server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1')`。
2. `packages/core/src/pool-auth.ts` `startFlow()`：
   ```ts
   let listener = startCallbackListener()
   let bindFailed = false
   await Promise.race([
     listener.result.then(() => {}, () => { bindFailed = true }),
     new Promise((resolve) => setTimeout(resolve, 300)),
   ])
   if (bindFailed) { await listener.close(); listener = null }
   const mode = listener ? 'auto' : 'manual'
   ```
   绑定失败（EADDRINUSE）在 300ms 内到达 ⇒ `mode='manual'`。**这是产品上的正确降级**（端口被占时改为手动粘贴回调链接），不是产品缺陷。
3. `packages/core/test/pool-auth.test.ts:24` 断言 `st.mode === 'auto'` —— 该断言隐含“本进程独占 51121”的环境假设，假设被并发打破即失败。
4. 争用来源不止一个：**root 的 `test/pool-auth.test.ts:7` 也 `import { PoolAuthFlow } from '../src/host/pool-auth.ts'` 并 `begin()`**，同样绑定 51121；`node --test` 默认按文件并行；本会话有多个 agent 同时执行 `pnpm test`。
5. 加重因素：core 测试第 4 个用例（`pool-auth.test.ts` 末尾）原本不 `cancel()`，监听器泄漏至进程退出，加宽了争用窗口。

## 3. 修复（最小改动，生产行为不变）

核心：把「固定端口」参数化，默认值仍是已注册的 51121 —— 生产只多了一个可选入参，行为与字节语义不变；测试改用 OS 分配的空闲端口，从不与其它进程抢 51121。

```diff
# packages/core/src/oauth.ts
-export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`
+/** Redirect URI for the registered callback port; overridable so a listener can bind an isolated port. */
+export function oauthRedirectUri(port: number = OAUTH_CALLBACK_PORT): string {
+  return `http://localhost:${port}${OAUTH_CALLBACK_PATH}`
+}
+export const OAUTH_REDIRECT_URI = oauthRedirectUri()

-export function buildAuthorizeUrl(challenge: string, state: string): string {
+export function buildAuthorizeUrl(challenge: string, state: string, redirectUri: string = OAUTH_REDIRECT_URI): string {
-  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI)
+  url.searchParams.set('redirect_uri', redirectUri)

-export async function exchangeCode(code, verifier, proxyUrl?): Promise<TokenSet> {
+export async function exchangeCode(code, verifier, proxyUrl?, redirectUri: string = OAUTH_REDIRECT_URI): Promise<TokenSet> {
-      redirect_uri: OAUTH_REDIRECT_URI,
+      redirect_uri: redirectUri,

-export function startCallbackListener(timeoutMs = 300_000): CallbackHandle {
+export function startCallbackListener(options: { port?: number; timeoutMs?: number } = {}): CallbackHandle {
+  const timeoutMs = options.timeoutMs ?? 300_000
+  const port = options.port ?? OAUTH_CALLBACK_PORT
-        ? new Error(`port ${OAUTH_CALLBACK_PORT} is busy`)
+        ? new Error(`port ${port} is busy`)
-  server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1')
+  server.listen(port, '127.0.0.1')

# packages/core/src/pool-auth.ts
 export interface PoolAuthFlowDeps {
   openBrowser?: (url: string) => Promise<boolean>
+  /** Callback port; defaults to the registered OAUTH_CALLBACK_PORT. Isolated listeners (tests) pass their own free port. */
+  callbackPort?: number
 }
+  private readonly callbackPort?: number      // 构造函数: this.callbackPort = deps.callbackPort
-    const url = buildAuthorizeUrl(challenge, state)
-    let listener = startCallbackListener()
+    const url = buildAuthorizeUrl(challenge, state, oauthRedirectUri(this.callbackPort))
+    let listener = startCallbackListener({ port: this.callbackPort })
-      const tokens = await exchangeCode(code, flow.verifier, flow.proxyUrl)
+      const tokens = await exchangeCode(code, flow.verifier, flow.proxyUrl, oauthRedirectUri(this.callbackPort))
```

```diff
# packages/core/test/pool-auth.test.ts
+/** Ask the OS for a currently free TCP port ... */
+async function freePort(): Promise<number> { /* createServer().listen(0) → address().port → close */ }
-  const flow = new PoolAuthFlow(pool, quota, () => {}, { openBrowser: async () => true })
+  const port = await freePort()
+  const flow = new PoolAuthFlow(pool, quota, () => {}, { openBrowser: async () => true, callbackPort: port })
-  assert.ok(st.url?.includes('redirect_uri=http%3A%2F%2Flocalhost%3A51121'))
+  assert.ok(st.url?.includes(`redirect_uri=http%3A%2F%2Flocalhost%3A${port}`))
+  // production default stays the registered callback port
+  assert.equal(OAUTH_REDIRECT_URI, 'http://localhost:51121/oauth-callback')
   ...
   } catch (err) { if (String(err).includes('fetch failed')) return }   // 保持原样，未改
+  } finally { await flow.cancel() }   // 释放端口，不再泄漏监听器
```

diffstat（core 子模块）：`src/oauth.ts +22/-8`、`src/pool-auth.ts +11/-3`、`test/pool-auth.test.ts +41/-7`；合计 56 insertions / 18 deletions。

**未做**：没有跳过任何用例、没有放宽断言（断言反而多了一条钉死生产默认 redirect URI）、没有删测试、没有加 sleep、没有改 root 的 `test/**`。

## 4. 修复后回归门禁

| 命令 | 退出码 | 结果 |
|------|--------|------|
| `packages/core && pnpm check` | 0 | `tsc --noEmit` 无诊断（ops/quality/core-check-postfix.log） |
| `packages/core && pnpm test` ×12 | 0 | 每次 `tests 212 / pass 212 / fail 0 / skipped 0 / todo 0`（ops/quality/flake-after-*.log） |
| repo 根 `pnpm check` | 0 | 无诊断（ops/quality/root-check-postfix.log） |
| repo 根 `pnpm test` | 0 | `tests 255 / pass 255 / fail 0 / skipped 0 / todo 0`（ops/quality/root-test-postfix.log） |
| repo 根 `pnpm build` ×3 | 0 | `dist/index.js` 三次哈希一致（见第 5 节） |

## 5. 构建产物影响（需要 Lead 决策，不要忽略）

`src/host/*.ts` 直接引用并内联 `packages/core/src/*.ts`，所以 **core 的源码修复必然改变 root 的 `dist/index.js`**：

| 文件 | 修复前 sha256 | 修复后 sha256 |
|------|---------------|---------------|
| `dist/index.js` | 73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf | **6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4** |
| `dist/client.js` | 3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717 | 不变 |
| `dist/index.d.ts` | 3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e | 不变 |

- 已重建 `packages/core/dist`（未跟踪）与 root `dist`；`pnpm build` 连跑 3 次哈希一致（可复现）。
- 因此 **`git status --short dist` 现在是 ` M dist/index.js`，不再为空**：T1 记录的“dist 与 HEAD 逐字节一致”只对 `dc0ca77` 成立；本工作区现在满足的是“dist == build(当前 src)”。
- 部署面：profile 依赖锁定 GitHub 提交 `dc0ca77`，安装副本未变 ⇒ **该修复不在已部署产物里**。两条路任选：
  (a) 发布：提交 packages/** + dist → push → 在 `~/.dsh/profiles/web` 重装 → 重启 → 重新校验（T2/T4 的哈希证据需按新提交重算）；
  (b) 冻结部署：`git checkout -- dist` 并回退 packages/** 改动，本 flake 修复不进产物（T4 证据保持有效）。

## 6. 残留问题（不在本任务写范围，需 Lead 派单给 root `test/**` 所有者）

1. **root `test/pool-auth.test.ts` 仍写死 51121**：修复后并跑两个 root suite 仍会出现同一失败（`test/pool-auth.test.ts:24 actual 'manual' expected 'auto'`，254/255，见 ops/quality/evidence/residual-root-conc-B.log）。建议改动与 core 完全一致（root `src/host/pool-auth.ts` 已透传 `PoolAuthFlowDeps`，可原样传 `callbackPort`）：
   ```ts
   const port = await freePort()   // 同上辅助函数
   const flow = new PoolAuthFlow(pool, quota, () => {}, { openBrowser: async () => true, callbackPort: port })
   assert.ok(st.url?.includes(`redirect_uri=http%3A%2F%2Flocalhost%3A${port}`))
   ```
2. **core `test/pool-auth.test.ts` 第 4 个用例存在静默跳过**：`catch (err) { if (String(err).includes('fetch failed')) return // offline: skip }` —— 离线时该用例无断言地“通过”，属弱测试。本次**未改**（避免扩大范围、避免离线 CI 变红），列入 findings 交 Lead 决定。
3. 端口固定本身是产品必要约束（redirect_uri 必须与注册值一致），生产宿主若恰有另一个进程占用 51121，授权会正确降级为 manual —— 属预期行为，不是缺陷。

## 7. 证据文件索引

- 复现/回归日志：ops/quality/flake-before-1..12.log、flake-after-1..12.log、root-test-postfix.log、core-check-postfix.log、root-check-postfix.log、root-build-postfix-1|2.log
- 实验原始输出：ops/quality/evidence/（pre-fix-holder-51121.log、exp2-a|b.log、pre-fix-conc-1..6.log、postfix-conc-1..6.log、residual-root-conc-A|B.log、single-run-9.log）
- 汇总：ops/quality/flake-before-summary.log、ops/quality/flake-after-summary.log

---

# T7 追加：F1（root 端口写死）+ F2（core 弱测试）修复与发布验收

task-7（worker-repo），write_scopes = test/**、packages/**。子模块 commit：**e52abe7786a3ee503759be51986180b339d422d1**（root 仓库未提交，交 T8）。

## 8. F1：root `test/pool-auth.test.ts` 改为动态空闲端口

- 修复前证据：两个 root suite 并发 → 其中一个 `pass 254 / fail 1`，`test/pool-auth.test.ts:24 actual 'manual' expected 'auto'`（ops/quality/evidence/residual-root-conc-B.log）。
- 改动（与 core 同款，root `src/host/pool-auth.ts` 是 `export * from core`，**未改 src**）：
  - 新增 `freePort()`（`node:net` 探针 `listen(0)` → 取端口 → close）；
  - 4 个用例各自注入 `{ callbackPort: port }`；
  - 断言改为 `redirect_uri=http%3A%2F%2Flocalhost%3A${port}`，并**新增**一条钉死生产默认：`assert.equal(OAUTH_REDIRECT_URI, 'http://localhost:51121/oauth-callback')`；
  - wrong-state 用例里的字面 URL 改为使用注入端口；
  - 第 4 个用例补 `finally { await flow.cancel() }`（此前泄漏监听器）。
- root diff：`test/pool-auth.test.ts | 52 ++++++---`，未改断言强度（断言只增不减）。

## 9. F2：core/root 第 4 个用例的离线分支改为显式判定

- 旧代码：`catch (err) { if (String(err).includes('fetch failed')) return // offline: skip }` —— 一旦异常逃逸，用例零断言记 pass。
- 新代码（core 与 root 同步）：
  ```ts
  } catch (err) {
    if (String(err).includes('fetch failed')) {
      t.diagnostic('token endpoint unreachable (fetch failed): rejecting-code path NOT verified')
      t.skip('offline: cannot reach the token endpoint to verify the rejection path')
      return
    }
    throw err
  } finally { await flow.cancel() }
  ```
- `t.skip` 机制实测（/tmp/flake/skip-probe.test.mjs，非仓库文件）：
  ```
  ﹣ explicit skip mechanics (1.024638ms) # offline: reason text
  ℹ diagnostic line visible in output
  ℹ pass 0   ℹ fail 0   ℹ skipped 1
  ```
- 离线实测（用死代理强制网络不可达，`HTTPS_PROXY=http://127.0.0.1:1` 跑 core 单文件）：
  ```
  ✔ PoolAuthFlow fails cleanly when the exchange is rejected (351.18283ms)
  ℹ tests 5  ℹ pass 5  ℹ fail 0  ℹ skipped 0
  ```
  即：**当前实现下离线并不会走 skip 分支** —— `finishWithCode` 内部 `catch (err) { this.fail('授权码交换失败: …') }`（packages/core/src/pool-auth.ts）把传输错误转成 `phase='failed'`，断言路径离线同样真实执行。因此 F2 的真实问题是“异常逃逸时静默记 pass”这一潜在漏洞，现已改为显式 skip + diagnostic（可计数的 skipped，不再静默）。

## 10. T7 验收原始输出（逐条）

| 项 | 命令 | 退出码 | 原始结果 |
|----|------|--------|----------|
| A root 单跑 | `pnpm test` | 0 | `tests 255 / pass 255 / fail 0 / skipped 0 / todo 0`（ops/quality/t7-root-single.log） |
| B 两个 root suite 并发 | `pnpm test` ×2 | 0 / 0 | A `255/255`、B `255/255`（t7-root-conc-A|B.log） |
| C root + core 并发 | `pnpm test` ×2 | 0 / 0 | root `255/255`、core `212/212`（t7-root-with-core.log / t7-core-with-root.log） |
| D 外部占住 51121，root+core 并发 | `node -e "…listen(51121…)"` + 两个 suite | 0 / 0 | holder `pid=573192` LISTEN 127.0.0.1:51121；root `255/255`、core `212/212`（t7-root-holder.log / t7-core-holder.log） |
| E 类型检查 | `pnpm check`（root / core） | 0 / 0 | 均 `tsc --noEmit` 无诊断（root-check-t7.log / core-check-t7.log） |
| F 构建确定性 | `pnpm build` ×3 | 0/0/0 | 三次 `dist/index.js` sha256 一致 = `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`（t7-build-1|2|3.log） |
| F2 git 状态 | `git status --short dist` | — | 仅 ` M dist/index.js`（t7-acceptance.log） |
| 提交后回归 | root+core 并发 | 0 / 0 | root `255/255`、core `212/212`（t7-root-postcommit.log / t7-core-postcommit.log） |

汇总日志：ops/quality/t7-acceptance.log。三个信号文件哈希（T7 后）：
- `dist/index.js` `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`
- `dist/client.js` `3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717`
- `dist/index.d.ts` `3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e`
