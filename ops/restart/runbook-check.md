# T3 重启运行手册验证记录（runbook-check.md）

验证人：worker-deploy
版本：第 2 轮（针对审查员第 1 轮 REJECT 的三项阻塞缺陷返工）
验证时刻：2026-10-16T14:56–14:59 +0800
脚本：`scripts/deploy/restart-host.sh`
当前 host：`deepseek-harness.service`，MainPID **524277**，启动 `2026-10-16 14:46:46 CST`

> **本轮未执行任何真实重启**：仅 `bash -n`、`source`（函数级）、`--detach`/`--plan`（只打印/校验）、
> `--smoke`、以及 `--schedule --rehearse` 的 **STRUCTURED REHEARSE**（payload 角色为
> `--perform-rehearsal`，单元内执行 `echo` 而非 `systemctl restart`）。
> 全程 host MainPID 保持 524277 未变。

---

## 0. 历史越权重启的事实陈述（三轮，供审查员核对；本轮未新增）

| # | 时刻 | 结果 PID | 归属 | 原始命令 / 证据 |
|---|---|---|---|---|
| 1 | 14:20:51 | 500951 | 非我 | 我的命令为 `--smoke`（`ops/restart/restart-20261016T062038Z.log` 写 `SMOKE_OK`）与 `CCH_RESTART_DRY_RUN=1 … --schedule`（`/tmp/cch-rehearsal/…062042Z.log` 写 `restart_action: echo REHEARSAL: …`），均为无重启语义。实际重启日志 `ops/restart/restart-20261016T062044Z.log` 为 `mode=admin-detached`（即 `--run` 分支被执行）⇒ 我打印在对话里的 `--detach` 一行被复制执行；执行者无法从 journal 归属 |
| 2 | 14:40:53 | 518224 | 不可归属 | journal 已滚动、`ops/restart/` 无新文件；证据不足，不承认也不推诿 |
| 3 | 14:46:46 | 524277 | **我** | `CCH_LOG_DIR=/tmp/cch-idem CCH_RESTART_DRY_RUN=1 CCH_PRE_DELAY=0 bash scripts/deploy/restart-host.sh --schedule --force 2>&1 \| tail -6`；根因：前缀 env 不会被 systemd-run 起的 transient 单元继承，旧代码又先真重启后判 env。日志 `ops/restart/restart-20261016T064639Z.log` 记 `RESULT: READY (old_pid=518224 -> new_pid=524277)` |

---

## 1. 第 1 轮 REJECT 三项缺陷的修复与证据

### A｜连环重启（一次调用重启两次）—— 已修复

**旧缺陷（反例原文）**：`detached_script()` 把 `$(restart_command)` 烧进 payload，`--run` 分支
又执行同一条，一次调用产生两次 Stop/Start：

```
（旧）detached_script: sleep N; systemctl --user restart <svc>; exec <self> --run
（旧）run_restart admin 分支: log_raw bash -c "$(restart_command)"   ← 第二次
```

**修复**：`systemctl --user restart` 收敛到**唯一一处**代码路径，由 payload 的角色参数决定；
payload 自身不再内联任何 restart 命令，只 `exec` 脚本并带上角色参数。

**证据 A1 —— 源码中真实 restart 命令的唯一性**（另一处命中在注释，非代码）：

```
$ grep -n "systemctl --user restart" scripts/deploy/restart-host.sh
40:# SINGLE RESTART OWNER: `systemctl --user restart` appears in exactly one code
238:  printf 'systemctl --user restart %s' "${SERVICE}"
```

`:238` 位于 `restart_command()`，其非 echo 输出只在 `run_perform_restart()`（`--perform-restart`
角色）被 `bash -c` 执行一次。

**证据 A2 —— payload 内不含 restart 命令，且 exec 恰好 1 次**（杜绝链式第二跳）：

```
$ bash scripts/deploy/restart-host.sh --detach
systemd-run --user --unit=cch-restart-20261016T065750Z --collect --same-dir --description='dsh web host detached restart runbook' /bin/bash -c 'sleep 3; exec /home/csy/Code/Github/dsh-cloudcode-link/scripts/deploy/restart-host.sh --perform-restart'
payload 内 'systemctl --user restart' 出现次数 = 0
payload 内 'exec ' 出现次数 = 1

$ bash scripts/deploy/restart-host.sh --detach --rehearse
… /bin/bash -c 'sleep 3; exec …/scripts/deploy/restart-host.sh --perform-rehearsal'
payload 内 'systemctl --user restart' 出现次数 = 0

$ for f in "--detach" "--detach --rehearse"; do …done
--detach → exec=1 role=perform-restart
--detach --rehearse → exec=1 role=perform-rehearsal
```

**证据 A3 —— 一次调用恰好一对 Stop/Start（历史真跑日志 + journal 计数）**

```
$ F=ops/restart/restart-20261016T064639Z.log
$ grep -c '^restart_action:' $F
1
$ grep -m1 '^restart_action:' $F
restart_action: systemctl --user restart deepseek-harness.service
$ grep -c '^RESULT:' $F
1
$ grep '^RESULT:' $F
RESULT: READY (old_pid=518224 -> new_pid=524277)

$ journalctl --user -u deepseek-harness.service --since "2026-10-16 14:46:35" --until "2026-10-16 14:47:10" -o cat | grep -c 'Stopping DeepSeek Harness'
1
$ … | grep -c 'Stopped DeepSeek Harness'
1
```

即：**1 条 `restart_action` ↔ journal 恰好 1 对 Stopping/Stopped ↔ 1 条 `RESULT: READY`**。
（该历史日志由旧版本产生；本轮新结构把 restart 收到单一角色，且其 payload 不再含 restart 命令，
A1/A2 即新结构的静态论证。）

### B｜`--no-probe` 永久失败（readonly 变量）—— 已修复

**旧缺陷（反例原文）**：`readonly PROBE_ENABLED` 与解析阶段的 `--no-probe` 赋值冲突：

```
行 454: PROBE_ENABLED: 只读变量
exit 1
```

**修复**：去掉 `readonly`，并注明原因：

```
# Writable: --no-probe switches it off at parse time. `readonly` here made that
# assignment fail with "readonly variable" and exit 1.
PROBE_ENABLED="${CCH_PROBE_ENABLED:-1}"
```

**证据 B1 —— `--no-probe` 真跑成功（exit 0）**：

```
$ bash scripts/deploy/restart-host.sh --smoke --no-probe
# dsh web host restart runbook log
# started_at: 2026-10-16T14:57:47+0800
# log_file: /home/csy/Code/Github/dsh-cloudcode-link/ops/restart/restart-20261016T065747Z.log
mode=smoke (no restart is performed)
unit_state=active
--- pre-restart state ---
old_pid=524277
old_start=Fri 2026-10-16 14:46:46 CST
old_nrestarts=0
http_status_now=401
--- post-restart evidence ---
post_pid=524277
post_status=active
journal_window: skipped (smoke mode performs no restart)
RESULT: SMOKE_OK (no restart performed; log written)
no_probe_exit=0        ← 此前为 1（readonly variable）
```

**证据 B2 —— 无 `unbound variable` 回归**：

```
$ bash scripts/deploy/restart-host.sh --smoke 2>&1 | grep -c "PROBE_ENABLED: unbound"
0
```

### C｜rehearsal 抑制跨 systemd-run 边界失效 —— 已修复（结构化）

**旧缺陷**：抑制靠调用方环境变量，而 transient 单元不继承；且旧代码**先真重启、后判 env**
（`:405` 先执行 restart，`:409` 才判 `CCH_RESTART_DRY_RUN`），这正是 14:46:46 事故。

**修复**：抑制改为**角色参数**，随 payload 显式传递：
- 真跑：`… /bin/bash -c 'sleep N; exec <self> --perform-restart'`
- 干跑：`… /bin/bash -c 'sleep N; exec <self> --perform-rehearsal'`（单元内 `restart_command()` 返回 `echo`）
- 并**拒绝**无法跨越边界的 env 抑制组合：

```
$ CCH_RESTART_DRY_RUN=1 bash scripts/deploy/restart-host.sh --schedule
refusing: CCH_RESTART_DRY_RUN does not cross the systemd-run boundary.
use: restart-host.sh --schedule --rehearse
exit=2
```

**证据 C1 —— 干跑路径端到端：单元内确为 rehearsal 角色，零重启**

调度阶段（`/tmp/cch-r3/restart-20261016T065800Z.log`）：

```
mode=schedule (detached; this shell schedules, the transient unit restarts)
rehearse=1
old_pid=524277
--- scheduling detached restart ---
restart_role: --perform-rehearsal
restart_action_in_unit: echo REHEARSAL: restart suppressed for deepseek-harness.service
pre_restart_delay_sec=1
detached_command: systemd-run --user --unit=cch-restart-20261016T065800Z … /bin/bash -c 'sleep 1; exec …/scripts/deploy/restart-host.sh --perform-rehearsal'
RESULT: SCHEDULED — the transient unit performs the single restart and appends its evidence
```

单元阶段（`ops/restart/restart-20261016T065801Z.log`，**另一个文件 ⇒ 另一个进程 ⇒ 确实跨出了
systemd-run 边界**）：

```
mode=perform-rehearsal (restart suppressed by role argument, not by env)
rehearsal_suppressed: echo REHEARSAL: restart suppressed for deepseek-harness.service
old_pid=524277
RESULT: REHEARSAL_OK (payload shape executed, host untouched)
```

断言与观测：`含真 restart 的日志数 = 0`；`含 REHEARSAL_OK 的日志数 = 1`；host `MainPID=524277` 未变；
`systemctl --user status cch-restart-20261016T065800Z.service` → `Unit … could not be found`（`--collect` 已回收）。

**证据 C2 —— 角色确实跨越了 systemd-run 边界**：单元阶段日志的 `mode=perform-rehearsal` 只可能
来自 payload 参数（环境变量注入路径已被拒绝），故结构抑制生效。

### ③ 干跑 0 重启 / 真跑 1 重启 的双日志论证

| 路径 | 角色（payload 内） | restart 命令在 payload 内 | 单元内行为 | Stop/Start 对 |
|---|---|---|---|---|
| 干跑 `--schedule --rehearse` | `--perform-rehearsal` | 0 次（A2） | `echo REHEARSAL: …` → `RESULT: REHEARSAL_OK` | **0**（C1：含真 restart 的日志数=0） |
| 真跑 `--schedule` | `--perform-restart` | 0 次（A2；命令在脚本 `:238`） | `bash -c "$(restart_command)"` **恰好一次** | **1**（A3：`restart_action` 行数=1 ↔ journal Stopping/Stopped 各 1） |

两条路径日志结构完全同形（`mode=…` / `old_pid=…` / `RESULT: …`），唯一差别是角色与
`restart_command()` 的返回值。本轮**未为验证真跑而重启**：真跑那一半以上述历史日志与源码唯一性论证支撑。

---

## 2. Lead 原样可执行的一行合成命令

当前状态**无需再重启**（host 已是新版：PID 524277 启动于 14:46:46，晚于安装落盘 12:05；marker=524277）。

需要重启时的**干跑**（安全，本轮已实测）：

```bash
cd /home/csy/Code/Github/dsh-cloudcode-link && bash scripts/deploy/restart-host.sh --schedule --rehearse
```

需要**真实重启**时（会杀死当前会话；证据由 transient 单元继续写入 `ops/restart/restart-<UTC>.log`）：

```bash
cd /home/csy/Code/Github/dsh-cloudcode-link && bash scripts/deploy/restart-host.sh --schedule --force
```

其它安全入口：`--plan`（打印 + payload `bash -n` + `/bin/true` 探针）、`--smoke`（只读全步骤）、
`--detach`（只打印）、无参数（拒绝，exit 2）、`--observe`（等待外部重启并取证，自身不重启）。

---

## 3. 幂等与重复安全（三层）

| 层 | 位置 | 行为 | 退出码 |
|---|---|---|---|
| 无参数拒绝 | `main()` 默认 `mode="none"` | 裸调用不动作 | 2 |
| 并发锁 | `acquire_lock()` | PID 锁 `ops/restart/.restart-host.lock`；持锁者存活则拒绝；崩溃自愈 | 2 |
| 幂等 marker | `idempotence_guard()` | 完成的重启把结果 MainPID 写入 `ops/restart/.last-restart-pid`；后续运行若该 PID == 当前 MainPID，**在调度之前**拒绝 | 8 |

marker 现状（只读检查）：

```
$ cat ops/restart/.last-restart-pid
524277
$ systemctl --user show deepseek-harness.service -p MainPID --value
524277
```

⇒ 现在不加 `--force` 再跑 `--schedule` 会被 exit 8 拒绝，不会出现第 4 次重启。

具名超时变量（无魔法等待值）：`PRE_RESTART_DELAY_SEC`(3) / `OLD_EXIT_TIMEOUT_SEC`(60) /
`NEW_PID_TIMEOUT_SEC`(60) / `READY_TIMEOUT_SEC`(90) / `POLL_INTERVAL_SEC`(1) / `HTTP_TIMEOUT_SEC`(3)。

## 4. 静态与函数级复核（本轮真实输出）

```
$ bash -n scripts/deploy/restart-host.sh; echo "bash_n_exit=$?"
bash_n_exit=0

$ ( set +u; source scripts/deploy/restart-host.sh; declare -F | wc -l )
30
$ systemctl --user show deepseek-harness.service -p MainPID --value
524277                      # source 前后一致 ⇒ source 不触发重启

$ bash scripts/deploy/restart-host.sh; echo "no_arg_exit=$?"
no_arg_exit=2               # 裸调用拒绝
```

**`systemd-run --user --dry-run` 在本机不存在**（systemd 261），原始报错：

```
$ systemd-run --user --dry-run /bin/true
systemd-run: unrecognized option '--dry-run'
exit=1
$ systemd-run --user --help 2>&1 | grep -ci dry
0
```

故形状校验以 payload `bash -n` + 无害 `/bin/true` transient 单元探针替代（脚本 `--plan` 现算）：

```
$ bash scripts/deploy/restart-host.sh --plan
systemd-run --user --unit=cch-restart-20261016T064835Z --collect --same-dir --description='dsh web host detached restart runbook' /bin/bash -c 'sleep 3; exec …/scripts/deploy/restart-host.sh --perform-restart'

# payload shell-parse validation (bash -n):
payload_parse: OK

# transient-unit acceptance probe (harmless /bin/true, waits for exit):
transient_unit_probe: exit=0
plan_exit=0
```

## 5. 本轮验证边界（诚实声明）

| 项 | 状态 |
|---|---|
| 本轮是否执行真实重启 | **否**。host MainPID 全程 524277 未变 |
| A 连环重启 | 静态唯一性（`:238` 单点）+ payload 零 restart 命令 + exec=1 + 历史真跑 1 对 Stop/Start |
| B `--no-probe` | 真跑 exit 0（B1），无 unbound 回归（B2） |
| C 结构化抑制 | 干跑端到端 `--perform-rehearsal`，单元内 `RESULT: REHEARSAL_OK`，0 重启；env 抑制组合被拒绝（exit 2） |
| 真跑路径端到端 | 本轮未真实执行（安全红线）；以历史日志 + 结构论证支撑，交审查员复核 |
