# T12 — canonical 钉版（机读件记录探针哈希与仓库 HEAD）

## 结论一句话

证据已钉版：canonical 机读件的 `provenance` 现在自证「由哪个探针修订、在哪个 HEAD、在什么 node 上、探针是否已提交」产出，
缺任一字段探针直接自检失败（exit 3），不再可能产出无标注的干净 PASS。

## 探针改动（commit `0dc6c43`）

`scripts/verify/post-restart-probe.mjs` 的 `provenance` 新增：

```json
{
  "probeFile": "scripts/verify/post-restart-probe.mjs",
  "probeSha256": "0539fdab0ecd79a85dfcc7678c7524f6577fb6d0fbbd622b0bc908c30400b814",
  "probeMatchesHeadBlob": true,
  "repoHeadSha": "0dc6c434d4ff74b6556c641330b98e19977124e5",
  "repoDirty": false,
  "repoDirtyAll": true,
  "repoDirtyPaths": [" M ops/restart/.last-restart-pid", "?? docs/review/t5-evidence-checklist.md", "?? docs/review/verdict-t5.md"],
  "nodeVersion": "v26.9.0"
}
```

语义：
- `probeSha256` = 运行中探针脚本自身 sha256；`probeMatchesHeadBlob` = 该哈希是否等于 `git show HEAD:<probeFile>`（即探针是否**已提交**）。
- `repoDirty` = **探针脚本自身**是否有未提交改动（本件 `false`）；`repoDirtyAll`/`repoDirtyPaths` = 整个工作区的脏状态（如实列出，
  本件 `true`，来自重启工具书写的 `ops/restart/.last-restart-pid` 与 reviewer 未提交的 `docs/review/**`，与探针无关）。
- 自检：`probeFile / probeSha256 / repoHeadSha / repoDirty / nodeVersion` 任一缺失或为空 → `PROVENANCE SELF-CHECK FAILED`，exit 3，不产出证据件。

## 新 canonical

```
ops/release/probe-out-20261016T082438Z/probe-2026-10-16T08-24-57-420Z.{log,json}
```

生成命令（产出自**已提交**探针 `0dc6c43`）：

```
cd /home/csy/Code/Github/dsh-cloudcode-link && node scripts/verify/post-restart-probe.mjs \
  --repo . --out ops/release/probe-out-20261016T082438Z --install-record ops/release/install-complete.json
```

判定：**UNKNOWN（PASS=6 FAIL=0 UNKNOWN=3，exit 2）**

| # | check | verdict |
|---|---|---|
| 1 | service_ready | PASS |
| 2 | process_fresh | UNKNOWN（记录 `writtenAfterTheFact=true`，时序自证） |
| 3 | artifact_pinned | PASS（安装副本 sha `6b8e1fad…` == `HEAD:dist/index.js`） |
| 4 | bundle_defines_ccl | PASS |
| 5 | ccl_registered_in_live_host | UNKNOWN（新进程加载哪份交付包未独立证明） |
| 6 | quota_refresh_live | **UNKNOWN**（`POST …/pool/refresh-quota -> fetch error: The operation was aborted due to timeout`，连跑两次同现） |
| 7 | models_upstream_side | PASS |
| 8 | models_fallback_side | PASS |
| 9 | journal_no_import_failure | PASS |

> 与任务书预估的 7/0/2 相差一条：第 6 条为上游配额调用**超时**（16:20 / 16:21 两次独立运行均 30s 超时），
> 如实记 UNKNOWN，未改 `HTTP_TIMEOUT_MS` 或复跑覆盖来凑 PASS。

### 同件附带的重要观察（已写进证据本身）

`evidence: WARN: SUSPECT TIMESTAMP - artifact mtime 1792138461427.841 (2026-10-16T08:14:21.427Z) is LATER than host start 1792136537316 (2026-10-16T07:42:17.316Z)`。
即：安装副本在 host 启动之后（16:14:21，另一任务的 profile 重装，见审计 §9.1）被同内容重写。
`artifact_pinned` 仍 PASS（sha 未变 `6b8e1fad…`），但这条恰好再次证明「mtime 判据不可采信」——探针只把它当上下文并把该情形判 UNKNOWN。

## 旧件处置

- `ops/release/probe-out-20261016T080603Z/`（T10 canonical，由**未提交**探针产出）→ 移入 `ops/release/superseded/`；
- `ops/release/superseded/SUPERSEDED.md` 已更新：指向最新件，并新增该件的作废原因行。

## 负向对照（判据未退化，原始输出 `ops/verify/negative-controls-t12.log`）

| 用例 | 构造 | `process_fresh` | 总判定 |
|---|---|---|---|
| N1 | 记录 `installCompletedUtc` 晚于 host 启动 | FAIL | FAIL exit 1 |
| N2 | 记录 `installedSha256=deadbeef…` != 实际 `6b8e1fad…` | FAIL | FAIL exit 1 |
| N3 | 记录缺失 | UNKNOWN | UNKNOWN exit 2 |

约束遵守：未重启 host；未 touch / 未 `cp -p`；未改动安装副本任何字节（其 mtime 变化来自其它任务的 profile 重装，非本任务）。

## 追加：`quota_refresh_live` 超时后的透明重试（Lead 指令）

同一条命令、同一探针修订（`0dc6c43` / `0539fdab…` / `probeMatchesHeadBlob=true` / `repoDirty=false`），未改任何超时或参数；**全部运行如实保留**：

| # | 运行时刻 (UTC) | 目录 | quota verdict | 原始错误/证据行 | 总判定 |
|---|---|---|---|---|---|
| A | 08:20:49 | `ops/release/probe-out-20261016T082049Z` | UNKNOWN | `POST …/pool/refresh-quota -> fetch error: The operation was aborted due to timeout`（auth.phase="ok"） | UNKNOWN 6/0/3 exit 2 |
| B | 08:21:27 | `ops/release/superseded/probe-out-20261016T082127Z` | UNKNOWN | 同上（30s 超时） | UNKNOWN 6/0/3 exit 2 |
| C | 08:24:23 | `ops/release/probe-out-20261016T082423Z` | PASS | `HTTP 200 in 14727ms, body.ok=true` | UNKNOWN 7/0/2 exit 2 |
| D | 08:24:38 | `ops/release/probe-out-20261016T082438Z`（**canonical**） | PASS | `HTTP 200 in 18381ms, body.ok=true`；`families=15 weeklyFractionPresent=15` | UNKNOWN 7/0/2 exit 2 |

结论：16:20–16:21 UTC 上游配额端点持续不可达（30s 超时）→ 那两次如实记 UNKNOWN；16:24 UTC 恢复，D 作为新 canonical。
B（首版 canonical）已按 superseded 流程移入 `ops/release/superseded/`，作废理由为「quota 上游瞬时超时」；
其余断言未变（`process_fresh`、`ccl_registered_in_live_host` 在 A–D 四次中均为 UNKNOWN，未因重试转 PASS）。
