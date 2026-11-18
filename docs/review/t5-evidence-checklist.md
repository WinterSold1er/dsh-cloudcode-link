# T5 对抗审查：证据清单与只读基线（审查员 reviewer）

- 生成时间：2026-10-16 ~14:20 CST
- 审查对象：task-1..task-4 的产物 + 仓库 HEAD dc0ca77
- 状态：**只读侦察完成，等待 Lead 唤醒后 claim task-5**（未 claim）
- 写范围：仅 docs/review/**；其它路径只读

## 0. 不可动摇的事实基线（本人亲自复核，非任何 Worker 的转述）

| 事实 | 值 | 复核命令 |
|---|---|---|
| 仓库 HEAD | `dc0ca77a29a317bd1948a291534cd69334085081` | `git rev-parse HEAD` |
| 工作树 | 干净（侦察时） | `git status --short` |
| repo `dist/index.js` sha256 | `73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf` | `sha256sum dist/index.js` |
| repo `dist/client.js` sha256 | `3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717` | `sha256sum dist/client.js` |
| 安装副本 `~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/*` | 两个哈希与 repo **完全一致** | `sha256sum .../dist/*.js` |
| host 单元 | `deepseek-harness.service` active (running) since **10:03:12 CST**，Main PID **420693**，listen `127.0.0.1:3080` | `systemctl --user status` / `ss -ltnp` |
| commit 时间 | dc0ca77 authored **11:57:44**；安装副本 mtime **12:05** | `git show --stat` / `ls -la` |
| 子模块 | `packages/core` = git submodule → `WinterSold1er/cloudcode-link-core` @ `1c0931a` | `cat .gitmodules` / `git ls-tree HEAD packages/core` |
| 打包形态 | `dist/index.js` 内联打包了 core（含 `//#region packages/core/src/...`，共 30821 行）；`neverBundle` 仅 `@deepseek-ai/*`、`qrcode`、`node:*` | 读 dist + `tsdown.config.ts` |
| 已修函数（repo dist 与源码一致） | `dist/index.js:28201` `mergeFallbackFamilyQuota` → `remainingFraction: fallback.remainingFraction ?? prev.remainingFraction` | 读 dist/index.js:28199-28209 |

**由基线直接推出的两条硬结论（任何产物与此冲突即 REJECT）**
1. 运行中的 host（10:03 启动）内存里是 **pre-fix** 插件；dc0ca77 只有在 host 重启后才会生效。任何“未重启即已生效”的结论无效。
2. 安装副本与 repo dist 字节一致，因此“重启后一定加载新代码”这一命题的**前提成立**（前提，不等于已发生）。

## 1. 每个任务的可证伪断言与我的复核动作

### T1（worker-repo）仓库质量门
- 断言：`pnpm check` / `pnpm test`（root + packages/core）全绿；`pnpm build` 后 `git status --short dist` 为空。
- 我复跑：root `pnpm check`、`pnpm test`（亲自，原始输出入裁决）；`pnpm build` 后 `git status --short dist`。
- 作弊红线：改测试迎合实现、`.skip/.only/todo`、`expect(true)`、断言恒真、删除断言、放宽阈值。
- 已侦察线索：dc0ca77 自身改过 `test/models.test.ts`、`test/quota.test.ts`（+36/-14）——必须逐行看是否弱化既有断言；新增 `test/e2e/*.ts` **不匹配** `test/**/*.test.ts` glob，故 `pnpm test` 不会执行它们，交付文档不得把 e2e 计入“测试通过”。

### T2（worker-deploy）安装面审计
- 断言：lock 解析 commit == HEAD；安装副本哈希 == repo dist；无更高优先级旧副本；host 加载路径指向该副本。
- 我复核：上述哈希（已做）+ `pnpm-lock.yaml` 中 dc0ca77 解析行 + profile `cordis.patch.yml`/`package.json` 插件声明（文件:行）。
- 作弊红线：拿仓库源码冒充实装副本（两者哈希相同属正常，但结论必须注明“重启后才生效”）；把“哈希一致”写成“已生效”。

### T3（worker-deploy）detached 重启运行手册
- 断言：`bash -n` 通过；detached 调度（`systemd-run --user --on-active=...`）而非同调用自杀；就绪轮询有具名超时变量与非零失败退出；幂等。
- 我复跑：`bash -n scripts/deploy/restart-host.sh`；函数级 source 执行（只调记录/就绪轮询，不触发 restart）；`systemd-run --user --dry-run` 形状校验；**绝不真重启**。
- 作弊红线：脚本内直接 `systemctl --user restart` 后继续；无超时上限的 `until` 死循环；硬编码 sleep 冒充就绪；重复执行会连环重启。

### T4（worker-verify）重启后探针
- 断言：服务就绪（401/200）；新 PID/启动时间晚于重启；新代码生效证据（journalctl 或安装副本哈希+可观测行为）；真实上游调用断言 5H 条目 resetTime 为未来、weeklyFraction ∈ [0,1]、模型清单与 docs 一致；退出码非零 ⟺ 有断言失败。
- 我复跑：probe 的可执行路径/dry-run（不重启、不写别人范围）。
- 作弊红线：网络/认证失败仍 PASS；断言恒真；mock 上游冒充真实；用**未安装**的仓库源码冒充已生效；只看 `dist/client.js` 就断言倒计时修复（dc0ca77 未改 client 代码，倒计时恢复源于 resetTime 变新鲜）。
- 需澄清的歧义（已发现）：`docs/models-and-fix.md` §1 的 21 条是**上游公共清单**，而 `DEFAULT_FALLBACK_MODELS` 只有 12 条。探针必须写明断言的是哪一侧，不得混用。

## 2. 我拒绝接受的“证据”
口头承诺 / 只说 OK 的日志 / 无原始输出的摘要 / 与命令不匹配的日志 / 未标注退出码 / 事后手写的“已通过”。

## 3. 裁决输出
`docs/review/verdict-t5.md`：逐条缺陷卡片（文件:行 / 反例 / 期望）或 APPROVE（附复跑命令与原始输出摘要）；完成后 `send_message` 通知 lead。单任务对抗上限 3 轮。
