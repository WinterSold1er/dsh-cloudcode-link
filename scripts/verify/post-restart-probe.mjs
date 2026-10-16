#!/usr/bin/env node
// End-to-end probe for the dsh-cloudcode-link update (HEAD dc0ca77).
// Runs AFTER the host restart and judges, with raw evidence, whether the newly
// installed plugin is the code the running host actually loaded and whether its
// live upstream paths (5H quota refresh / countdown, model catalog, /ccl command)
// behave.
//
// Usage (safe to run detached; needs no agent session):
//   node scripts/verify/post-restart-probe.mjs [--since <ISO|epoch-ms|epoch-s>]
//        [--base-url http://127.0.0.1:3080] [--repo <dir>] [--out <dir>]
//        [--installed <dir>] [--fresh-window-ms <n>] [--ready-timeout-ms <n>]
//
// Exit code: 0 = every check PASS; 1 = at least one FAIL; 2 = no FAIL but at
// least one UNKNOWN (UNKNOWN is never reported as PASS).
//
// Discipline: no mocks, no hardcoded expectations from the report — every
// verdict is derived from a raw observation printed next to it. A network or
// auth failure is FAIL/UNKNOWN, never PASS.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---- named knobs (no anonymous magic values) -------------------------------
const DEFAULT_BASE_URL = 'http://127.0.0.1:3080'
const DEFAULT_FRESH_WINDOW_MS = 5 * 60 * 1000 // refreshed quota must be this recent
const DEFAULT_READY_TIMEOUT_MS = 90 * 1000 // host readiness wait after restart
// An artifact mtime may sit this far before the recorded install completion and
// still be legitimate (copy/extract ordering inside the install phase).
const MTIME_TOLERANCE_MS = 5 * 60 * 1000
const READY_POLL_INTERVAL_MS = 2 * 1000
const HTTP_READY_STATUSES = new Set([200, 401]) // 401 = web host alive, auth required
const SERVICE_UNIT = 'deepseek-harness.service'
const CCL_ROUTE_PREFIX = '/plugins/cloudcode-link/'
const HTTP_TIMEOUT_MS = 30 * 1000

// docs/models-and-fix.md §1 = upstream public catalog (21 entries). These 10 are
// the §1 entries that are normalized to plugin slugs and were observed live.
// Evidence side: UPSTREAM (fetched through the running plugin's /catalog route).
const REQUIRED_UPSTREAM_SLUGS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
]

// docs/models-and-fix.md §2 = plugin-local DEFAULT_FALLBACK_MODELS (12 entries).
// Evidence side: FALLBACK CONSTANT (extracted from the shipped bundle).
const REQUIRED_FALLBACK_SLUGS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
  'gemini-3-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
]

// ---- args ------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    baseUrl: DEFAULT_BASE_URL,
    sinceMs: null,
    sinceRaw: null,
    repo: process.cwd(),
    out: null,
    installed: join(homedir(), '.dsh/profiles/web/node_modules/dsh-cloudcode-link'),
    installRecord: null,
    freshWindowMs: DEFAULT_FRESH_WINDOW_MS,
    readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
    noWait: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined) throw new Error(`missing value for ${a}`)
      i += 1
      return v
    }
    if (a === '--since') { opts.sinceRaw = next(); opts.sinceMs = toEpochMs(opts.sinceRaw) }
    else if (a === '--base-url') opts.baseUrl = next()
    else if (a === '--repo') opts.repo = resolve(next())
    else if (a === '--out') opts.out = resolve(next())
    else if (a === '--installed') opts.installed = resolve(next())
    else if (a === '--install-record') opts.installRecord = resolve(next())
    else if (a === '--fresh-window-ms') opts.freshWindowMs = Number(next())
    else if (a === '--ready-timeout-ms') opts.readyTimeoutMs = Number(next())
    else if (a === '--no-wait') opts.noWait = true
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0) }
    else throw new Error(`unknown argument: ${a}`)
  }
  if (opts.sinceRaw !== null && !Number.isFinite(opts.sinceMs)) {
    throw new Error(`--since is not a parseable time: ${opts.sinceRaw}`)
  }
  opts.out = opts.out ?? join(opts.repo, 'ops/verify')
  opts.installRecord = opts.installRecord ?? join(opts.repo, 'ops/release/install-complete.json')
  return opts
}

function toEpochMs(raw) {
  const s = String(raw).trim()
  if (/^\d{13}$/.test(s)) return Number(s)
  if (/^\d{10}$/.test(s)) return Number(s) * 1000
  const p = Date.parse(s)
  return Number.isFinite(p) ? p : Number.NaN
}

function printUsage() {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 16).join('\n'))
}

// ---- helpers ---------------------------------------------------------------
const checks = []
function record(id, verdict, summary, evidence, note = null) {
  checks.push({ id, verdict, summary, evidence, note })
  log(`--- CHECK ${id}: ${verdict} ---`)
  log(`    ${summary}`)
  for (const e of evidence) log(`    evidence: ${e}`)
  if (note) log(`    note: ${note}`)
}

const logLines = []
function log(line) {
  logLines.push(line)
  process.stdout.write(`${line}\n`)
}

function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000, ...opts })
    return { ok: true, out: out ?? '' }
  } catch (err) {
    return { ok: false, out: `${err?.stdout ?? ''}`, err: `${err?.stderr ?? err?.message ?? err}` }
  }
}

function sha256(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

async function httpJson(method, url, body) {
  const started = Date.now()
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep raw text as evidence */ }
  return { status: res.status, json, text, ms: Date.now() - started }
}

function msHuman(ms) {
  if (!Number.isFinite(ms)) return 'n/a'
  return `${ms} (${new Date(ms).toISOString()})`
}

// ---- host facts ------------------------------------------------------------
function systemdProps() {
  const r = run('systemctl', ['--user', 'show', SERVICE_UNIT, '-p', 'MainPID',
    '-p', 'ExecMainPID', '-p', 'ActiveState', '-p', 'SubState',
    '-p', 'ExecMainStartTimestamp', '-p', 'ExecMainStartTimestampMonotonic'])
  if (!r.ok) return { ok: false, raw: r.err || r.out }
  const props = {}
  for (const line of r.out.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return { ok: true, props }
}

function bootTimeSec() {
  const r = run('cat', ['/proc/stat'])
  if (!r.ok) return null
  const m = /^btime (\d+)$/m.exec(r.out)
  return m ? Number(m[1]) : null
}

function listeningPid(port) {
  const r = run('ss', ['-ltnpH', `sport = :${port}`])
  if (!r.ok) return { ok: false, raw: r.err || r.out }
  const m = /pid=(\d+)/.exec(r.out)
  return { ok: true, pid: m ? Number(m[1]) : null, raw: r.out.trim() }
}

function installedArtifact(installedDir) {
  const p = join(installedDir, 'dist/index.js')
  if (!existsSync(p)) return null
  const st = statSync(p)
  return { path: p, mtimeMs: st.mtimeMs, size: st.size, sha256: sha256(p) }
}

// Independent install record written by the release pipeline
// (ops/release/install-complete.json). Freshness is judged against THIS, never
// against a filesystem mtime that a single `touch` can rewrite.
function readInstallRecord(recordPath) {
  if (!existsSync(recordPath)) return { ok: false, reason: `install record not found: ${recordPath}` }
  let rec
  try {
    rec = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch (err) {
    return { ok: false, reason: `install record is not valid JSON (${recordPath}): ${err?.message ?? err}` }
  }
  const recordMs = rec?.installCompletedUtc ? toEpochMs(rec.installCompletedUtc) : Number.NaN
  const missing = ['installCompletedUtc', 'installedSha256', 'installedPath', 'repoHead']
    .filter((k) => typeof rec?.[k] !== 'string' || rec[k] === '')
  if (missing.length > 0) return { ok: false, reason: `install record is missing field(s): ${missing.join(', ')} (${recordPath})`, rec }
  if (!Number.isFinite(recordMs)) return { ok: false, reason: `install record installCompletedUtc is not parseable: ${rec.installCompletedUtc}`, rec }
  return {
    ok: true,
    path: recordPath,
    recordMs,
    rec,
    // A record the same operator derived after the fact is self-attested: it can
    // still bind the artifact hash, but it cannot independently prove ordering.
    writtenAfterTheFact: rec?.provenance?.writtenAfterTheFact === true,
    provenanceEvidence: Array.isArray(rec?.provenance?.evidence) ? rec.provenance.evidence : [],
  }
}

// ---- startup readiness -----------------------------------------------------
async function waitReady(opts) {
  const deadline = Date.now() + opts.readyTimeoutMs
  let last = 'no attempt'
  for (;;) {
    try {
      const res = await fetch(`${opts.baseUrl}/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      last = `HTTP ${res.status}`
      if (HTTP_READY_STATUSES.has(res.status)) return { ready: true, last, waitedMs: opts.readyTimeoutMs - (deadline - Date.now()) }
    } catch (err) {
      last = `fetch error: ${err?.message ?? err}`
    }
    if (Date.now() >= deadline) return { ready: false, last, waitedMs: opts.readyTimeoutMs }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS))
  }
}

// ---- checks ----------------------------------------------------------------
async function checkServiceReady(opts) {
  try {
    const res = await fetch(`${opts.baseUrl}/`, { redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
    const evidence = [`GET ${opts.baseUrl}/ -> HTTP ${res.status}`, `response date header: ${res.headers.get('date')}`]
    const pass = HTTP_READY_STATUSES.has(res.status)
    record('service_ready', pass ? 'PASS' : 'FAIL',
      pass ? 'web host answers on the configured port' : `unexpected status ${res.status} from ${opts.baseUrl}/`,
      evidence)
    return pass
  } catch (err) {
    record('service_ready', 'FAIL', 'host did not answer', [`GET ${opts.baseUrl}/ -> fetch error: ${err?.message ?? err}`])
    return false
  }
}

function checkProcessFresh(opts, artifact) {
  const sd = systemdProps()
  const evidence = []
  if (!sd.ok) {
    record('process_fresh', 'UNKNOWN', 'cannot read systemd unit state', [`systemctl --user show ${SERVICE_UNIT} failed: ${sd.raw}`])
    return { verdict: 'UNKNOWN' }
  }
  const { props } = sd
  const mainPid = Number(props.MainPID)
  const port = Number(new URL(opts.baseUrl).port || 80)
  const lp = listeningPid(port)
  const btime = bootTimeSec()
  const mono = Number(props.ExecMainStartTimestampMonotonic)
  const startMs = btime !== null && Number.isFinite(mono) ? btime * 1000 + Math.round(mono / 1000) : Number.NaN

  evidence.push(`ActiveState=${props.ActiveState} SubState=${props.SubState}`)
  evidence.push(`MainPID=${props.MainPID} ExecMainPID=${props.ExecMainPID} ExecMainStartTimestamp=${props.ExecMainStartTimestamp}`)
  evidence.push(`ExecMainStartTimestampMonotonic=${props.ExecMainStartTimestampMonotonic} btime=${btime}s -> hostStartMs=${msHuman(startMs)}`)
  evidence.push(lp.ok ? `listening on :${port}: ${lp.raw}` : `ss failed: ${lp.raw}`)
  evidence.push(artifact
    ? `installed dist/index.js mtime=${msHuman(artifact.mtimeMs)} sha256=${artifact.sha256}`
    : 'installed dist/index.js NOT FOUND')
  if (opts.sinceMs !== null) evidence.push(`--since ${opts.sinceRaw} -> ${msHuman(opts.sinceMs)}`)

  const installRec = readInstallRecord(opts.installRecord)
  evidence.push(`independent install record: ${opts.installRecord}`)
  if (installRec.ok) {
    evidence.push(`record installCompletedUtc=${installRec.rec.installCompletedUtc} -> ${msHuman(installRec.recordMs)}`)
    evidence.push(`record installedSha256=${installRec.rec.installedSha256}`)
    evidence.push(`record installedPath=${installRec.rec.installedPath}`)
    evidence.push(`record repoHead=${installRec.rec.repoHead}`)
  } else {
    evidence.push(`record unusable: ${installRec.reason}`)
  }

  // Timestamp tamper detection: a legitimately installed artifact is written
  // before the host started and after (or near) the recorded install completion.
  let suspect = null
  if (artifact && Number.isFinite(startMs)) {
    if (artifact.mtimeMs > startMs) {
      suspect = `artifact mtime ${msHuman(artifact.mtimeMs)} is LATER than host start ${msHuman(startMs)} (artifact changed after the process booted)`
    } else if (installRec.ok && artifact.mtimeMs < installRec.recordMs - MTIME_TOLERANCE_MS) {
      suspect = `artifact mtime ${msHuman(artifact.mtimeMs)} predates the recorded install completion ${msHuman(installRec.recordMs)} by more than ${MTIME_TOLERANCE_MS}ms (back-dated timestamp)`
    }
    if (suspect) evidence.push(`WARN: SUSPECT TIMESTAMP - ${suspect}`)
  }

  const problems = []
  if (!installRec.ok) {
    problems.push(`UNKNOWN-EVIDENCE: missing/invalid independent install record (${installRec.reason}) -> the mtime comparison cannot be trusted on its own`)
  } else {
    if (artifact && artifact.sha256 !== installRec.rec.installedSha256.toLowerCase()) {
      problems.push(`record installedSha256 ${installRec.rec.installedSha256} != actual installed artifact sha256 ${artifact.sha256}`)
    }
    if (artifact && resolve(installRec.rec.installedPath) !== resolve(artifact.path)) {
      problems.push(`record installedPath ${installRec.rec.installedPath} != probed artifact path ${artifact.path}`)
    }
    if (Number.isFinite(startMs) && !(startMs > installRec.recordMs)) {
      problems.push(`host started ${msHuman(startMs)} which is NOT after the recorded install completion ${msHuman(installRec.recordMs)} -> the running process predates the new build`)
    }
    // The record binds the artifact hash, but its timestamp was chosen after the
    // fact by the same operator -> it cannot independently prove ordering.
    if (installRec.writtenAfterTheFact) {
      problems.push(`UNKNOWN-EVIDENCE: install record is self-attested (provenance.writtenAfterTheFact=true, installCompletedUtc=${installRec.rec.installCompletedUtc} derived after the fact) -> the install->restart ordering is NOT independently trustworthy; hash binding and live-route evidence remain admissible`)
      for (const line of installRec.provenanceEvidence) evidence.push(`record provenance evidence: ${line}`)
    }
  }
  if (suspect) {
    problems.push(`UNKNOWN-EVIDENCE: SUSPECT TIMESTAMP - ${suspect}`)
  }
  if (props.ActiveState !== 'active') problems.push(`unit not active (${props.ActiveState})`)
  if (!lp.ok || lp.pid === null) problems.push(`no process listening on :${port}`)
  else if (lp.pid !== mainPid) problems.push(`listening pid ${lp.pid} != MainPID ${mainPid}`)
  if (!Number.isFinite(startMs)) problems.push('host start time could not be computed')
  if (!artifact) problems.push('installed artifact missing')
  if (opts.sinceMs !== null && Number.isFinite(startMs) && !(startMs >= opts.sinceMs - 1000)) {
    problems.push(`host started ${msHuman(startMs)} which is before the requested --since ${msHuman(opts.sinceMs)}`)
  }
  const unknownOnly = problems.length > 0 && problems.every((p) => p.startsWith('UNKNOWN-EVIDENCE:'))
  const pass = problems.length === 0
  const verdict = pass ? 'PASS' : unknownOnly ? 'UNKNOWN' : 'FAIL'
  const caveat = installRec.ok
    ? (installRec.writtenAfterTheFact
      ? `process_fresh timing judgement is self-attested: ${opts.installRecord} has provenance.writtenAfterTheFact=true, so installCompletedUtc (${installRec.rec.installCompletedUtc}) was derived after the fact from a release log by the same operator; the install->restart ordering is NOT independently trustworthy, therefore the verdict is UNKNOWN, not PASS. Admissible substitutes: artifact hash binding (record sha == installed copy sha == HEAD blob == working tree), the live plugin routes answered by this PID, and the release-pipeline ordering lines in the record provenance.`
      : null)
    : `no usable independent install record (${installRec.reason}); an artifact mtime is rewritable by one touch and is never a freshness basis, therefore the verdict is UNKNOWN, not PASS.`
  record('process_fresh', verdict,
    pass ? `host process is a live listener started after installCompletedUtc=${installRec.rec?.installCompletedUtc} with a matching artifact hash (basis: independent install record, not mtime)`
      : `${unknownOnly ? 'NOT INDEPENDENTLY PROVEN' : 'stale/unverifiable process'}: ${problems.join('; ')}`,
    evidence,
    pass ? 'mtime is reported for context only and is never the freshness basis' : caveat)
  return {
    verdict,
    mainPid,
    startMs,
    listenPid: lp.pid,
    recordMs: installRec.ok ? installRec.recordMs : null,
    recordPath: opts.installRecord,
    recordBasis: installRec.ok ? 'record' : 'none',
    writtenAfterTheFact: installRec.ok ? installRec.writtenAfterTheFact : null,
    installRecordInstallCompletedUtc: installRec.ok ? installRec.rec.installCompletedUtc : null,
    installRecordSha256: installRec.ok ? installRec.rec.installedSha256 : null,
    installRecordRepoHead: installRec.ok ? installRec.rec.repoHead : null,
    provenanceEvidence: installRec.ok ? installRec.provenanceEvidence : [],
    caveat,
  }
}

function checkArtifactPinned(opts, artifact) {
  const evidence = []
  const indexPath = join(opts.installed, 'dist/index.js')
  const clientPath = join(opts.installed, 'dist/client.js')
  if (!artifact) {
    record('artifact_pinned', 'FAIL', 'installed plugin artifact is missing', [`expected ${indexPath}`])
    return { verdict: 'FAIL', sha256: null }
  }
  evidence.push(`installed dist/index.js ${artifact.path} sha256=${artifact.sha256} size=${artifact.size}`)
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: opts.repo })
  if (!head.ok) {
    record('artifact_pinned', 'UNKNOWN', 'cannot resolve repo HEAD', [evidence[0], `git rev-parse HEAD failed: ${head.err || head.out}`])
    return { verdict: 'UNKNOWN', sha256: artifact.sha256 }
  }
  const headSha = head.out.trim()
  const blob = run('git', ['show', `HEAD:dist/index.js`], { cwd: opts.repo, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  let blobHash = null
  if (blob.ok) blobHash = createHash('sha256').update(blob.out).digest('hex')
  evidence.push(`repo HEAD=${headSha}`)
  evidence.push(blobHash ? `git show HEAD:dist/index.js sha256=${blobHash}` : `git show HEAD:dist/index.js failed: ${blob.err || blob.out}`)
  if (existsSync(join(opts.repo, 'dist/index.js'))) {
    evidence.push(`working-tree dist/index.js sha256=${sha256(join(opts.repo, 'dist/index.js'))}`)
  }
  if (existsSync(clientPath)) {
    // informational only: dc0ca77 does not change client code, so a client hash
    // match is NOT evidence that the new build is live.
    evidence.push(`INFO (not used as a verdict): installed dist/client.js sha256=${sha256(clientPath)}`)
  }
  if (blobHash === null) {
    record('artifact_pinned', 'UNKNOWN', 'HEAD blob for dist/index.js is unavailable (is dist tracked?)', evidence)
    return { verdict: 'UNKNOWN', sha256: artifact.sha256 }
  }
  const pass = artifact.sha256 === blobHash
  record('artifact_pinned', pass ? 'PASS' : 'FAIL',
    pass ? `installed artifact is byte-identical to HEAD ${headSha}:dist/index.js`
      : 'installed artifact differs from HEAD dist/index.js',
    evidence)
  return { verdict: pass ? 'PASS' : 'FAIL', sha256: artifact.sha256, headSha }
}

function checkBundleDefinesCcl(opts) {
  const bundlePath = join(opts.installed, 'dist/index.js')
  if (!existsSync(bundlePath)) {
    record('bundle_defines_ccl', 'FAIL', 'shipped bundle missing', [`${bundlePath} not found`])
    return { verdict: 'FAIL' }
  }
  const text = readFileSync(bundlePath, 'utf8')
  const needles = [
    'commands.register',
    'cclCommandDefinition(cmdDeps, "ccl")',
    'cclCommandDefinition(cmdDeps, "cloudcode")',
    'regBoth("status"',
    'inject(["webServer"]',
  ]
  const offsets = {}
  const missing = []
  for (const n of needles) {
    const i = text.indexOf(n)
    if (i < 0) missing.push(n)
    else offsets[n] = i
  }
  const evidence = needles.map((n) => (n in offsets ? `offset ${offsets[n]}: ${n}` : `MISSING: ${n}`))
  const registeredCclAt = offsets['cclCommandDefinition(cmdDeps, "ccl")']
  const registeredAliasAt = offsets['cclCommandDefinition(cmdDeps, "cloudcode")']
  const statusRouteAt = offsets['regBoth("status"']
  const webInjectAt = offsets['inject(["webServer"]']
  if (Number.isFinite(registeredCclAt) && Number.isFinite(statusRouteAt) && Number.isFinite(webInjectAt)) {
    // apply() is one straight-line body: it registers /ccl + cloudcode, then wires
    // the routes (regBoth("status") is the status route this probe actually GETs),
    // then only on webServer injection does it run. Because that status route is
    // served by the live host, the earlier registration statements did execute.
    evidence.push(`ordering in shipped apply() body: ccl@${registeredCclAt} < status-route@${statusRouteAt} < webServer-inject@${webInjectAt}`)
  }
  const ordered = [registeredCclAt, registeredAliasAt, statusRouteAt, webInjectAt].every(Number.isFinite)
    && registeredCclAt < registeredAliasAt && registeredAliasAt < statusRouteAt && statusRouteAt < webInjectAt
  const pass = missing.length === 0 && ordered
  record('bundle_defines_ccl', pass ? 'PASS' : 'FAIL',
    pass ? 'shipped bundle registers the /ccl and cloudcode commands before route wiring (static, hash-pinned artifact)'
      : `shipped bundle does not contain the expected registration literals: ${missing.join(', ') || 'ordering violated'}`,
    evidence,
    'static evidence only; direct /ccl invocation needs an authenticated session API that the local HTTP surface does not expose')
  return { verdict: pass ? 'PASS' : 'FAIL' }
}

async function checkCclLive(opts, fresh, cclStatic) {
  const url = `${opts.baseUrl}${CCL_ROUTE_PREFIX}status`
  try {
    const res = await httpJson('GET', url)
    const evidence = [`GET ${url} -> HTTP ${res.status} in ${res.ms}ms`, `body.plugin=${JSON.stringify(res.json?.plugin)} transport=${JSON.stringify(res.json?.transport)}`]
    const servedByPlugin = res.status === 200 && res.json?.plugin === 'dsh-cloudcode-link'
    evidence.push(`listening pid (new process) = ${fresh.listenPid}, host start = ${msHuman(fresh.startMs)}`)
    const problems = []
    let unproven = null
    if (!servedByPlugin) problems.push(`plugin status route not served as expected (HTTP ${res.status})`)
    if (fresh.verdict === 'FAIL') problems.push('new-process evidence refuted (see process_fresh)')
    else if (fresh.verdict !== 'PASS') unproven = 'new-process evidence not established (see process_fresh)'
    if (cclStatic.verdict !== 'PASS') problems.push('shipped bundle lacks the /ccl registration literals')
    const verdict = problems.length > 0 ? 'FAIL' : unproven ? 'UNKNOWN' : 'PASS'
    record('ccl_registered_in_live_host', verdict,
      verdict === 'PASS' ? 'live host runs the hash-pinned bundle whose apply() registers /ccl before the routes it is serving'
        : verdict === 'UNKNOWN' ? `cannot prove /ccl is registered in the live host: ${unproven}`
          : `cannot prove /ccl is registered in the live host: ${problems.join('; ')}`,
      evidence,
      'chain: routes answered by the new PID + bundle hash == HEAD + registration precedes route wiring in the same shipped function')
    return { verdict, statusCode: res.status, servedByPlugin }
  } catch (err) {
    record('ccl_registered_in_live_host', 'FAIL', 'plugin status route unreachable in the running host',
      [`GET ${url} -> fetch error: ${err?.message ?? err}`])
    return { verdict: 'FAIL', statusCode: null, servedByPlugin: false }
  }
}

async function checkQuotaRefresh(opts, probeStartMs) {
  const statusUrl = `${opts.baseUrl}${CCL_ROUTE_PREFIX}status`
  const refreshUrl = `${opts.baseUrl}${CCL_ROUTE_PREFIX}pool/refresh-quota`
  const poolUrl = `${opts.baseUrl}${CCL_ROUTE_PREFIX}pool`
  const evidence = []
  let authPhase = null
  try {
    const st = await httpJson('GET', statusUrl)
    authPhase = st.json?.auth?.phase ?? null
    evidence.push(`GET ${statusUrl} -> HTTP ${st.status}, auth.phase=${JSON.stringify(authPhase)} message=${JSON.stringify(st.json?.auth?.message)}`)
  } catch (err) {
    record('quota_refresh_live', 'UNKNOWN', 'cannot read plugin status before refreshing quota',
      [`GET ${statusUrl} -> fetch error: ${err?.message ?? err}`])
    return { verdict: 'UNKNOWN' }
  }
  if (authPhase !== 'ok') {
    record('quota_refresh_live', 'UNKNOWN',
      'upstream account auth is not healthy, so no real upstream quota evidence can be obtained',
      evidence)
    return { verdict: 'UNKNOWN' }
  }
  let refreshed
  try {
    refreshed = await httpJson('POST', refreshUrl, {})
  } catch (err) {
    record('quota_refresh_live', 'UNKNOWN', 'quota refresh request failed at the network layer (upstream may be unreachable)',
      [...evidence, `POST ${refreshUrl} -> fetch error: ${err?.message ?? err}`])
    return { verdict: 'UNKNOWN' }
  }
  evidence.push(`POST ${refreshUrl} -> HTTP ${refreshed.status} in ${refreshed.ms}ms, body.ok=${JSON.stringify(refreshed.json?.ok)}`)
  if (refreshed.status !== 200) {
    record('quota_refresh_live', 'FAIL', `live quota refresh returned HTTP ${refreshed.status}`,
      [...evidence, `body: ${refreshed.text.slice(0, 500)}`])
    return { verdict: 'FAIL' }
  }
  let pool
  try {
    pool = await httpJson('GET', poolUrl)
  } catch (err) {
    record('quota_refresh_live', 'UNKNOWN', 'pool read failed at the network layer after the refresh',
      [...evidence, `GET ${poolUrl} -> fetch error: ${err?.message ?? err}`])
    return { verdict: 'UNKNOWN' }
  }
  evidence.push(`GET ${poolUrl} -> HTTP ${pool.status}`)
  if (pool.status !== 200 || !Array.isArray(pool.json?.accounts)) {
    record('quota_refresh_live', 'FAIL', 'pool route did not return account data after refresh',
      [...evidence, `body: ${pool.text.slice(0, 500)}`])
    return { verdict: 'FAIL' }
  }

  const problems = []
  let families = 0
  let weeklyCount = 0
  let freshestUpdatedAt = -Infinity
  for (const acc of pool.json.accounts) {
    const quotas = acc?.quotas ?? {}
    for (const [fam, q] of Object.entries(quotas)) {
      families += 1
      const resetMs = q?.resetTime ? Date.parse(q.resetTime) : Number.NaN
      const weekly = q?.weeklyFraction
      const updatedAt = Number(q?.updatedAt)
      if (Number.isFinite(updatedAt)) freshestUpdatedAt = Math.max(freshestUpdatedAt, updatedAt)
      if (typeof weekly === 'number' && Number.isFinite(weekly)) weeklyCount += 1
      evidence.push(
        `acc=${acc.id} family=${fam} remainingFraction=${JSON.stringify(q?.remainingFraction)} ` +
        `resetTime=${JSON.stringify(q?.resetTime)} (epoch ${resetMs}) updatedAt=${JSON.stringify(q?.updatedAt)} ` +
        `weeklyFraction=${JSON.stringify(weekly)}`,
      )
      if (!Number.isFinite(resetMs)) problems.push(`${acc.id}/${fam}: resetTime missing or unparseable (${JSON.stringify(q?.resetTime)})`)
      else if (!(resetMs > probeStartMs)) {
        problems.push(`${acc.id}/${fam}: resetTime ${q.resetTime} is not in the future (probe start ${new Date(probeStartMs).toISOString()}) -> countdown still broken`)
      }
      if (weekly !== undefined && !(typeof weekly === 'number' && weekly >= 0 && weekly <= 1)) {
        problems.push(`${acc.id}/${fam}: weeklyFraction ${JSON.stringify(weekly)} is not a number in [0,1]`)
      }
    }
  }
  if (families === 0) problems.push('no quota families present after refresh')
  if (weeklyCount === 0) problems.push('no family carries a numeric weeklyFraction, so weekly sync is unverified')
  const freshAgeMs = probeStartMs - freshestUpdatedAt
  evidence.push(`families=${families} weeklyFractionPresent=${weeklyCount} freshest updatedAt=${freshestUpdatedAt} (age ${freshAgeMs}ms, window ${opts.freshWindowMs}ms)`)
  if (!Number.isFinite(freshestUpdatedAt) || freshAgeMs > opts.freshWindowMs) {
    problems.push(`no quota entry was refreshed within ${opts.freshWindowMs}ms of probe start (freshest ${Number.isFinite(freshestUpdatedAt) ? new Date(freshestUpdatedAt).toISOString() : 'n/a'}) -> the post-refresh values are stale`)
  }
  const pass = problems.length === 0
  record('quota_refresh_live', pass ? 'PASS' : 'FAIL',
    pass ? 'live upstream refresh produced future resetTime, in-range weeklyFraction and a fresh updatedAt for every family'
      : `live quota evidence is not healthy: ${problems.join('; ')}`,
    evidence,
    'values come from the running plugin (installed copy) calling the upstream quota endpoints; nothing is mocked')
  return { verdict: pass ? 'PASS' : 'FAIL' }
}

async function checkModelsUpstream(opts) {
  const url = `${opts.baseUrl}${CCL_ROUTE_PREFIX}catalog`
  let res
  try {
    res = await httpJson('GET', url)
  } catch (err) {
    record('models_upstream_side', 'FAIL', 'catalog route unreachable', [`GET ${url} -> fetch error: ${err?.message ?? err}`])
    return { verdict: 'FAIL' }
  }
  const ids = Array.isArray(res.json?.models) ? res.json.models.map((m) => m?.id).filter(Boolean) : []
  const missing = REQUIRED_UPSTREAM_SLUGS.filter((id) => !ids.includes(id))
  const evidence = [
    `GET ${url} -> HTTP ${res.status} in ${res.ms}ms`,
    `source=${JSON.stringify(res.json?.source)} count=${JSON.stringify(res.json?.count)} idsInBody=${ids.length}`,
    `observed ids: ${ids.join(', ')}`,
    `required (docs/models-and-fix.md §1 upstream, normalized slugs): ${REQUIRED_UPSTREAM_SLUGS.join(', ')}`,
    `missing: ${missing.length ? missing.join(', ') : '(none)'}`,
  ]
  const source = res.json?.source ?? null
  const slugsOk = res.status === 200 && ids.length > 0 && missing.length === 0
  // A catalog served from the local fallback list proves the plugin's catalog
  // contract, but NOT that the upstream discovery path (§1) was exercised.
  const pass = slugsOk && source === 'discovered'
  const verdict = pass ? 'PASS' : slugsOk ? 'UNKNOWN' : 'FAIL'
  record('models_upstream_side', verdict,
    pass ? 'upstream-side catalog served by the live plugin contains every required §1 model slug'
      : slugsOk
        ? `catalog was served from "${source}" (not upstream discovery), so the §1 upstream list is unverified in this run even though every required slug is present`
        : `upstream-side catalog is incomplete (missing ${missing.join(', ') || 'all models'})`,
    evidence)
  return { verdict }
}

function checkModelsFallback(opts) {
  const bundlePath = join(opts.installed, 'dist/index.js')
  if (!existsSync(bundlePath)) {
    record('models_fallback_side', 'FAIL', 'shipped bundle missing', [`${bundlePath} not found`])
    return { verdict: 'FAIL' }
  }
  const text = readFileSync(bundlePath, 'utf8')
  const start = text.indexOf('const DEFAULT_FALLBACK_MODELS$1 = [')
  if (start < 0) {
    record('models_fallback_side', 'FAIL', 'DEFAULT_FALLBACK_MODELS not found in the shipped bundle', [`searched ${bundlePath}`])
    return { verdict: 'FAIL' }
  }
  const end = text.indexOf('\n]', start)
  const block = text.slice(start, end + 2)
  const ids = [...block.matchAll(/id: "([^"]+)"/g)].map((m) => m[1])
  const missing = REQUIRED_FALLBACK_SLUGS.filter((id) => !ids.includes(id))
  const evidence = [
    `extracted from ${bundlePath} (offset ${start}..${end})`,
    `DEFAULT_FALLBACK_MODELS ids (${ids.length}): ${ids.join(', ')}`,
    `required (docs/models-and-fix.md §2 fallback constant, ${REQUIRED_FALLBACK_SLUGS.length} entries): ${REQUIRED_FALLBACK_SLUGS.join(', ')}`,
    `missing: ${missing.length ? missing.join(', ') : '(none)'}`,
  ]
  const pass = missing.length === 0
  record('models_fallback_side', pass ? 'PASS' : 'FAIL',
    pass ? 'shipped bundle carries every §2 fallback model entry'
      : `fallback constant is missing ${missing.join(', ')}`,
    evidence)
  return { verdict: pass ? 'PASS' : 'FAIL' }
}

function checkJournalClean(fresh) {
  if (!Number.isFinite(fresh.startMs)) {
    record('journal_no_import_failure', 'UNKNOWN', 'host start time unknown, cannot scope the journal query', ['see process_fresh evidence'])
    return { verdict: 'UNKNOWN' }
  }
  const since = new Date(fresh.startMs - 5000).toISOString()
  const r = run('journalctl', ['--user', '-u', SERVICE_UNIT, '--since', since, '--no-pager'])
  if (!r.ok) {
    record('journal_no_import_failure', 'UNKNOWN', 'journalctl unavailable', [`journalctl --user -u ${SERVICE_UNIT} --since ${since} failed: ${r.err || r.out}`])
    return { verdict: 'UNKNOWN' }
  }
  const lines = r.out.split('\n').filter((l) => l.trim())
  // Only failures of THIS plugin invalidate the probe; unrelated plugins that
  // already fail to import are reported as INFO, not as a verdict.
  const bad = lines.filter((l) => /cloudcode|agy-link/i.test(l) && /failed to import|import failed|cannot find/i.test(l))
  const otherFailures = lines.filter((l) => /failed to import/i.test(l) && !/cloudcode|agy-link/i.test(l))
  const cclLines = lines.filter((l) => /cloudcode|agy-link/i.test(l))
  const evidence = [
    `journalctl --user -u ${SERVICE_UNIT} --since ${since} -> ${lines.length} lines`,
    `cloudcode-link/agy-link lines: ${cclLines.length}`,
    ...cclLines.slice(0, 5).map((l) => `INFO: ${l}`),
    `cloudcode-link import FAILURES: ${bad.length}`,
    ...bad.slice(0, 5).map((l) => `FAILURE LINE: ${l}`),
    `unrelated plugins failing to import (pre-existing, informational): ${otherFailures.length}`,
    ...otherFailures.slice(0, 3).map((l) => `INFO (other plugin): ${l}`),
  ]
  const pass = bad.length === 0
  record('journal_no_import_failure', pass ? 'PASS' : 'FAIL',
    pass ? 'startup journal has no dsh-cloudcode-link import failure'
      : 'startup journal reports a dsh-cloudcode-link import failure',
    evidence,
    cclLines.length === 0 ? 'the plugin logs no startup banner, so absence of a failure line is the only journal signal (the live routes are the positive evidence)' : null)
  return { verdict: pass ? 'PASS' : 'FAIL' }
}

// ---- main ------------------------------------------------------------------
function outStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const probeStartMs = Date.now()
  log('=== dsh-cloudcode-link post-restart probe ===')
  log(`probe start: ${new Date(probeStartMs).toISOString()} (epoch ${probeStartMs})`)
  log(`base url: ${opts.baseUrl}`)
  log(`installed copy: ${opts.installed}`)
  log(`repo: ${opts.repo}`)
  log(`argv: node scripts/verify/post-restart-probe.mjs ${process.argv.slice(2).join(' ')}`)

  await checkServiceReady(opts)
  if (!opts.noWait) {
    const ready = await waitReady(opts)
    log(`readiness wait: ready=${ready.ready} last=${ready.last} waitedMs=${ready.waitedMs}`)
  }

  const artifact = installedArtifact(opts.installed)
  const fresh = checkProcessFresh(opts, artifact)
  const pinned = checkArtifactPinned(opts, artifact)
  const cclStatic = checkBundleDefinesCcl(opts)
  const ccl = await checkCclLive(opts, fresh, cclStatic)
  await checkQuotaRefresh(opts, probeStartMs)
  await checkModelsUpstream(opts)
  checkModelsFallback(opts)
  checkJournalClean(fresh)

  const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 }
  for (const c of checks) counts[c.verdict] += 1
  const verdict = counts.FAIL > 0 ? 'FAIL' : counts.UNKNOWN > 0 ? 'UNKNOWN' : 'PASS'
  const exitCode = counts.FAIL > 0 ? 1 : counts.UNKNOWN > 0 ? 2 : 0
  // Every emitted check carries its own basis text; this block makes the timing
  // judgement explicit in the machine-readable artifact so no unlabelled PASS
  // can leave the probe.
  const provenance = {
    argv: `node scripts/verify/post-restart-probe.mjs ${process.argv.slice(2).join(' ')}`.trim(),
    cwd: process.cwd(),
    repo: opts.repo,
    baseUrl: opts.baseUrl,
    installedPath: artifact?.path ?? null,
    installRecordPath: fresh.recordPath,
    installRecordBasis: fresh.recordBasis, // 'record' | 'none' ('mtime' is never used as a basis)
    processFreshBasis: fresh.recordBasis === 'record'
      ? `installCompletedUtc=${fresh.installRecordInstallCompletedUtc} from ${fresh.recordPath}`
      : `no usable install record (${fresh.recordPath}); mtime deliberately NOT used`,
    installRecordInstallCompletedUtc: fresh.installRecordInstallCompletedUtc,
    installRecordSha256: fresh.installRecordSha256,
    installRecordRepoHead: fresh.installRecordRepoHead,
    installRecordWrittenAfterTheFact: fresh.writtenAfterTheFact,
    caveat: fresh.caveat,
    supportingEvidence: [
      `artifact hash binding (artifact_pinned=${pinned.verdict}): installed copy sha256 ${pinned.sha256 ?? 'n/a'} == git HEAD:dist/index.js ${pinned.headSha ?? 'n/a'}`,
      `live plugin routes answered by host PID ${fresh.mainPid} (ccl_registered_in_live_host=${ccl.verdict}, status HTTP ${ccl.statusCode ?? 'n/a'}, servedByPlugin=${ccl.servedByPlugin})`,
      ...fresh.provenanceEvidence.map((l) => `release pipeline: ${l}`),
    ],
  }
  // Pin the evidence to an exact probe revision + repo state, so a machine-readable
  // artifact can never be produced by an unidentified script revision.
  const probeAbs = fileURLToPath(import.meta.url)
  const probeRel = relative(opts.repo, probeAbs)
  const probeClean = run('git', ['diff', '--quiet', 'HEAD', '--', probeRel], { cwd: opts.repo })
  const headBlob = run('git', ['show', `HEAD:${probeRel}`], { cwd: opts.repo, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const porcelain = run('git', ['status', '--porcelain'], { cwd: opts.repo })
  const dirtyPaths = porcelain.ok ? porcelain.out.split('\n').map((l) => l.trimEnd()).filter(Boolean) : []
  provenance.probeFile = probeRel
  provenance.probeSha256 = sha256(probeAbs)
  provenance.probeMatchesHeadBlob = headBlob.ok
    ? createHash('sha256').update(headBlob.out).digest('hex') === provenance.probeSha256
    : null
  provenance.repoHeadSha = (run('git', ['rev-parse', 'HEAD'], { cwd: opts.repo }).out ?? '').trim() || null
  provenance.repoDirty = probeClean.ok ? false : true // the evidence-producing probe revision is uncommitted
  provenance.repoDirtyAll = dirtyPaths.length > 0
  provenance.repoDirtyPaths = dirtyPaths.slice(0, 10)
  provenance.nodeVersion = process.version
  const REQUIRED_PROVENANCE_FIELDS = ['probeFile', 'probeSha256', 'repoHeadSha', 'repoDirty', 'nodeVersion']
  const missingProvenance = REQUIRED_PROVENANCE_FIELDS
    .filter((k) => provenance[k] === undefined || provenance[k] === null || provenance[k] === '')
  if (missingProvenance.length > 0) {
    log('')
    log(`PROVENANCE SELF-CHECK FAILED: missing/empty provenance field(s): ${missingProvenance.join(', ')} -> evidence is invalid, refusing to emit a canonical artifact`)
    mkdirSync(opts.out, { recursive: true })
    writeFileSync(join(opts.out, `probe-${outStamp()}.log`), `${logLines.join('\n')}\n`)
    return 3
  }
  const summary = {
    tool: 'post-restart-probe',
    verdict,
    exitCode,
    probeStart: new Date(probeStartMs).toISOString(),
    repoHead: pinned.headSha ?? null,
    installedSha256: pinned.sha256 ?? null,
    hostPid: fresh.mainPid ?? null,
    hostStartMs: Number.isFinite(fresh.startMs) ? fresh.startMs : null,
    provenance,
    checks: checks.map((c) => ({ id: c.id, verdict: c.verdict, summary: c.summary })),
    counts,
  }
  log('')
  log(`VERDICT: ${verdict}  (PASS=${counts.PASS} FAIL=${counts.FAIL} UNKNOWN=${counts.UNKNOWN}, exit ${exitCode})`)
  log(`PROBE_PROVENANCE_JSON ${JSON.stringify(provenance)}`)
  log(`PROBE_SUMMARY_JSON ${JSON.stringify(summary)}`)

  mkdirSync(opts.out, { recursive: true })
  const stamp = outStamp()
  const logPath = join(opts.out, `probe-${stamp}.log`)
  const jsonPath = join(opts.out, `probe-${stamp}.json`)
  writeFileSync(logPath, `${logLines.join('\n')}\n`)
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`log:  ${logPath}\njson: ${jsonPath}\n`)
  return exitCode
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stdout.write(`probe crashed: ${err?.stack ?? err}\n`)
  process.exit(3)
})
