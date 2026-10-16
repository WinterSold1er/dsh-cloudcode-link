# release-ready（T7 交付）：新 dist sha256、子模块 commit id、验收命令与退出码

- task: task-7（owner worker-repo），write_scopes = test/**、packages/**
- 时间：2026-10-16T07:34Z（UTC） / node v26.9.0 / pnpm 11.7.0
- 状态：**发布物已就绪，root 仓库未提交**（按任务要求交 T8 统一提交推送）

## 1. 子模块（packages/core）commit id

| 项 | 值 |
|----|----|
| commit | **e52abe7786a3ee503759be51986180b339d422d1** |
| 短 id | e52abe7 |
| 标题 | `fix(oauth): injectable callback port so tests stop contending for 51121` |
| author | WinterSold1er <166986667+WinterSold1er@users.noreply.github.com>（子模块本地 git config，符合 GitHub 账号铁律） |
| 变更 | `src/oauth.ts +22/-8`、`src/pool-auth.ts +11/-3`、`test/pool-auth.test.ts +52/-10`（含 T6+T7 全部 core 侧改动） |
| 提交后 | `git -C packages/core status --porcelain` 为空；`git submodule status` → `+e52abe7786a3ee503759be51986180b339d422d1 packages/core (heads/main)` |
| 是否 push | **否**（T8 负责 push） |

## 2. 构建产物 sha256（T7 重新构建，3 次一致）

| 文件 | sha256 | 相对 dc0ca77 |
|------|--------|--------------|
| `dist/index.js` | **6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4** | 已变（73e0efbf… → 6b8e1fad…，因 core src 内联） |
| `dist/client.js` | 3991a5a36b0141609605bc010fd6d5481ee737303cff40077d9d43eec2c48717 | 不变 |
| `dist/index.d.ts` | 3579872b011a1d6313c09962611538263fe8f81ea0dc8942f6a1b9912652614e | 不变 |
| `packages/core/dist/index.js`（未跟踪） | 385bede1c2ffaddfcf25babd015e09d78c8416e98c7076bcc669628d75e0ccf1 | 已重建 |
| `packages/core/dist/index.d.ts`（未跟踪） | 8199ff6af55d5cbd0c3cf8dc6c64c0fa3372e94ad22689d143b86ab35cc22f78 | 已重建 |

`git status --short dist` → 仅 ` M dist/index.js`（无多余文件）。

## 3. 验收命令与退出码（原始输出见 ops/quality/t7-*.log、汇总 t7-acceptance.log）

| # | 命令（cwd） | 退出码 | 结果 |
|---|-------------|--------|------|
| A | `pnpm test`（root，单跑） | 0 | `tests 255 / pass 255 / fail 0 / skipped 0 / todo 0` |
| B | `pnpm test` ×2（root，并发） | 0 / 0 | A `255/255`、B `255/255` |
| C | `pnpm test`（root）与 `pnpm test`（packages/core）并发 | 0 / 0 | root `255/255`、core `212/212` |
| D | 外部进程 `listen(51121)` 时 C 同款并发 | 0 / 0 | holder pid=573192；root `255/255`、core `212/212` |
| E | `pnpm check`（root / packages/core） | 0 / 0 | 均 `tsc --noEmit` 无诊断 |
| F | `pnpm build` ×3（root） | 0/0/0 | `dist/index.js` 三次 sha256 全等 `6b8e1fad…50a4` |
| G | `pnpm test` ×2（root+core，子模块提交后回归） | 0 / 0 | root `255/255`、core `212/212` |

## 4. T8 待办的前置状态（root 工作区，勿丢）

```
$ git status --porcelain --untracked-files=no
 M dist/index.js                      # 由 T6/T7 core 源码修复内联导致，已重建
 M packages/core                      # 子模块指针 1c0931a7… → e52abe77…
 M test/pool-auth.test.ts             # F1 修复（动态空闲端口 + 显式离线判定）
```

一并变更（未跟踪，随 T8 判断是否入库）：docs/review/**、ops/**。

## 5. 已知边界（不影响发布，供 T8/T5 判读）

1. 该修复对**运行时行为零改变**：`OAUTH_CALLBACK_PORT` 仍是 51121，`startCallbackListener()`、`buildAuthorizeUrl()`、`exchangeCode()` 不传参时行为与 dc0ca77 完全一致；新增的 `oauthRedirectUri()` 与可选入参只被测试使用。
2. profile 安装副本仍是 dc0ca77 ⇒ T8 必须 commit+push+`pnpm update dsh-cloudcode-link` 后，安装副本哈希才会等于上表 `6b8e1fad…`。
3. 离线实测结论（见 flake-report 第 9 节）：当前实现下离线走的是正常断言路径（flow 把传输错误转成 `phase='failed'`），新增的显式 skip 仅用于“异常真的逃逸”这一潜在漏洞，不会再出现零断言记 pass。
