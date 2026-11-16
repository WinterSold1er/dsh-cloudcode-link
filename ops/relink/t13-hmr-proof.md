# T13a — 运行中 host 是否真的重新装载了插件代码（新实例判别器）

- 任务：`t13a-runner`（只执行，不重启 host，不改 repo，不发上游生成请求）
- 时间：2026-11-16 19:25–19:41 (+08:00)
- host：`deepseek-harness.service` **PID 2685153**，全程未变、**未重启**
- 被测插件：`dsh-cloudcode-link`，dist 路径 `~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js`
- 触发手段：仅向 `~/.dsh/profiles/web/cordis.patch.yml` **append YAML 注释行**（共 4 行）；未写 `~/.dsh` 其他文件

## 判定

**PROVEN（已装载）**：patch 变更触发 reconcile 后，若模块文件身份（`ino:size:mtimeMs`）与已记录身份不同，运行中的 host 会**重新从安装的 dist 读取字节并重建插件实例**（新的 `ModelCatalog`），全程不重启进程。

关键正面证据（run2）：append 后 **+2217 ms** dist 被 `OPEN/ACCESS`，同窗口 `/catalog` 出现 `source:"fallback", count:12` 持续 **1.69 s**，随后回到 `discovered/16`。
`/status` 独立给出同一 fallback 窗口（28 个样本），两个端点互证 ⇒ 进程内确实换了实例。

## 判据原理（可证伪）

`new ModelCatalog()` 构造时 `current = {source:'fallback', models: buildFallbackCatalog(), discoveredAt:0}`（`packages/core/src/models.ts:346-350`），随后 `src/index.ts:177` `void catalog.refreshIfNeeded()` 异步发现模型。
⇒ 旧实例永远是 `discovered/16`；**出现 `fallback/12` 只可能是新实例**。再叠加同秒 dist 的 `OPEN/ACCESS` ⇒ 新实例 + 新字节都装载了。

## run2 时间线（dist 字节在触发前 8 s 被替换：`677d9a8…` → `e79aee6…`）

| epoch_ms | 本地时间 | 事件 | 来源行摘录 |
|---|---|---|---|
| 1794828845117 | 19:34:05.117 | **append 触发** `# t13a-recomp2 …` | `append_epoch` |
| 1794828847127 | 19:34:07.127 | 最后一个 `discovered/16` | `{"epoch_ms":1794828847127,"http":200,"ok":true,"source":"discovered","count":16,"ms":1.034}` |
| 1794828847142 | 19:34:07.142 | **首个 `fallback/12`**（该请求耗时 312.9 ms） | `{"epoch_ms":1794828847142,"http":200,"ok":true,"source":"fallback","count":12,"ms":312.882}` |
| 1794828847167 | 19:34:07.167 | `/status` 也变 `fallback/12`（288.4 ms） | `{"epoch_ms":1794828847167,…,"catSource":"fallback","catCount":12,…,"ms":288.377}` |
| 1794828847334 | 19:34:07.334 | dist **OPEN**（+2217 ms） | `1794828847334 OPEN name=index.js src=file pid=-` |
| 1794828847397 | 19:34:07.397 | dist **ACCESS** | `1794828847397 ACCESS name=index.js src=file pid=-` |
| 1794828847434 | 19:34:07.434 | **CLOSE_NOWRITE + 第二次 OPEN** | `1794828847434 CLOSE_NOWRITE name=index.js …` / `1794828847434 OPEN name=index.js …` |
| 1794828847470 | 19:34:07.470 | 第二次 ACCESS | `1794828847470 ACCESS name=index.js src=file pid=-` |
| 1794828847506 | 19:34:07.506 | 第二次 CLOSE_NOWRITE | `1794828847506 CLOSE_NOWRITE name=index.js src=file pid=-` |
| 1794828848810 | 19:34:08.810 | `/status` 最后一个 `fallback/12` | `{"epoch_ms":1794828848810,…,"catSource":"fallback","catCount":12,…,"ms":0.844}` |
| 1794828848831 | 19:34:08.831 | `/catalog` 最后一个 `fallback/12` | `{"epoch_ms":1794828848831,"http":200,"ok":true,"source":"fallback","count":12,"ms":0.891}` |
| 1794828848846 | 19:34:08.846 | 恢复 `discovered/16` | `{"epoch_ms":1794828848846,"http":200,"ok":true,"source":"discovered","count":16,"ms":19.217}` |

两次读爆发相隔 100 ms（+2217 / +2317），符合"先比对身份、再导入求值"两次读。
766 个 `/catalog` 样本中 **0 个非 200**；241 个 `/status` 样本全 200、`enabled:true`。

## run3 时间线（字节完全相同，只有 mtime 变：19:37:11.897 重写同内容）

| epoch_ms | 本地时间 | 事件 | 来源行摘录 |
|---|---|---|---|
| 1794829041080 | 19:37:21.080 | **append 触发** `# t13a-recomp3-control …`；dist 身份因 mtime 变化而"已变更" | `append_epoch` |
| 1794829043133 | 19:37:23.133 | 最后一个 `discovered/16` | `{"epoch_ms":1794829043133,…,"source":"discovered","count":16,"ms":1.024}` |
| 1794829043148 | 19:37:23.148 | **首个 `fallback/12`**（307.7 ms） | `{"epoch_ms":1794829043148,"http":200,"ok":true,"source":"fallback","count":12,"ms":307.687}` |
| 1794829043385 | 19:37:23.385 | dist **OPEN**（+2305 ms） | `1794829043385 OPEN name=index.js src=file pid=-` |
| 1794829043453 | 19:37:23.453 | dist **ACCESS** | `1794829043453 ACCESS name=index.js src=file pid=-` |
| 1794829043499 | 19:37:23.499 | **CLOSE_NOWRITE + 第二次 OPEN** | `1794829043499 CLOSE_NOWRITE …` / `1794829043500 OPEN …` |
| 1794829043559 | 19:37:23.559 | 第二次 CLOSE_NOWRITE | `1794829043559 CLOSE_NOWRITE name=index.js src=file pid=-` |
| 1794829044806 | 19:37:24.806 | 最后一个 `fallback/12` | `{"epoch_ms":1794829044806,…,"source":"fallback","count":12,"ms":0.906}` |
| 1794829044821 | 19:37:24.821 | 恢复 `discovered/16` | `{"epoch_ms":1794829044821,…,"source":"discovered","count":16,"ms":21.851}` |

run3 前后 `sha256sum` 与 `stat` 对比：**sha256 完全相同**、size 相同、inode 相同，只有 mtime 变 ⇒ **装载判定按 mtime，不是按字节内容**。

## 阴性对照（关键：证明"没有 fallback"是有意义的）

| run | dist 身份 | 触发 | /catalog 结果 | dist inotify |
|---|---|---|---|---|
| run1 | 未变（`677d9a8…`，11:01:47Z 已装载过） | 19:29:31.894 append | 1330 样本全 `discovered/16`，0 fallback（窗口 20.4 s） | **0 事件 / 46 s** |
| run4 | 未变（`e79aee6…`，11:37:23Z 已装载过） | 19:39:49.556 append | 665 样本全 `discovered/16`，0 fallback（窗口 10.4 s） | **0 事件 / 18 s** |

对照说明：空闲基线本来就**一次都不读** dist，所以触发后出现的读取确由 reconcile 引起；身份不变时也确实**不会**重载。

## 机制（代码依据，DSH 0.2.2-rc.2 checkout）

1. `packages/boot/hmr/src/index.ts:385-399`：`inputs = JSON([bundles, 两个 patch 文件的原始文本])`；`if (inputs === lastInputs) return;` 否则 `reconcileProfile()`。
   ⇒ **注释也会改变原始文本**，所以 append 注释确实能触发 reconcile（run2/run3/run4 都触发了）。
2. `reconcileProfile` → `recomposeProfile`（`:974`）；模块比对用 `ModuleFiles`：身份 = `${ino}:${size}:${mtimeMs}`（`module-files.ts:28`），身份不同或 `mtime >= observedAt - TIMESTAMP_RESOLUTION_MS` 即 stale（`:72-85`）→ `planReplacement`（`:955`）重新 import。
3. import 读盘（inotify 观测到）→ 模块重新求值 → 插件 `apply` 重跑 → `new ModelCatalog(...)`（`src/index.ts:170-177`）→ 先 `fallback/12`，约 1.7 s 后 `discovered/16`。

触发到读盘的延迟稳定在 **+2.2~2.4 s**（run2 +2217 ms、run3 +2305 ms；此前 t13-deploy 也是 +2.2 s），符合 watcher 的写入稳定窗口。

## 局限（不粉饰）

1. **改 dist 本身不会触发重载**。11:33:57Z 与 11:37:11Z 两次改 dist 都没有立即引发读取；要等随后的 patch 文本变更（run2/run3 的 append）才重载。触发条件是 patch/manifest 变更，dist 身份差异只是闸门。
   反证：若改 dist 后曾在 append 之前自动重载过，则随后的 reconcile 会看到"身份已记录"而**不**重载；但 run2/run3 在 append 后 +2.2~2.3 s 确实重载了 ⇒ append 之前并未发生重载。
2. run2/run3 里**变更的 dist 字节不是本任务部署的**（另一 agent 在 11:33:57Z 换字节、11:37:11Z 重写同内容）。本任务证明的是"host 会重载并装载最新字节"，**不是**"本任务部署了这些字节"。
3. inotify **没能拿到 pid**（`/proc` fd 扫描未命中，读取仅 36–76 ms 就关闭）。归属依据是：触发后 +2.2 s 的时序、空闲基线零事件、以及**进程内 fallback 窗口只能由新实例产生**。
4. 装载期间 **1.66–1.69 s** 内 `/catalog` 只暴露 12 个 fallback 模型（不是 16 个已发现模型）；换装后第一个请求耗时 308–313 ms。未观测到 404 或连接错误，但"读到 12 个模型的瞬时窗口"是真实的。
5. 重新实例化会跑插件自己的 `quota.discoverAvailableModels()`（agy 本地模型/配额查询）。**本任务未发任何上游生成请求**。
6. run1 的原始 catalog/status 序列被我 run2 的文件移动覆盖（操作失误）；run1 仅存聚合值，run4 是补做的**原始**阴性对照。
7. 脱敏检查：所有产物对三类凭据前缀模式（OAuth access token、refresh token、JWT 头部段）的匹配数均为 **0**（检查命令的计数见 `t13-hmr-proof.json` 的 `sanitization` 字段之外的独立校验，产物内未写入任何真实 token）。

## 健康状态（结束时）

- `GET /plugins/cloudcode-link/status` → **200**，`enabled:true`，`dormantReason:null`，`catalog:{source:"discovered",count:16}`
- `GET /plugins/cloudcode-link/catalog` → **200**，`{ok:true, source:"discovered", count:16}`
- host PID 仍为 **2685153**（未重启）；patch 文件仅新增 4 行注释，host 4 次 reconciliation 后插件 entry 始终 active。

## 产物

| 文件 | 内容 |
|---|---|
| `t13-hmr-proof.json` | 机器可读完整报告（含每次 run 的原始行、sha256） |
| `t13-hmr-catalog-series.jsonl` | run2 `/catalog` 全量 10–15 ms 采样 |
| `t13-hmr-status-series.jsonl` | run2 `/status` 50 ms 采样 |
| `t13-hmr-inotify.log` | run2 dist inotify 原始日志 |
| `t13-hmr-inotify-patch.log` | run2 patch 文件 inotify 原始日志 |
| `t13-hmr-catalog-series-mtimeonly.jsonl` / `t13-hmr-inotify-mtimeonly.log` | run3（mtime-only）原始日志 |
| `t13-hmr-catalog-series-nochange.jsonl` / `t13-hmr-status-series-nochange.jsonl` / `t13-hmr-inotify-nochange.log` | run4 阴性对照原始日志 |
| `t13-hmr-inotify-run1-empty.log` | run1 空日志（0 事件 / 46 s） |

---

# T13b — `/status` 增加 `build` + `distSha256`：装载硬证据（B 方案）

> 本段由 `worker-fix/t13b-runner` 追加，**未改动上方 T13a 段任何内容**。两段并发取证，交叉印证。
> 原始数据：`t13-b-proof.json`、`t13-b-status-series.jsonl`、`t13-b-inotify.log`。

## 动机

A 段用 `/catalog` 的行为差异（`fallback/12` → `discovered/16`）推断装载，属**间接**信号。B 方案改为**自证式**证据：插件在模块加载时对**正在执行的那个模块文件**取 sha256，挂到 `/status` 上。若 `/status` 出现该字段且值等于新构建 dist 的 sha ⇒ 当前进程执行的确实是新代码。

## 实现（仅改 `src/index.ts` 的 status 组装处）

```ts
// 顶部新增（readFileSync 原已存在）
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// 模块级：模块加载时对自身文件取 sha256
const selfSha256 = (() => {
  try {
    return createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  } catch {
    return null
  }
})()

// regBoth('status', ...) 的 sendJson 追加两个字段（不改其它行为）
build: 't13b',
distSha256: selfSha256,
```

## dist 变化

| | sha256 |
|---|---|
| 旧 dist（repo = 安装副本） | `677d9a81e70ba139a417e5fff5e7c784d3efdd6fa97a34f359b7db6e77f7ce82` |
| 新 dist（repo = 安装副本） | `e79aee63621b8eea1a002a5b8c646efeea219155e72a65dfdcfcc213086da22d` |

- 备份：`/tmp/relink-t13b/backup-index.js`（旧 sha 已校验）。
- `pnpm build` 成功；`node --test test/m1-client.test.ts` → **8/8 pass**。
- 安装副本已覆盖为新 dist，**未重启 host**。

## `/status` 键列表

- 前（19:32:12）：`askTool auth catalog defaultEffort defaultModel dormantReason enabled lastRun plugin pool poolAuth transport`
- 后（19:41:xx）：`askTool auth build catalog defaultEffort defaultModel distSha256 dormantReason enabled lastRun plugin pool poolAuth transport`
- 新增：`build`、`distSha256`（其余键与值行为未变）。

## 核心发现：什么触发重载

| 操作 | 是否触发插件重载 |
|---|---|
| 改 `cordis.patch.yml` | **是**（约 2.1–2.4 s 内 `/status` 反映磁盘上的新 dist） |
| 仅替换 `dist/index.js` | **否**（旧 dist 持有 42 s，215/215 采样仍为已缓存的旧模块） |

⇒ **dist 热替换单独无效，必须伴随 profile patch 变动才会重新加载模块。** 这解释了 A 段为何必须"重触发"。

## 四轮观测（原始序列 `t13-b-status-series.jsonl`）

| 轮次 | 目的 | 结果 |
|---|---|---|
| round1 | 初次触发 + 16 s 轮询 | 首个采样（19:34:33.895）即有新字段，`distSha256=e79aee..`、`build=t13b`、`enabled=true`。**非自证**：并发 agent t13a 于 19:34:05 追加 `# t13a-recomp2`，而 t13b 已于 19:33:57 放好新 dist ⇒ 是 t13a 的 patch 变更把新 dist 装了进来（与 A 段 19:34:08 的 `fallback/12→discovered/16` 同一事件）。 |
| round2 | 旧 dist 回写 / 新 dist 再写 | 125 采样全 `true`，**零翻转** ⇒ dist 写入本身不重载。 |
| round3 | 旧 dist 持有 42 s | 215 采样全 `true`，**零翻转** ⇒ 排除"延迟重载"。 |
| round4 | **自证双向因果** | 明确 false ↔ true 双向翻转，见下。 |

## round4 自证因果（B 段核心证据）

1. `1794829149076` 磁盘换成**旧** dist（`677d..`）→ 模块仍缓存新代码，`/status` 继续 `true/t13b/e79aee..`。
2. `1794829157123` **t13b 追加** patch 注释 → 插件重载。
3. `1794829159225` 起 `/status` **失去** `distSha256`/`build`（`hasDistSha=false`）——已装载的是磁盘上的**旧** dist。
4. `1794829175131` 磁盘换回**新** dist。
5. `1794829180178` **t13b 再次追加** patch 注释 → 插件重载。
6. `1794829182249` 起 `/status` **恢复** `distSha256=e79aee63…`、`build=t13b`。

采样统计：round4 共 235 采样，`true` 148 / `false` 87，false 窗口 `1794829159225 → 1794829181994`（约 22.8 s）。

⇒ 同一进程内，patch 变更后插件重新读取**磁盘上的 dist** 并重新执行；字段随磁盘内容双向变化。这既证明重载机制，也证明字段确实是"当前执行模块"的指纹。

## inotify（安装 dist，`t13-b-inotify.log`）

- round4：patch 触发后可见对 `index.js` 的 `OPEN`/`ACCESS`/`CLOSE_NOWRITE`（重载时重新读取模块文件），与 A 段"两次读爆发"一致。
- 仅 `cp` dist 时只见 `MODIFY`/`CLOSE_WRITE`，**不产生**后续模块 `OPEN` 读取序列（无重载）。

## 判定

**装载已证（LOADED_PROVEN）。**

- `/status` 返回 `build="t13b"`、`distSha256="e79aee63621b8eea1a002a5b8c646efeea219155e72a65dfdcfcc213086da22d"`；
- 该值与 repo dist、安装副本的 `sha256sum` **完全一致**；
- `distSha256` 在模块加载时对 `import.meta.url` 指向的文件计算 ⇒ 执行中的代码就是新构建；
- host pid `2685153` 启动于 `11:42:17`，取证前后**未变** ⇒ 运行时重载，**不是重启**；
- round4 双向翻转证明因果，非偶然。

## 插件健康（结束时）

`GET /plugins/cloudcode-link/status` → HTTP `200`，`enabled: true`，`plugin: dsh-cloudcode-link`，`transport: direct`，`catalog.source=discovered`、`count=16`。未因 B 改动而变化。

## 局限（不粉饰）

1. **并发污染**：t13a-runner 与 t13b-runner 同时操作同一份安装 dist 与 `cordis.patch.yml`。round1 的字段出现由 t13a 的 patch 追加导致，故 round1 不作为自证证据；自证结论只依赖 round4。
2. 本文件 `t13-hmr-proof.md` 曾被 t13a 覆盖写一次；B 段以 **append** 方式追加，未破坏 A 段。
3. `distSha256` 证明的是**哪个构建在运行**，不能区分加载自 repo dist 还是安装副本（两者字节相同）。
4. 本方案未发任何上游生成请求。
