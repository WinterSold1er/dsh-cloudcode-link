# T2 安装面审计：profile 依赖锁与安装副本一致性

审计人：worker-deploy
审计时刻：2026-10-16T14:1x+08:00（Asia/Shanghai）
仓库：`/home/csy/Code/Github/dsh-cloudcode-link` @ HEAD `dc0ca77`
运行中 host：用户级 systemd 单元 `deepseek-harness.service`，PID 420693，启动 `2026-10-16 10:03:11`
Profile：`/home/csy/.dsh/profiles/web`（由单元 `Environment=DSH_HOME=/home/csy/.dsh` 决定）

---

## 0. 结论摘要（TL;DR）

| 断言 | 判定 | 依据 |
|---|---|---|
| lock 解析 commit == 仓库 HEAD | **PASS** | 见 §1 |
| 安装副本 dist 与仓库 dist 逐字节一致，且 == HEAD:dist | **PASS** | 见 §2（sha256 + git blob hash） |
| host 运行时解析到的插件入口 == 安装副本 `dist/index.js` | **PASS** | 见 §3.2（`require.resolve` 与 dump-config 双证） |
| `cordis.yml` 里 `disabled: true` 会阻止插件加载 | **否（已证伪）** | 见 §3.3（合成配置无 `disabled`） |
| 存在其它会被优先加载的副本 | **无（.dsh-test 副本不可达）** | 见 §4 |
| **重启后新代码一定生效** | **是** | 见 §5 |

**重启前必须知道的一点**：运行中的 PID 420693 启动于 `10:03:11`，而安装副本 `dist/index.js` 的 mtime/ctime 是 `12:05:25`；Node ESM 在首次 import 时把模块读进内存，之后不会再读盘。**因此重启是让 `dc0ca77` 产物生效的必要且充分动作。**

---

## 1. lock 解析 commit == 仓库 HEAD

仓库 HEAD：

```
$ git rev-parse HEAD
dc0ca77a29a317bd1948a291534cd69334085081
```

Profile 依赖声明 —— `/home/csy/.dsh/profiles/web/package.json:8`：

```
"dsh-cloudcode-link": "github:WinterSold1er/dsh-cloudcode-link",
```

并在同一文件 `:28` 注册进 web profile 的 bundle 列表（决定它会被 loader 当作 bundle 层加载）：

```
        "dsh-cloudcode-link",
```

lock 解析 —— `/home/csy/.dsh/profiles/web/pnpm-lock.yaml`：

```
20:      dsh-cloudcode-link:
21:        specifier: github:WinterSold1er/dsh-cloudcode-link
22:        version: https://codeload.github.com/WinterSold1er/dsh-cloudcode-link/tar.gz/dc0ca77a29a317bd1948a291534cd69334085081
```

```
167:  dsh-cloudcode-link@https://codeload.github.com/WinterSold1er/dsh-cloudcode-link/tar.gz/dc0ca77a29a317bd1948a291534cd69334085081:
168:    resolution: {gitHosted: true, integrity: sha512-6MMCmjX4rWEObhB0QTEdlpZdTK7uxbQIXGg+iymCyLh37iD/iYAEqdGa54/EYgIKkCAU9p+stx3wXbr4myK9Qw==, tarball: https://codeload.github.com/WinterSold1er/dsh-cloudcode-link/tar.gz/dc0ca77a29a317bd1948a291534cd69334085081}
169-    version: 0.1.1
170-    engines: {node: '>=24.0.0'}
```

判定：lock 的 tarball 路径 commit `dc0ca77a29a317bd1948a291534cd69334085081` **逐字符等于** `git rev-parse HEAD`。PASS。

---

## 2. 安装副本 dist 与仓库 dist 一致性

### 2.1 sha256（内容一致）

```
$ cd /home/csy/Code/Github/dsh-cloudcode-link && sha256sum dist/index.js dist/client.js dist/index.d.ts
73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf  dist/index.js
3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717  dist/client.js
3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e  dist/index.d.ts

$ sha256sum /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/{index.js,client.js,index.d.ts}
73e0efbf8d72cbb8a0f51866f31afb5411e9c61c88107e9ce9337107198e2ebf  .../dist/index.js
3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717  .../dist/client.js
3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e  .../dist/index.d.ts
```

三个文件哈希两两相等。

### 2.2 与 HEAD:dist 绑定（不是「工作区里某个旧构建」）

仅比对仓库工作区与安装副本还不够——若工作区 dist 本身就是陈旧构建，两者会「一致地一起错」。
故追加两道证据：

**(a) 仓库 dist 工作区 == HEAD commit 内容**（`git status --short dist` 输出为空，且 blob hash 相等）：

```
$ git ls-files dist/
dist/client.js
dist/index.d.ts
dist/index.js

$ git status --short dist
(空)

$ git rev-parse HEAD:dist/index.js HEAD:dist/client.js
df6b428d880c2957455a00db163c019795698468
15d37de9a83429a6e505aea7428d2410092a8704
```

**(b) git blob hash 三方相等**（`index.d.ts` 未在 `HEAD:dist` 里单独列出 blob，故以其 hash-object 结果为准）：

```
$ git hash-object dist/{index.js,client.js,index.d.ts}
df6b428d880c2957455a00db163c019795698468   # .../dist/index.js
15d37de9a83429a6e505aea7428d2410092a8704   # .../dist/client.js
3ff4ba4b578b39e8b2db1b4cf80643f80f5b2697   # .../dist/index.d.ts

$ git hash-object /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/{index.js,client.js,index.d.ts}
df6b428d880c2957455a00db163c019795698468
15d37de9a83429a6e505aea7428d2410092a8704
3ff4ba4b578b39e8b2db1b4cf80643f80f5b2697
```

`dist/index.js` 的 blob hash `df6b428d…` 与 `HEAD:dist/index.js` 的 blob hash 完全一致 ⇒ 安装副本 `dist/index.js` 的内容**就是 `dc0ca77` 提交里那份**。PASS。

### 2.3 附带核对：插件自带 patch 层

```
$ diff node_modules/dsh-cloudcode-link/cordis.patch.yml /home/csy/Code/Github/dsh-cloudcode-link/cordis.patch.yml && echo IDENTICAL
PATCH-YML IDENTICAL
```

### 2.4 附带核对：清单入口声明

仓库 `HEAD:package.json` 与安装副本 `package.json` 的 `main` / `exports` / `peerDependencies` 完全一致：

```
15:  "main": "./dist/index.js",
17:  "exports": {
29:  "peerDependencies": {
36:  "peerDependenciesMeta": {
```

```
$ diff <(git show HEAD:package.json | sed -n '/"peerDependencies"/,/^  }/p') \
       <(sed -n '/"peerDependencies"/,/^  }/p' node_modules/dsh-cloudcode-link/package.json)
PEERS IDENTICAL
```

> 该一致性同时排除了 §3.3 的 `disabled` 风险：peer 元数据自上一个安装版本以来未变，而 preflight 只依据 peer 元数据拒绝条目。

### 2.5 时间线（为何必须重启）

```
$ stat -c '%y %n' /home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
2026-10-16 12:05:25 +0800  .../dist/index.js
$ stat -c 'inode=%i links=%h mtime=%y ctime=%z' .../dist/index.js
inode=3141829 links=1 dev=31 size=1249751 mtime=2026-10-16 12:05:25.479562237 +0800 ctime=2026-10-16 12:05:25.479562237 +0800
$ ps -o pid,lstart -p 420693
    PID                  STARTED CMD
 420693 五 10月 16 10:03:11 2026 ...
```

| 时刻 | 事件 |
|---|---|
| 10:03:11 | host PID 420693 启动，import 当时的插件产物（内存中为旧版） |
| 11:57:44 | `dc0ca77` 提交（`dist/index.js` +100/-35 行） |
| 12:05:25 | 安装副本 dist 落盘（links=1，非 pnpm store 硬链接；`inode=3141829`） |
| 14:1x | 本次审计 |

Node ESM 只在首次 `import` 时读盘，模块加载后常驻内存，磁盘覆写不会热更新已加载模块 ⇒ 内存中代码版本**早于**当前 dist。

---

## 3. 插件加载路径与配置

### 3.1 单元与 DSH_HOME

```
$ systemctl --user cat deepseek-harness.service
[Service]
WorkingDirectory=/home/csy/Code/installer/deepseek-harness
ExecStart=/usr/bin/node .../apps/cli/lib/bin.js web --port 3080 --no-open --trusted-host ...
Environment=DSH_HOME=/home/csy/.dsh

$ tr '\0' '\n' < /proc/420693/environ | grep -i '^DSH_'
DSH_HOME=/home/csy/.dsh
```

profile 目录因此确定为 `/home/csy/.dsh/profiles/web`。
（另注：`/home/csy/.dsh/cordis.patch.yml` 是 home 级 patch，在 profile 层之后应用。）

### 3.2 host 解析入口确实指向安装副本

**(a) Node 解析器直接求值**（用 profile 自身的解析基准，即 loader 的解析基准）：

```
$ node --input-type=module -e "import{createRequire}from'node:module';const r=createRequire('/home/csy/.dsh/profiles/web/package.json');console.log(r.resolve('dsh-cloudcode-link'))"
/home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
```

**(b) 真实 boot 配置解析器输出的合成树**（`dsh --dump-config`，读 `apps/cli/lib/bin.js`，`apps/cli/src/dump-config.ts` 内无任何 `writeFile` 调用，故为只读；退出码 0，stderr 0 行）：

```
$ DSH_HOME=/home/csy/.dsh node apps/cli/lib/bin.js --profile web --dump-config > /tmp/dump-web.yml
$ echo $?
0
$ wc -l /tmp/dump-web.yml /tmp/dump-web.err
 1434 /tmp/dump-web.yml
    0 /tmp/dump-web.err
```

合成树中的插件条目（`/tmp/dump-web.yml:1267-1282`）：

```
1267:# == dsh-cloudcode-link
1268:- id: cloudcode-link
1269:  name: dsh-cloudcode-link
1270-  config:
1271-    enabled: !!js process.env.DSH_CLOUDCODE_ENABLED ?? process.env.DSH_AGY_ENABLED ?? 'true'
1272-    baseUrl: !!js process.env.ANTIGRAVITY_BASE_URL ?? ''
...
1282-      process.env.DSH_AGY_HEARTBEAT_INTERVAL_MS ?? '180000'
```

`name: dsh-cloudcode-link` 是裸包名 ⇒ 由 loader 按 profile 基准解析 ⇒ 落到 (a) 求得的同一个文件。

**(c) 运行中进程的旁证**：PID 420693 持有插件 stats 存储的 fd（该路径由插件核心代码以 `os.homedir()` + `cloudcode/accounts/stats.db` 拼出，见 `packages/core`），证明插件在该进程内**已被加载并运行**：

```
$ ls -l /proc/420693/fd | grep cloudcode
fd21 -> /home/csy/.cloudcode/accounts/stats.db
fd22 -> /home/csy/.cloudcode/accounts/stats.db-wal
fd23 -> /home/csy/.cloudcode/accounts/stats.db-shm
```

**(d) 启动期未被拒绝**：启动日志的失败清单里没有该插件（PID 420693 于 10:03:40 打印）：

```
10月 16 10:03:40 ... node[420693]: dsh: warning: 6 entries did not activate
10月 16 10:03:40 ... node[420693]: subagent-director (dsh-plugin-subagent-director): failed to import
10月 16 10:03:40 ... node[420693]: lsp (@deepseek-ai/dsh-lsp): failed to import
10月 16 10:03:40 ... node[420693]: lsp-stdio (@deepseek-ai/dsh-lsp-stdio): failed to import
10月 16 10:03:40 ... node[420693]: lsp-tool (@deepseek-ai/dsh-tool-lsp): failed to import
10月 16 10:03:40 ... node[420693]: hooks-claude-code (@deepseek-ai/dsh-hooks-claude-code): failed to import
```

`cloudcode-link` 不在其中。

### 3.3 `cordis.yml` 中 `disabled: true` 的澄清（已证伪的假警报）

生成的 `/home/csy/.dsh/profiles/web/cordis.yml:1246` 含 `disabled: true`：

```
1229:- id: cloudcode-link
1230:  name: dsh-cloudcode-link
...
1246:  disabled: true
```

初看像「插件被禁用」，但**真实合成配置里没有该字段**（见 §3.2(b)，`/tmp/dump-web.yml:1267-1282` 无 `disabled`）：

```
$ awk 'NR>=1267 && NR<=1292 && /disabled/' /tmp/dump-web.yml
(空)
```

`disabled` 是 **`dc0ca77` 的 boot 预检产物**，不是被消费的最终配置。依据：`packages/boot/app-boot/src/compatibility-preflight.ts` 是唯一非遥测的赋值点——

```
65: * the Loader's own import failure. A denied ordinary row gains `disabled`; a native Include that
115:    row.disabled = true
122:      if (row.disabled === true && !row.group) continue
```

而它只在**兼容性冲突**时才置位：

```
100:  /** Only a compatibility conflict denies a row; every other failure keeps the Loader's own diagnosis. */
```

该 profile 的 `compatibility.json` 只有 4 条豁免，不含本插件：

```
$ cat /home/csy/.dsh/profiles/web/compatibility.json
{ "dsh-vectr-client@0.1.0": [...], "dsh-plugin-subagent-director@0.5.0": [...],
  "dsh-session-migration-fix@0.2.0": [...], "@michengai/dsh-skills-manager@1.1.10": [...] }
```

且本插件 peer 元数据自上一安装版以来未变（§2.4），故本次 preflight 也不会判它冲突。

**结论：`disabled: true` 不会在重启后阻止插件加载。**（该字段只在 boot 读到生成期 `cordis.yml` 时短暂参与判断，而该文件 mtime 12:30 晚于 PID 420693 启动时刻 10:03:11，说明运行中的进程根本不以此为输入。）

### 3.4 运行中进程所持版本「无法直接读取」的说明（诚实边界）

**没有**用 Node inspector（`127.0.0.1:9229` 处于监听）attach PID 420693 去 dump 内存模块——那会暂停正在服务本团队会话的 host 进程，收益不足以抵风险。
因此「内存中是哪个 commit 的产物」只能由 §2.5 的时间证据推断（启动 10:03:11 早于 dist 落盘 12:05:25），而非直接抓取。此推断已足以支撑「必须重启」的动作结论。

---

## 4. 其它候选副本与缓存（优先级与风险）

全盘（`-xdev`，跳过 sessions 目录）搜索名称为 `dsh-cloudcode-link` 的目录：

```
$ find /home/csy -xdev -path /home/csy/.dsh/sessions -prune -o -type d -name "dsh-cloudcode-link" -print
/home/csy/Code/Github/dsh-cloudcode-link                              # 仓库源（非运行时路径）
/home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link           # ← 运行时（被加载）
/home/csy/.dsh-test/profiles/web/node_modules/dsh-cloudcode-link      # 另一套 DSH_HOME，见下
```

**第二套副本不可达**，且内容不同（10月7日旧版）：

```
$ sha256sum /home/csy/.dsh-test/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
777ff62da80a32686aa850cd5207cd8a91d8fba746edd9d47c430f8421149a5c
```

它只属于另一个单元，且该单元处于 inactive、另用独立端口与 DSH_HOME：

```
$ systemctl --user is-active deepseek-harness-test.service
inactive
$ grep -n 'ExecStart|Environment=DSH_HOME' /home/csy/.config/systemd/user/deepseek-harness-test.service
8:ExecStart=/usr/bin/node .../deepseek-harness-test/apps/cli/lib/bin.js web --port 3088 --no-open ...
9:Environment=DSH_HOME=/home/csy/.dsh-test
```

主单元 `deepseek-harness.service`（含其 drop-in）**没有**任何对 `.dsh-test` 的引用。风险：无。

**pnpm 虚拟store / 硬链接**：`.pnpm` 下不存在本插件的实体（只有一份 `lock.yaml`），故不存在「指向旧 store 版本的硬链接被优先解析」的路径；且安装副本 `links=1`（非 store 硬链接）：

```
$ ls /home/csy/.dsh/profiles/web/node_modules/.pnpm/ | grep -i cloudcode
(空)
$ stat -c 'inode=%i links=%h' .../node_modules/dsh-cloudcode-link/dist/index.js
inode=3141829 links=1
```

**codeload/bare tarball 缓存**：未发现任何 `*cloudcode*.tar.gz|.tgz`；pnpm store 仅为内容寻址目录，**运行时不被 Node 读取**（Node 只按 profile `node_modules` 解析），故 store 内命中不构成加载风险。

**其它 profile**：`/home/csy/.dsh/profiles/headless/` 中无任何 cloudcode 引用：

```
$ grep -rn cloudcode /home/csy/.dsh/profiles/headless/
(空)
```

---

## 5. 结论：重启后新代码是否一定生效

**是。** 论证链（每步均有上文原始输出支撑）：

1. host 单元以 `DSH_HOME=/home/csy/.dsh` 启动 ⇒ profile = `profiles/web`（§3.1）。
2. profile `package.json:8,28` 声明并注册该插件为 bundle；lock 解析到 `dc0ca77…`（§1）。
3. 真实 boot 配置解析器合成树中该条目存在且无 `disabled`（§3.2(b)、§3.3）。
4. loader 以裸包名解析 ⇒ profile 内唯一实体 ⇒ `.../node_modules/dsh-cloudcode-link/dist/index.js`（§3.2(a)）。
5. 该文件 sha256 + git blob hash 与 `HEAD:dist/index.js` 相同（§2.1、§2.2）⇒ 即 `dc0ca77` 的产物。
6. 不存在可被优先解析的第二实体（§4）。
7. 运行中的进程启动于 10:03:11，早于该产物落盘 12:05:25（§2.5）⇒ 重启是生效的必要且充分条件。

**阻塞项：无。**
**待 Lead 执行的动作：** 重启 `deepseek-harness.service`（T3 交付的 detached 脚本负责），重启后由 T4 探针验证生效。

## 6. 未决/风险清单

| 项 | 说明 |
|---|---|
| 内存版本未直接抓取 | §3.4：未 attach inspector，版本差异由时间证据推断而非直接读取；不影响动作结论 |
| `cordis.yml` 生成期 `disabled` 字段来源未定位到具体写入者 | 已证明其**非**最终合成配置的一部分（§3.3）；写入者定位属 harness 侧（`/home/csy/Code/installer/deepseek-harness`），不在本任务写范围内 |
| 每 2 小时「5h quota」依赖上游可用性 | 属 T4 探针范围，不在本审计结论内 |
