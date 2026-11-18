# T1 — 出口 × 资格 × 直连 矩阵实验 复跑手册

生成：2026-11-16T18:1x+08:00 ｜ 执行：`worker-egress/exp-egress`（一级 subagent，未再 spawn）
预算：**生成请求 4 次上限，本次实际 3 次**（arm A/B/C 各 1）。

---

## 0. 前置

- Clash(mihomo) 在 `127.0.0.1:9090`，TUN 已起；不要用 7890/7891（那是**入站**代理，需 `authentication` 用户名密码，且规则路由会落到 `漏网之鱼`，不是 `Google` 组）。
- `store-selected: true`：**任何 selector 切换都必须恢复并校验**，否则会把用户面板选择改掉。
- 目标组：`Google`（Selector）；默认 `now` 见 P0 快照。

## 1. 取 secret（只进变量，永不 echo/落盘）

```bash
CFG=$HOME/.config/clash-meta/config.yaml
SECRET=$(grep -m1 -E '^[[:space:]]*secret:' "$CFG" \
  | sed -E 's/^[[:space:]]*secret:[[:space:]]*//' \
  | sed -E 's/[[:space:]]+#.*$//' | tr -d '"' | xargs)
# 自检：期望 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SECRET" http://127.0.0.1:9090/version
```

> 坑 1：`secret:` 行尾可能带 `# 注释`，必须先剥注释再剥引号，否则拿到的是注释文本 → 401。
> 坑 2：`authentication:` 段是 **7890/7891 入站**用户名密码，与 9090 控制器无关，别混用。

## 2. 存 before 快照 + 取原值

```bash
curl -sS -H "Authorization: Bearer $SECRET" http://127.0.0.1:9090/proxies -o /tmp/p.json
python3 - <<'PY'
import json; d=json.load(open('/tmp/p.json'))['proxies']
for g in ("Google","漏网之鱼","总模式"): print(g, d[g]["type"], "->", d[g]["now"])
PY
```

`ORIG_GOOGLE`、`ORIG_LW` 记下来（本次分别为 `Main：🇺🇲 美国 | V2 | 02` 与 `总模式`）。

## 3. 节点名**从 /proxies 取**，别手打

```bash
python3 - <<'PY'
import json; d=json.load(open('/tmp/p.json'))['proxies']
ga=d["Google"]["all"]
conc=[n for n in ga if n.startswith("Main：")]        # 关键：只要具体节点，排除 日本节点/狮城节点 这类嵌套组
print(len(ga),"members;",len(conc),"concrete")
for tok in ("美国","日本","新加坡","德国","香港"):
    print(tok, [n for n in conc if tok in n][:3])
PY
```

> 坑 3：`Google.all` 里**混着组名和节点名**。PUT 一个组名（如 `日本节点`）会被接受，但出口变成 URLTest 间接选路、不可复现。只选 `Main：…` 开头的具体节点。
> 坑 4：日本要排除名字含「尼日利亚」的；香港要排除含「直连」的。

## 4. 出口地理（方法 B：临时把 `漏网之鱼` 钉到同一节点）

`ipinfo.io` 不解析到 `Google` 组（走 MATCH → 漏网之鱼），所以必须临时把 `漏网之鱼` 钉到与 `Google.now` 相同节点，裸 curl 拿出口 IP，**立即恢复**。

```bash
./ops/relink/t1-switch.sh egress '<节点名>' ops/relink/t1-ipinfo-R1.json
```

脚本内部：存 `LW_ORIG` → PUT 钉住 → 并发 curl（ipinfo + ipapi.co + ip-api.com）→ **trap 恢复** → 再独立 GET 校验恢复成功。

> 坑 5：`ipinfo.io` 原始响应逐行是 **3 超时 / 2 成功 / 1 限流**（R1/R2/R5 = `{"error":"empty_response","curl_rc":28}`；R3/R4 = 200 含 ip/city/country；R6 = 429 Rate limit），**不是全程 429**；`ipapi.co` **0 行可用**（R1–R4 `RateLimited`、R5 付费墙文本、R6 Cloudflare HTML）。实际可用源是 `ip-api.com`（5/6 行，R5 超时）。三个源**并发**打，窗口 ≈ max(timeout) 而非三者之和，减少对 MATCH 流量的附带影响；双源同 IP 互证仅 R3/R4。
> 坑 6：恢复必须**独立复查**（再 GET 一次 now），不能只信 PUT 返回码。

## 5. 零配额资格探针（每个区域 1 次）

```bash
cp /usr/bin/agy /tmp/t1-agy-official && chmod +x /tmp/t1-agy-official
bash ops/relink/t1-cli-probe.sh --out ops/relink/t1-cli-probe-R1.json --account 3 \
     --bin /tmp/t1-agy-official --timeout 30 --keep-home
```

未打补丁的官方 CLI 在 ineligible 时**于本地中止**，不发 `streamGenerateContent` → 零生成配额。
若账号 eligible 则会产生生成，verdict 会是 `generation_success_quota_consumed`，**那要计入 4 次预算**。

> 坑 7：`--keep-home` 才能拿到日志原文（JSON 里只有命中**计数**，没有行文本）。取完必须删掉那个临时 HOME（里面是 token 副本）。
> 坑 8：**官方 CLI 会自我更新**。本次副本在运行中被原地替换（215MB → 265MB，mtime 18:04:04），导致 R1 与 R2–R6 跑在两个官方构建上（日志行号 `server_oauth.go:114` → `:133` 可佐证）。要字节稳定就 `chmod 500 /tmp/t1-agy-official` 后再跑。`/usr/bin/agy` 本身是 root 所有、未被改动（sha256 前后一致）。

一行一条跑完整行（切换 + 地理 + 探针 + 连接旁证）：

```bash
bash ops/relink/t1-row.sh R1 '<节点名>'
bash ops/relink/t1-row.sh R2 '<节点名>'   # ... R3..R6
```

## 6. 直连三臂（身份固定 arm A，只改出口）

```bash
# 先 dry-run 确认 body sha256 与 spec 一致（无网络 I/O）
bash ops/relink/t1-probe.sh --arm A --account 3 --out /tmp/dry.json --dry-run
#  期望 request_body_sha256 = 8d9647890ce6f8b7b82ac466db3c324499225016fc3b527cd7964fb5967f40bb

./ops/relink/t1-switch.sh set Google '<R1 节点>'
bash ops/relink/t1-probe.sh --arm A --account 3 --out ops/relink/t1-arm-A.json

./ops/relink/t1-switch.sh set Google '<R2 节点>'
bash ops/relink/t1-probe.sh --arm A --account 3 --out ops/relink/t1-arm-B.json

# C 仅当 B 状态码 == A 状态码（都非 200）且 计数 < 4
./ops/relink/t1-switch.sh set Google '<R3 节点>'
bash ops/relink/t1-probe.sh --arm A --account 3 --out ops/relink/t1-arm-C.json
```

**任何一臂返回 200 就立刻停**，存 SSE 原文到 `t1-arm-<X>.body.txt` 并置 `found_200=true`。

## 7. 恢复 + 收尾校验

```bash
./ops/relink/t1-switch.sh set Google "$ORIG_GOOGLE"
./ops/relink/t1-switch.sh verify Google "$ORIG_GOOGLE"
./ops/relink/t1-switch.sh verify 漏网之鱼 "$ORIG_LW"
sha256sum /usr/bin/agy        # 必须与 P0 记录一致
```

## 8. 脱敏自检（每个产物都必须 0）

```bash
# 字符类写法与原始 pattern 等价，但本文件自身不会命中（否则自检脚本会把自己数成 1 个泄漏）
for f in ops/relink/t1-*; do
  printf '%-46s %s\n' "$f" "$(grep -cE 'ya29[.]|1[/]/|ey[J]' "$f")"
done
```

另外确认产物里没有明文 token / secret / 完整邮箱（邮箱一律打码成 `z***@gmail.com`）。

## 9. 产物清单

| 文件 | 内容 |
|---|---|
| `t1-clash-before.json` / `t1-clash-after.json` | 三个 selector 的 type/now/member_count 前后快照 |
| `t1-run.json` | 计数、逐请求时间戳、before/after、interference、完整性、偏离记录 |
| `t1-matrix-data.json` | 逐行矩阵 + `conclusion_inputs`（不含结论） |
| `t1-ipinfo-R<n>.json` / `.ipapi.json` / `.ipapicom.json` | 三源出口地理原文（ipinfo 为 429 原文，保留当证据） |
| `t1-cli-probe-R<n>.json` | 探针 verdict/exit/duration/hits |
| `t1-cli-log-R<n>.txt` | 命中的原始日志行（server_oauth.go 等） |
| `t1-connections-R<n>.log` | 探针期间 `/connections` 采样，用于验证流量确实走了目标节点 |
| `t1-arm-{A,B,C}.json` | 直连响应（状态码/延迟/body sha256/body 原文） |
| `t1-run.log` | 全量命令与原始输出（已脱敏） |
| `t1-switch.sh` / `t1-row.sh` | 切换/恢复助手、单行执行器 |
