# T14｜本 DSH profile 依赖指针推进到 HEAD（不重启）

执行人：worker-deploy
执行时刻：2026-10-16T08:31:31Z 起（本地 `16:31`，Asia/Shanghai）
日志：`ops/profile-update/update-20261016T083131Z.log`（命令与原始输出，含失败退出的原文）

---

## 结论（先看这个）

| 问题 | 答案 | 依据 |
|---|---|---|
| lock 指针是否已推进到 HEAD？ | **是**：`a318b245…` → `4dda09f44d…` | §1 |
| 运行中的 host 需要重启吗？ | **不需要（就功能而言）** | §3 |
| 那么什么时候才需要重启？ | 当**以后**真的有字节变化、而用户/系统希望运行中的进程加载它时。本次没有字节变化 | §3 |
| 本次是否重启了 host？ | **没有**。PID 仍 581348，启动时间仍 `15:42:17 CST` | §4 |

一句话：**本次只把 lock 的“指针”前移，插件代码字节没有变化**（两个提交之间 `dist/` 变更 0 个文件），
运行中的 host 早已在加载这份产物，因此**无需重启**。

## 1. 本次操作与原始输出

```
$ cd /home/csy/.dsh/profiles/web && pnpm update dsh-cloudcode-link
✓ Lockfile passes supply-chain policies (verified 17m ago)
Progress: resolved 73, reused 5, downloaded 1, added 1, done
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: dsh-cloudcode-link@https://codeload.github.com/WinterSold1er/dsh-cloudcode-link/tar.gz/4dda09f44da0123214f70770df55537a8e655eef, dsh-cloudcode-link@https://codeload.github.com/WinterSold1er/dsh-cloudcode-link/tar.gz/a318b2456a6fabe8af026af0f581db2ef44c3af4
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
pnpm_exit=1
```

**`pnpm_exit=1` 如实记录、不掩盖**：这是 pnpm 11 对本插件忽略构建脚本的既有告警
（`ERR_PNPM_IGNORED_BUILDS`）。该插件的 `dist/` **已随 tarball 提交**，postinstall 并非生效所必需，
故告警不影响结果——但判定依据不是"忽略告警"，而是下节的实际产物哈希校验。

lock 前后：

```
lock_before = tar.gz/a318b2456a6fabe8af026af0f581db2ef44c3af4
lock_after  = tar.gz/4dda09f44da0123214f70770df55537a8e655eef
repo HEAD   = 4dda09f44da0123214f70770df55537a8e655eef
```

`lock_after == HEAD` ✅（逐字符相等）

## 2. 五文件 SAME/DIFF 表

对比基准：`git show HEAD:<path>`（HEAD = `4dda09f44d…`）
被测：`/home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/<path>`

| 文件 | 判定 | sha256（安装副本，与 `HEAD:<path>` 逐字相同） |
|---|---|---|
| `dist/index.js` | **SAME** | `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4` |
| `dist/client.js` | **SAME** | `3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717` |
| `dist/index.d.ts` | **SAME** | `3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e` |
| `cordis.patch.yml` | **SAME** | `83ce8dedbcc458727ac2323fff581a3a32407b08988c53f5c651a4a043a7d214` |
| `package.json` | **SAME** | `4f83bf9551c4b130711cbeaf8d578611efd6b43dab54bc076099090582d14756` |

**DIFF 项：无。** 五个文件全部 SAME（更新前后亦为同一组哈希）。

### 2.1 mtime 变化（pnpm 自身落盘，如实记录，未手工改写）

未执行任何 `touch` / `cp -p`；以下变化全部由 `pnpm update` 重新落盘产生：

| 文件 | 更新前 mtime | 更新后 mtime |
|---|---|---|
| `dist/index.js` | `2026-10-16 16:14:21.427841018 +0800` | `2026-10-16 16:31:53.675633589 +0800` |
| `dist/client.js` | `2026-10-16 16:14:21.427782081 +0800` | `2026-10-16 16:31:53.675566773 +0800` |
| `dist/index.d.ts` | `2026-10-16 16:14:21.428809480 +0800` | `2026-10-16 16:31:53.676841617 +0800` |
| `cordis.patch.yml` | `2026-10-16 16:14:21.428861243 +0800` | `2026-10-16 16:31:53.676900781 +0800` |
| `package.json` | `2026-10-16 16:14:21.428938771 +0800` | `2026-10-16 16:31:53.676953259 +0800` |

内容哈希更新前后完全一致，仅时间戳被 pnpm 重写。

**这会影响未来的探针 `process_fresh` 判定**：安装副本 mtime（`16:31:53`）现在晚于运行中进程的启动
（`15:42:17`），而 `process_fresh` 的 mtime 判据正是「产物 mtime < 进程启动」——因此该判据此后必然
指向「进程早于产物」。这不是新问题：该判据在 `ops/release/release-audit.md` §4.1.1/§9.1 已被判为
**不可采信**，§10.1 的裁定 (i) 也已接受 `process_fresh` = UNKNOWN。此处仅记录本次重装再次刷新了该时间戳。

## 3. 运行中的 host 是否需要重启？

### 结论：**不需要。**

### 依据（三条，均为只读观察）

**(1) 本次更新没有改变任何插件代码字节。** 两个 lock 提交之间：

```
$ git diff --name-only a318b24..4dda09f -- dist/ | wc -l
0
$ git diff a318b24..4dda09f -- packages/core | wc -l          # 子模块指针
0
$ git show a318b24:dist/index.js | sha256sum
6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4
$ git show 4dda09f:dist/index.js | sha256sum
6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4
```

即：lock 从 `a318b24` 走到 `4dda09f`，`dist/` 内 **0 个文件**变化，子模块指针 **0 行**变化
（中间三个提交 `a7ebb95`/`0dc6c43`/`4dda09f` 只动了 docs/ops/scripts）。
**运行中进程加载的产物 == 更新后安装副本的产物**（同一 `6b8e1fad…`），故不存在"新代码未生效"的问题。

**(2) 安装副本与仓库 HEAD 完全一致**（§2 五文件 SAME），且运行中 host 确实在服务该插件：

```
host_pid=581348    host_start=Fri 2026-10-16 15:42:17 CST    host_state=active
GET /plugins/cloudcode-link/status -> HTTP 200
GET /                    -> HTTP 401   （服务在线信号）
```

**(3) 因此重启不会带来任何行为差异**：它会加载**逐字节相同**的文件。重启的收益为零，
成本是杀掉当前 host 上的所有会话与任务——用户已明确禁止（原话：「本DSH也更新这个插件，但是不要重启，
需要的话告诉我我来重启。」）。

### 什么时候才需要重启（供用户判断）

当**以后**某次发布的 `dist/` 字节确实变化、且希望运行中的进程加载新代码时，才需要重启。
判定方式（可复用）：

```
# 若下面两个哈希不同，则运行中的进程加载的是旧字节，需要重启才能生效
git show HEAD:dist/index.js | sha256sum
sha256sum /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
```

**该判据的边界（必须说清，否则会被当成比实际更强的证据）**：
「安装副本 == HEAD」只证明**磁盘上**的副本等于 HEAD，**不能**单独证明运行中进程加载的就是这些字节。
本仓库唯一能触及"进程何时加载了什么"的信号是产物 mtime，而它在本发布中已被人工回拨过
（`ops/release/release-audit.md` §4.1.1），随后又被 `pnpm update` 重写（§9.1 与本文 §2.1），
按 §10.1 的裁定**一律不可采信**。因此本次的严格表述是：

> 运行中进程加载的字节**未被独立证实**（同 §10.1 的 `process_fresh` = UNKNOWN），
> 但它所服务的插件功能无任何变化——因为 `dist/` 在两个 lock 提交之间 **0 文件变化**，
> 且这些字节最后一次被证明与运行中进程一致是在 T8 的 15:42:17 重启点。

上面那条「两个哈希是否相等」的判据，仍然是一个**低成本的有用信号**：
两者不同 ⇒ 一定需要重启；两者相同 ⇒ 无需为"代码生效"而重启（本次即此情形）。

若用户届时决定重启，一行命令为（**本次不由我执行**）：

```bash
cd /home/csy/Code/Github/dsh-cloudcode-link && bash scripts/deploy/restart-host.sh --schedule --force
```

> 注意：`ops/release/.no-restart` 标记仍在，`release-runner.sh` 的重启阶段会以 exit 6 拒绝。
> 用户本人执行 `restart-host.sh` 不受该标记影响（该护闸位于 release-runner 中）。

## 4. 硬约束遵守情况

| 约束 | 状态 |
|---|---|
| 不重启 host | **遵守**。PID 581348、启动 `15:42:17 CST` 全程未变；未运行 `restart-host.sh` 任何重启角色、未 `systemctl restart`、未用 `systemd-run` 拉起任何重启路径 |
| 不手工写时间戳 | **遵守**。未执行 `touch`/`cp -p`；§2.1 的 mtime 变化全部来自 `pnpm update` 自身落盘 |
| 失败/告警如实记录 | **遵守**。`pnpm_exit=1` 与 `ERR_PNPM_IGNORED_BUILDS` 原文保留在日志与 §1 |
| 不假装成功 | **遵守**。结论以五文件哈希与跨提交 diff 为依据，不以"退出码为 0"或"看起来正常"为依据 |

## 5. 复核命令（任何人可原样重跑）

```bash
# lock 是否 == HEAD
grep -o 'tar.gz/[0-9a-f]*' ~/.dsh/profiles/web/pnpm-lock.yaml | grep -m1 4dda09f

# 五文件是否仍与 HEAD 一致
cd /home/csy/Code/Github/dsh-cloudcode-link
for f in dist/index.js dist/client.js dist/index.d.ts cordis.patch.yml package.json; do
  printf '%-20s %s\n' "$f" "$( [ "$(git show HEAD:$f | sha256sum | awk '{print $1}')" = \
    "$(sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/$f | awk '{print $1}')" ] && echo SAME || echo DIFF )"
done

# 运行中 host 是否需要重启的判据
[ "$(git show HEAD:dist/index.js | sha256sum | awk '{print $1}')" = \
  "$(sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js | awk '{print $1}')" ] \
  && echo "产物字节一致 ⇒ 无需重启（重启不会改变行为）"
```
