// /agy doctor: writes a diagnostic report with the
// CloudCode direct connection status, catalog state, config snapshot, and pool accounts.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stateDir } from '../common/config.ts'
import type { PluginConfig } from '../common/types.ts'
import type { ModelCatalog } from './models.ts'
import type { AccountPoolManager } from './pool.ts'

export interface DoctorDeps {
  cfg: () => PluginConfig
  catalog: () => ModelCatalog
  pool?: () => AccountPoolManager
}

export function redactLine(line: string): string {
  let out = line
  out = out.replace(/https:\/\/accounts\.google\.com\/\S+/g, '<auth-url-redacted>')
  out = out.replace(/\b[0-9]{4,}\//g, '4/<code-redacted>')
  out = out.replace(/ya29\.[A-Za-z0-9._-]+/g, '<oauth-token-redacted>')
  out = out.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
  return out
}

export function writeDoctorReport(deps: DoctorDeps): string {
  const cfg = deps.cfg()
  const cat = deps.catalog().get()
  const pool = deps.pool?.()
  const accounts = pool ? pool.getAccounts() : []

  const lines: string[] = []
  lines.push('# dsh-agy-link diagnostic report (Direct CloudCode)')
  lines.push('')
  lines.push('- generated: ' + new Date().toISOString())
  lines.push('- mode: direct CloudCode API')
  lines.push('- plugin config: ' + JSON.stringify(cfg))
  lines.push('- catalog: ' + cat.source + ' — ' + cat.models.length + ' models' + (cat.lastError === undefined ? '' : ' — error: ' + cat.lastError))
  for (const m of cat.models) {
    lines.push('  - ' + m.id + (m.efforts ? ' [' + m.efforts.join('/') + ']' : ''))
  }
  lines.push('- pool accounts: ' + accounts.length)
  for (const a of accounts) {
    lines.push('  - ' + a.id + ' (' + a.alias + '): ' + (a.authRequired ? 'AUTH_REQUIRED' : 'READY'))
  }
  lines.push('- node: ' + process.version + ' — ' + process.platform + ' ' + process.arch)
  lines.push('')

  const dir = join(stateDir(), 'diagnostics')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'doctor-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '.md')
  writeFileSync(file, lines.join('\n'), 'utf8')
  return file
}
