# T14 验收清单 — 用户侧真实聊天（cloudcode-link / daily-first）验证

- 目的：用户在新会话里用 `cloudcode-link` provider 发一句 `hi` 后，用**可复制的本地证据**确认：① 请求确实经过插件成功路径；② 走的是**新代码（dist `677d9a81…`，daily-first）**与 **daily 端点**；③ 失败时能一眼定位是否 429 冷却。
- 前置事实：安装副本 sha256 = `677d9a81e70ba139a417e5fff5e7c784d3efdd6fa97a34f359b7db6e77f7ce82`（daily-first），`/status` = `enabled:true`。**本清单只读，不代发聊天请求**。

---

## 0. 测试前基线（记录到一处，便于对比）

```bash
# 0.1 新代码在位？
sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
# 期望：677d9a81e70ba139a417e5fff5e7c784d3efdd6fa97a34f359b7db6e77f7ce82

# 0.2 插件健康 + 当前 lastRun（内存态，重载/重启会清空）
curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status \
  | jq -c '{distSha256,enabled,dormantReason,defaultModel,defaultEffort,lastRun,catalog}'
# 期望：distSha256="adba7687bbf0acf156118b9700219124dfdf32fc2941fb3bb9f20f156dcfefcd"
# 且与该命令结果一致：sha256sum ~/.dsh/profiles/web/node_modules/dsh-cloudcode-link/dist/index.js
# （distSha256 是 T13 新增字段，用于判断“运行中代码是否最新”；不要期望存在 build 键——临时标记已删除）

# 0.3 记录“测试前最后一条”请求指标（时间戳 = 毫秒 epoch）
sqlite3 -header -column ~/.cloudcode/accounts/stats.db \
  "select max(timestamp) as last_ts from request_metrics;"

# 0.4 端点伪装 IP 映射（Clash TUN fake-ip；测试前重测，Clash 重启会变）
getent ahostsv4 daily-cloudcode-pa.googleapis.com | head -1
getent ahostsv4 cloudcode-pa.googleapis.com        | head -1
# 本次实测：daily=172.20.0.59  production=172.20.0.91
```

> 记录基线时刻 `T0`：`date -u +%FT%TZ`（UTC）与 `date +%FT%T%z`（CST=UTC+8）。

---

## 1. 用户操作（由用户完成，本清单不执行）

1. 新开一个会话；
2. 选择 provider = **Google Antigravity**（`cloudcode-link`），模型 = `gemini-3.8-flash`（默认 effort=high → wire slug `gemini-3.8-flash-high`）；
3. 发送一句 `hi`；
4. 记下发送时刻 `T1`（UTC 与本地）。

---

## 2. 证据①：`request_metrics` 新增行（主证据）

数据库：`~/.cloudcode/accounts/stats.db`（WAL 模式，只读连接也能看到已提交数据）。
表结构（实测）：`requestId, sessionId, accountId, model, timestamp(ms epoch), status, latencyMs, ttftMs, cacheHit, promptTokens, cachedTokens, outputTokens`。

```bash
python3 - <<'PY'
import sqlite3, os, datetime
p = os.path.expanduser('~/.cloudcode/accounts/stats.db')
c = sqlite3.connect(f'file:{p}?mode=ro', uri=True)   # 只读，不写库
for (rid, sid, acc, model, ts, st, lat, pt, ot) in c.execute(
    "select requestId,sessionId,accountId,model,timestamp,status,latencyMs,promptTokens,outputTokens "
    "from request_metrics order by timestamp desc limit 5"):
    utc = datetime.datetime.fromtimestamp(ts/1000, datetime.timezone.utc)
    cst = utc.astimezone()                            # 本机时区 = CST(UTC+8)
    print(f"{utc.isoformat(timespec='seconds')}  {cst.strftime('%Y-%m-%d %H:%M:%S %z')}  "
          f"{st:7s} model={model} acc={acc} lat={lat}ms tok={pt}/{ot} req={rid[:24]}…")
PY

# 等价 sqlite3 一行（时间戳为毫秒，除以 1000 后转 UTC）
sqlite3 -header -column ~/.cloudcode/accounts/stats.db \
  "select datetime(timestamp/1000,'unixepoch') as utc_ts, status, model, accountId, latencyMs,
          promptTokens, outputTokens
   from request_metrics order by timestamp desc limit 5;"
```

**判定（全部满足即通过）**

| 检查点 | 期望 |
|---|---|
| 新增行 | 出现 `timestamp >= T1` 的新行（且 `requestId` 不在基线里） |
| 成功 | `status = 'success'` |
| 模型 | `model = 'gemini-3.8-flash-high'`（用户若手动换 effort/模型，以实际 wire slug 为准） |
| 用量 | `promptTokens > 0` 且 `outputTokens > 0` |
| 延迟 | `latencyMs` 为正值（daily 首 token 通常 1–10s，含思考会更长） |

> 时区换算提醒：`timestamp` 是**毫秒**。`datetime(timestamp/1000,'unixepoch')` 给 UTC；CST = UTC+8。若手工换算可 `date -u -d @<秒>` 与 `date -d @<秒>` 对照。

---

## 3. 证据②：`/status.lastRun`（内存态，发完立刻看）

```bash
curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status \
  | jq -c '{enabled,dormantReason,lastRun}'
```

期望（适配器真实完成后写入）：

```json
{"enabled":true,"dormantReason":null,"lastRun":{"ok":true,"code":"OK","durationMs":0,"model":"gemini-3.8-flash-high"}}
```

- `lastRun` 来源 `src/host/adapter.ts:538-543`（成功 `ok:true, code:"OK"`；流失败 `ok:false, code:"STREAM_ERROR"`，见 :545-550）。
- **注意**：`lastRun` 只在内存里；插件 HMR 重载或 host 重启会变回 `null`。所以要在聊天结束后立刻读，且不要在此期间触发 reload。`durationMs` 偶发为 0 属计时口径，可忽略。

---

## 4. 证据③：端点归属（daily vs production）

`request_metrics` **没有 endpoint 列**（历史已知缺口）。用下面两种方式确认"实际打的是 daily"：

**4.1 连接采样（推荐；在用户点发送前启动，覆盖 T1..T1+20s）**

```bash
# 终端 A：先确认 fake-ip 映射（见 0.4），再采样宿主进程的 443 连接
# 注意：host 自身还有后台 quota 轮询等流量，可能同时出现 production；判定看“请求窗口内是否出现 daily”
for i in $(seq 1 400); do
  ss -tnp 2>/dev/null | grep -E '172\.20\.0\.(59|91)' | grep -E 'pid=2685153'
  sleep 0.05
done | awk '{print $5}' | sort -u
# 172.20.0.59:443  → daily ✅（出现即可作为“走新端点”的旁证）
# 172.20.0.91:443  → production（后台 quota 轮询也可能命中，单独出现不等于失败；要结合 success）
```

> 已实测 `ss -tnp` 在本机可看到 `users:(("node-MainThread",pid=2685153,fd=..))` 与 `172.20.0.x:443` 形式的 fake-ip 远端。
> 若映射变了（Clash 重启），先用 0.4 重新取两个域名的 fake-ip 再替换正则。

**4.2 事后旁证（无采样时的次优判据）**

- 该账号（`acc_1788785623927_xhs7n` 等）在 **production 端点已被多次证实 429**（T3 gen#4、T1 三臂）；**这次若 `success`，基本只能是 daily**。
- 进一步：`/status` 里 `lastRun.ok=true` 且 stats 行 `status='success'` 同时成立。

---

## 5. 失败分支：若这次聊天失败

按顺序查三处，**先确认是否 429**：

```bash
# 5.1 内存态结果
curl -s http://127.0.0.1:3080/plugins/cloudcode-link/status | jq -c '{lastRun,enabled,dormantReason}'

# 5.2 冷却是否被写（reason 里应有 429 原文；family 可能是 google/anthropic/openai）
curl -s http://127.0.0.1:3080/plugins/cloudcode-link/pool \
  | jq -c '.accounts[] | {id,enabled,cooldowns}'

# 5.3 请求指标（失败行 status='error'，token 计数为 0）
python3 - <<'PY'
import sqlite3, os, datetime
p = os.path.expanduser('~/.cloudcode/accounts/stats.db')
c = sqlite3.connect(f'file:{p}?mode=ro', uri=True)
for (ts, st, model, acc, lat) in c.execute(
    "select timestamp,status,model,accountId,latencyMs from request_metrics order by timestamp desc limit 5"):
    print(datetime.datetime.fromtimestamp(ts/1000, datetime.timezone.utc).isoformat(), st, model, acc, f"{lat}ms")
PY
```

**判据表**

| 现象 | 含义 | 下一步 |
|---|---|---|
| `lastRun.ok=false, code="STREAM_ERROR"` + stats `status='error'` + `cooldowns.<family>.reason` 含 `429 ... RESOURCE_EXHAUSTED` | 仍是 429（daily 也被限流/或没走 daily） | 先用 4.1 确认命中端点；若 daily 仍 429，属账号级限流，换账号/等冷却（`POST /plugins/cloudcode-link/pool/clear-cooldown` 只清本地冷却，不改上游） |
| 失败但 `cooldowns` 未新增、reason 不含 429 | 不是 429（可能是 404/401/网络/模型 slug） | 看 stats 行 model 与 `lastRun.code`；对照 T12 残余风险（`-tiered`/`-low`/`-medium` 未验证） |
| `status` 404 或连接失败 | 插件路由不在（重载失败/dormant） | 检查 `dormantReason`；必要时按 T13 §5 回滚 dist 并再次触发 recomposition |

---

## 6. 验收结论记录模板（贴进 review）

```
T0=<UTC> / T1=<UTC>
dist_sha256=<sha256sum 输出>
new_row={timestamp_utc, status, model, promptTokens, outputTokens, latencyMs}
lastRun={ok, code, model, durationMs}
endpoint_evidence={4.1 采样结果 or 4.2 旁证}
verdict=PASS|FAIL(<原因分类>)
```

---

## 7. 红线

- 本清单**不代发聊天请求**；不重启 host；不改 `/usr/bin/agy`；不改 `~/.dsh` 其它文件。
- 查询数据库一律 `mode=ro`；不要把 token / `Authorization` 写进任何记录。
- 本清单中的 `172.20.0.x` 是 Clash TUN 的 fake-ip，**Clash 重启后会变**，每次以 0.4 的实时结果为准。
