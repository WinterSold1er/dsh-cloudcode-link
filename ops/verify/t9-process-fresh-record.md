# T9 — `process_fresh` 判据去 mtime 化（消费独立安装记录）

## 改了什么

`scripts/verify/post-restart-probe.mjs` 的 `process_fresh` 不再以「安装副本 mtime < host 启动」为判据，
改为消费发布流水线独立产出的记录 `ops/release/install-complete.json`
（字段 `installCompletedUtc` / `installedSha256` / `installedPath` / `repoHead`，可用 `--install-record <path>` 覆盖路径）。

判定规则：

| 情形 | verdict |
|---|---|
| `hostStartMs > installCompletedUtc` 且 记录 sha == 安装副本 sha 且 记录 path == 实际探测路径 | PASS |
| 记录 `installedSha256` != 实际安装副本 sha256 | FAIL |
| 记录 `installedPath` != 实际探测路径 | FAIL |
| `hostStartMs` 不晚于 `installCompletedUtc` | FAIL |
| 记录缺失 / JSON 非法 / 缺字段 / 时间不可解析 | UNKNOWN（不回退 mtime，绝不 PASS） |
| 检测到 `WARN: SUSPECT TIMESTAMP`（mtime 晚于 host 启动，或 mtime 早于记录安装完成 5min 以上） | UNKNOWN |
| unit 非 active / 无监听进程 / 监听 PID != MainPID / 启动时间算不出 / 产物缺失 / `--since` 被违反 | FAIL |

mtime 仍在证据里打印，但只作上下文，**永不作为 freshness 判据**；`--since` 保留为额外下界。
`ccl_registered_in_live_host` 同步修正语义：新进程证据 UNKNOWN 时该条也判 UNKNOWN（不再把「未证明」当 FAIL）。

## 真实环境 canonical 运行

```
cd /home/csy/Code/Github/dsh-cloudcode-link && node scripts/verify/post-restart-probe.mjs --out ops/release/probe-out-<UTC ts>
```

- 日志：`ops/release/probe-out-20261016T080158Z/probe-2026-10-16T08-02-21-403Z.log`（同份镜像 `ops/verify/`）
- `VERDICT: PASS (PASS=9 FAIL=0 UNKNOWN=0, exit 0)`
- `process_fresh` 依据来源：**独立安装记录**，不是 mtime——
  `MainPID=581348 ExecMainStartTimestamp=Fri 2026-10-16 15:42:17 CST`（`hostStartMs=1792136537316`）
  > 记录 `installCompletedUtc=2026-10-16T15:42:06+08:00`（`1792136526000`）；
  记录 `installedSha256=6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`
  == 实际安装副本 sha256；记录 `installedPath` == 实际探测路径；记录 `repoHead=f29859706175201043cc51260fef177106719c68`。
  mtime 仅打印：`1792136536316 (2026-10-16T07:42:16.316Z)`。

## 负向验证（证明断言非恒真；原始输出见 `ops/verify/negative-controls-t9.log`）

全部为只读运行 + `/tmp` 构造 fixture；**未重启 host、未 touch / 未 `cp -p` 任何既有产物 mtime**
（N4 只用普通 `cp` 新建了一份临时副本，其新文件 mtime 自然晚于 host 启动，用于触发嗅探分支）。

| 用例 | 构造 | process_fresh 结果 | 整体 |
|---|---|---|---|
| N1 | 记录 `installCompletedUtc=2026-10-16T23:59:00+08:00`（晚于 host 启动） | **FAIL** — `host started 1792136537316 (07:42:17.316Z) which is NOT after the recorded install completion 1792166340000 (15:59:00.000Z)` | FAIL exit 1 |
| N2 | 记录 `installedSha256=deadbeef…` | **FAIL** — `record installedSha256 deadbeef… != actual installed artifact sha256 6b8e1fad…` | FAIL exit 1 |
| N3 | `--install-record /tmp/ccl-rec-missing.json`（不存在） | **UNKNOWN** — `missing/invalid independent install record (install record not found: …)` | UNKNOWN exit 2 |
| N4 | `--installed /tmp/ccl-suspect-copy`（副本 mtime 晚于 host 启动） | **UNKNOWN** + `WARN: SUSPECT TIMESTAMP - artifact mtime … is LATER than host start …` | UNKNOWN exit 2 |

## 残留局限（不美化）

- 记录 `install-complete.json` 自带 `provenance.writtenAfterTheFact: true`（由 `release-20261016T074145Z.log` 事后推导），
  其独立性取决于该日志本身；探针只能校验「记录 vs 实际产物哈希/路径一致 + 进程晚于记录时刻」，无法校验记录自身的撰写动机。
- 本轮未重启 host，故 canonical 运行对应的仍是 15:42:17 那次重启的进程；下次发布后重跑同一命令即可获得配套新记录的证据。

---

## 追加（T10，审查员第 2 轮收敛后）

- 本说明中「canonical = `ops/release/probe-out-20261016T080158Z/…`（PASS 9/0/0）」**已作废**：该次未识别记录
  `provenance.writtenAfterTheFact=true`（自证时序），仍报 PASS。
- 现行规则：`writtenAfterTheFact === true` ⇒ `process_fresh` 一律 **UNKNOWN**（不得带 caveat 判 PASS）；
  机读 JSON 增加 `provenance`（argv / installRecordPath / installRecordBasis / processFreshBasis /
  installRecordWrittenAfterTheFact / caveat / supportingEvidence），无标注的干净 PASS 已不可能。
- 新 canonical：`ops/release/probe-out-20261016T080603Z/probe-2026-10-16T08-06-29-613Z.{log,json}` →
  **UNKNOWN（7 PASS / 0 FAIL / 2 UNKNOWN，exit 2）**；第二条 UNKNOWN 是 `ccl_registered_in_live_host`
  （同一规则的下游后果：路由由 PID 581348 应答已证，但「该进程加载的正是该交付包」未独立证明）。
- 下个发布若由安装阶段**现场写入**记录（`writtenAfterTheFact=false`），该时序项即可合法转 PASS。
- 负向验证（含自证用例 N5）：`ops/verify/negative-controls-t10.log`。
