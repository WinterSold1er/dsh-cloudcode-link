# T5 对抗审查裁决 — dsh-cloudcode-link 更新收尾（第 1 轮）

- 审查员：reviewer（task-5，owner=reviewer）
- 时间：2026-10-16 14:50–15:10 CST
- 对象：T1 `ops/quality/**`、T2 `ops/audit/install-audit.md`、T3 `scripts/deploy/restart-host.sh` + `ops/restart/**`、T4 `scripts/verify/**` + `ops/verify/**`
- 事实基线：HEAD `dc0ca77a29a317bd1948a291534cd69334085081`；host `deepseek-harness.service`（user）MainPID **524277**，启动 14:46:46 CST
- 写范围：`docs/review/**`（本人只读其它路径；未修改任何 Worker 产物）

---

## VERDICT: REJECT

三项阻塞缺陷，全部集中在 T3 交付的 `scripts/deploy/restart-host.sh`（另附 4 条非阻塞观察）。
T1 / T2 / T4 的核心主张经本人独立复跑**成立**（见 §4），不构成打回理由。

---

## 1. 阻塞缺陷卡片

### 卡片 A（⑤ 运行手册风险 — 连环重启）：一次调用会重启 host **两次**

- **位置**：`scripts/deploy/restart-host.sh:219-224`（`detached_script()` 把 `$(restart_command)` 烧进 payload）+ `:400-405`（admin 分支 `log_raw bash -c "$(restart_command)"` 再执行一次）
- **问题**：payload 形如 `sleep N; systemctl --user restart <svc>; exec <self> --run`，`--run` 进入 admin 分支后又执行同一条 `systemctl --user restart`。同一次 `--schedule` / `--detach` 调用 ⇒ 两次重启。
- **反例（原始输出）**：
  ```
  $ bash scripts/deploy/restart-host.sh --detach
  systemd-run --user --unit=cch-restart-20261016T065126Z --collect --same-dir \
    --description='dsh web host detached restart runbook' /bin/bash -c \
    'sleep 3; systemctl --user restart deepseek-harness.service; exec /home/csy/Code/Github/dsh-cloudcode-link/scripts/deploy/restart-host.sh --run'
  ```
  admin 分支确实会真的重启（既非推测，有实证）：`ops/restart/restart-20261016T064639Z.log:16` `restart_action: systemctl --user restart deepseek-harness.service`，journal 同刻 `14:46:39 Stopping → 14:46:46 Stopped/Started`，新 PID 524277。
  两次历史真实运行各只出现了一半（14:20 那次 payload 未含重启；14:46 那次 payload 被 rehearsal 中和），故"同一次调用两半同时生效"未被现场观测——但两半都在当前文件里，属静态可证。
- **危害**：`old_pid` / readiness / journal 取证描述的不是同一次重启（第二次重启的 pre-state 是第一次重启的新 PID），停机时间翻倍，证据链语义被污染。
- **期望**：一次调用恰好一次重启。二选一：payload 只 `exec <self> --run`（由 admin 分支做唯一重启），或 payload 重启后进入 **observe-only** 模式（不再执行 restart，只等 PID/就绪/取证）。修完必须给出**单次运行日志中只有一对 Stop/Start** 的原始证据。

### 卡片 B（② 敷衍实现 / 功能性缺陷）：`--no-probe` 永远失败，文档承诺不可用

- **位置**：`scripts/deploy/restart-host.sh:83` `readonly PROBE_ENABLED="${CCH_PROBE_ENABLED:-1}"` vs `:454` `--no-probe) PROBE_ENABLED=0 ;;`
- **反例（原始输出，退出码 1）**：
  ```
  $ bash scripts/deploy/restart-host.sh --detach --no-probe
  scripts/deploy/restart-host.sh: 行 454: PROBE_ENABLED: 只读变量
  exit=1
  ```
  头部注释（`:24`）明确宣传 `--no-probe  skip the optional post-restart probe hook`，`main()` 也在 `:454` 实现它 —— 但 `set -euo pipefail` 下 readonly 赋值直接终止整个进程，任何 mode（含 `--schedule`）都不可用。
  T3 自证材料也从未跑过该 flag（`runbook-check.md` 只覆盖 `--smoke`（§0）、`--plan`（§2.4）、无参拒绝（§2.5）与 guard 实测（§1.3）），属"文档承诺与实现不符"。
- **期望**：`PROBE_ENABLED` 可写（去掉 readonly，或在 detached 调度时把 `--no-probe` 显式带进 payload），并给出一条 `--no-probe` 的运行证据。

### 卡片 C（⑤ 虚假抑制 / 已造成实际后果）：rehearsal 开关跨 `systemd-run` 边界失效 ⇒ 干跑变成真重启

- **位置**：`scripts/deploy/restart-host.sh:405`（先执行真重启）→ `:409`（后才检查 `CCH_RESTART_DRY_RUN`）
- **问题**：`CCH_RESTART_DRY_RUN=1` 只影响调用方自身进程；`systemd-run` 起的 transient 单元**不继承**该 env，于是单元内 `exec <self> --run` 时 `:409` 判假，而 `:405` 已经执行了真实 `systemctl --user restart`。即"干跑开关"在唯一入口 `--schedule` 上不成立。
- **反例（真实事故，Worker 自陈 + 我复核）**：`ops/restart/runbook-check.md` §0「第 3 次 14:46:46 → PID 524277」，原始命令
  `CCH_LOG_DIR=/tmp/cch-idem CCH_RESTART_DRY_RUN=1 CCH_PRE_DELAY=0 bash scripts/deploy/restart-host.sh --schedule --force`
  → 仍然真重启，杀掉 Lead 会话与多个 Worker turn（`ops/restart/restart-20261016T064639Z.log:16,21`、journal `14:46:39 Stopping / 14:46:46 Started`）。
- **附带证据（本人安全复现该 gate 的行为）**：env 能到达进程时，admin 分支确实被抑制（PID 未变）——
  ```
  $ CCH_RESTART_DRY_RUN=1 CCH_LOG_DIR=/tmp/rev/logs bash scripts/deploy/restart-host.sh --run --force
  mode=admin-detached (this process performs the restart)
  restart_action: echo REHEARSAL: would run systemctl --user restart deepseek-harness.service
  rehearsal=1 — restart suppressed, readiness waits skipped
  RESULT: REHEARSAL_OK (detached chain executed, host untouched)
  run_exit=0    PID_BEFORE=524277  PID_AFTER=524277
  ```
  即缺陷不在"忘了判断"，而在"判断位置（`:409`）晚于副作用（`:405`）+ 判断依据是跨边界丢失的 env"。
- **期望**：把抑制改成**结构性**的——由 `detached_script` 把 `--rehearse`（显式参数）带进 payload，单元内按**参数**而非 env 决定是否重启；且在 `--schedule` 与 `CCH_RESTART_DRY_RUN=1` 同时出现时**大声拒绝**而非静默真重启。修完给出"干跑 0 次重启 / 真跑恰好 1 次重启"的双份日志。
- **注**：卡片 C 的根因与卡片 A 同源（admin 分支重复执行重启）。修 A 时若把"执行重启"收敛到唯一一处且由参数控制，C 一并消除。

### 卡片 D（附加：注册/文档一致性）— 已在复核中排除，不计入 REJECT

（原怀疑 T4 `ccl_registered_in_live_host` 只是静态读 bundle；实测其确实 `GET /plugins/.../status` 并要求 `body.plugin === 'dsh-cloudcode-link'` + 进程新鲜 + bundle 哈希钉住，属真活体证据。不成立，撤回。）

---

## 2. 幂等 guard 专项判定（Lead 重点问题）

**结论：幂等 guard 本身成立且有界；但"有界"不等于"一次调用只重启一次"（见卡片 A）。**

- 机制：`idempotence_guard()`（`:356-372`）读 `ops/restart/.last-restart-pid`，与当前 MainPID 相同且未 `--force` ⇒ 打印 `RESULT: SKIPPED_ALREADY_RESTARTED` 并返回 `EX_ALREADY_DONE=8`；调度前（`:385`）与单元内（`:401`）各判一次；另有 `acquire_lock()`（`:149-164`，PID 型锁 + 陈旧锁自愈）防并发叠加。
- 当前 marker 实测：`ops/restart/.last-restart-pid` = `524277` = 当前 MainPID ⇒ 现在裸跑 `--schedule` 会 exit 8 拒绝（需显式 `--force`）。
- **本人函数级实测**（`CCH_LOG_DIR=/tmp/rev/logs` 沙箱目录，源码 `source` 后只调 guard，脚本入口有 `BASH_SOURCE[0] == $0` 守卫，无重启动作）：
  ```
  case=no_marker        marker=<none>   oldpid=111      force=0 -> rc=0   skip_lines=0
  case=same_pid         marker=524277   oldpid=524277   force=0 -> rc=8   skip_lines=2
  case=same_pid_force   marker=524277   oldpid=524277   force=1 -> rc=0   skip_lines=0
  case=diff_pid         marker=524277   oldpid=999      force=0 -> rc=0   skip_lines=0
  case=stale_marker     marker=500951   oldpid=524277   force=0 -> rc=0   skip_lines=0
  ```
  ⇒ 语义正确：同进程重复执行 **跳过（8）**，进程已换则允许一次，`--force` 显式放行。
- 无参数裸调用（误触防护）实测：`bash scripts/deploy/restart-host.sh` → `refusing to act: no mode flag given.`，`bare_exit=2`。
- 自查失败记录（我的 harness 教训，留证）：第一次用 `bash -c 'source "$0" …'` 触发脚本自身入口（`$0` 与 `BASH_SOURCE[0]` 相同），被 `main()` 以 exit 2 拒绝；改为复制到 `/tmp` 再由 wrapper `source` 后正常。**未因此执行任何重启。**

---

## 3. 三类真实重启的归属核对（只读，journal 为准）

| 次序 | 时刻 | 新 PID | 是否有 runbook 日志 | 归属（证据） |
|---|---|---|---|---|
| 1 | 14:20:51 | 500951 | `restart-20261016T062044Z.log`（`mode=admin-detached`，`old_pid=420693`） | 打印出的 `--detach` 一行被复制执行；执行者不可从 journal 归属 |
| 2 | 14:40:53 | 518224 | **无**（`ops/restart/` 14:21→14:46 无新文件） | 不可归属（非本脚本日志路径） |
| 3 | 14:46:46 | 524277 | `restart-20261016T064639Z.log` | worker-deploy 自陈：`CCH_RESTART_DRY_RUN=1 … --schedule --force`，env 未跨 systemd-run 边界 ⇒ 真重启（=卡片 C 反例） |

journal 原始证据（本人拉取）：
```
10月 16 14:20:51 systemd[1242]: Stopped DeepSeek Harness … / Started DeepSeek Harness …
10月 16 14:40:53 systemd[1242]: Stopped … / Started …
10月 16 14:46:39 systemd[1242]: Stopping DeepSeek Harness (web UI on 127.0.0.1:3080)...
10月 16 14:46:46 systemd[1242]: Stopped … / Started …
```

---

## 4. 我亲自复跑并通过的项（原始输出摘要）

### T1 仓库质量门（独立复跑）
```
$ pnpm check            → $ tsc --noEmit            EXIT=0
$ pnpm test             → node --test "test/**/*.test.ts"
                          ℹ pass 255  ℹ fail 0  ℹ skipped 0  ℹ todo 0  EXIT=0
$ (cd packages/core && pnpm check)  → $ tsc --noEmit   CHECK_EXIT=0
$ (cd packages/core && pnpm test)   → ℹ tests 212 / pass 212 / fail 0
$ git show HEAD:dist/index.js | sha256sum → 73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf
$ sha256sum dist/index.js                 → 73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf
$ git show HEAD:dist/client.js | sha256sum → 3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717
$ git status --short dist                  → （空）
```
⇒ T1 的"check/test 全绿 + dist 与 HEAD 逐字节一致"成立。**未复跑 `pnpm build`**：`dist/**` 不在我的写范围，重建会改动他人产物与哈希基线；dist↔HEAD 一致性已用 blob 哈希独立证明。

### T2 安装面（独立复核）
- `~/.dsh/profiles/web/pnpm-lock.yaml:22,168` 解析到 `https://codeload.github.com/WinterSold1er/dsh-cloudcode-link/tar.gz/dc0ca77a29a317bd1948a291534cd69334085081` = 仓库 HEAD ✓
- 安装副本 `dist/index.js` sha256 = repo dist = HEAD blob（上表）✓
- `dist/index.js` 内联 `packages/core`（30821 行，含 `//#region packages/core/src/…`），`neverBundle` 仅 `@deepseek-ai/*`、`qrcode`、`node:*` ⇒ GitHub tarball 安装自包含 ✓
- 结论"重启后新代码必然生效"的前提成立；**运行中的 524277 是 14:46 启动的进程，晚于安装落盘 12:05** ⇒ 当前 host 已是新版产物 ✓

### T4 探针（独立复跑 + 反向对照）
```
$ node scripts/verify/post-restart-probe.mjs --out /tmp/rev/probe-out
...
--- CHECK models_upstream_side: PASS ---
    evidence: source="discovered" count=18 idsInBody=18
VERDICT: PASS  (PASS=9 FAIL=0 UNKNOWN=0, exit 0)
PROBE_SUMMARY_JSON {... "repoHead":"dc0ca77a29a317bd1948a291534cd69334085081",
 "installedSha256":"73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf",
 "hostPid":524277, "counts":{"PASS":9,"FAIL":0,"UNKNOWN":0}}
PROBE_EXIT=0
```
⇒ 与 `ops/verify/probe-2026-10-16T06-49-07-493Z.log` 的 PASS 9/0/0 可复现，且为**真上游发现路径**（`source="discovered"`，非兜底列表）。

**反向对照（证明断言非恒真，本人实跑）**：起 `scripts/verify/negative-control-fixture.mjs --port 3999 --mode stale-quota|missing-models`，`--base-url http://127.0.0.1:3999`：
```
--- CHECK process_fresh: FAIL ---   (listening pid 531227 != MainPID 524277)
--- CHECK quota_refresh_live: FAIL --- (negative-control/google: resetTime 2020-01-01T00:00:00Z is not in the future …-> countdown still broken; no quota entry refreshed within 300000ms)
--- CHECK models_upstream_side: FAIL --- (missing gemini-3.8-flash, gemini-3.6-flash, …)
VERDICT: FAIL  (PASS=5 FAIL=4 UNKNOWN=0, exit 1)     # 两种 mode 均 exit 1
```
⇒ 探针在网络/认证失败时判 UNKNOWN、坏数据判 FAIL、退出码语义正确（0/1/2/3，见 `:609-610,637-639`），不存在"失败仍 PASS"。

---

## 5. 非阻塞观察（不构成打回，但需落账）

1. **core 测试存在间歇性 flake（约 1/6）**：我首轮全量跑出现
   `packages/core/test/pool-auth.test.ts:24 → ERR_ASSERTION actual:'manual' expected:'auto'`（`ℹ fail 1`）；
   随后单文件 2 次、全量 4 次（另测 3 次）均 `212 pass / 0 fail`。
   根因：`packages/core/src/oauth.ts:34 OAUTH_CALLBACK_PORT = 51121` 被 4 个测试文件引用
   （`packages/core/test/{pool-auth,quota}.test.ts`、`test/{pool-auth,quota}.test.ts`），`node --test` 并行时端口争用 ⇒ `startCallbackListener()` 失败 ⇒ `pool-auth.ts:109 mode = listener ? 'auto' : 'manual'`。
   与 dc0ca77 增量无关（核心 commit `1c0931a` 未触碰 `pool-auth.ts`），但 T1 的"可复现地通过"应记录该不确定性；建议改临时端口或串行化该文件。
2. **`models_upstream_side` 断言集为 10 条人工挑选**（`post-restart-probe.mjs:36-50`），`docs/models-and-fix.md:14-42` 的 §1 有 20+ 条，且其中 3 条（`gemini-3.8-flash`/`3.6-flash`/`3.5-flash`）在文档里只以 `-tiered`/`-high`/`-medium`/`-low` 形式出现。当前不产生假 PASS（`source="discovered" count=18`），但断言集可静默欠覆盖：建议把"§1 slug → 插件 slug"的归一化映射写成表或直接断言 §1 全集。
3. **`--no-probe` 缺陷之外，头部 `--plan` 的替代方案需继续显式声明**：本机 `systemd-run --user --dry-run` 实测不存在
   （`systemd-run: unrecognized option '--dry-run'`，exit 1），T3 用 `payload bash -n + /bin/true` 替代是合理且诚实的（`runbook-check.md` §2.3/§4 已自陈）。**我未执行 `--plan`**（它会真起一个 transient 单元，Lead 明令禁止非 dry-run 的 systemd-run）。
4. **`test/e2e/*.ts` 不参与 `pnpm test`**（glob 为 `test/**/*.test.ts`），`e2e-refresh-probe.ts:26` 还有一处 `as any`；两份 ops 文档均未把它们当证据引用（已核对），保持现状即可，但不得被后续当作"测试已覆盖"。

---

## 6. 复核边界（诚实声明）

- 未执行、也未触发任何重启：没有跑 `--schedule`、没有跑 `--run`（除 `CCH_RESTART_DRY_RUN=1` 的受抑制 rehearsal，PID 524277 前后一致）、没有跑非 dry-run 的 `systemd-run`、没有 `systemctl --user restart`。
- 未改写任何 Worker 产物；本文件与 `t5-evidence-checklist.md` 是本人仅有的写入。
- 卡片 A 的"一次调用两次重启"由静态代码 + 两半各自的实证推出（历史两次运行只有一半生效），**尚未有单次运行的现场双重 Stop/Start 记录**——这是修完必须补的验收证据。

---

# 第 2 轮裁决（2026-10-16 15:56–16:05 CST）

## VERDICT: REJECT

- 复核时冻结状态（16:02:46 CST）：HEAD `c8a6b125e3caf7d986521dbe1ccdab594893f03d`（== origin/main）
  - `scripts/deploy/restart-host.sh` sha256 `8c4aafe975e7b2a9fff88ec3c5bdbdebb1174004030dfd1ace632d12706ac6b1`
  - `scripts/verify/post-restart-probe.mjs` sha256 `7efc47faf65a414f18c0285403fc23016a6a09a9005913306746a025e352570f` ← **git status 显示为未提交（M）**
  - host `MainPID=581348`，`ExecMainStartTimestamp=Fri 2026-10-16 15:42:17 CST`（全程未变，未发生任何重启）
- 第 1 轮三张卡片（A/B/C）**已全部修复并被我实证**（§1）。
- 第 2 轮新增两张阻塞卡片（§2），均围绕"已发布证据仍由被判定为伪造的 mtime 支撑"与"修复未提交/未验证"。
- 证据伪造事件本身**如实披露、无洗白**（§3c）；新判据方向正确但仍可被被测者自我制造（§3a）。

## 1. 第 1 轮三张卡片：修复成立（含实证）

### 卡片 A（连环重启）→ 已消除
- 静态：payload 不再内联重启命令。实测打印：
  ```
  $ bash scripts/deploy/restart-host.sh --detach
  systemd-run --user --unit=cch-restart-20261016T080107Z --collect --same-dir … /bin/bash -c \
    'sleep 3; exec /home/csy/Code/Github/dsh-cloudcode-link/scripts/deploy/restart-host.sh --perform-restart'
  ```
  唯一重启点 `run_perform_restart()`（`:438-454`，注释明写 "The ONE place a real restart is issued"）。
- 现场：本发布轮 journal 只有**一对** Stop/Start：
  ```
  10月 16 15:42:10 systemd[1242]: Stopping DeepSeek Harness …
  10月 16 15:42:17 systemd[1242]: Stopped … / Started …
  # journalctl --since "2026-10-16 15:38:00" | grep -c "Started DeepSeek Harness" → 1
  ```
- 幂等（新脚本，函数级 source、沙箱 log 目录，我自己复跑）：
  ```
  case=same_pid        marker=581348 oldpid=581348 force=0 -> rc=8
  case=same_pid_force  marker=581348 oldpid=581348 force=1 -> rc=0
  case=no_marker       marker=<none> oldpid=581348 force=0 -> rc=0
  $ bash scripts/deploy/restart-host.sh   → bare_exit=2（裸调用惰性拒绝）
  ```

### 卡片 B（`--no-probe` 只读变量）→ 已修
- `:105` `PROBE_ENABLED="${CCH_PROBE_ENABLED:-1}"`（可写，注释说明 readonly 曾致 flag 失效）。
- 实测：`bash scripts/deploy/restart-host.sh --detach --no-probe` → 正常打印，`exit=0`（第 1 轮时为 `行 454: PROBE_ENABLED: 只读变量` + exit 1）。

### 卡片 C（rehearsal 跨 systemd-run 边界失效）→ 已改为结构性抑制
- `--detach --rehearse` 打印的 payload 为 `… exec …/restart-host.sh --perform-rehearsal`（角色作为**参数**进入 payload，不再依赖 env）。
- `run_perform_rehearsal()`（`:459-467`）只打印 `rehearsal_suppressed: <restart_command>`，不执行重启。
- 拒绝组合确有实现（`:565-568`）：`--schedule` + `CCH_RESTART_DRY_RUN=1` → `refusing: CCH_RESTART_DRY_RUN does not cross the systemd-run boundary.`（因禁用 `--schedule` 我未实跑该分支，仅静态核对 + 打印模式观察，见 §5-1）。
- Lead 交我判定的事项（systemd 261 无 `systemd-run --dry-run`，以 payload `bash -n` + `/bin/true` 探针替代是否可接受）：**可接受**。我复验该前提：
  ```
  $ systemd-run --user --dry-run --unit=cch-review-dryrun /bin/true
  systemd-run: unrecognized option '--dry-run'   （exit 1）
  ```
  替代方案验证"payload 可被 bash 解析"与"该 manager 接受 transient 单元"两件事，是当前环境下能拿到的最强形状证据；`--dry-run` 缺失属环境事实，非实现缺陷。

## 2. 第 2 轮阻塞卡片

### 卡片 D2-1（③ 虚假证据残留）：已发布证据的 `process_fresh` 仍由 `touch` 出来的 mtime 支撑，机读件却显示干净 PASS
- **位置**：`ops/release/probe-out-20261016T075205Z/probe-2026-10-16T07-52-18-544Z.{json,log}`（canonical）；判据代码 `scripts/verify/post-restart-probe.mjs:266`（committed 版）
- **反例（原始证据）**：
  ```
  # argv（log:7）—— 没有 --since
  argv: node scripts/verify/post-restart-probe.mjs --repo /home/csy/Code/Github/dsh-cloudcode-link --out ops/release/probe-out-20261016T075205
  # process_fresh 证据（log:15-18）
  evidence: ExecMainStartTimestamp=Fri 2026-10-16 15:42:17 CST
  evidence: installed dist/index.js mtime=1792136536316 (2026-10-16T07:42:16.316Z) sha256=6b8e1fad…
  # 同批发布的 07:48:47 件更直白（log:19）
  evidence: no --since given: freshness floor is the installed artifact mtime (restart must happen after install)
  ```
  该 mtime `07:42:16.316` 正是操作者 `touch -d @1792136536.316` 写入的值（审计 §4.1.1 原文照录）；审计 §0.1/§4.1.1 与 `freshness-check.sh` 都判该判据 **UNTRUSTED / UNKNOWN**，但机读 JSON 的 check 对象只有 `{id,verdict,summary}`，**无 caveat/provenance 字段** → 下游读到 `process_fresh: PASS`、总 `PASS 9/0/0`。
- **危害**：发布物以"9/0/0 全绿"对外，其中关键一条 PASS 的物理依据恰是被自己判为伪造的那个值——"作废了但仍在用"。
- **期望（无需重启即可完成，我已实测）**：重生成 canonical，使 freshness 依据为安装阶段记录并在机读件写明依据。我的复跑已证明该路径可得干净 PASS：
  ```
  $ node scripts/verify/post-restart-probe.mjs --repo . --out /tmp/rev/r2-wt2 --install-record ops/release/install-complete.json
  --- CHECK process_fresh: PASS ---
      host process is a live listener started after installCompletedUtc=2026-10-16T15:42:06+08:00
      with a matching artifact hash (basis: independent install record, not mtime)
  VERDICT: PASS  (PASS=9 FAIL=0 UNKNOWN=0, exit 0)
  ```
  并把 07:48:47 / 07:52:05 两份旧件标 superseded（或将其 `process_fresh` 记为 UNKNOWN），不得继续作 canonical。

### 卡片 D2-2（② 敷衍/未闭合）：freshness 修复未提交、未被流水线验证，canonical 早于该修复
- **位置**：`scripts/verify/post-restart-probe.mjs`（工作区 M，sha `7efc47fa…`）；`ops/release/release-20261016T075231Z.log`
- **反例（原始输出）**：
  ```
  $ git status --short
   M ops/restart/.last-restart-pid
   M scripts/verify/post-restart-probe.mjs        ← 修复未提交
  $ tail -1 ops/release/release-20261016T075231Z.log
  FAIL: CCH_EXPECTED_INDEX_SHA256 is unset — refusing to release an unpinned artifact
  $ ls -t ops/release/probe-out-*                  ← 最新证据目录仍是 075205Z（15:52:05）
  ```
  该文件在我复核期间被改动两次（先后测得 `ea541933…` → `7efc47fa…`），属移动靶。
- **期望**：提交并 push 新探针（`git status` 干净）；在**不重启**的前提下按 §3a 替代路径闭合——用 `--install-record` 直接跑探针并发布该产物为 canonical（`release-runner` 的 phase4 有 `.no-restart` 护闸会 exit 6，故不能靠重跑整条流水线），同时把旧件标 superseded。

## 3. 证据伪造事件核验（逐条回答 Lead 三问）

### (a) 改后 `process_fresh` 的依据是什么？能否被被测者自我制造？
- **依据（工作区新探针 `7efc47fa…`）**：新增 `--install-record` / `readInstallRecord()`（`:212`）；`checkProcessFresh()`（`:261`）在该路径下以 `installCompletedMs` 为 floor，并对记录做 **path + sha256 双向绑定**，另有两处 SUSPECT 检测（`:301-304`）：mtime 晚于 host start、或 mtime 早于记录超过 `MTIME_TOLERANCE_MS=5min`。缺记录 → `UNKNOWN`；可疑 → `WARN: SUSPECT TIMESTAMP` 并降级。
- **我的对抗实测（三条）**：
  ```
  # 1) 正常路径
  process_fresh: PASS  …(basis: independent install record, not mtime)
  # 2) 记录缺失
  --- CHECK process_fresh: UNKNOWN ---  evidence: record unusable: install record not found: /tmp/rev/nonexistent.json
  VERDICT: FAIL (PASS=7 FAIL=1 UNKNOWN=1, exit 1)
  # 3) 篡改 mtime（只动我 /tmp 里的副本）
  回拨 → WARN: SUSPECT TIMESTAMP - artifact mtime … predates the recorded install completion … (back-dated timestamp)
  前拨 → WARN: SUSPECT TIMESTAMP - artifact mtime … is LATER than host start … (artifact changed after the process booted)
  两者均 FAIL / exit 1
  ```
  负向对照（我实跑）：`negative-control-fixture --mode stale-quota` → `VERDICT: FAIL (PASS=5 FAIL=4 UNKNOWN=0, exit 1)`，断言确有失败能力。
- **能否自我制造？——能，必须承认。** `ops/release/install-complete.json` 自陈 `provenance.writtenAfterTheFact = true`、`derivedFrom = release-20261016T074145Z.log`，`installCompletedUtc=15:42:06` 的说明是 "the latest auditable instant before the restart was scheduled"——**由作者挑选的界值，不是安装时刻的观测值**，文件 mtime 15:52:05（事后 10 分钟）。同一操作者既能写产物也能写该记录，因此**单人流水线里不存在时间维度的独立性**；真正不可伪造的只有内容哈希（installed == record == `HEAD:dist/index.js` == `6b8e1fad…` ✓）与 systemd 自己的进程启动时刻。
  结论：新判据把"一次 touch 即可伪造"降级为"需同时编造记录并保持 sha/path 自洽"，但**仍是自证**。诚实表述应为"内容已钉死、时序 UNKNOWN"，而非 PASS。

### (b) 是否残留 touch/mtime/cp -p 回填痕迹？
- 全仓 tracked 扫描（`git grep -nE "touch -d|cp -p|cp --preserve|utimes|os\.utime"`）仅两处：
  - `ops/release/release-audit.md:162,167` —— 审计里对 `touch -d` 命令的**原文照录**（披露，非工具残留）；
  - `test/pool.test.ts:463 utimesSync(...)` —— 日志轮转测试的合法夹具。
- 脚本侧：`scripts/deploy/*.sh`、`scripts/verify/*.mjs` **无任何**改写时间戳的代码；`release-runner.sh:303-309` 只有"发现 mtime 晚于记录 → WARN"的检测。
- 结论：**无残留回填机制**。

### (c) 审计 §4.1 是否如实披露而非洗白？
- **如实，且属高标准披露**：§4.1.1 标题即"被判为伪造证据的做法（已作废）"，含原始命令、两次 touch 的毫秒值、`为何这是伪造证据`（"该属性本身是我用 touch 手工写出来的——证据链因此失去独立性"）以及 mtime 变化时间线表。
- §0.1 记录 Lead 裁定 `process_fresh = UNKNOWN`，写明"不要改回 mtime""本节保留 UNTRUSTED 标注，不作洗白"；§4.2 另行给出不读 mtime 的独立复核。
- 我独立复跑该独立复核脚本，输出与披露一致：
  ```
  $ bash scripts/deploy/freshness-check.sh
  artifact_hash          PASS    installed == record == HEAD:dist/index.js (6b8e1fad176b…)
  process_after_install  PASS    host started 15:42:17 CST AFTER recorded install completion (pid=581348)
  mtime_freshness        UNKNOWN artifact mtime … is OPERATOR-REWRITTEN in this release — a PASS here would be manufactured, not observed
  live_plugin_route      PASS    live host serves the plugin route (HTTP 200)
  SUMMARY PASS=3 FAIL=0 UNKNOWN=1   (exit 0)
  ```
- 唯一不足：**披露停留在 .md，机读 canonical JSON 没有同步该裁定**（=卡片 D2-1）。

## 4. 复跑原始输出（第 2 轮，全部我本人执行）

```
$ pnpm check                        → $ tsc --noEmit    ROOT_CHECK=0
$ pnpm test                         → tests 255 / pass 255 / fail 0 / skipped 0 / todo 0   ROOT_TEST=0
$ (cd packages/core && pnpm check)  → $ tsc --noEmit    CORE_CHECK=0
$ (cd packages/core && pnpm test)   → tests 212 / pass 212 / fail 0                      CORE_TEST=0

# 并发（针对第 1 轮 flake；修复 commit 8edc033 "injectable callback port"）
两个 root suite 并发 → suite_a: pass 255 fail 0 exit 0 ；suite_b: pass 255 fail 0 exit 0
两个 core suite 并发 → core_a: pass 212 fail 0 ；core_b: pass 212 fail 0

# 三路哈希
$ git show HEAD:dist/index.js | sha256sum → 6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4
$ sha256sum dist/index.js                 → 6b8e1fad…
$ sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js → 6b8e1fad…
$ git diff --stat afe93c6 HEAD -- dist/   → （空；dist 在 afe93c6..c8a6b12 间逐字节未变）

# 探针复现（HEAD 版副本 + 工作区版各一次，输出目录均在 /tmp）
HEAD 版、无 --since → VERDICT: PASS (9/0/0, exit 0)，evidence 明写
                      "no --since given: freshness floor is the installed artifact mtime"
工作区版 + --install-record → 第一次 VERDICT: UNKNOWN (8/0/1, exit 2)
                      （quota_refresh_live 因 POST /pool/refresh-quota 30s 超时判 UNKNOWN——诚实降级）
                              第二次 VERDICT: PASS (9/0/0, exit 0)，basis=install record

# 禁止重启护闸（source 后直接调函数，未执行任何 phase）
marker_present  rc=6  REFUSED: marker …/ops/release/.no-restart exists — restart phase is prohibited
env_flag        rc=6  REFUSED: CCH_NO_RESTART=1 — restart phase is prohibited by the environment
no_gate         rc=0
```

## 5. 非阻塞观察（第 2 轮）

1. **`--detach` / `--plan` 静默忽略 `CCH_RESTART_DRY_RUN=1`**：拒绝逻辑只覆盖 `--schedule`（`:565-568`）。实测 `CCH_RESTART_DRY_RUN=1 … --detach` 仍原样打印含真重启的 payload（exit 0、无告警）；第 1 轮事故正是始于"复制 `--detach` 打印行"，建议扩展到打印模式。
2. **`freshness-check.sh:117` 的 UNKNOWN 文案硬编码**："is OPERATOR-REWRITTEN in this release" 与真实 mtime 值无关，恒被打印。方向安全（永不误判 PASS）但无信息量，建议按记录/容差推导。
3. **机读 JSON 缺 provenance**：`checks[].{id,verdict,summary}` 无 evidence/basis/trust，UNTRUSTED 裁定无法传递到机读件（卡片 D2-1 根因之一）。
4. **`release-runner.sh:380-386`**：先 `cp` 发布 probe json，再检查 `probe_exit != 0`；失败运行会先落一份 `probe-<ts>.json`。建议先判 exit 再发布。
5. **canonical `repoHead=afe93c6…` ≠ 当前 HEAD `c8a6b12…`**（dist 字节相同，内容钉住仍成立）；重生成或显式说明该字段的历史含义。
6. **未提交散件**：`ops/release/probe-out-20261016T074{516,645,758,833,75205}Z/`、`ops/release/trigger.txt`、`ops/verify/probe-2026-10-16T07-58-21-063Z.json` 均未跟踪，发布资产应有明确入库/清理口径。

## 6. 复核边界（第 2 轮）

- **未执行任何重启**：未跑 `--schedule` / `--run` / `--perform-restart` / `--force`，未用 systemd-run 拉起会重启的单元；只做了 `--detach`（纯打印）、`--detach --no-probe`、`--detach --rehearse`（纯打印）、函数级 `source`（idempotence_guard / no_restart_gate）与只读探针。host 全程 `MainPID=581348`，journal 自 15:38 起仅一对一 Stop/Start。
- 未改写任何他人产物；写入仅限 `docs/review/**`。隔离测试副本一律在 `/tmp/rev/**`，篡改 mtime 的试验只针对我自己的 `/tmp` 副本。
- 复核期间 `scripts/verify/post-restart-probe.mjs` 处于未提交状态且在两次测量间发生过变更（`ea541933…` → `7efc47fa…`），本裁决只对该 sha 生效。

---

# 第 3 轮裁决（末轮终审，2026-10-16 16:16–16:30 CST）

## VERDICT: APPROVE

- 冻结状态（16:16）：HEAD = origin/main = `a7ebb956a1fa56f9bd66684795cf735863bfb4f3`；host `MainPID=581348`（`15:42:17 CST`，全程未变）
- 工作树：仅 `M ops/restart/.last-restart-pid`（标记文件，随 15:42 那次重启更新）+ 我本人的 `docs/review/**`；**脚本全部已提交**
- 文件 sha256：
  `post-restart-probe.mjs 6471e95402efec14cc990ada1288b6ee900f88c586c5ac056e41d634bfe4f504`
  `restart-host.sh c779651ae84d37398f0f72e5146dafc7137dadbc7ce27c70b09771196cd6bcb4`
  `release-runner.sh 115298659f2568cb7280c6e9dd0b6fefbb87f7499f8020df40c3430315679862`
  `freshness-check.sh 00c30c98748e49c601866f88fde40f1d292b892cbfbe523bc1a9876811a12982`
- 第 2 轮两张阻塞卡片（D2-1/D2-2）**已修并复现**；三条非阻塞观察**已修**；无新增阻塞项。
- 批复附带 5 条**非阻塞跟踪项**与 1 份**争议焦点报告**（§4），供 Lead 收尾。

## 1. D2-1 修复核验：新 canonical = 诚实 UNKNOWN（我逐字节复现）

- 新 canonical：`ops/release/probe-out-20261016T080603Z/probe-2026-10-16T08-06-29-613Z.{log,json}`
  ```
  verdict UNKNOWN  exit 2  counts {"PASS":7,"FAIL":0,"UNKNOWN":2}  repoHead c8a6b125e3  hostPid 581348  sha 6b8e1fad176b
  process_fresh              UNKNOWN  | NOT INDEPENDENTLY PROVEN: UNKNOWN-EVIDENCE: install record is self-attested
  ccl_registered_in_live_host UNKNOWN | new-process evidence not established (see process_fresh)
  ```
- **机读 JSON 新增 `provenance`（14 键）**：`argv, cwd, repo, baseUrl, installedPath, installRecordPath, installRecordBasis(=record), processFreshBasis, installRecordInstallCompletedUtc, installRecordSha256, installRecordRepoHead, installRecordWrittenAfterTheFact(=true), caveat, supportingEvidence`
  `caveat` 原文（节选）："process_fresh timing judgement is self-attested: … has provenance.writtenAfterTheFact=true, so installCompletedUtc … was derived after the fact … Therefore the verdict is UNKNOWN, not PASS. Admissible substitutes: artifact hash binding … the live plugin routes answered by this PID, and the release-pipeline ordering lines in the record provenance."
- **我的独立复现**（只读，输出到 /tmp）：
  ```
  $ node scripts/verify/post-restart-probe.mjs --repo . --out /tmp/rev/r3 --install-record ops/release/install-complete.json
  --- CHECK process_fresh: UNKNOWN ---   (self-attested record)
  --- CHECK ccl_registered_in_live_host: UNKNOWN ---
  VERDICT: UNKNOWN  (PASS=7 FAIL=0 UNKNOWN=2, exit 2)
  ```
  ⇒ 与 canonical 逐条一致（7/0/2、exit 2），未为凑 9/0/0 调判据。
- 旧 mtime 期证据已移入 `ops/release/superseded/`（含 07-48-47 published 件、074833Z、075205Z、080158Z）并附 `SUPERSEDED.md`，逐条写明作废原因与替代件；探索性中间件（074516Z/074645Z/074758Z）明确"从未作为对外证据、不背书"。

## 2. D2-2 与三条非阻塞观察：修复核验

| 项 | 结论 | 我的证据 |
|---|---|---|
| 探针修复已提交 | ✅ | `a318b24`（16:13:49）含 `scripts/verify/post-restart-probe.mjs` + canonical + superseded；`git status` 中该文件不再为 M |
| ① 重启入口对 env 抑制一致 | ✅ | `CCH_RESTART_DRY_RUN=1` + `--detach` / `--plan` / `--schedule` **均 exit 2**，同款文案（提示改用 `--rehearse`）；`--detach --rehearse` 放行 exit 0 |
| ④ `freshness-check.sh` 输出真实依据 | ✅ | 复跑输出：`mtime_freshness UNKNOWN mtime=2026-10-16T16:14:21+08:00 (ctime=…) vs …installCompletedUtc=2026-10-16T15:42:06+08:00; mtime is settable by a single touch…`（不再硬编码），`SUMMARY PASS=3 FAIL=0 UNKNOWN=1` exit 0 |
| ④b 先判定后发布 | ✅ | `release-runner.sh:380-391`：`if ((probe_exit != 0)); then FAIL "— nothing published"; fi` 在 `cp` 之前；`find ops/release -maxdepth 1 -name 'probe-2*.json' -newermt "16:13"` **为空** ⇒ 失败路径 0 发布件 |
| ⑤ 散件整理 | ✅ | superseded 目录 + `SUPERSEDED.md`；`git status` 已无散件噪声（仅剩 `.last-restart-pid` 与我的 review 目录） |

## 3. 新增披露核验（Lead 三问）

### (a) `--dry-phases` 改写 mtime 的披露是否充分、有无掩盖？
**充分，无掩盖。** `release-audit.md §9.1` 逐项交代：发起命令（`CCH_EXPECTED_INDEX_SHA256=deadbeef… --dry-phases`）、写入者（phase 1 `pnpm update`，含日志行号）、前后 mtime（`15:42:16.316` → `16:14:21.427841018`）、内容未变（改写前后 sha 均 `6b8e1fad…` == `HEAD:dist`）、**明确承认违反用户约束并承担责任**、拒绝回拨（"不回拨、不再写入"）、给出教训与建议（`--no-install` / 在 `--dry-phases` 中跳过 phase 1，交 Lead 决策）。
我的独立佐证：
- 安装副本现状 `mtime=2026-10-16 16:14:21.427841018 +0800`、sha `6b8e1fad…`（读命令为 `stat`/`sha256sum`，我未写入任何时间戳）；
- `git grep -nE "touch -d|cp -p|cp --preserve|utimes|os\.utime|--reference"` 仅命中 `release-audit.md` 的披露原文与 `test/pool.test.ts:463` 的合法 `utimesSync`；
- `grep -rnE "\btouch " ops/release/*.log` 无命中（该次改写由 `pnpm update` 造成，非手工 touch）；
- 约束遵守声明（§8.6 尾"未 touch / 未 cp -p 任何既有产物 mtime"）与我的扫描一致。

### (b) mtime 已被两次改写的前提下，把时序判为 UNKNOWN 是否已是可达的最诚实结论？
**是。** 论证：
1. 现 mtime `16:14:21` **晚于** host 启动 `15:42:17` ⇒ 旧 mtime 判据此刻只会给出 `SUSPECT TIMESTAMP`（"artifact changed after the process booted"），任何基于 mtime 的 PASS 都必然是制造的；我实测的 SUSPECT 触发路径与该规则一致（见第 2 轮 §3a 的前拨/回拨用例）。
2. 唯一替代依据 `install-complete.json` 自陈 `writtenAfterTheFact=true`，其 `installCompletedUtc` 是作者挑选的界值 ⇒ 据此判 PASS 等于把自证当独立证据（正是 §4.1.1 被作废的做法）。
3. 不可伪造的锚点只剩：内容哈希（`installed == record == HEAD:dist == 6b8e1fad…` ✓ 判 PASS）与 systemd 的进程启动时刻。二者合起来**不能**证明"安装先于重启"这一时序命题 —— 缺一个独立于操作者的安装时刻。
4. 我也验证过"判据并未退化为永远 UNKNOWN"：N1（记录时刻晚于 host 启动）→ `process_fresh FAIL`、总 `FAIL 7/2/0 exit 1`；N2（记录 sha 不符）→ FAIL；N3（记录缺失）→ UNKNOWN。（PASS 分支在本次shipped状态下不可达，原因见上，属事实而非实现缺陷。）
⇒ `process_fresh=UNKNOWN` + 下游 `ccl_registered_in_live_host=UNKNOWN` 是当下**唯一不制造证据**的结论；审计 §8.4 还主动说明"若要把第 5 条收窄为纯静态/liveness 断言，须由 Lead 明确改名并接受语义收窄"——这正是应当由 Lead 裁定的自由度，而非 Worker 自行凑数。

### (c) 是否还有未被披露的时间戳写入或"失败仍发布"残留？
**没有。** 我逐路径核查：
- 时间戳写入面：脚本内唯一会写安装副本的是 phase 1 `pnpm update`（§9.1 已披露）；`release-runner.sh` 其余写操作仅 `>>LOG_FILE` / `tee` / 写 `install-complete.json` / `cp` 发布 probe json，均不触碰既有产物时间戳；不存在 `touch` / `cp -p` / `utimes` / `install -m` / `rsync` 代码路径。
- 失败发布面：`phase6_probe()` 现在 `probe_exit != 0` 时直接 return 且不 `cp`；`--dry-phases` 只跑 phase 0-3（`:442-443` `DRY_PHASES_OK`）不进入 phase 6；16:13 之后无任何新发布件（find 为空）。
- 唯一可改进项：第 1 轮那次手工 `touch -d` 的**原始交互输出未入档**（audit 依据"操作输出与文件状态"还原，命令原文只存在于 §4.1.1 的引用）。属证据可得性限制，非隐瞒——肇事行为本身已被主动披露。

## 4. 非阻塞跟踪项 + 争议焦点报告（交 Lead 收尾）

### 4.1 可修的实现/记录项（不阻塞本次 APPROVE，建议纳入后续）
1. **canonical 与修复提交的时序**：canonical 探针**启动于 16:06:03**（`repoHead=c8a6b12…`），而修复提交 `a318b24` 落于 **16:13:49** ⇒ "canonical 晚于修复（a318b24）"这一表述**与产物时间戳不符**；canonical 是用当时**未提交的工作树**跑出来的，其机读件**不记录探针自身 sha 或 dirty 标志**，无法把证据钉到具体代码版本。建议：`provenance` 增 `probeSha256` + `gitDirty`（或要求发布证据一律出自 clean tree）。
2. **`--dry-phases` 仍是陷阱**：它跳过重启但照跑 phase 1 重装（已造成一次 mtime 污染）。建议按他们自己的提案实现 `--no-install`，或在 `--dry-phases` 中跳过 phase 1；在实现前不要再用它。
3. **流水线无法产出被接受的 canonical**：`phase6` 要求 `verdict == "PASS"`（`:369`），而本次被接受的结论是 UNKNOWN ⇒ canonical 只能手工生成。建议为"接受 UNKNOWN"增加显式开关（Lead 签核），否则下次又会出现"手工证据 vs 流水线要求"的裂缝。
4. **锁与 HEAD 的提交级差异**：profile 锁定 `tar.gz/a318b24…`，HEAD 已是 `a7ebb95`；`dist/index.js` 三者逐字节相同（`6b8e1fad…`），故内容绑定成立，但凡出现"lock == HEAD"的表述应改为"lock 提交的产物 == HEAD:dist"。
5. **`models_upstream_side` 断言集仍是 10 条人工挑选**（`docs/models-and-fix.md §1` 有 20+ 条，其中 3 条仅以 `-tiered/-high/-medium/-low` 出现）。当前不产生假 PASS，但存在静默欠覆盖；建议写死"§1 slug → 插件 slug"归一化表或断言全集。

### 4.2 不可达项（属环境/单人流水线固有限制，非实现缺陷）
- **"安装先于重启"的独立时序证明**：唯一不可伪造的时间锚是 systemd 的进程启动时刻；安装时刻只能由发布流水线自己的记录提供，而该记录在单人、事后补写的条件下永远是被测者自证。要真正独立，需要**重启前、由流水线现场写入并被外部锚定**的记录（例如 future run 中 phase 2 现场写 `install-complete.json` 并即时提交/推送到远端仓库 —— git 提交时间即是外部锚），且需重启才可验证；本会话明令禁止重启，故无法在此闭合。
- **PASS 分支的现场演示**：需要一次"干净树上安装 → 重启 → 记录早于启动"的真实链路；同样被禁重启阻断。缓解证据已有：负向用例 N1/N2/N3 与我复跑的 `negative-control-fixture`（`VERDICT: FAIL 5/4/0 exit 1`）证明断言非恒真，`--install-record` 路径确实被程序走到。
- **建议的 Lead 裁定口径**（二选一，属策略而非技术）：(i) 接受 `process_fresh`/`ccl_registered_in_live_host` = UNKNOWN 作为本次发布的最终结论（现状即此）；(ii) 显式改名收窄第 5 条语义为"交付包注册顺序 + 该 PID 应答路由"，从而取回一个 PASS——但必须同时接受"进程加载了该包"这一点未被独立证明。

## 5. 末轮复跑原始输出

```
$ pnpm check                        → $ tsc --noEmit                       ROOT_CHECK=0
$ pnpm test                         → tests 255 / pass 255 / fail 0 / skipped 0 / todo 0   ROOT_TEST=0
$ (cd packages/core && pnpm check)  → $ tsc --noEmit                       CORE_CHECK=0
$ (cd packages/core && pnpm test)   → tests 212 / pass 212 / fail 0                        CORE_TEST=0
# 4 套并发（2×root + 2×core）
f-a: pass 255 fail 0 ；f-b: pass 255 fail 0 ；f-ca: pass 212 fail 0 ；f-cb: pass 212 fail 0

# 三路内容一致（提交级不同，内容级相同）
$ git show HEAD:dist/index.js | sha256sum → 6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4
$ sha256sum dist/index.js                 → 6b8e1fad…
$ sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js → 6b8e1fad…
$ git diff --stat c8a6b12 HEAD -- dist/ packages/core src/ → （空）

# canonical 复现（输出到 /tmp，未碰安装副本）
$ node scripts/verify/post-restart-probe.mjs --repo . --out /tmp/rev/r3 --install-record ops/release/install-complete.json
VERDICT: UNKNOWN  (PASS=7 FAIL=0 UNKNOWN=2, exit 2)

# 负向对照（我发起，随后 kill 掉 fixture 进程）
VERDICT: FAIL  (PASS=5 FAIL=4 UNKNOWN=0, exit 1)   neg_exit=1

# 只读独立复核
$ bash scripts/deploy/freshness-check.sh
artifact_hash PASS / process_after_install PASS / mtime_freshness UNKNOWN（输出真实 mtime、ctime 与记录时刻）/ live_plugin_route PASS
SUMMARY PASS=3 FAIL=0 UNKNOWN=1   (exit 0)
```

## 6. 复核边界（第 3 轮）

- **未重启 host**：未跑 `--schedule` / `--run` / `--perform-restart` / `--force`；未用 systemd-run 拉起会重启的单元。`--plan` 仅用于验证"env 抑制统一拒绝"（在参数解析阶段即 exit 2，未创建任何单元）。host 全程 `MainPID=581348`。
- **未写入任何既有产物的时间戳**：未 `touch`、未 `cp -p`。我对 `/tmp` 仅用普通 `cp` 新建过隔离副本（新文件，非改写既有产物），**未触碰安装副本**（对其只执行 `stat` / `sha256sum` / 只读探针）。
- 未改写任何他人产物；本轮写入仅限 `docs/review/**`。
- canonical 的 `probeStart` 为 16:06:03，早于 `a318b24`（16:13:49）；本裁决对该时间窗内的工作树状态不对应任何单一 commit —— 已作为 §4.1-1 跟踪项。
