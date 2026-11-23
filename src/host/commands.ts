// /ccl command family: status, accounts, quota, login, models, diagnostics
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import type { PluginConfig } from '../common/types.ts'
import type { AuthHelper } from './auth.ts'
import type { ModelCatalog } from './models.ts'
import type { SessionStore } from './sessions.ts'
import type { AccountPoolManager } from './pool.ts'
import { describeAccountAuth, REAUTH_COMMAND, scopeLabel } from './account-health.ts'
import type { PoolAuthFlow } from './pool-auth.ts'
import type { QuotaService } from './quota.ts'
import { saveGeminiAppToken } from './gemini-app.ts'

export interface CommandDeps {
  cfg: () => PluginConfig
  auth: () => AuthHelper | null
  catalog: () => ModelCatalog
  store?: () => SessionStore
  pool?: () => AccountPoolManager
  poolAuth?: () => PoolAuthFlow
  quota?: () => QuotaService
  lastRun: () => { ok: boolean; code: string; durationMs: number; model: string } | null
  setOverride: (key: string, value: unknown) => void
  runDoctor: () => Promise<string>
}

const HELP = [
  '**/ccl** — CloudCode Link bridge',
  '- `/ccl status` — direct connection, auth, catalog, accounts',
  '- `/ccl pool` / `/ccl accounts` — account pool, live quota %, cooldowns',
  '- `/ccl add-account [alias]` — start OAuth login for a new account slot',
  '- `/ccl refresh-quota` — query Google backend for fresh quota %',
  '- `/ccl clear-cooldown` — reset cooldown timers across all accounts',
  '- `/ccl remove-account <id>` — delete an account slot',
  '- `/ccl auth` — Google login for the primary account (opens the browser)',
  '- `/ccl auth-code <code>` — finish login by pasting the code (fallback)',
  '- `/ccl models` — refresh and list discovered models',
  '- `/ccl effort <low|medium|high|default>` — default reasoning effort',
  '- `/ccl gemini-token <token>` — configure Google OAuth bearer token for Gemini App (Robin)',
  '- `/ccl gemini-offload <on|off>` — toggle offloading tool-free tasks to Gemini App',
  '- `/ccl doctor` — write a diagnostic report and return its path',
  '- `/ccl help` — this text',
].join('\n')

export function cclCommandDefinition(deps: CommandDeps, name = 'ccl'): CommandDefinition {
  return {
    name,
    description: 'CloudCode Link bridge: status, login, models, diagnostics',
    handler: (invocation) => handle(deps, invocation.rawInput),
  }
}

/** Legacy alias for backward compatibility */
export const agyCommandDefinition = cclCommandDefinition

async function handle(deps: CommandDeps, raw: string): Promise<CommandResult> {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  const sub = parts[0] ?? 'help'
  const arg = parts[1] ?? ''
  try {
    if (sub === 'status') return ok(await renderStatus(deps))
    if (sub === 'pool' || sub === 'accounts') {
      const rendered = renderAccountPool(deps)
      return ok(rendered ?? 'Account pool not enabled.')
    }
    if (sub === 'add-account') {
      const flow = deps.poolAuth?.()
      if (!flow) return err('Auth flow not available')
      const st = await flow.begin(arg || undefined)
      if (st.ok && st.url) {
        return ok([
          `**Account slot created: [${st.alias}]** (id: \`${st.stagingId}\`)`,
          st.browserOpened
            ? '**浏览器已打开 Google 授权页** — 批准访问后自动完成登录。'
            : '**请手动打开下面的 URL 完成 Google 授权：**',
          '',
          st.url,
          '',
          `备用：授权完成后运行 \`/ccl auth-code <授权码或完整回调URL>\`。`,
        ].join('\n'))
      }
      return err(st.message ?? 'failed to create account slot')
    }
    if (sub === 'refresh-quota') {
      const quota = deps.quota?.()
      if (!quota) return err('Quota service not available')
      await quota.refreshAllQuotas()
      return ok('Refreshed quota statistics for all accounts in pool.')
    }
    if (sub === 'clear-cooldown') {
      const pool = deps.pool?.()
      if (!pool) return err('Account pool not available')
      pool.clearCooldown(arg || undefined)
      return ok('Cleared cooldown timers.')
    }
    if (sub === 'remove-account') {
      if (!arg) return err('usage: /ccl remove-account <id>')
      const pool = deps.pool?.()
      if (!pool) return err('Account pool not available')
      const success = pool.deleteAccount(arg)
      return success ? ok(`Removed account ${arg}`) : err(`Account ${arg} not found`)
    }

    if (sub === 'auth') {
      const flow = deps.poolAuth?.()
      if (!flow) return err('auth flow not available')
      const st = await flow.beginPrimary()
      if (st.ok && st.url) {
        return ok([
          st.browserOpened
            ? '**浏览器已打开 Google 授权页** — 批准访问后自动完成登录。'
            : '**请手动打开下面的 URL 完成 Google 授权：**',
          '',
          st.url,
          '',
          '备用：授权完成后运行 `/ccl auth-code <授权码或完整回调URL>`。',
        ].join('\n'))
      }
      return err(st.message ?? 'failed to start the login flow')
    }
    if (sub === 'auth-code') {
      if (arg === '') return err('usage: /ccl auth-code <code-or-callback-url>')
      const flow = deps.poolAuth?.()
      if (!flow) return err('auth flow not available')
      const st = await flow.submitCode(arg)
      if (st.ok) {
        deps.store?.()?.clear()
        return ok(st.message ?? 'Logged in to CloudCode Link.')
      }
      return err(st.message ?? 'login failed')
    }
    if (sub === 'models') {
      const cat = await deps.catalog().forceRefresh()
      const lines = [
        '**CloudCode Link models** — source: ' + cat.source + (cat.lastError === undefined ? '' : ' — ' + cat.lastError) + ':',
      ]
      for (const m of cat.models) {
        lines.push('- `' + m.id + '` — ' + m.name + (m.efforts ? ' — efforts: ' + m.efforts.join(' / ') : ''))
      }
      return ok(lines.join('\n'))
    }
    if (sub === 'effort') {
      if (!['low', 'medium', 'high', 'default'].includes(arg)) {
        return err('usage: /ccl effort <low|medium|high|default>')
      }
      deps.setOverride('defaultEffort', arg === 'default' ? '' : arg)
      return ok('Default effort set to **' + (arg === 'default' ? 'model default' : arg) + '**.')
    }
    if (sub === 'doctor') {
      const path = await deps.runDoctor()
      return ok('Diagnostic report written to `' + path + '` — attach it when opening an issue.')
    }
    if (sub === 'gemini-token') {
      if (!arg) return err('usage: /ccl gemini-token <token>')
      saveGeminiAppToken(arg)
      deps.setOverride('geminiAppToken', arg)
      deps.setOverride('geminiAppEnabled', true)
      return ok('Gemini App token saved and enabled. Provider route `gemini-app` is now active.')
    }
    if (sub === 'gemini-offload') {
      const v = arg.trim().toLowerCase()
      if (v === 'on' || v === 'true' || v === '1') {
        deps.setOverride('geminiAppOffloadEnabled', true)
        return ok('Gemini App offload enabled (`geminiAppOffloadEnabled = true`). Tool-free tasks within context limits will route to Gemini App.')
      }
      if (v === 'off' || v === 'false' || v === '0') {
        deps.setOverride('geminiAppOffloadEnabled', false)
        return ok('Gemini App offload disabled (`geminiAppOffloadEnabled = false`).')
      }
      return err('usage: /ccl gemini-offload <on|off>')
    }
    return ok(HELP)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

/**
 * The `/ccl accounts` (`/ccl pool`) listing. Exported as its own renderer so the account
 * rows — including the re-auth verdict each row carries — can be asserted directly; the
 * command handler above is a one-line dispatch into it.
 */
export function renderAccountPool(deps: CommandDeps): string | null {
  const pool = deps.pool?.()
  if (!pool) return null
  const accounts = pool.getAccounts()
  const data = pool.getPoolData()
  const lines = [
    `**CloudCode Link Account Pool (${accounts.length} accounts, mode: ${data.mode})**`,
  ]
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]
    if (!a) continue
    const isPrimary = a.id === data.primaryAccountId
    const qG = a.quotas.google?.remainingFraction !== undefined ? `${Math.round(a.quotas.google.remainingFraction * 100)}%` : 'unknown'
    const qC = a.quotas.anthropic?.remainingFraction !== undefined ? `${Math.round(a.quotas.anthropic.remainingFraction * 100)}%` : 'unknown'
    const qO = a.quotas.openai?.remainingFraction !== undefined ? `${Math.round(a.quotas.openai.remainingFraction * 100)}%` : 'unknown'
    const cds: string[] = []
    for (const [fam, cd] of Object.entries(a.cooldowns)) {
      if (cd && cd.cooldownUntil > Date.now()) {
        const sec = Math.ceil((cd.cooldownUntil - Date.now()) / 1000)
        cds.push(`${fam} cooldown: ${sec}s left (${cd.reason})`)
      }
    }
    const row: string[] = [
      `${i + 1}. **${a.alias}** (${a.email || a.id})${isPrimary ? ' ⭐ primary' : ''}`,
      `   - Proxy: ${a.proxyUrl || 'system default'}`,
      `   - Quota: Gemini ${qG} | Claude ${qC} | GPT-OSS ${qO}`,
      cds.length > 0 ? `   - ⚠️ ${cds.join('; ')}` : '   - Status: 🟢 Ready',
    ]
    // Read-only verdict from the account's recorded grant: the account stays listed and
    // usable, the row only says the grant is too narrow and how to widen it.
    const authHealth = describeAccountAuth(a)
    if (authHealth.reauthRequired) {
      row.push(
        `   - 🔁 该账号授权缺少 ${authHealth.missingScopes.map(scopeLabel).join(', ')}，` +
          `请对该账号重新 \`${REAUTH_COMMAND}\`（账号仍在池中，可继续用于已授予的能力）`,
      )
    }
    lines.push(...row)
  }
  return lines.join('\n')
}

export async function renderStatus(deps: CommandDeps): Promise<string> {
  const cfg = deps.cfg()
  const authHelper = deps.auth()
  const auth = authHelper ? await authHelper.resolvedStatus() : undefined
  const cat = deps.catalog().get()
  const pool = deps.pool?.()
  const accounts = pool ? pool.getAccounts() : []
  const reauthNeeded = accounts.filter((a) => describeAccountAuth(a).reauthRequired).length
  const last = deps.lastRun()
  const lines = [
    '**dsh-agy-link status (Direct CloudCode)**',
    '- transport: direct Google CloudCode API',
    '- auth: ' + (auth ? auth.phase + (auth.message ? ' — ' + auth.message : '') : 'unknown'),
    '- default model: ' + (cfg.defaultModel !== '' ? cfg.defaultModel : '(none - use /model picker)'),
    '- default effort: ' + (cfg.defaultEffort !== '' ? cfg.defaultEffort : 'model default'),
    '- catalog: ' + cat.source + ' (' + cat.models.length + ' models)',
    '- pool accounts: ' + accounts.length + ' accounts configured',
    ...(cfg.geminiAppEnabled || cfg.geminiAppOffloadEnabled || cfg.geminiAppAskToolEnabled
      ? [
          `- gemini-app: ${cfg.geminiAppEnabled ? 'enabled' : 'disabled'} (endpoint: ${cfg.geminiAppEndpoint}, token: ${cfg.geminiAppToken ? 'configured' : 'not configured'}, offload: ${cfg.geminiAppOffloadEnabled ? 'on' : 'off'}, ask-tool: ${cfg.geminiAppAskToolEnabled ? 'on' : 'off'})`,
        ]
      : []),
    ...(reauthNeeded > 0
      ? [
          `- 需要重新授权: ${reauthNeeded} 个账号的 Google 授权 scope 不足，请对这些账号执行 \`${REAUTH_COMMAND}\``,
        ]
      : []),
    '- last call: ' + (last ? (last.ok ? 'OK' : 'FAIL: ' + last.code) + ' (' + last.durationMs + 'ms, ' + last.model + ')' : '(none yet)'),
  ]
  return lines.join('\n')
}

function ok(text: string): CommandResult {
  return { kind: 'success', text }
}

function err(text: string): CommandResult {
  return { kind: 'error', text }
}
