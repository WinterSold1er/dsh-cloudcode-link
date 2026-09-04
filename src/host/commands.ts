// /agy command family: status, accounts, quota, login, models, diagnostics
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import type { PluginConfig } from '../common/types.ts'
import type { AuthHelper } from './auth.ts'
import type { ModelCatalog } from './models.ts'
import type { SessionStore } from './sessions.ts'
import type { AccountPoolManager } from './pool.ts'
import type { PoolAuthFlow } from './pool-auth.ts'
import type { QuotaService } from './quota.ts'

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
  '**/agy** — Antigravity (Google CloudCode direct) bridge',
  '- `/agy status` — direct connection, auth, catalog, accounts',
  '- `/agy pool` / `/agy accounts` — account pool, live quota %, cooldowns',
  '- `/agy add-account [alias]` — start OAuth login for a new account slot',
  '- `/agy refresh-quota` — query Google backend for fresh quota %',
  '- `/agy clear-cooldown` — reset cooldown timers across all accounts',
  '- `/agy remove-account <id>` — delete an account slot',
  '- `/agy auth` — Google login for the primary account (opens the browser)',
  '- `/agy auth-code <code>` — finish login by pasting the code (fallback)',
  '- `/agy models` — refresh and list discovered models',
  '- `/agy effort <low|medium|high|default>` — default reasoning effort',
  '- `/agy doctor` — write a diagnostic report and return its path',
  '- `/agy help` — this text',
].join('\n')

export function agyCommandDefinition(deps: CommandDeps): CommandDefinition {
  return {
    name: 'agy',
    description: 'Antigravity bridge: status, login, models, diagnostics',
    handler: (invocation) => handle(deps, invocation.rawInput),
  }
}

async function handle(deps: CommandDeps, raw: string): Promise<CommandResult> {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  const sub = parts[0] ?? 'help'
  const arg = parts[1] ?? ''
  try {
    if (sub === 'status') return ok(await renderStatus(deps))
    if (sub === 'pool' || sub === 'accounts') {
      const pool = deps.pool?.()
      if (!pool) return ok('Account pool not enabled.')
      const accounts = pool.getAccounts()
      const data = pool.getPoolData()
      const lines = [
        `**Antigravity Account Pool (${accounts.length} accounts, mode: ${data.mode})**`,
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
        lines.push(
          `${i + 1}. **${a.alias}** (${a.email || a.id})${isPrimary ? ' ⭐ primary' : ''}`,
          `   - Proxy: ${a.proxyUrl || 'system default'}`,
          `   - Quota: Gemini ${qG} | Claude ${qC} | GPT-OSS ${qO}`,
          cds.length > 0 ? `   - ⚠️ ${cds.join('; ')}` : '   - Status: 🟢 Ready'
        )
      }
      return ok(lines.join('\n'))
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
          `备用：授权完成后运行 \`/agy auth-code <授权码或完整回调URL>\`。`,
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
      if (!arg) return err('usage: /agy remove-account <id>')
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
          '备用：授权完成后运行 `/agy auth-code <授权码或完整回调URL>`。',
        ].join('\n'))
      }
      return err(st.message ?? 'failed to start the login flow')
    }
    if (sub === 'auth-code') {
      if (arg === '') return err('usage: /agy auth-code <code-or-callback-url>')
      const flow = deps.poolAuth?.()
      if (!flow) return err('auth flow not available')
      const st = await flow.submitCode(arg)
      if (st.ok) {
        deps.store?.()?.clear()
        return ok(st.message ?? 'Logged in to Antigravity.')
      }
      return err(st.message ?? 'login failed')
    }
    if (sub === 'models') {
      const cat = await deps.catalog().forceRefresh()
      const lines = [
        '**Antigravity models** — source: ' + cat.source + (cat.lastError === undefined ? '' : ' — ' + cat.lastError) + ':',
      ]
      for (const m of cat.models) {
        lines.push('- `' + m.id + '` — ' + m.name + (m.efforts ? ' — efforts: ' + m.efforts.join(' / ') : ''))
      }
      return ok(lines.join('\n'))
    }
    if (sub === 'effort') {
      if (!['low', 'medium', 'high', 'default'].includes(arg)) {
        return err('usage: /agy effort <low|medium|high|default>')
      }
      deps.setOverride('defaultEffort', arg === 'default' ? '' : arg)
      return ok('Default effort set to **' + (arg === 'default' ? 'model default' : arg) + '**.')
    }
    if (sub === 'doctor') {
      const path = await deps.runDoctor()
      return ok('Diagnostic report written to `' + path + '` — attach it when opening an issue.')
    }
    return ok(HELP)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

async function renderStatus(deps: CommandDeps): Promise<string> {
  const cfg = deps.cfg()
  const authHelper = deps.auth()
  const auth = authHelper ? await authHelper.resolvedStatus() : undefined
  const cat = deps.catalog().get()
  const pool = deps.pool?.()
  const accounts = pool ? pool.getAccounts() : []
  const last = deps.lastRun()
  const lines = [
    '**dsh-agy-link status (Direct CloudCode)**',
    '- transport: direct Google CloudCode API',
    '- auth: ' + (auth ? auth.phase + (auth.message ? ' — ' + auth.message : '') : 'unknown'),
    '- default model: ' + (cfg.defaultModel !== '' ? cfg.defaultModel : '(none - use /model picker)'),
    '- default effort: ' + (cfg.defaultEffort !== '' ? cfg.defaultEffort : 'model default'),
    '- catalog: ' + cat.source + ' (' + cat.models.length + ' models)',
    '- pool accounts: ' + accounts.length + ' accounts configured',
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
