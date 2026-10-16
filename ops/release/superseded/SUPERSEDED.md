# 作废证据（superseded）— 原因与替代件

本目录存放**不再作为发布证据**的探针产物。它们被移动而非删除，以便审计追溯。

替代件（**最新** canonical，T12 钉版：机读件带 probeFile/probeSha256/repoHeadSha/repoDirty/nodeVersion）：

```
ops/release/probe-out-20261016T082438Z/probe-2026-10-16T08-24-57-420Z.{log,json}
```

历史替代件（均已被上件取代，仅留痕）：
`ops/release/superseded/probe-out-20261016T080603Z/probe-2026-10-16T08-06-29-613Z.{log,json}`（未提交探针产出）、
`ops/release/superseded/probe-out-20261016T082127Z/probe-2026-10-16T08-21-58-057Z.{log,json}`（配额上游瞬时超时导致 quota 判 UNKNOWN）
（该件由**未提交**的探针产出：probeStart 16:06:03 早于探针修复提交 a318b24(16:13:49)，JSON 无探针哈希/HEAD 标记，故作废）。

最新件由**已提交**的探针（`scripts/verify/post-restart-probe.mjs` @ `0dc6c43`，sha256 `0539fdab…`）经
`--install-record ops/release/install-complete.json` 生成：机读 JSON 的 `provenance` 带
`probeFile/probeSha256/probeMatchesHeadBlob=true/repoHeadSha/repoDirty=false/repoDirtyAll(+paths)/nodeVersion`，
外加 argv / installRecordPath / installRecordBasis / processFreshBasis / installRecordWrittenAfterTheFact / caveat /
supportingEvidence；`process_fresh` 与 `ccl_registered_in_live_host` 判 **UNKNOWN**，
总判定 **UNKNOWN（6 PASS / 0 FAIL / 3 UNKNOWN，exit 2）**——第三条 UNKNOWN 是 `quota_refresh_live`：
`POST …/pool/refresh-quota -> fetch error: The operation was aborted due to timeout`（上游配额调用超时，连跑两次同现，
如实记录，未改超时阈值凑 PASS）。

| 作废件 | 原判定 | 作废原因 |
|---|---|---|
| `probe-published-2026-10-16T07-48-47-193Z.{log,json}`（07-48-47，曾作为 published 件） | PASS | `process_fresh` 依据是被操作者 `touch -d` 回拨过的安装副本 mtime（`ops/release/release-audit.md` §4.1.1）；判据可被被测者制造 |
| `probe-out-20261016T074833Z/`（同一次 07-48-47 运行） | PASS | 同上 |
| `probe-out-20261016T075205Z/probe-2026-10-16T07-52-18-544Z.{log,json}`（07-52-05） | PASS | argv 无 `--install-record`，`process_fresh` 仍以 mtime 为准；机读 JSON 无 provenance/basis，对外呈无标注的干净 PASS 9/0/0，与审计「接受 process_fresh=UNKNOWN」自相矛盾 |
| `probe-out-20261016T080158Z/`（08-02-21，T9 期间产出） | PASS | 已用独立记录作依据，但当时未识别该记录 `provenance.writtenAfterTheFact=true`（自证时序），仍报 PASS；现按同一规则改判 UNKNOWN 并作废 |
| `probe-out-20261016T082127Z/probe-2026-10-16T08-21-58-057Z.{log,json}`（08-21-58，T12 首版 canonical） | UNKNOWN（6/0/3） | 判定成立但被**上游瞬时超时**拖累：`POST …/pool/refresh-quota -> fetch error: The operation was aborted due to timeout`（同窗口 08-21-20 亦同现）；16:24 两次透明重试 quota 均转 PASS，故由 08-24-57 件取代。原始超时证据保留在同目录与本文件对照表 |
| `probe-out-20261016T080603Z/probe-2026-10-16T08-06-29-613Z.{log,json}`（08-06-29，T10 canonical） | UNKNOWN（7/0/2） | 判定本身成立，但**产出自未提交的探针修订**（probeStart 16:06:03 < 探针修复提交 a318b24 16:13:49），机读件无 `probeSha256`/`repoHeadSha`/`repoDirty`，无法证明由哪个探针版本在哪个 HEAD 上产出 → 由 T12 钉版件取代 |

其余 `probe-out-20261016T074516Z / 074645Z / 074758Z` 为探索性中间运行，从未作为对外证据；
它们**已移动至本目录**（见下方「追加：本次整理（T11 第 ⑤ 项）」表格），此处不再「保持原位」——
原措辞与目录实况不符，已订正。移动只改路径，内容与哈希未变，仍不背书。

## 追加：本次整理（T11 第 ⑤ 项）

为避免历史探测件与 canonical 混淆，以下文件**移动**（未删除）到本目录，内容与哈希不变：

| 原路径 | 现路径 | 说明 |
|---|---|---|
| `ops/release/probe-out-20261016T074516Z/` | 同左（本目录下） | 07:45 期，mtime 依据期，已作废 |
| `ops/release/probe-out-20261016T074645Z/` | 同左（本目录下） | 07:46 期，同上 |
| `ops/release/probe-out-20261016T074758Z/` | 同左（本目录下） | 07:47 期（mtime 回拨导致 process_fresh FAIL 的那次），同上 |

同时删除 `ops/release/trigger.txt`：其全部信息（触发时刻、前置 host PID/启动时间、repo HEAD）
已完整记录在 `ops/release/release-<UTC>.log` 头部（`# started_at` / `pre_pid` / `pre_start` / `repo_head_at_start`），
该文件属冗余，删除不损失证据。

`ops/verify/` 下的 T9 期散件已移动到 `ops/verify/superseded/`，连同其 `probe-2026-10-16T08-02-21-403Z.superseded.md` 说明一同保留。

## 附：`quota_refresh_live` 超时—恢复对照表（透明重试，未静默重跑到变绿）

同一条命令 `node scripts/verify/post-restart-probe.mjs --repo . --out <dir> --install-record ops/release/install-complete.json`，
同一探针修订（`0dc6c43`，sha256 `0539fdab…`，`probeMatchesHeadBlob=true`、`repoDirty=false`），未改任何超时/参数：

| # | 运行时刻 (UTC) | 目录 | quota 条目 verdict | 原始证据行 | 总判定 |
|---|---|---|---|---|---|
| A | 08:20:49 | `probe-out-20261016T082049Z` | UNKNOWN | `POST …/pool/refresh-quota -> fetch error: The operation was aborted due to timeout`（auth.phase="ok"） | UNKNOWN 6/0/3 exit 2 |
| B | 08:21:27 | `superseded/probe-out-20261016T082127Z` | UNKNOWN | 同上（30s 超时） | UNKNOWN 6/0/3 exit 2 |
| C | 08:24:23 | `probe-out-20261016T082423Z` | PASS | `POST …/pool/refresh-quota -> HTTP 200 in 14727ms, body.ok=true`；15 family，weeklyFraction 15/15，resetTime 全为未来 | UNKNOWN 7/0/2 exit 2 |
| D | 08:24:38 | `probe-out-20261016T082438Z`（**canonical**） | PASS | `POST …/pool/refresh-quota -> HTTP 200 in 18381ms, body.ok=true`；`families=15 weeklyFractionPresent=15`，`freshest updatedAt=1792139078985 (age -158ms)` | UNKNOWN 7/0/2 exit 2 |

结论：16:20–16:21 UTC 窗口内上游配额端点持续超过 30s 未响应（两次独立超时）；16:24 两次运行恢复（14.7s / 18.4s）。
超时的两次运行全部保留（未删除、未覆盖），作为「上游瞬时不可达」的可复核依据。
