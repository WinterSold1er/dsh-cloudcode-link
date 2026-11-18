# 限流 → 图标变黄 / 账号卡片黄色主题：完整机制与证据

**分析对象**：`dsh-cloudcode-link`（root `HEAD 9203a4a` + 未提交改动）与其 submodule `packages/core`（= `cloudcode-link-core`，`HEAD 5401f32`）。
**行号核实时间**：2026-11-18 18:12–18:25（Asia/Shanghai），全部以**插件仓库工作树**为准。
**行号警告**：分析期间 `src/index.ts` 正被其他成员编辑（`git status` 显示 `M src/index.ts`，未提交 +35 行），该文件行号可能再漂移；`src/host/adapter.ts`、`packages/core/src/{pool.ts,quota.ts,types/pool-types.ts,types/config-types.ts}` 本次未改动，行号即 HEAD 行号。

**客户端行号时效性（后补）**：本轮随后重写了 `src/client/index.ts`，因此文中所有 `src/client/index.ts:<行号>` 引用是**重构前 HEAD 9203a4a 的快照行号**，直接按号跳转会错位；机制结论与 CSS 变量语义不变，新实现位置见 `docs/design/ui-redesign.md`（工具栏徽章入口已按要求移除，现仅设置页有入口）。

---

## 0. 一句话结论（可直接转述）

> **触发信息来自云端，"变黄"是本地判断。** Google Cloud Code 只回了一个 HTTP `429`（外加可选的 `retry-after` 头和一段 `RESOURCE_EXHAUSTED` JSON 文本）；插件把它换算成一个**本地 epoch 毫秒时间戳 `cooldownUntil`** 存进 `~/.dsh/agy-accounts/pool.json`，UI 每 3 秒拉 `/status` 后自己用 `cooldownUntil > Date.now()` 重算颜色。云端**从未**下发过任何颜色、主题或状态字段。

---

## 1. 证据表

| # | 结论 | 证据（file:line） | 关键代码 |
|---|---|---|---|
| E1 | 429 来自 `v1internal:streamGenerateContent` 的 HTTP 响应 | `packages/core/src/client.ts:1098` | `agyFetch(\`${endpoint}/v1internal:streamGenerateContent?alt=sse\`, …)` |
| E2 | 限流判定 = HTTP 状态码，不是文本正则 | `src/host/adapter.ts:833` | `if (res.status === 429) {` |
| E3 | 上游 reset 只取 **一个响应头** `retry-after` | `src/host/adapter.ts:834` | `const resetHeader = res.headers.get('retry-after') \|\| undefined` |
| E4 | 上游 body 原文被当作 `reason` 存盘 | `src/host/adapter.ts:830,836` | `const errText = await res.text()…`；`pool.recordFailure(account.id, family, errText \|\| 'Rate limit 429', resetHeader)` |
| E5 | 失败被归成 `cause:'rate_limit'` | `src/host/adapter.ts:63,838-843` | `failures.push({ cause: 'rate_limit', httpStatus: 429, upstreamError: errText … })` |
| E6 | 本地计算 `cooldownUntil`（三分支） | `packages/core/src/pool.ts:707-736` | 见 §2 |
| E7 | 落盘字段 = `accounts[].cooldowns[family]` | `packages/core/src/types/pool-types.ts:39-46,74`；`pool.ts:730-734` | `{ cooldownUntil, reason, consecutiveFailures }` |
| E8 | 落盘文件 = `<DSH_HOME>/agy-accounts/pool.json` | `pool.ts:184`；`src/index.ts:117-120`；`src/common/config.ts:12-14` | `join(baseDir,'pool.json')`；`join(dshHome(),'agy-accounts')` |
| E9 | 默认 15min / 上限 60min，按失败次数线性放大 | `pool-types.ts:125-126,139-140`；`pool.ts:712,722,727` | `Math.min(defaultCooldownMs * failures, maxCooldownMs)` |
| E10 | 到期不删除，只是判定失败（无 prune） | `pool.ts:842,946,1015`；`src/client/index.ts:1137,1244,2022` | 全部写成 `cd.cooldownUntil > now` 比较 |
| E11 | 成功请求清冷却 | `pool.ts:791-802`（调用点 `src/host/adapter.ts:1061`） | `delete acc.cooldowns[family]`，顺带清 `authRequired` |
| E12 | 手动清冷却：UI → 路由 → pool | `src/client/index.ts:1092-1098,1381-1387` → `src/index.ts:564-576` → `pool.ts:805-818` | `acc.cooldowns = {}`（该账号所有 family） |
| E13 | `/status` 只回原始池数据，无颜色字段 | `src/index.ts:365-391`（`pool: pool.getPoolData()` @380）；`pool.ts:327-329` | `getPoolData() { return this.data }` |
| E14 | UI 侧 payload 类型里没有任何 color/theme | `src/client/index.ts:49-80` | `StatusPayload{ … pool?: AccountPoolData }` |
| E15 | 工具栏点颜色完全本地派生 | `src/client/index.ts:2020-2024`；圆点 `2048` | `… status.dormantReason ? '#f59e0b' : hasCooldown ? '#f59e0b' : isAuthed ? '#10b981' : '#f59e0b'` |
| E16 | 卡片黄点 + 黄横幅本地派生 | `src/client/index.ts:1244,1246`；横幅 `1362-1387` | `hasCooldown = Object.entries(acc.cooldowns).some(… cooldownUntil > Date.now())` |
| E17 | 源码自带结论注释：冷却是本地启发式 | `src/client/index.ts:1142-1144` | `// Cooldown is a LOCAL heuristic — never overwrite the server-reported fraction with 0%` |
| E18 | UI 每 3s 重新拉取并重算颜色 | `src/client/index.ts:2000-2013` | `const timer = setInterval(tick, 3000)` |
| E19 | 配额类字段确实来自云端 | `packages/core/src/quota.ts:1085-1101,1116-1127`；`quota.ts:102,124` | `group.buckets[].remainingFraction/resetTime`、`models[].quotaInfo.*`（`v1internal:fetchAvailableModels` / `retrieveUserQuotaSummary`） |
| E20 | 请求级最终错误 = `RATE_LIMIT` + 倒计时 | `src/host/adapter.ts:128-141,173-185`；输出 `578-581`/`924-927` | `code:'RATE_LIMIT', status:429, message: 'Antigravity quota exhausted … Resets in 12m 3s.'` |
| E21 | 倒计时来源 = 本地 cooldown 与云端 resetTime 混合取最早 | `pool.ts:939-973`；`1013-1017`；格式化 `src/common/types.ts:246-258` | `Math.min(…)` over `cooldownUntil` / `Date.parse(quota.resetTime)` / `weeklyResetTime` |
| E22 | `dormantReason` 恒为 `null`（该黄分支是死代码） | `src/index.ts:114`（声明）、`:373`（输出）；`dist/index.js` 中只有 `dormantReason = null;` | 全仓无第二处赋值 |
| E23 | 插件不走 core 的 `LlmAdapter`，走 `AgyAdapter` | `src/index.ts:12`（import）、`:227`（`new AgyAdapter`）；`packages/core/src/adapter.ts:366-369` 无任何调用点 | `grep -rn "core/adapter" src/` 为空 |
| E24 | `src/common/types.ts` 的 `Err/looksLike*/parseResetDurationMs` 是重复副本，未参与冷却计算 | `src/common/types.ts:176-245`（`parseResetDurationMs` @206 无调用点）；`pool.ts:16` 只 import `./types/config-types.ts` | 实际生效副本 = `packages/core/src/types/config-types.ts:172` |
| E25 | 429 文本分类器只被测试引用 | `config-types.ts:158-170`；`packages/core/test/rate-limit-classify.test.ts:3,30-32` | 生产链路无调用（grep 排除 test 后只剩定义） |

---

## 2. 429 → cooldown 的完整链路（谁分类、谁换算）

```
Google PA  429 响应
   │  HTTP status: 429            ← 云端事实
   │  header: retry-after?        ← 云端事实（可有可无）
   │  body: {"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}   ← 云端事实
   ▼
src/host/adapter.ts:833   if (res.status === 429)                # 分类：纯状态码
src/host/adapter.ts:834   resetHeader = res.headers.get('retry-after')
src/host/adapter.ts:836   pool.recordFailure(id, family, errText || 'Rate limit 429', resetHeader)
   ▼
packages/core/src/pool.ts:707-736   recordFailure()             # 换算：纯本地时间运算
   :715   parsedDuration = parseResetDurationMs(serverResetTime || reason)
   :717-721  serverResetTime 有值但解析失败 → Date.parse(serverResetTime) + 10_000
   :724-725  解析成功         → Date.now() + parsedDuration + 10_000
   :726-727  两者都不可用      → Date.now() + min(15min × consecutiveFailures, 60min)
   :730-734  acc.cooldowns[family] = { cooldownUntil, reason, consecutiveFailures }
   :735      this.persist()   →  pool.json（tmp+rename, mode 0o600, pool.ts:243-255）
   ▼
src/host/adapter.ts:838-843  failures.push({ cause:'rate_limit', httpStatus:429 })
src/host/adapter.ts:844-846  还有预算就换下一个账号（日志 "Rate limited (429) … switching accounts"）
   ▼
src/host/adapter.ts:142 classifyPoolFailure()  →  code 'RATE_LIMIT' / status 429 / 带 "Resets in …"
```

**`parseResetDurationMs` 支持的四种格式**（`config-types.ts:172-210`）：

1. 紧凑式 `Resets in 2h26m6s` / `resets in 21m25s` / `resets in 45s` → `:176-183`
2. 词式 `Resets in 15 minutes` / `retry after 30 seconds`（hour/hr/minute/min/second/sec）→ `:186-193`
3. ISO 时间戳 `2026-11-18T13:52:52Z`（带 `Z` 或 `±hh:mm`，且必须在未来）→ `:196-202`
4. 纯数字秒（`parseInt` 成功且 `< 7 天`）→ `:204-207`（`retry-after: 3600` 走这条）

**一个容易踩的细节**：`:715` 是 `parseResetDurationMs(serverResetTime || reason)` —— 只要 `retry-after` 头存在，就**只**解析头部；即使解析失败也只会退到 `Date.parse(serverResetTime)+10s`（`:717-721`），**不会**回头去解析 body 里的 "Resets in …" 文本。body 文本只有在头部缺失时（`serverResetTime` 为 `undefined`）才参与解析。

**未被使用的分类器**：`looksLikeHardRateLimit`（`config-types.ts:158-163`，正则含 `RESOURCE_EXHAUSTED|code 429|too many requests|quota exhausted|…`）与 `looksLikeRateLimit`（`:165-170`，软容量信号如 "model overloaded"）目前只有测试引用（E25）——线上判定靠 E2 的状态码。

---

## 3. 存储、默认值、递进与清除

| 项目 | 值 / 位置 |
|---|---|
| 存储文件 | `~/.dsh/agy-accounts/pool.json`（`pool.ts:184` + `src/index.ts:117-120`；可用 `CLOUDCODE_ACCOUNTS_DIR` / `ANTIGRAVITY_ACCOUNTS_DIR` 覆盖） |
| 存储字段 | `accounts[].cooldowns[family] = { cooldownUntil, reason, consecutiveFailures }`（`pool-types.ts:39-46`）；同一对象还持久化 `quotas[family]`（`:76`） |
| 写入点 | 唯一：`pool.ts:730-734`（`recordFailure`） |
| 默认冷却 | `defaultCooldownMs = 15 * 60 * 1000`（`pool-types.ts:139`） |
| 上限 | `maxCooldownMs = 60 * 60 * 1000`（`pool-types.ts:140`） |
| 递进 | `consecutiveFailures = 上次 + 1`（`pool.ts:712`），无云端 hint 时 `min(15min × failures, 60min)`（`pool.ts:722,727`）——**线性**而非指数 |
| 到期 | 不删除、不清零：只有 `cooldownUntil > now` 判定失败（`pool.ts:842,946,1015`；UI `1137,1244,2022`）。过期条目永久留在 pool.json |
| 成功请求 | `recordSuccess`（`pool.ts:791-802`，调用点 `src/host/adapter.ts:1061`）删除该 family 的冷却，并清 `authRequired/authError`，同时写 `lastUsedAt`（`:794`） |
| 手动 | `clearCooldown(id?, family?)`（`pool.ts:805-818`）：给 `id` 不给 `family` → `acc.cooldowns = {}`（该账号全部 family 全清）；都不给 → 全账号全清 |
| 手动入口 | 卡片「清除冷却」按钮（UI `1381-1387` → `1092-1098` `POST pool/clear-cooldown {id}` → 路由 `src/index.ts:564-576`）；`/ccl clear-cooldown [id]`（`src/host/commands.ts:86-91`）。UI **不传** `family`，所以按账号整体清 |
| 不影响黄色 | `modelQuarantine`（`pool.ts:175`，`recordModelUnsupported` `:748-779`，`clearModelQuarantine` `:782-789`）是内存 Map，不落 `pool.json`、不进 `cooldowns` |

**现场样本（实测 `~/.dsh/agy-accounts/pool.json`，mtime 2026-11-18 18:15）**

```
acc_1788949635573_50yxc  cooldowns.google = {
  cooldownUntil: 1794993176805        # = 2026-11-18 17:12:56 CST（本地 epoch ms）
  reason: "{\n  \"error\": {\n    \"code\": 429,\n    \"message\": \"Resource has been exhausted (e.g. check quota).\",\n    \"status\": \"RESOURCE_EXHAUSTED\"\n  }\n}\n"   # = 云端 body 原文
  consecutiveFailures: 1
}
```

- `reason` 里没有任何 "Resets in …" 文本，`cooldownUntil − 该账号 lastUsedAt(16:56:40) = 16m16s`，与 `pool.ts:727` 的 `now + 15min` 默认分支一致（差值 ≈ 请求往返耗时）。**推断**：Google 当时没有给出可用的 `retry-after`，所以走本地默认 15 分钟。（这是时间戳推断，不是抓包观测。）
- 另一条 `acc_1788785623927_xhs7n cooldowns.anthropic` 的 `cooldownUntil = 2026-09-09 18:06:21`，已过期约 70 天仍留在文件里 → 直接证明"到期不清理，只在读取时判定"。

---

## 4. 黄色到底由谁决定

**云端给的东西只有这些**：HTTP `429`、`retry-after` 头、body 的 `error` JSON、以及配额接口（`v1internal:fetchAvailableModels` / `v1internal:retrieveUserQuotaSummary`，`quota.ts:102,124`）返回的 `remainingFraction` / `resetTime` / `weeklyFraction` / `weeklyResetTime`（`quota.ts:1085-1101,1116-1127` → `pool-types.ts:19-36`）。

**没有任何** 颜色、主题、severity、level、icon 字段：
- 服务端 payload：`src/index.ts:365-391` 的字段全集为 `plugin, transport, dormantReason, enabled, defaultModel, defaultEffort, askTool, auth, poolAuth, pool, catalog, lastRun, distSha256`；其中 `pool` 就是 `pool.json` 原样对象（`getPoolData()` 直接 `return this.data`，`pool.ts:327-329`）。
- 客户端类型：`StatusPayload`（`src/client/index.ts:49-80`）里同样只有 `dormantReason` / `auth.phase` / `pool?: AccountPoolData` / `lastRun` 等，**无 color/theme**。

**颜色在浏览器里现算**（每 3 秒一次，`src/client/index.ts:2000-2013`）：

```
2022  const hasCooldown = accounts.some(a => Object.entries(a.cooldowns).some(([,cd]) => cd && cd.cooldownUntil > Date.now()));
2023  const isAuthed   = status?.auth?.phase === 'ok' || accounts.length > 0;
2024  const color = status === null ? '#64748b'
                    : status.dormantReason ? '#f59e0b'
                    : hasCooldown          ? '#f59e0b'
                    : isAuthed             ? '#10b981'
                    :                        '#f59e0b';
2048  h('span', { style: { width:'7px', height:'7px', borderRadius:'50%', background: color } })
```

判定用的是**浏览器自己的 `Date.now()`**，不是服务端算好的布尔值。源码里还留着一句结论性注释（E17，`src/client/index.ts:1142-1144`）：

> `// Cooldown is a LOCAL heuristic — never overwrite the server-reported fraction with 0% (a ghost cooldown used to show a 98%-full account as empty). Surface it as a note next to the reset time instead.`
> 并且 UI 文案自己就写着 `· 本地冷却中`（`src/client/index.ts:1145`）。

结论：云端提供**证据**（429 / 配额数字 / resetTime 字符串），本地负责**解释与着色**。

---

## 5. 除 cooldown 外，还有什么会让工具栏点变黄

| 触发条件 | 颜色 | 证据 |
|---|---|---|
| `status.dormantReason` 为真 | 黄 | `src/client/index.ts:2024`。但 `dormantReason` 在 `src/index.ts:114` 声明为 `null` 后**再未被赋值**（全仓 grep 仅 `src/index.ts:114,373` 与 UI 类型 `:52`、判定 `:2024`）；构建产物 `dist/index.js` 同样只有 `dormantReason = null;`。→ 当前版本该分支**恒不触发**，没有取值集合，属遗留占位 |
| 任意账号存在未过期 cooldown | 黄 | `src/client/index.ts:2022` |
| `status` 拿到了、但没有 cooldown、又"未授权"（`auth.phase !== 'ok'` 且 `accounts.length === 0`） | 黄（兜底分支） | `src/client/index.ts:2023-2024` 最后一个 `'#f59e0b'` |
| `/status` 拉不到（首次加载 / 请求失败） | 灰 `#64748b` | `src/client/index.ts:2024` 第一个分支 |
| 已授权或有账号 | 绿 `#10b981` | `src/client/index.ts:2023-2024` |

**auth 失败会不会黄？**
- 账号卡片：**不会黄，会红**——`dotColor = !acc.enabled ? '#64748b' : isAuthRequired ? '#ef4444' : hasCooldown ? '#f59e0b' : '#10b981'`（`src/client/index.ts:1246`），`authRequired` 来自 `pool-types.ts:70`。
- 工具栏：**不看 `authRequired`**。只要 `accounts.length > 0` 就判 `isAuthed` 为真 → 五个账号全被标记需要重新登录时，工具栏仍然是**绿**，卡片是**红**。这是一个已知的判定点不对称（`src/client/index.ts:2023`）。

**另外两套黄色与限流无关**，别混淆：
- 配额条：`remainingFraction` 10–30% → 琥珀黄、`<10%` → 珊瑚红（`src/client/index.ts:1170-1187`），阈值本地、数字云端。
- 缓存命中率色条（`src/client/index.ts:1510`、`1780`）。

---

## 6. 账号卡片黄色主题的完整触发条件

```
1244  hasCooldown = Object.entries(acc.cooldowns).some(([, cd]) => cd && cd.cooldownUntil > Date.now())
1246  dotColor    = … hasCooldown ? '#f59e0b' : '#10b981'
1362  hasCooldown ? <div 背景 var(--agy-warn-bg) / 边框 var(--agy-warn-border) / 文字 var(--agy-warn-text)>   # 黄色横幅
1379  文案：'部分模型限流中，已自动切换账号'
1381-1387  <button> '清除冷却' → onClick: clearCooldown(acc.id)
```

- **不是 per-family**：只要**任意一个** family 的冷却未过期，整张卡片（点 + 横幅）就变黄；文案也诚实地写"部分模型"。
- **quota exhausted 本身不会让卡片变黄**：`1244/1246` 只看 `cooldowns`，`quotas.remainingFraction` 只影响额度条颜色（§5），以及选号时被拒（`pool.ts:843-848`）与 family 被抑制（`pool.ts:1013-1017`）。
- **「清除冷却」清了什么**：`1386 → 1094 (POST pool/clear-cooldown, body {id}) → src/index.ts:571-573 → pool.ts:805-818 → acc.cooldowns = {}` 再 `persist()`。即"该账号 **所有 family** 的冷却一次性全清"，无法只清单个 family（路由支持 `body.family`，UI 没有传）。另有 `/ccl clear-cooldown`（`src/host/commands.ts:86-91`）可清全池。清除后 UI 立刻 `refresh()` 并 toast `已清除冷却`（`1095-1097`）。
- 注意：手动清冷却不会恢复被云端判定耗尽的配额——若 `remainingFraction ≤ lowQuotaThreshold` 且云端 `resetTime` 在未来，`selectAccount` 依旧拒绝该账号（`pool.ts:843-848`），此时卡片可能"黄点消失但仍选不上号"。

---

## 7. 请求级别：一次 429 如何被归成 `RATE_LIMIT` 并展示

1. **归因**：`src/host/adapter.ts:833-843` 把该账号这次尝试记为 `cause:'rate_limit'`（`FailoverCause` 定义 `:63`）。
2. **换号继续**：`:844-846` 预算内 failover 到下一个账号。
3. **汇总分类**：`classifyPoolFailure`（`src/host/adapter.ts:142`，设计说明 `:128-141`："Map the observed failures to the one error the user should see"）：
   - `allOf('rate_limit')`，或 `familyStatus.reason === 'rate_limited'`，或 `familyStatus.suppressed && reason === 'quota_exhausted'` → `{ code: 'RATE_LIMIT', status: 429, message: "Antigravity quota exhausted for model family 'x'. Resets in 12m 3s." }`（`:173-185`）。
   - 对照组：全部 `auth` → `AUTH_REQUIRED`（`:147-153`）；entitlement 拒绝 → `MODEL_NOT_AVAILABLE`（`:155-171`，并且明确"回过 429 的账号一定有权用该模型，不能叫用户换模型"，`:160-162`）。
4. **倒计时怎么算**：`familyStatus.resetInMs` ← `getEarliestResetCountdown(family)`（`pool.ts:939-973`）：对每个未禁用/未 authRequired 的账号取
   `max(本地 cooldownUntil, Date.parse(云端 quota.resetTime) 当 remainingFraction ≤ lowQuotaThreshold, Date.parse(云端 weeklyResetTime) 当 weeklyFraction ≤ 0.01)`，
   再在所有账号里取**最早**的那个，返回 `earliest − now`（`pool.ts:972`）。reason 判定见 `pool.ts:1013-1017`（有活跃 cooldown → `rate_limited`，否则 → `quota_exhausted`）。文案格式化：`formatDuration`（`src/common/types.ts:246-258`）。
5. **交付给用户**：`yield { type:'finish', reason:{ kind:'error', failure: verdict } }`（`src/host/adapter.ts:578-581` 无候选账号时；`:924-927` 请求失败后），DSH 直接把 `verdict.message` 作为本次生成的错误文本显示。
6. **`/ccl accounts` 里的倒计时**：`src/host/commands.ts:176-181` `sec = Math.ceil((cd.cooldownUntil - Date.now())/1000)`，输出 `⚠️ google cooldown: 743s left (<云端 429 body 原文>)`，否则该行显示 `🟢 Ready`（`:186`）。

---

## 8. 分析过程中发现的不一致 / 死代码（顺带记录，未改动任何源码）

1. **`dormantReason` 是空壳**：`src/index.ts:114` 声明、`:373` 输出，无任何赋值路径 → 工具栏 `dormantReason` 那条黄分支永不生效（E22）。
2. **`src/common/types.ts:176-245`** 复制了一份 `Err` / `looksLikeAuthFailure` / `looksLikeHardRateLimit` / `looksLikeRateLimit` / `parseResetDurationMs` / `formatDuration`；冷却计算用的是 core 那份（`pool.ts:16` 只 import `./types/config-types.ts`）。`src/common/types.ts:206` 的 `parseResetDurationMs` 无调用点（E24）。
3. **`packages/core/src/adapter.ts:366-369`** 是核心库自带的同名 429→recordFailure 逻辑，插件运行时不走它：插件只用 `AgyAdapter`（`src/index.ts:12` import、`:227` 实例化），`src/` 下没有任何对 core `adapter.ts` 的 import（E23）。读代码时若看错文件会得到与线上不一致的结论。
4. **正则分类器目前未参与判定**（E25）：改文案不会改变冷却，改 HTTP 状态才会。
5. **过期冷却条目不会被回收**：pool.json 里留着 70 天前的过期条目（§3 现场样本），只影响可读性，不影响颜色。
6. **工具栏与卡片的授权判定不对称**（§5）：全员 `authRequired` 时工具栏仍绿。

---

## 9. 本地 vs 云端 —— 明确判定

| 环节 | 归属 | 证据 |
|---|---|---|
| "被限流了"这一事实（HTTP 429、`RESOURCE_EXHAUSTED` body、`retry-after`） | **云端** | E1、E2、E3、E4 |
| 配额百分比与 resetTime 字符串 | **云端** | E19 |
| 冷却时长（`cooldownUntil`）的计算、默认 15min/上限 60min、失败次数递进 | **本地** | E6、E9 |
| 冷却的存储与清除（到期/成功/手动） | **本地** | E7、E8、E10、E11、E12 |
| 图标/卡片颜色、黄色横幅、"清除冷却"按钮是否出现 | **本地** | E15、E16、E14、E17、E18 |
| 用户看到的 `RATE_LIMIT … Resets in …` 文案 | **本地生成**（倒计时混合了本地 cooldown 与云端 resetTime） | E20、E21 |

**最终判定**：变黄的**判据**（时间戳）一半来自云端（429 与可选的 reset 提示、配额 resetTime），一半由本地换算补齐（无可用 hint 时本地 15min×失败次数、上限 60min）；变黄的**着色决定**100% 在本地（UI 比较 `cooldownUntil` 与浏览器 `Date.now()`）。云端不参与任何颜色或主题决策。
