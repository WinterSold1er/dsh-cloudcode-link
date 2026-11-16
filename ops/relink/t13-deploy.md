# T13 — 落地部署（HMR recomposition，无重启）+ 装载硬证据 + 端到端验证

- 任务：`task-13`（reviewer 第 2 轮 REJECT 后补证并重开）
- 执行：`worker-fix` 编排；`t13-builder` / `t13-deployer` / `t13-lca-check` / `t13a-runner` / `t13b-runner` 执行
- 结论时间：2026-11-16 19:45 CST
- **host 未重启**：`deepseek-harness.service` MainPID **2685153**、ActiveEnterTime 2026-11-16 11:42:18 CST 全程未变
- 本文件 + [`t13-hmr-proof.md`](./t13-hmr-proof.md)（A/B 两段装载取证）+ [`t13-b-proof.json`](./t13-b-proof.json) + [`t13-b-status-series.jsonl`](./t13-b-status-series.jsonl) + [`t13-b-inotify.log`](./t13-b-inotify.log) + [`t13-deploy.json`](./t13-deploy.json) + [`t13-e2e.json`](./t13-e2e.json) + [`t13-lca-daily.json`](./t13-lca-daily.json) + [`t13-status-field.diff`](./t13-status-field.diff)

---

## 0. 一句话结论（reviewer 阻断项已解）

**新 dist 已被运行中 host 装载，且是内存级硬证据**：`GET /plugins/cloudcode-link/status` 返回的 `distSha256` 与安装副本/仓库 dist 逐字节一致，且该字段是随补丁新增的（旧代码没有它）；临时取证标记 `build:"t13b"` 已在收尾时删除（现仅保留 `distSha256`，长期用于判断"运行中代码是否最新"）。交叉印证：触发 HMR 后 `/catalog` 出现只可能来自新实例的 `source:"fallback"/count:12` 窗口，**同窗口** dist 被 `OPEN/ACCESS` 重读（§3.2）；阴性对照下同样操作 0 事件、0 fallback（§3.4）；B 方案还用"换旧 dist→字段消失、换回新 dist→字段恢复"的因果翻转自证（§3.5）。全程未重启 host。

---

## 1. 部署三阶段（最终安装副本 sha）

| 阶段 | 变更 | 旧 sha → 新 sha | 是否被 host 装载 | 证据 |
|---|---|---|---|---|
| phase 1（19:01） | T3 补丁：`ENDPOINT_FALLBACKS` daily-first | `6b8e1fad…` → `677d9a81…` | 是（触发后 +2.2s 读盘；见 §3.1 说明） | `t13-inotify.log`、`t13-deploy.json` |
| phase 2（19:34） | + `/status` 的 `build`/`distSha256`（装载硬证据字段） | `677d9a81…` → `e79aee63621b8eea1a002a5b8c646efeea219155e72a65dfdcfcc213086da22d` | **是** | `/status` 字段 + sha 一致；A run2/run3 + B round4 |
| phase 3（19:49，收尾） | 删除临时标记 `build:"t13b"`，只保留 `distSha256` | `e79aee63…` → **`adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd`** | **是** | `/status` 中 `build` 键消失、`distSha256` = 新 sha；`t13-e2e-installed.json` |

当前状态（19:55 实测）：

```bash
$ sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd
$ sha256sum dist/index.js          # repo
adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd   # 与安装副本一致
$ curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status | jq -c 'keys'
["askTool","auth","catalog","defaultEffort","defaultModel","distSha256","dormantReason","enabled","lastRun","plugin","poolAuth","pool","transport"]
$ curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status | jq -c '{distSha256,enabled,dormantReason,catalog}'
{"distSha256":"adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd",
 "enabled":true,"dormantReason":null,"catalog":{"source":"discovered","count":16,"lastError":null}}
```

- 备份：`/tmp/relink-t13-deploy/backup-index.js`（`6b8e1fad…`，T3 前）、`/tmp/relink-t13b/backup-index.js`（`677d9a81…`，phase 2 前）。
- 触发方式：`~/.dsh/profiles/web/cordis.patch.yml` **append 一行 YAML 注释**（内容变化）；HMR 在 **+2.1~2.4s** 内完成 reconcile。

---

## 2. 执行步骤（实际命令与结果）

1. phase 1：repo `git apply ops/relink/t3-patch.diff` → `pnpm build`（`677d9a81…`，`pnpm test` 255/255）→ 备份并覆盖安装副本 → append patch 注释触发。
2. phase 2：`src/index.ts` 增加 `selfSha256`（`createHash('sha256')` + `import.meta.url`）+ `/status` 返回 `build:"t13b"`、`distSha256`（`t13-status-field.diff`，14 行新增）→ `pnpm build`（`e79aee63…`，`m1-client` 8/8 pass）→ 备份并覆盖 → append 触发。
3. phase 3（收尾）：删除 `build:"t13b"` 临时标记，只保留 `distSha256`（`t13-status-field.diff` 更新）→ `pnpm build`（**`adba7687…`**）→ 备份（`/tmp/relink-t13c/backup-index.js` = `e79aee63…`）并覆盖 → append 触发 → `/status` 中 `build` 键消失、`distSha256`=新 sha。
4. 回归：daily 上 `loadCodeAssist` 200 + `project=aicode-consumers`（`t13-lca-daily.json`），证明 `ensureProject` 链路未坏。
5. 装载取证：A 方案（新实例判别器 + 阴性对照）与 B 方案（`/status` 字段 + 因果翻转），见 §3。

---

## 3. 装载硬证据（reviewer 阻断项）

### 3.1 先纠正一个方法论坑（重要）

**只换 dist 文件不会触发重载**；必须先让 **patch/manifest 内容变化**触发 reconcile，reconcile 再按模块身份（`ino:size:mtime`）判断是否 stale 并重读。A 首轮（19:29）"无 fallback、无读盘"的阴性结果，正是因为当时 dist 与已装载身份相同——**这恰好是正确行为，不是未装载**。B 的 round3 进一步证明：**字节完全相同、仅 mtime 变化也会触发重载**。

### 3.2 A 方案：新实例判别器（`t13-hmr-proof.md` A 段，原始序列见 `t13-hmr-catalog-series.jsonl`）

判据：`ModelCatalog` 新实例构造时 `source:'fallback'`、`count:12`（`packages/core/src/models.ts:346-350`），旧实例恒为 `discovered/16`。**fallback 只可能来自新实例**。

run2 原始行（dist 在触发前 8s 被替换为新字节）：

```
{"epoch_ms":1794828847127,"http":200,"ok":true,"source":"discovered","count":16,"ms":1.034}
{"epoch_ms":1794828847142,"http":200,"ok":true,"source":"fallback","count":12,"ms":312.882}
{"epoch_ms":1794828848831,"http":200,"ok":true,"source":"fallback","count":12,"ms":0.891}
{"epoch_ms":1794828848846,"http":200,"ok":true,"source":"discovered","count":16,"ms":19.217}
```

- fallback 窗口 **1.689 s / 81 样本**；`/status` 独立同窗 28 样本（两端口互证）。
- 同窗口 dist inotify（触发后 **+2217 ms**）：

```
1794828847334 OPEN  name=index.js src=file pid=-
1794828847397 ACCESS name=index.js src=file pid=-
1794828847434 CLOSE_NOWRITE name=index.js src=file pid=-
1794828847434 OPEN  name=index.js src=file pid=-   ← 第二波（+2317 ms）
1794828847470 ACCESS name=index.js src=file pid=-
1794828847506 CLOSE_NOWRITE name=index.js src=file pid=-
```

run3（同字节、仅 mtime 变）：fallback/12 窗口 1794829043148–1794829044806，dist `OPEN` 1794829043385（+2305 ms）⇒ **装载按 mtime 判定**。

### 3.3 B 方案：`/status` 字段 + sha（决定性）

- 新代码在 `/status` 增加 `build:"t13b"`、`distSha256 = sha256(当前执行模块文件)`。
- 实测返回 `distSha256 === 安装副本 sha256 === repo dist sha256`（`e79aee63…`）⇒ **运行中执行的就是这次构建**。
- 该字段**只存在于新代码**：未装载时不可能出现（见 §3.5 的翻转）。

### 3.4 阴性对照（证明"没有事件"是有意义的）

| run | dist 身份 | 操作 | 观测 | 结论 |
|---|---|---|---|---|
| run1 | 与已装载相同（`677d9a81`） | append 注释 | 1330 `/catalog` 样本全 `discovered/16`；inotify **0 事件 / 46s** | 无 stale ⇒ 不重载（正确） |
| run4 | 与已装载相同（`e79aee63`） | append 注释 | 665 `/catalog` 样本 0 fallback；inotify **0 事件 / 18s** | 同上，阴性干净 |
| run2/run3 | 与已装载**不同**（字节或 mtime） | append 注释 | fallback 窗口 + 同秒 dist 重读 | **重载成立** |

空闲基线：探针空跑 10s **0 事件** ⇒ 不存在周期性读者，重读只可能由 reconcile 引起。

### 3.5 B 的因果翻转自证（`t13-b-proof.json` round4）

磁盘放旧 dist（模块仍缓存新码）→ append 触发 → `1794829159225` 起 `/status` **字段消失**（装载旧 dist）→ 磁盘换回新 dist → 再 append → `1794829182249`（**+2.07s**）字段**恢复** `e79aee63…/t13b`。235 个采样（true 148 / false 87）完整覆盖双向翻转。

### 3.6 如实披露的局限

- **并发污染**：A 与 B 取证曾同时操作同一份安装 dist 与 patch 文件（我调度失误）。具体影响：A 的 run2/run3 所用 dist 字节由 B 放置；B 的 round1 字段出现由 A 的 append 触发。**因此双方都只把"自己完全控制的那一轮"作为自证**：A 用 run2/run3（自身 append + 自身观测）、B 用 round4（双向翻转）。其余 rounds 仅作交叉印证。
- **inotify 无 pid**：事件结构不含 pid；装载窗口读操作仅 36–76 ms，`/proc` 轮询抓不到。归属靠"时序 + 空闲基线 + 进程内 fallback + `/status` 字段"多重互证。
- `distSha256` 证明"哪个构建在运行"，不能区分加载自 repo dist 还是安装副本——两者字节相同，这不影响结论。
- HMR 日志不可见（product profile 无 console exporter），`restart required`/pending 类告警无法直接读取；本报告不依赖日志。

---

## 4. 端到端验证

### 4.1 插件真实代码路径 — **安装副本直连**（最终口径，1/2 生成预算）

按 reviewer 要求，e2e **不使用 `packages/core/src`**，而是：

1. 把安装副本 `~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js` **逐字节复制**为 `/tmp/relink-t13c/e2e/dist-copy.mjs`（追加 export 前 sha256 = `adba7687…`，与安装副本一致）；
2. 仅在文件末尾追加**一行** `export { streamGenerateContent, ENDPOINT_FALLBACKS };`（bundle 内这两个是顶层标识符），其余零字节改动；
3. 用软链解决宿主依赖（`@deepseek-ai/dsh-llm` → installer `node_modules/@deepseek-ai/dsh-llm`；`@deepseek-ai/dsh-tools` → installer `packages/core/tools`）；
4. **不设 endpoint 覆盖**调用 `streamGenerateContent(token, body, timeout, undefined, undefined)` → 走 dist 内置的 `ENDPOINT_FALLBACKS`（首位 daily）。

结果：

```json
{"via":"installed-dist (byte-identical copy + one export line)",
 "ENDPOINT_FALLBACKS_first":"https://daily-cloudcode-pa.googleapis.com",
 "model":"gemini-3.8-flash-high","status":200,"contentType":"text/event-stream",
 "bytes":1526,"sseFrames":2,"modelVersion":"gemini-3.8-flash-n","durationMs":4634,
 "firstText":"Hello! How can I help you today?"}
```

- 未发生 failover（命中 daily 即 200 结束）；生成请求 **1** 次，无重试。
- 证据：`t13-e2e-installed.json` / `t13-e2e-installed.log`（含 dist-copy 追加前后 sha、runner 说明、请求体）。

> 说明：这是"安装副本直连"而非替代方案；唯一非安装副本的字节是那行 `export`（用于把 bundle 内部函数暴露给测试进程），已在 log 中逐项标注。

### 4.2 "经宿主"再发一次：**当前不可行（已实测）**

- `list_subagent_models(provider="antigravity")` → **`Error: LLM provider "antigravity" is not allowed for this Session`**；
- DSH 的会话 API 是连接态 RPC（`/api/path` 自定义方法），无独立"发一条 chat"的 REST 端点；插件自身没有 generate HTTP 端点。
- 结论：**"宿主进程内再发一次真实生成"需要用户在新会话里发一句 `hi`**。观测点清单（stats.db 新行、`/status.lastRun`、cooldown 429）见 [`t14-acceptance.md`](./t14-acceptance.md)；本轮**不伪造**宿主生成请求。

### 4.3 回归

daily `loadCodeAssist` → 200、`project=aicode-consumers`（`t13-lca-daily.json`）；`ensureProject` 不受 daily-first 影响。

---

## 5. 回滚预案（本轮未触发）

```bash
# 回滚到上一版（只保留 distSha256、无 build 字段之前的 e79aee63 不可用同理）
# 可选备份（按时间倒序）：
#   /tmp/relink-t13c/backup-index.js  = e79aee63…（phase 2，含 build 字段）
#   /tmp/relink-t13b/backup-index.js  = 677d9a81…（phase 1，仅 daily-first）
#   /tmp/relink-t13-deploy/backup-index.js = 6b8e1fad…（原始 production-first）
cp -a /tmp/relink-t13c/backup-index.js \
  ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
printf '\n# t13-rollback %s\n' "$(date -u +%Y%m%dT%H%M%SZ)" >> ~/.dsh/profiles/web/cordis.patch.yml
sleep 4
curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status | jq -c '{distSha256,enabled}'
```

判据：`/status` 200 + `enabled:true`；`distSha256` 应变为回滚目标 sha（若回滚到无该字段的版本，字段消失属预期）。

---

## 6. 仓库状态（未提交，等 Lead 指令）

```text
 M dist/index.js                 # adba7687…（root 构建产物）
 M src/index.ts                  # +13 行：selfSha256 + distSha256（见 t13-status-field.diff）
 m packages/core                 # submodule: src/client.ts 1+/1-（见 t3-patch.diff）
?? ops/relink/t13-*             # 本任务产物
```

- 两处代码改动：`ops/relink/t3-patch.diff`（core，2 行，daily-first）+ `ops/relink/t13-status-field.diff`（root，+13 行，`distSha256` 判别器）。
- **未做任何 git commit/push**。

---

## 7. 预算 / 脱敏 / 约束

- 生成预算：T3 4/4（已用尽）；T12 1/3；T13 **2/2**（1 次源路径 e2e @19:05 + 1 次**安装副本直连** e2e @19:51）。用户侧验收需新的预算或直接用 `t14-acceptance.md` 观测点。
- 脱敏：本文件与 `t13-*` 产物、`/tmp` 原始序列凭据前缀扫描 **0** 命中；未打印 token。
- 未重启 host、未改 `/usr/bin/agy`、未写 `/tmp/agy-fix`。
