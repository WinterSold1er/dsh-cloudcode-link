// Wiring proof for the scope-aware re-auth verdict.
//
// oauth.ts could already compute `needsReauth` / `missingScopes`; what was missing was a
// caller. These tests drive the surfaces a user actually reads — the `/pool` account-list
// payload, `/ccl accounts`, `/ccl status`, `/ccl doctor` — against a real AccountPoolManager
// whose account homes hold real credential documents, and assert BOTH directions: a token
// with no recorded grant is flagged with the missing scope plus `/ccl auth`, a token with the
// full grant is not. An always-true or hardcoded implementation cannot pass this.
//
// HOME is redirected to a sandbox for the duration so the pool's system-home account is
// judged by these fixtures and not by whoever happens to run the suite.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AGY_SCOPES, writeAgyTokenFile } from '../src/host/oauth.ts'
import { describePoolAuthHealth, reauthGuidanceFor, reauthGuidanceResolver } from '../src/host/account-health.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { renderAccountPool, renderStatus, type CommandDeps } from '../src/host/commands.ts'
import { writeDoctorReport } from '../src/host/diagnostics.ts'
import { defaultConfig } from '../src/common/types.ts'

const AICODE = 'https://www.googleapis.com/auth/aicode'
const REAL_HOME = process.env.HOME ?? ''
const REAL_DSH_HOME = process.env.DSH_HOME

interface Fixture {
  pool: AccountPoolManager
  base: string
  home: string
  dshHome: string
  legacyId: string
  grantedId: string
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'acct-wiring-pool-'))
  const home = mkdtempSync(join(tmpdir(), 'acct-wiring-home-'))
  const dshHome = mkdtempSync(join(tmpdir(), 'acct-wiring-dsh-'))
  process.env.HOME = home
  process.env.DSH_HOME = dshHome

  const pool = new AccountPoolManager(base)
  const legacy = pool.createAccountSlot('legacy-token')
  const granted = pool.createAccountSlot('full-token')

  // The legacy slot is exactly what an older install leaves behind: a working token,
  // no scope record at all.
  writeAgyTokenFile(legacy.dir, { access_token: 'ya29.legacy', refresh_token: 'rt-legacy' })
  writeAgyTokenFile(granted.dir, {
    access_token: 'ya29.full',
    refresh_token: 'rt-full',
    grantedScopes: [...AGY_SCOPES],
  })
  // The pool's system-home account resolves to $HOME, which is this sandbox.
  writeAgyTokenFile(home, {
    access_token: 'ya29.system',
    refresh_token: 'rt-system',
    grantedScopes: [...AGY_SCOPES],
  })

  return { pool, base, home, dshHome, legacyId: legacy.id, grantedId: granted.id }
}

function destroyFixture(fixture: Fixture): void {
  rmSync(fixture.base, { recursive: true, force: true })
  rmSync(fixture.home, { recursive: true, force: true })
  rmSync(fixture.dshHome, { recursive: true, force: true })
  process.env.HOME = REAL_HOME
  if (REAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = REAL_DSH_HOME
}

function depsOf(fixture: Fixture): CommandDeps {
  return {
    cfg: () => defaultConfig(),
    auth: () => null,
    catalog: () =>
      new ModelCatalog(undefined, [{ id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen High' }], 60_000),
    pool: () => fixture.pool,
    lastRun: () => null,
    setOverride: () => {},
    runDoctor: async () => join(fixture.dshHome, 'doctor.txt'),
  }
}

/** The block of lines `/ccl accounts` prints for one account alias. */
function rowsOf(output: string, alias: string): string[] {
  const lines = output.split('\n')
  const start = lines.findIndex((line) => line.includes(`**${alias}**`))
  assert.notEqual(start, -1, `account ${alias} must be listed. Output was:\n${output}`)
  const rows: string[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    if (i > start && /^\d+\.\s+\*\*/.test(line)) break
    rows.push(line)
  }
  return rows
}

test('the account-list route serves the pool through describePoolAuthHealth', () => {
  const indexSource = readFileSync(join(import.meta.dirname, '../src/index.ts'), 'utf8')
  assert.match(
    indexSource,
    /regBoth\('pool',\s*\(_req,\s*res\)\s*=>\s*\{[\s\S]{0,400}?describePoolAuthHealth\(pool\.getPoolData\(\)\)/,
    'src/index.ts must publish the account list through describePoolAuthHealth, not raw pool data',
  )
})

test('the pool payload flags the under-scoped account and leaves the fully granted one alone', () => {
  const fixture = makeFixture()
  try {
    const raw = fixture.pool.getPoolData()
    const payload = describePoolAuthHealth(raw)

    assert.equal(payload.accounts.length, raw.accounts.length, 'no account may be dropped from the list')
    assert.ok(payload.accounts.every((a) => a.enabled), 'a scope gap must not disable an account')
    assert.ok(payload.accounts.every((a) => !a.authRequired), 'the verdict must not flip account state')
    assert.equal(payload.accountsNeedingReauth, 1, 'exactly the legacy token needs re-auth')

    const legacy = payload.accounts.find((a) => a.id === fixture.legacyId)!
    const granted = payload.accounts.find((a) => a.id === fixture.grantedId)!

    assert.equal(legacy.reauthRequired, true)
    assert.deepEqual(legacy.missingScopes, [AICODE])
    assert.equal(granted.reauthRequired, false)
    assert.deepEqual(granted.missingScopes, [])
  } finally {
    destroyFixture(fixture)
  }
})

test('/ccl accounts names the missing scope and the command, only for the account that needs it', () => {
  const fixture = makeFixture()
  try {
    const output = renderAccountPool(depsOf(fixture))
    assert.ok(output, 'the renderer must produce a listing for a configured pool')

    const legacyRows = rowsOf(output, 'legacy-token')
    const grantedRows = rowsOf(output, 'full-token')

    assert.ok(
      legacyRows.some((line) => line.includes('/ccl auth')),
      `the under-scoped account must be told to re-authorize:\n${legacyRows.join('\n')}`,
    )
    assert.ok(
      legacyRows.some((line) => line.includes('auth/aicode')),
      `the row must name the missing scope:\n${legacyRows.join('\n')}`,
    )
    assert.ok(
      legacyRows.some((line) => line.includes('仍在池中')),
      `the row must say the account stays usable:\n${legacyRows.join('\n')}`,
    )

    assert.ok(
      !grantedRows.some((line) => line.includes('/ccl auth')),
      `a fully authorized account must not be told to re-authorize:\n${grantedRows.join('\n')}`,
    )
    assert.ok(grantedRows.some((line) => line.includes('Status: 🟢 Ready')))
  } finally {
    destroyFixture(fixture)
  }
})

test('/ccl accounts still lists cooldowns and quota next to the new verdict', () => {
  const fixture = makeFixture()
  try {
    fixture.pool.recordFailure(fixture.grantedId, 'google', 'Rate limit 429', '120')
    const output = renderAccountPool(depsOf(fixture))!
    const grantedRows = rowsOf(output, 'full-token')
    assert.ok(grantedRows.some((line) => line.includes('google cooldown')), grantedRows.join('\n'))
    assert.ok(!grantedRows.some((line) => line.includes('Status: 🟢 Ready')), grantedRows.join('\n'))
    assert.ok(!grantedRows.some((line) => line.includes('/ccl auth')), grantedRows.join('\n'))
  } finally {
    destroyFixture(fixture)
  }
})

test('/ccl status counts the accounts whose grant is too narrow — and says nothing when none do', async () => {
  const fixture = makeFixture()
  try {
    const status = await renderStatus(depsOf(fixture))
    assert.match(status, /需要重新授权: 1 个账号/, status)
    assert.ok(status.includes('/ccl auth'), status)
  } finally {
    destroyFixture(fixture)
  }

  // Control: the same pool with every credential document fully granted must not warn.
  const fixed = makeFixture()
  try {
    writeAgyTokenFile(fixed.pool.getAccounts().find((a) => a.id === fixed.legacyId)!.dir, {
      access_token: 'ya29.fixed',
      refresh_token: 'rt-fixed',
      grantedScopes: [...AGY_SCOPES],
    })
    const status = await renderStatus(depsOf(fixed))
    assert.ok(!status.includes('需要重新授权'), `no account needs re-auth here:\n${status}`)
    assert.ok(status.includes('pool accounts:'), status)
  } finally {
    destroyFixture(fixed)
  }
})

test('/ccl doctor records the same verdict in the report file it writes', () => {
  const fixture = makeFixture()
  try {
    const file = writeDoctorReport({
      cfg: () => defaultConfig(),
      catalog: () =>
        new ModelCatalog(undefined, [{ id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen High' }], 60_000),
      pool: () => fixture.pool,
    })
    const report = readFileSync(file, 'utf8')
    const legacyLine = report.split('\n').find((line) => line.includes(fixture.legacyId))
    const grantedLine = report.split('\n').find((line) => line.includes(fixture.grantedId))
    assert.ok(legacyLine && grantedLine, `both accounts must appear in the report:\n${report}`)

    assert.ok(legacyLine!.includes('auth/aicode'), legacyLine)
    assert.ok(legacyLine!.includes('/ccl auth'), legacyLine)
    assert.ok(!grantedLine!.includes('/ccl auth'), grantedLine)
    assert.ok(grantedLine!.includes('READY'), grantedLine)
  } finally {
    destroyFixture(fixture)
  }
})

test('the adapter-facing helper turns 401/403 into the re-auth sentence, and nothing else', () => {
  const fixture = makeFixture()
  try {
    const legacy = fixture.pool.getAccounts().find((a) => a.id === fixture.legacyId)!
    const granted = fixture.pool.getAccounts().find((a) => a.id === fixture.grantedId)!

    for (const status of [401, 403]) {
      const text = reauthGuidanceFor(legacy, { status })
      assert.ok(text, `status ${status} on an under-scoped account must produce guidance`)
      assert.ok(text.includes('/ccl auth'), text)
      assert.ok(text.includes('auth/aicode'), text)
      assert.ok(text.includes('legacy-token'), text)
    }

    for (const status of [401, 403]) {
      assert.equal(reauthGuidanceFor(granted, { status }), undefined, `a full grant is not an auth gap (${status})`)
    }
    for (const status of [429, 500, 408, 0]) {
      assert.equal(reauthGuidanceFor(legacy, { status }), undefined, `${status} is not an authorization verdict`)
    }
  } finally {
    destroyFixture(fixture)
  }
})

test('the per-attempt resolver answers from each account’s recorded grant', () => {
  const fixture = makeFixture()
  try {
    const resolve = reauthGuidanceResolver((accountId) =>
      fixture.pool.getAccounts().find((a) => a.id === accountId),
    )

    const legacy403 = resolve(fixture.legacyId, { httpStatus: 403 })
    assert.ok(legacy403, 'a 403 on an under-scoped account must be reported as a scope gap')
    assert.ok(legacy403.includes('/ccl auth'), legacy403)
    assert.ok(legacy403.includes('auth/aicode'), legacy403)
    assert.ok(legacy403.includes('legacy-token'), legacy403)

    assert.ok(resolve(fixture.legacyId, { httpStatus: 401 }), '401 on the same account is also a gap')

    // The same status on a fully granted account is not an authorization gap.
    assert.equal(resolve(fixture.grantedId, { httpStatus: 403 }), undefined)
    assert.equal(resolve(fixture.grantedId, { httpStatus: 401 }), undefined)

    // Not every failure has an HTTP answer, and not every account exists.
    assert.equal(resolve(fixture.legacyId, { httpStatus: null }), undefined)
    assert.equal(resolve(fixture.legacyId, { httpStatus: 429 }), undefined)
    assert.equal(resolve('acc-not-in-the-pool', { httpStatus: 401 }), undefined)
  } finally {
    destroyFixture(fixture)
  }
})

test('the registration hands the resolver to the adapter instead of leaving the 403 verdict to it', () => {
  const indexSource = readFileSync(join(import.meta.dirname, '../src/index.ts'), 'utf8')
  assert.match(
    indexSource,
    /reauthGuidanceFor:\s*reauthGuidanceResolver\(\(accountId\)\s*=>[\s\S]{0,160}?pool\.getAccounts\(\)\.find/,
    'src/index.ts must inject the account-health resolver into AgyAdapter deps',
  )
})
