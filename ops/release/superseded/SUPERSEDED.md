# 作废证据（superseded）— 原因与替代件

本目录存放**不再作为发布证据**的探针产物。它们被移动而非删除，以便审计追溯。

替代件（新 canonical，由审查员第 2 轮 REJECT 卡片 D2-1/D2-2 要求重生成）：

```
ops/release/probe-out-20261016T080603Z/probe-2026-10-16T08-06-29-613Z.{log,json}
```

该件由 `--install-record ops/release/install-complete.json` 生成，机读 JSON 带 `provenance`（argv /
installRecordPath / installRecordBasis / processFreshBasis / installRecordWrittenAfterTheFact / caveat /
supportingEvidence），`process_fresh` 判 **UNKNOWN**，总判定 **UNKNOWN（7 PASS / 0 FAIL / 2 UNKNOWN，exit 2）**。

| 作废件 | 原判定 | 作废原因 |
|---|---|---|
| `probe-published-2026-10-16T07-48-47-193Z.{log,json}`（07-48-47，曾作为 published 件） | PASS | `process_fresh` 依据是被操作者 `touch -d` 回拨过的安装副本 mtime（`ops/release/release-audit.md` §4.1.1）；判据可被被测者制造 |
| `probe-out-20261016T074833Z/`（同一次 07-48-47 运行） | PASS | 同上 |
| `probe-out-20261016T075205Z/probe-2026-10-16T07-52-18-544Z.{log,json}`（07-52-05） | PASS | argv 无 `--install-record`，`process_fresh` 仍以 mtime 为准；机读 JSON 无 provenance/basis，对外呈无标注的干净 PASS 9/0/0，与审计「接受 process_fresh=UNKNOWN」自相矛盾 |
| `probe-out-20261016T080158Z/`（08-02-21，T9 期间产出） | PASS | 已用独立记录作依据，但当时未识别该记录 `provenance.writtenAfterTheFact=true`（自证时序），仍报 PASS；现按同一规则改判 UNKNOWN 并作废 |

其余 `probe-out-20261016T074516Z / 074645Z / 074758Z` 为探索性中间运行，从未作为对外证据，保持原位、不背书。

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
