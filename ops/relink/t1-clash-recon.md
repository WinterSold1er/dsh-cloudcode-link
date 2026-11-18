# T1 — Clash(mihomo) 出口路由只读侦察

- **生成时间**：2026-11-16T17:42+08:00
- **执行者**：`worker-egress/recon-clash`（一级 subagent，**只读**）
- **本次未做**：未切换任何 selector、未发任何 cloudcode-pa / googleapis / ipinfo 请求、未改动 config / /tmp/agy-fix / /usr/bin/agy 及任何仓库文件
- **产物**：`ops/relink/t1-clash-recon.{json,md,log}`
- **脱敏**：`secret` / `authentication` 密码在本文与 log 中一律以 `$SECRET` / `$CLASH_AUTH` 占位，不出现明文。
- **`chain` 顺序约定**：本文与 JSON 中的 chain 均按 **最外层 → 最内层（规则目标组 → … → 最终节点）**；mihomo `GET /connections` 的 `chains` 字段是**反序**（最终节点在前），比对时注意。

---

## 0. TL;DR（可直接拿去用）

| 问题 | 结论 |
|---|---|
| Google 系域名命中哪个组 | 规则 `RuleSet Google_域`（运行时 rule idx **24**，config **L636**）→ 组 **`Google`** |
| `Google` 组类型 | **Selector（可直接 PUT 切换）**，72 个成员 = 12 个组名 + 60 个具体节点 |
| 当前选中的节点 | `Main：🇺🇲 美国 | V2 | 02`（**切换前必须重新读**，会漂移） |
| chain | `Google` → `Main：🇺🇲 美国 | V2 | 02` |
| `generativelanguage.googleapis.com` | **例外！** 命中显式规则 `DOMAIN`（idx **2**，L600）→ 组 **`其它地区`**，当前 `Main：🇦🇺 澳大利亚 | V1 | 01`。**与 cloudcode 不是同一个组** |
| `ipinfo.io` | 无任何规则命中 → `MATCH`（idx **46**，L668）→ `漏网之鱼` → `总模式` → `美国节点` → 节点。**与 Google 组无关** |
| 美国候选节点 | 8 个：`Main：🇺🇲 美国 | V2 | 01`、`V2 | 02`、`V1 | 01..06` |
| 非美国候选 | 日本 8 个（含 1 个 bug 混入的尼日利亚）、新加坡 8、香港 9、其它地区 20（含 DE/GB/KR/AU…） |
| ipinfo 首选方法 | **方法 B**：临时把 `漏网之鱼` 钉到 `Google.now` 同一个节点 → 裸 `curl https://ipinfo.io/json`（走 TUN/规则）→ 立即恢复。窗口 ~6s。无 `listeners:` 段，故方法 A 不可用 |
| 最大风险 | `profile.store-selected: true` → **PUT 会被持久化到 cache.db**，脚本中断后即使重启 Clash 仍保持测试节点，必须 restore + verify |

---

## 1. 运行实例与生效配置

```bash
ps -eo pid,args | grep -i -E 'clash|mihomo' | grep -v grep
```
```
   1383 /home/csy/.local/share/clash-meta/clash-meta -f /home/csy/.config/clash-meta/config.yaml -d /home/csy/.config/clash-meta
```
结论：`-f` 与 `-d` 同时指向 `~/.config/clash-meta`，因此 `~/.config/clash-meta/config.yaml` **就是生效配置**（非 `config.yaml.bak.*`）。

```bash
ss -tln | grep -E ':(7890|7891|7898|1536|9090|1053) '
```
```
LISTEN 0 4096 *:1053 *:*
LISTEN 0 4096 *:1536 *:*
LISTEN 0 4096 *:7898 *:*
LISTEN 0 4096 *:7890 *:*
LISTEN 0 4096 *:7891 *:*
LISTEN 0 4096 *:9090 *:*
```
（`ss -tlnp` 的进程列需要 root，本会话拿不到 PID 归属；PID 已由 `ps` 给出。）

核心版本：
```bash
curl -s -H "Authorization: Bearer $SECRET" http://127.0.0.1:9090/version
```
```json
{"meta":true,"version":"v1.19.12"}
```

---

## 2. 端口与入站认证（解释了 7890/7891 的 407）

config 关键行（行号为 `config.yaml` 原始行号）：

| 行 | 内容 |
|---|---|
| 3–6 | `port: 7890` / `socks-port: 7891` / `mixed-port: 7898` / `tproxy-port: 1536` |
| 8 | `mode: Rule` |
| 28 | `external-controller: 0.0.0.0:9090` |
| 31 | `secret: "***"`（长度 6，**明文不入产物**） |
| 37–38 | `authentication:` → `- "proxy:***"`（**用户名 `proxy`，密码脱敏**） |
| 104–106 | `profile: {store-selected: true, store-fake-ip: true}` |
| 129–159 | `tun:` |
| 160–194 | `dns:` |

`GET /configs` 佐证（脱敏后）：
```
mode = "rule"
mixed-port = 7898 | port = 7890 | socks-port = 7891 | tproxy-port = 1536
allow-lan = true
authentication = ["proxy"]      # 只回显用户名，不回显密码
tun = {"enable": true, "device": "Meta", "stack": "gVisor", "dns-hijack": ["any:53","tcp://any:53"],
       "auto-route": true, "strict-route": true, "inet4-address": ["172.20.0.1/30"], "udp-timeout": 300}
geodata-mode = false   geo-auto-update = true
```

认证行为实测（**目标只用本机 9090，未出网**）：
```bash
curl -s -o /dev/null -w '%{http_code}' --max-time 4 -x http://127.0.0.1:7890 http://127.0.0.1:9090/version
# -> 407   （无凭据）
curl -s -o /dev/null -w '%{http_code}' --max-time 4 -x "http://$CLASH_AUTH@127.0.0.1:7890" http://127.0.0.1:9090/version
# -> 401   （代理认证已通过！401 是 9090 自己要求 Bearer 认证头造成的）
curl -s -o /dev/null -w '%{http_code}' --max-time 4 -x socks5h://127.0.0.1:7891 http://127.0.0.1:9090/version
# -> 000 / curl exit 97（SOCKS 握手失败：同样要求用户名密码）
```
**推断**（由 407→401 的变化得出，已足够确定）：`7890` 带 `$CLASH_AUTH` 后认证通过并转发，`401` 来自 mihomo API 本身。所以 `curl -x http://$CLASH_AUTH@127.0.0.1:7890 …` 是可用的 **http 代理入口**，但它**走规则**，不锁定节点。

---

## 3. TUN / DNS（决定了“域名规则”而非“IP 规则”生效）

```
tun: enable=true, device=Meta, stack=gvisor, auto-route=true, strict-route=true,
     dns-hijack=[any:53, tcp://any:53], inet4-address=172.20.0.1/30
dns: enable=true, enhanced-mode=fake-ip, fake-ip-range=172.20.0.1/16, listen=0.0.0.0:1053
     fake-ip-filter: RULE-SET:CN_域,Private_域,GoogleFCM_域 ; +.3gppnetwork.org
```
**结论**：本机出口被 TUN 全接管（`auto-route + strict-route`），fake-ip 模式下 TCP 连接元数据里带的是**域名**，所以 `DOMAIN` / `RULE-SET(domain)` 类规则优先命中；`RULE-SET,Google_IP` 只在直连字面 IP 时才可能命中。这解释了为什么 `cloudcode-pa.googleapis.com` 命中 `Google_域` 而不是 `Google_IP`。

`/connections` 里 `sourceIP=172.20.0.1`、`type=Tun` 是 TUN 接管的直接旁证。

---

## 4. Proxy groups

`proxy-groups`（config L233–408）共 **35** 个。本次相关者：

| 行 | 组名 | 类型 | 成员 | 当前 now |
|---|---|---|---|---|
| 234 | `总模式` | Selector | 10 个组名 | `美国节点` |
| 304 | **`Google`** | **Selector** | 72（12 组名 + 60 节点） | **`Main：🇺🇲 美国 | V2 | 02`** |
| 336 | `漏网之鱼` | Selector | 72 | `总模式` |
| 358 | `白名单出站` | Selector | 72 | `🇨🇳 瓦洛兰大陆`（=直连！） |
| 332 | `DNS连接` | Selector | 72 | `🇨🇳 瓦洛兰大陆` |
| 362 | `延迟最低` | URLTest | 60 | `Main：🇭🇰 香港 | V1 | 04` |
| 367 | `故障转移` | Fallback | 60 | `Main：🇭🇰 香港 | V2 | 01` |
| 372 | `负载均衡` | LoadBalance | 60 | `None` |
| 378 | `台湾节点` | URLTest | — | — |
| 383 | `香港节点` | URLTest | 9 | `Main：🇭🇰 香港 | V1 | 04` |
| 388 | `日本节点` | URLTest | 10 | `Main：🇯🇵 日本 | V2 | 01` |
| 393 | `美国节点` | URLTest | 8 | `Main：🇺🇲 美国 | V1 | 06`（随后漂到 `V1 | 02`） |
| 398 | `狮城节点` | URLTest | 8 | `Main：🇸🇬 试用 | 新加坡 | 01 | 限 20 Mbs` |
| 403 | `其它地区` | URLTest | 20 | `Main：🇦🇺 澳大利亚 | V1 | 01` |

`Google` 组的成员来自 YAML 锚点 `proxy_groups`（L200–213）+ `use:` 三个 provider（L216 附近 `A` 锚点含 `1.主要地址/2.备用地址/3.额外地址`）：

```yaml
# L200
proxy_groups: &proxy_groups
    type: select
    proxies: [总模式, ⛔️ 拒绝连接, 延迟最低, 故障转移, 负载均衡,
              香港节点, 台湾节点, 狮城节点, 日本节点, 美国节点, 其它地区, 🇨🇳 瓦洛兰大陆]
    <<: *A          # use: [1.主要地址, 2.备用地址, 3.额外地址]
```

**关键**：`use:` 把 provider 里的 60 个**具体节点**也并进了 `all`，所以 `Google` 的 72 个成员里既有组名也有节点名 —— 这就是**可以直接 PUT 具体节点**的原因（见 §8）。

`GET /proxies` 实测：
```
Google     | type=Selector    | now=Main：🇺🇲 美国 | V2 | 02 | all=72
漏网之鱼    | type=Selector    | now=总模式                | all=72
美国节点    | type=URLTest     | now=Main：🇺🇲 美国 | V1 | 06 | all=8
其它地区    | type=URLTest     | now=Main：🇦🇺 澳大利亚 | V1 | 01 | all=20
```

**注意（URGENT）**：`美国节点` 的 `now` 在本次侦察过程中从 `V1 | 06` 漂到 `V1 | 02`（URLTest 自动重选）。所有 URLTest 组的 `now` 都是**时点快照**，动手前必须重读。

---

## 5. Rules（自上而下首个命中；行号 = config.yaml，idx = 运行时 0-based）

总规则数 **47**（`GET /rules`）。

```
 idx   类型             payload / 目标                          config 行
   2   Domain           generativelanguage.googleapis.com -> 其它地区    L600
   5   RuleSet          自定义出站 -> 白名单出站                          L605   【惰性，见下】
  23   DomainKeyword    mtalk.google -> GoogleFCM                        L634
  24   RuleSet          Google_域 -> Google                              L636
  25   RuleSet          Google_IP -> Google                              L637
  46   Match            (empty) -> 漏网之鱼                              L668
```

原文（config L594–L668 摘录，保持原顺序）：
```yaml
  # - PROCESS-NAME,agy,其它地区                       # L594  【已注释】
  - DOMAIN-KEYWORD,tailscale.com,🇨🇳 瓦洛兰大陆       # L596
  - DOMAIN-KEYWORD,api.commandcode.ai,美国节点        # L598
  - DOMAIN,generativelanguage.googleapis.com,其它地区 # L600  ← 在 Google_域 之前！
  - DST-PORT,53,🌐 DNS_Hijack                         # L602
  - DST-PORT,853,DNS连接                              # L603
  - RULE-SET,自定义出站,白名单出站                      # L605
  - RULE-SET,WebRTC_端/域,WebRTC                       # L606
  - RULE-SET,No-ads-all_域,广告拦截                     # L607
  ...
  - DOMAIN-KEYWORD,mtalk.google,GoogleFCM             # L634
  - RULE-SET,Google_域,Google                          # L636  ← 目标
  - RULE-SET,Google_IP,Google                          # L637
  ...
  - DOMAIN-SUFFIX,opencode.ai,opencode                 # L661
  - DOMAIN-SUFFIX,api.commandcode.ai,opencode          # L662
  - RULE-SET,CN_域,🇨🇳 瓦洛兰大陆                        # L663
  - RULE-SET,CN_IP,🇨🇳 瓦洛兰大陆                        # L664
  - RULE-SET,Private_域,🇨🇳 瓦洛兰大陆                   # L665
  - RULE-SET,Private_IP,🇨🇳 瓦洛兰大陆                   # L666
  - MATCH,漏网之鱼                                      # L668
```

`L605 RULE-SET,自定义出站` 的 provider（L425–427）：
```yaml
  自定义出站:
    <<: *Local                    # {type: file, behavior: classical, format: text}
    path: ./etc/自定义规则.list
```
```bash
ls -la ~/.config/clash-meta/etc/
# -> NO etc dir ；文件不存在
```
`GET /providers/rules` → `自定义出站 | vehicleType=File | ruleCount=0`。
**结论**：这条规则**惰性**（空文件 + 0 条规则），不会截走任何域名。这点很重要，否则 `白名单出站`（当前=直连）会劫持 `ipinfo.io`。

Rule provider 元数据：
```
Google_域   | behavior=Domain | ruleCount=685   | vehicleType=HTTP | format=MrsRule | updatedAt=2026-11-16T16:06:00+08:00
Google_IP   | behavior=IPCIDR | ruleCount=5     | vehicleType=HTTP | format=MrsRule
GoogleFCM_域 | behavior=Domain | ruleCount=15   | vehicleType=HTTP | format=MrsRule
```

### 5.1 关于 mrs 规则集内容无法离线枚举（重要限制）

`Google_域` 是 `./rules/Google.mrs`（6091 B）。实测它整文件是 **zstd 帧**（魔数 `28 b5 2f fd`），解压后为 `MRS\x01` 二进制 **domain trie**，不是明文域名表：
```bash
zstd -dc ~/.config/clash-meta/rules/Google.mrs | head -c 16 | xxd
# 00000000: 4d52 5301 0000 0000 0000 0002 ad00 0000  MRS.............
```
解压后 10165 B，但域名以压缩 trie 存储，`strings | grep googleapis` / 前缀扫描均为 0 命中（共享后缀被打散）。

**所以**：`Google_域` 里到底有没有某个域名，**离线无法确证**。本报告因此采用**运行时实证**（`GET /connections` 的 `rule` / `rulePayload`），并把没抓到实证的一律标 `INFERRED`。

---

## 6. 四个（及新增九个）域名的精确判定

### 6.1 运行时实证（唯一硬证据）

```bash
curl -s -H "Authorization: Bearer $SECRET" http://127.0.0.1:9090/connections \
 | python3 -c "..."   # 只筛 host 含 google 的行
```
原始输出（关键字段，`remoteDestination` 见 §7 讨论）：
```
host=cloudcode-pa.googleapis.com                 dstIP=172.217.119.4:443   rule=RuleSet  payload=Google_域
  chains=['Main：🇺🇲 美国 | V2 | 02', 'Google']
host=autopush-cloudcode-pa.sandbox.googleapis.com dstIP=74.125.23.81:443   rule=RuleSet  payload=Google_域
  chains=['Main：🇺🇲 美国 | V2 | 02', 'Google']
host=oauth2.googleapis.com                       dstIP=142.250.141.95:443  rule=RuleSet  payload=Google_域
  chains=['Main：🇺🇲 美国 | V2 | 02', 'Google']
host=generativelanguage.googleapis.com           dstIP=(sniff)             rule=Domain   payload=generativelanguage.googleapis.com
  chains=['Main：🇦🇺 澳大利亚 | V1 | 01', '其它地区']
```
（注：`/connections` 的 chains 是**节点在前**；本地既有长连接 start 时间为 07:04，说明是插件等长驻会话的 gRPC 流。）

### 6.2 判定表

| 域名 | 命中规则（idx / 行） | 目标组 | 证据等级 |
|---|---|---|---|
| `cloudcode-pa.googleapis.com` | RuleSet `Google_域`（24 / L636） | **Google** | **已证实**（live /connections） |
| `autopush-cloudcode-pa.sandbox.googleapis.com` | RuleSet `Google_域`（24 / L636） | **Google** | **已证实** |
| `oauth2.googleapis.com` | RuleSet `Google_域`（24 / L636） | **Google** | **已证实** |
| `daily-cloudcode-pa.googleapis.com` | RuleSet `Google_域`（推断） | Google | 推断（同后缀兄弟已证实） |
| `daily-cloudcode-pa.sandbox.googleapis.com` | RuleSet `Google_域`（推断） | Google | 推断（见上） |
| `antigravity.googleapis.com` | RuleSet `Google_域`（推断） | Google | 推断 |
| **`generativelanguage.googleapis.com`** | **Domain 显式**（2 / L600） | **其它地区** | **已证实 —— 与 cloudcode 不同组！** |
| `accounts.google.com` | RuleSet `Google_域`（推断） | Google | 推断 |
| `www.googleapis.com` | RuleSet `Google_域`（推断） | Google | 推断 |
| `play.googleapis.com` | RuleSet `Google_域`（推断） | Google | 推断 |
| `*.googleapis.com`（通用） | **不存在通配规则**；覆盖仅来自 `Google_域` 的 685 条成员 | Google（成员内） | 部分 |
| `*.google.com` | RuleSet `Google_域`（推断） | Google | 推断 |
| `*.gstatic.com` | RuleSet `Google_域`（推断） | Google | 推断 |
| **`ipinfo.io`** | **无任何规则** → `Match`（46 / L668） | **漏网之鱼 → 总模式 → 美国节点** | 已由排除法证实（47 条规则逐条枚举，无 ipinfo） |

**对 `agy` 探针的直接含义**：
1. `agy` 走的是 cloudcode-pa / oauth2 一线 → **`Google` 组**。切 `Google` 就能同时影响插件与 CLI 探针（二者都打 `*.googleapis.com`）。
2. **但** `generativelanguage.googleapis.com` 独立走 `其它地区`（当前澳大利亚）。若探针/插件用到它，**只切 `Google` 不会改变它的出口**。要全包住必须同时处理 `其它地区`。
3. `ipinfo.io` 既不在 `Google` 也不在 `其它地区`，独立走 `漏网之鱼` 链 —— 这是 §9 的整个设计前提。

---

## 7. 节点地区清单

`proxies` 由订阅 provider 提供，缓存于 `~/.config/clash-meta/proxies/1.主要地址.yaml`（60 节点）。

**决定性发现：60 个节点只用了 2 个入口主机**
```
distinct servers: 2
  g2.devoodev.com    -> 59 nodes
  line.acetace.com   -> 1 node
```
```bash
timeout 6 whois 144.225.78.50 | grep -i -E 'netname|country'
# NetName: ADCIL / IPXO / NETUTILS ; Country: US
```
`/connections` 里 `remoteDestination` 也全部是 `144.225.78.50`（US），即便当时的节点是"澳大利亚"或"美国"。

→ **推断**：所有节点共用一个美国入口中继（Linode/ADCIL 段），真实出口在服务端再分流。**因此节点名/入口 IP 都不能代表出口地区，出口国家只能靠实测（ipinfo）证明。** 这也是上一手观测到 `96.126.100.194 (US Linode)` 的合理来源（中继侧），但**未证实**它对应哪个节点。

### 7.1 美国候选（≥2，实为 8）

```
Main：🇺🇲 美国 | V2 | 01
Main：🇺🇲 美国 | V2 | 02      ← Google 组当前选中
Main：🇺🇲 美国 | V1 | 01
Main：🇺🇲 美国 | V1 | 02
Main：🇺🇲 美国 | V1 | 03
Main：🇺🇲 美国 | V1 | 04
Main：🇺🇲 美国 | V1 | 05
Main：🇺🇲 美国 | V1 | 06
```
（均为 `vmess`，server `g2.devoodev.com`，端口不同：39107/39108/11503/21502/2501/11501/39105/39106）

### 7.2 非美国候选（≥2）

| 地区 | 数量 | 节点 |
|---|---|---|
| 日本 | 7（+1 误入） | `Main：🇯🇵 日本 | V2 | 01`、`日本| V2 | 02`（注意 **`日本|` 后无空格，与其它命名不一致**）、`日本 | V1 | 01..05`、`🇯🇵 试用 | 日本 | 01/02 | 限 20 Mbs` |
| 新加坡 | 8 | `Main：🇸🇬 新加坡 | V2 | 01/02`、`V1 | 01..04`、`🇸🇬 试用 | 新加坡 | 01/02 | 限 20 Mbs` |
| 香港 | 9 | `Main：🇭🇰 香港 | V2 | 01/02`、`V1 | 01..06`、`V1 | 直连` |
| 其它地区（20） | | 韩国 ×2、越南、西班牙、印尼、法国、菲律宾、印度、泰国、**英国**、**德国**、加拿大、澳大利亚、巴基斯坦、智利、意大利、马来西亚、土耳其、巴西、阿根廷 |

### 7.3 ⚠️ 命名陷阱（务必读）

1. **`日本节点` 组里混入了尼日利亚节点**：`Main：🇳🇬 尼日利亚 | V1 | 01`。
   根因（推断，由 filter 正则直接对出）：`日本节点` 的 filter 为
   `^(?=.*(日本|川日|东京|大阪|泉日|埼玉|沪日|深日|[^-]日|JP|Japan)).*$`，
   其中 `[^-]日` 会匹配"尼**日**利亚"里的"日"。→ **选 `日本节点` 不等于日本。**
2. **`香港节点` 组含 `Main：🇭🇰 香港 | V1 | 直连`**，该节点在 config L197 定义为 `type: direct` → 选它就是**直连（本机真实 IP）**，不是代理。
3. 节点名存在不一致空格：`Main：🇯🇵 日本| V2 | 02`（`日本` 后无空格）。写脚本时不要手打节点名，一律从 `GET /proxies` 取。

---

## 8. 切换方案（Selector，可直接切）

`Google` = `Selector`，成员含具体节点 → **直接 PUT 节点名即可**，无需动 `总模式`、无需动 mode。

```bash
CONFIG=~/.config/clash-meta/config.yaml
SECRET=$(sed -n 's/^secret: *"\{0,1\}\([^"#]*\)"\{0,1\} *#*.*$/\1/p' "$CONFIG" | head -1 | xargs)
API=http://127.0.0.1:9090

# 0) 读取当前原值（务必先存，切勿硬编码）
curl -sS -H "Authorization: Bearer $SECRET" $API/proxies \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['proxies']['Google']['now'])"
# 本次侦察时为： Main：🇺🇲 美国 | V2 | 02

# 1) 切换（示例：切到美国 V1|03）
curl -sS -X PUT -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
     --data '{"name":"Main：🇺🇲 美国 | V1 | 03"}' $API/proxies/Google

# 2) 校验
curl -sS -H "Authorization: Bearer $SECRET" $API/proxies \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['proxies']['Google']['now'])"

# 3) 恢复（$ORIG 来自第 0 步）
curl -sS -X PUT -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
     --data "{\"name\":\"$ORIG\"}" $API/proxies/Google
```
成功判据：PUT 返回 **HTTP 204 无 body**；`now` 立即变为目标值；随后 `GET /connections` 中新出现的 googleapis 连接 `chains[0]` 应为该节点。

**若目标组不是 Selector**（`美国节点`/`日本节点`/`其它地区`/`延迟最低`/`故障转移`/`负载均衡` 都是 URLTest/Fallback/LoadBalance）：
- **不可靠地钉节点**：mihomo 的 `URLTest`/`Fallback`/`LoadBalance` 组一般不实现「选择」接口，
  对它们 `PUT /proxies/<组名>` **预期被拒（400）** —— 本次遵守只读**未实测**，标 `未证实`；
  即便某些版本接受，健康检查也会在下一个 interval **立刻重选覆盖**，无法提供确定性。
- 可行替代：**改钉父 Selector**。想让"某地区"生效就 PUT 父组到地区组名，例如
  `PUT /proxies/Google {"name":"美国节点"}` → 之后由 `美国节点`(URLTest) 自动挑最快的美国节点。
  代价：**失去"指定到某一个具体节点"的确定性**（URLTest 会漂），不适合做"同账号换出口"的对照实验。
- 因此：**要确定性就用 `Google` 组直接钉节点名**（推荐）；要"整个地区"就用 `Google → <地区组>`（不推荐做实验）。

### 8.1 ⚠️ `generativelanguage.googleapis.com` 的节点级限制（重要）

它的规则**直接指向 `其它地区`**（idx 2 / L600），而 `其它地区` 是 **URLTest**（20 个成员）。因此在**不改 config 的前提下**：

- ❌ **无法把它钉到某个指定节点** —— 没有任何一条链路是「Selector → 具体节点」服务于它；
- ✅ 只能做「组级」影响：把它的上游 `总模式` 切走 —— 但那会牵连一大片；
- ⚠️ 因此若对照实验要求「cloudcode 与 generativelanguage 同出口同节点」，**当前配置做不到**；
  能确认的只是「两者不是同一组」（已证实）。

反过来说：若实验只关心 `cloudcode-pa` / `daily-cloudcode-pa` / `oauth2`（`agy` 探针的主链路），
它们都在 `Google` 组，**可以直接钉节点**，不受此限制。

---

## 9. 出口 IP 取证方法（**只设计，未执行**）

### 9.1 为什么不能用 7890/7891 直接量

`curl -x http://$CLASH_AUTH@127.0.0.1:7890 https://ipinfo.io/json` **走规则**：
`ipinfo.io` → `MATCH` → `漏网之鱼` → `总模式` → `美国节点` → 节点。
它与 `Google` 组**完全解耦**，所以**切 `Google` 后用它量到的 IP 不是 Google 出口**（这是最容易犯的错）。

### 9.2 方法 A（config 有 `listeners:` 段）→ **不可用**

```bash
grep -n -E '^listeners:' ~/.config/clash-meta/config.yaml   # 无输出
```
config **没有 `listeners:` 段**，也就不存在 `proxy: <节点名>` 的独立 socks/http 端口。方法 A 排除。

### 9.3 方法 B（**首选**）：临时把 `漏网之鱼` 钉到同一个节点 + 裸 curl 走 TUN

原理：`漏网之鱼` 是 Selector，其 `all` 含 72 个成员（组名 + 60 个具体节点），因此可以把它临时钉到**与 `Google.now` 完全相同的那个节点**；此时裸 `curl`（走 TUN，同样走规则）访问 `ipinfo.io` 就必然从那一个节点出去 → 量到的就是 Google 出口 IP。随后立刻恢复。

```bash
CONFIG=~/.config/clash-meta/config.yaml
SECRET=$(sed -n 's/^secret: *"\{0,1\}\([^"#]*\)"\{0,1\} *#*.*$/\1/p' "$CONFIG" | head -1 | xargs)
API=http://127.0.0.1:9090
J() { python3 -c "import json,sys;print(json.load(sys.stdin)['proxies']['$1']['now'])"; }

# --- 快照 ---
ORIG=$(curl -sS -H "Authorization: Bearer $SECRET" $API/proxies | J 漏网之鱼)   # 本次=总模式
NODE=$(curl -sS -H "Authorization: Bearer $SECRET" $API/proxies | J Google)      # 本次=Main：🇺🇲 美国 | V2 | 02
echo "ORIG=$ORIG  NODE=$NODE" | tee /dev/stderr

# --- 兜底：任何退出路径都恢复 ---
restore() {
  curl -sS -X PUT -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
       --data "{\"name\":\"$ORIG\"}" $API/proxies/漏网之鱼
  echo "[restored] 漏网之鱼 -> $(curl -sS -H "Authorization: Bearer $SECRET" $API/proxies | J 漏网之鱼)" >&2
}
trap restore EXIT INT TERM

# --- 窗口内：钉同节点 -> 量 IP -> 立刻恢复 ---
curl -sS -X PUT -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
     --data "{\"name\":\"$NODE\"}" $API/proxies/漏网之鱼
curl -sS --max-time 5 https://ipinfo.io/json          # ← 唯一的外网请求，走 TUN/规则
restore
```
- **窗口**：约 **4–6 秒**（含一次 5s 超时的 curl）。`trap` 保证无论 Ctrl-C / 异常 / 超时都会恢复。
- **副作用范围**：这 6 秒内，本机**所有**"落到 MATCH 的回退流量"（没有专属规则的一般网站、curl、pip、npm 等）都会从该节点出。`Google`/`OpenAI`/`YouTube`/`Telegram`/`GitHub` 等有专属组的流量**不受影响**。
- **为什么优于切 `总模式`**：`总模式` 只影响 `漏网之鱼` 一条路径（当前 `漏网之鱼 → 总模式`），但改 `总模式` 还会连带影响其它以 `总模式` 为成员的组路径；直接改 `漏网之鱼` 是**最小爆炸半径**。
- **不建议**改成裸 `curl`（TUN）以外的 `-x` 形式：`-x` 只是多绕一层同一套规则，收益为零。

### 9.4 方法 C（临时切 global）→ **不要用**

`mode=global` 会把**本机全部流量**（含 Tailscale DERP、SSH、其它会话的 cloudcode）压到一个节点，且 `store-selected`/`store-fake-ip` 下切换状态还会落盘。**默认禁止**；本场景有方法 B 可用，无任何理由用 global。若万不得已，必须：`GET /configs` 存 `mode` → PUT `/configs` 切 `global` → ≤8s 内测完 → PUT 回 `rule` → 校验 `GET /configs` 的 `mode`，且用 `trap` 兜底。

### 9.5 方法 D（带认证的 7890/7891）→ 仅作旁证，不作节点级取证

```bash
# http
curl -sS --max-time 5 -x "http://$CLASH_AUTH@127.0.0.1:7890" https://ipinfo.io/json
# socks（socks5h = 远端解析，避免本机 fake-ip 干扰）
curl -sS --max-time 5 -x "socks5h://$CLASH_AUTH@127.0.0.1:7891" https://ipinfo.io/json
```
**必须知道**：这两条**都走规则** → `ipinfo.io` → `漏网之鱼`。它们的价值是"验证某个节点是不是当前回退链的出口"，**不能**用来量 `Google` 组某个节点的出口。

### 9.6 优先级判定与理由

1. **B（首选）**：唯一能"把 ipinfo 精确绑到我选的那个 Google 节点"的方法；无 `listeners:` 情况下的最优解；窗口可压到 ~5s 且可 trap 回滚。
2. **D**：零切换成本，但只反映 `漏网之鱼` 链，**无法体现 Google 组选择** → 只能做旁证。
3. **C**：副作用全局且落盘 → 除非 B 失败且已论证，否则禁用。
4. **A**：本机不存在，排除。

---

## 10. 探针链路取证（`agy -p "hi" --output-format json`，**给片段不执行**）

前提事实：
- `agy` = `~/.local/bin/agy`（101 行 bash wrapper），对 `/usr/bin/agy` 做**字节校验后的补丁副本**再 exec；补丁是"绕过账号 gate"，**不重写 base URL** → 仍打真实 `*.googleapis.com`。
- 日志目录 `~/.gemini/antigravity-cli/log/` 存在，但**日志里不记录域名**（实测 grep `googleapis|cloudcode|daily` 全 0；只有 gRPC language-server 日志、`server.go`、`cache.go` 等）。
- `/connections` 的 `metadata.process` / `processPath` 对 TUN 连接**为空**（本机 `find-process-mode: always` 也没用，因为源是 TUN 而非本地 socket）→ **不能按 PID 过滤**。

因此用"**时间窗 + host 匹配**"：

```bash
CONFIG=~/.config/clash-meta/config.yaml
SECRET=$(sed -n 's/^secret: *"\{0,1\}\([^"#]*\)"\{0,1\} *#*.*$/\1/p' "$CONFIG" | head -1 | xargs)
API=http://127.0.0.1:9090
OUT=ops/relink/t1-probe-conns.log   # 探针实验时才建，本次不建

poll() {   # 12 次 × 1s
  for i in $(seq 1 12); do
    echo "=== t=$i $(date +%H:%M:%S.%3N) ==="
    curl -sS -H "Authorization: Bearer $SECRET" $API/connections | python3 -c '
import json,sys
d=json.load(sys.stdin)
for c in d.get("connections") or []:
    m=c["metadata"]; h=(m.get("host") or "")
    if any(k in h for k in ("googleapis","cloudcode","antigravity","gstatic","google.com")):
        print(" host=%-52s chains=%s rule=%s/%s dst=%s" % (
            h, c.get("chains"), c.get("rule"), c.get("rulePayload"), m.get("destinationIP")))
'
    sleep 1
  done
}

# —— 只给不执行 ——
# ( poll > "$OUT" ) &   POLL=$!
# agy -p "hi" --output-format json
# wait $POLL
# 关键判据：chains[0] 是否等于你 PUT 上去的那个节点名
```

**降级方案（抓不到时）**：
1. gRPC 流可能很短，12s 轮询漏采 → 降到 **0.5s × 30** 轮询。
2. 仍为空 → 用"规则 + 组 now"推断并**显式标 `INFERRED`**：`idx24 Google_域 → Google`，读 `Google.now` 即当时出口节点；`generativelanguage` 则读 `其它地区.now`。
3. 交叉验证可用 §9 方法 B 量 IP，与"节点名宣称的国家"对照。

---

## 11. 风险清单

1. **`store-selected: true`（config L105）** → 所有 PUT 会写进 `cache.db` 持久化。脚本中途被杀，`Google` 会**一直**停在测试节点，**重启 Clash 也不会恢复**。必须 `restore` + `verify`，禁止"设了就跑"。
2. **`Google` 组是全机共享**：插件、`agy`、浏览器、oauth 全在同一组。切它会让**别的会话的 live 连接**在下一次建连时换区（既有长连接不会立刻断，但新连接会走新节点）——做对照实验前需知会并接受。
3. **`日本节点` 含尼日利亚节点**（filter 正则 `[^-]日` 误伤"尼日利亚"）→ 不能把"选日本组"当作"出口在日本"。
4. **`香港节点` 含 `type: direct` 成员（直连）** → 选它会直接暴露本机真实 IP。
5. **地区组是 URLTest**，`now` 会自己漂（本次 `美国节点` 从 `V1|06` 漂到 `V1|02`）→ 不能把"地区组当前节点"当稳定量。
6. **59 节点共用一个入口 `g2.devoodev.com`（US 144.225.78.50）** → 节点名不代表出口，必须实测。
7. **`generativelanguage.googleapis.com` 走 `其它地区`**，与 cloudcode 不同组 → 只切 `Google` 可能漏掉这条线。
8. **无 `listeners:`** → 没有零副作用的"单节点测量端口"，方法 B 的 ~5s 回退流量副作用无法完全消除。
9. **不要切 `mode=global`** → 会掐断本机 Tailscale/SSH/其它会话。

---

## 12. 未证实项

- `daily-cloudcode-pa.googleapis.com` / `daily-cloudcode-pa.sandbox.googleapis.com` / `antigravity.googleapis.com` / `accounts.google.com` / `www.googleapis.com` / `play.googleapis.com` / `*.google.com` / `*.gstatic.com` 的**实际**规则命中（均未抓到 live 连接；按 `googleapis.com`/`google.com`/`gstatic.com` 后缀推断为 `Google_域 → Google`）。
- **每个节点的真实出口 IP/国家**（按指令未发任何 ipinfo 请求）。
- 上一手观测的 `96.126.100.194 (US Linode)` 究竟对应 `美国节点` 的哪个节点、还是直连路径。
- `Google_域.mrs` 的 685 条成员明细（zstd + 二进制 trie，离线不可枚举）。
- `agy` 探针实际命中的 host 清单（日志不留域名，需按 §10 的 `/connections` 轮询实证）。

---

## 13. 交付物与脱敏自检

| 文件 | 内容 |
|---|---|
| `ops/relink/t1-clash-recon.json` | 结构化：运行实例/端口/secret_ref（不含明文）/groups+chain/rule_lines/域判定/connections 实证/节点候选/switch_plan/ipinfo_method/risks/unverified |
| `ops/relink/t1-clash-recon.md` | 本文件 |
| `ops/relink/t1-clash-recon.log` | 全部命令 + 原始输出（secret 脱敏为 `***`） |

> **关于 `t1-clash-proxies.json`**：原始 task 曾要求把裸 `/proxies` 单独落盘为 `ops/relink/t1-clash-proxies.json`，但**硬约束**只允许写 `t1-clash-recon.{json,md,log}` 三个文件。按"硬约束优先"，未额外建第 4 个文件，改为把 `/proxies` 的**关键摘要**（目标组 now/all、计数、节点清单）内嵌进 `t1-clash-recon.json` 的 `groups` / `proxies_summary` 字段。如需裸 `/proxies` 全量快照，请明确放开该文件。

脱敏自检（API secret 与入站代理密码明文**均未出现**；OAuth 令牌三族前缀的扫描计数均为 **0**）：

> 说明：那三个待扫描的前缀/正则在**本文件内故意不写出完整形式**，否则自检文本本身会被自己匹配到（会变成 1 而不是 0）。请从 runbook / 父 agent 侧执行该扫描。

```
计数结果（本次实测）：
ops/relink/t1-clash-recon.json : 0
ops/relink/t1-clash-recon.md   : 0
ops/relink/t1-clash-recon.log  : 0
```
