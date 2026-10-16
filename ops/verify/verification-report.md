# T4 重启后端到端探针 — 结论

最新生效证据对应 host PID **524277**（启动 14:46:46 CST，晚于安装 12:05:25）；
最新运行日志 `ops/verify/probe-2026-10-16T06-49-07-493Z.log` → `VERDICT: PASS (PASS=9 FAIL=0 UNKNOWN=0, exit 0)`。
（此前 PID 518224 / 500951 两轮同样 PASS，日志保留在 ops/verify/。）

**已修正的记账口径**：`models_upstream_side` 现在只在 `/catalog` 的 `source === "discovered"` 时判 PASS；
若目录来自本地兜底列表（`source="fallback"`），该条判 UNKNOWN 而非 PASS —— 因为兜底列表只证明插件目录契约，
不证明上游发现路径被真实执行（早先 06:47 那次运行即 `source="fallback" count=12`，其 PASS 结论不再沿用）。
最新运行 `source="discovered" count=18`，为真上游侧证据。

## 运行命令（可原样执行）

```
cd /home/csy/Code/Github/dsh-cloudcode-link && node scripts/verify/post-restart-probe.mjs
```

detached（重启后由调度器运行，自身不依赖任何 agent 会话）：

```
systemd-run --user --collect --unit=ccl-probe-$(date -u +%H%M%S) --property=WorkingDirectory=/home/csy/Code/Github/dsh-cloudcode-link /bin/bash -lc 'node scripts/verify/post-restart-probe.mjs'
```

本次已用同一形状做过 detached 自检：`systemd-run --user --collect --wait --pipe --unit=ccl-probe-selftest-<pid> ...`
→ `Finished with result: success`，产出于 `ops/verify/probe-2026-10-16T06-24-31-363Z.log`。

退出码语义：`0` = 全部 PASS；`1` = 存在 FAIL；`2` = 无 FAIL 但存在 UNKNOWN（UNKNOWN 绝不算 PASS）。

## 最新一次运行

- 日志：`ops/verify/probe-2026-10-16T06-46-16-700Z.log`（机读：同名 `.json`）
- 结果：`VERDICT: PASS (PASS=9 FAIL=0 UNKNOWN=0, exit 0)`

| 断言 | 判定 | 关键原始证据 |
|---|---|---|
| service_ready | PASS | `GET / -> HTTP 401`（host 在线） |
| process_fresh | PASS | `MainPID=518224 ExecMainStartTimestamp=Fri 2026-10-16 14:40:53 CST`；`hostStartMs=1792132852657 (06:40:52.657Z)` **晚于** 安装副本 mtime `1792123525479.5623 (04:05:25.479Z)`；`ss: 127.0.0.1:3080 pid=518224` |
| artifact_pinned | PASS | 安装副本 `dist/index.js` sha256 `73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf` == `git show HEAD:dist/index.js` == 工作区 dist == HEAD `dc0ca77`；`client.js` 哈希仅记录为 INFO（dc0ca77 未改客户端，不作生效证据） |
| bundle_defines_ccl | PASS | 交付包内 `commands.register`@1230341 < `cclCommandDefinition(cmdDeps,"ccl")`@1230359 < `"cloudcode"`@1230421 < `regBoth("status"`@1232667 < `inject(["webServer"])`@1248389；`/ccl` 与别名 `cloudcode` 注册均在路由装配之前 |
| ccl_registered_in_live_host | PASS | 该路由由**新 PID 518224** 服务（`GET /plugins/cloudcode-link/status -> HTTP 200`），而 apply() 是直落函数体：路由被服务 ⇒ 其之前的 `ctx.commands.register('ccl'/'cloudcode')` 已执行。直接敲 `/ccl` 需带认证的会话 API，本地 HTTP 面不可达，故未做交互式调用（未虚构） |
| quota_refresh_live | PASS | `POST .../pool/refresh-quota -> HTTP 200 (13.5s, ok=true)`；9 条 family：`resetTime="2026-10-16T11:46:1xZ"`（= 19:46 CST，**未来**）`weeklyFraction` ∈ {1, 0.27856246, 0.220663} 全在 [0,1]；`updatedAt=1792133163153` 即刷新当下 |
| models_upstream_side | PASS | **上游侧（docs §1）**：`/catalog` `source="discovered" count=19`，要求的 10 条 §1 slug（gemini-3.8-flash/gemini-3.6-flash/gemini-3.5-flash/gemini-3-flash/gemini-3.1-flash-lite/gemini-2.5-pro/gemini-2.5-flash/claude-sonnet-4-6/claude-opus-4-6-thinking/gpt-oss-120b-medium）全部在列，missing=(none) |
| models_fallback_side | PASS | **插件本地兜底常量（docs §2）**：从交付包提取 `DEFAULT_FALLBACK_MODELS` 共 12 条，与 §2 完全一致，missing=(none)。两侧清单分开断言，未混用 |
| journal_no_import_failure | PASS | `journalctl --user -u deepseek-harness.service --since <hostStart>` 中 dsh-cloudcode-link 导入失败 0 条；其它插件（subagent-director/lsp/hooks-claude-code，5 条）的失败为既存无关项，记为 INFO |

UNKNOWN：无。

## 断言非恒真 / 非空洞的证据

1. 重启前同一脚本基线：`VERDICT: FAIL (PASS=7 FAIL=2)`，`process_fresh` 与 `ccl_registered_in_live_host` 如实 FAIL —
   旧 PID 420693 启动 10:03:12 早于安装 12:05:25，探针拒绝判 PASS（日志 `probe-2026-10-16T06-20-13-916Z.log`）。
2. 分支可达性对照：把同字节产物复制到 `/tmp/ccl-probe-sim` 并把 mtime 提前到 09:00 后，
   `process_fresh`/`ccl_registered_in_live_host` 转为 PASS（`probe-2026-10-16T06-20-30-464Z.log`）——
   说明该断言确实由「进程晚于产物」这一事实驱动，两个分支都可达。
3. 负向对照：`scripts/verify/negative-control-fixture.mjs`（仅用于证明断言会 FAIL，**不是**插件证据）
   伪造 `resetTime=2020-01-01`、无 weeklyFraction、目录缺模型 → 探针判
   `quota_refresh_live FAIL`（resetTime 非未来 + 无 weeklyFraction + updatedAt 陈旧）与 `models_upstream_side FAIL`。

## 说明（未美化）

- 探针的「功能证据」走**运行中 host 的插件 HTTP 面**（`/plugins/cloudcode-link/{status,pool,pool/refresh-quota,catalog}`），
  即安装副本自身的产物在真实进程内执行；不 mock、不读仓库 src（仓库 `src/**` 不参与判定）。
- `/ccl` 的**交互式**调用未取证（无认证会话 API），只给出「交付包注册顺序 + 新进程加载该交付包 + 其路由正被服务」的推理链，
  已在日志 note 中标注，未当作交互验证。
