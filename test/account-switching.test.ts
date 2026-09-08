import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountPoolManager } from '../src/host/pool.ts'

test('FIX VERIFIED: selectAccount does NOT overwrite pool.json on disk during temporary cooldown failover (FR-07, AC-07)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-pool-fix-disk-'))
  const pool = new AccountPoolManager(dir)

  // Account A exists by default (acc_primary).
  // Add user preferred account B
  const accB = pool.createAccountSlot('User Preferred Account B')
  
  // User sets account B as primary
  pool.setPrimaryAccount(accB.id)

  // Verify initial state: account B is active and persisted to pool.json
  assert.equal(pool.selectAccount('google')?.id, accB.id)
  const poolJsonInitial = JSON.parse(readFileSync(join(dir, 'pool.json'), 'utf8'))
  assert.equal(poolJsonInitial.activeAccountIds?.google, accB.id)
  assert.equal(poolJsonInitial.primaryAccountId, accB.id)

  // Account B encounters a temporary rate limit cooldown
  pool.recordFailure(accB.id, 'google', 'rate_limit', new Date(Date.now() + 5000).toISOString())

  // Runtime failover selects Account A
  const failoverAcc = pool.selectAccount('google')
  assert.equal(failoverAcc?.id, 'acc_primary')

  // FIX VERIFICATION: pool.json on disk was NOT overwritten during failover!
  const poolJsonAfterFailover = JSON.parse(readFileSync(join(dir, 'pool.json'), 'utf8'))
  assert.equal(
    poolJsonAfterFailover.activeAccountIds?.google,
    accB.id,
    'FIX VERIFIED: pool.json activeAccountIds.google remains accB.id on disk, NOT overwritten!',
  )
  assert.equal(
    poolJsonAfterFailover.primaryAccountId,
    accB.id,
    'FIX VERIFIED: primaryAccountId remains accB.id on disk!',
  )
})

test('Pin Locking Mechanism: pinned account takes precedence and auto-recovers after cooldown (FR-07, AC-08)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-pool-pin-'))
  const pool = new AccountPoolManager(dir)

  const accB = pool.createAccountSlot('Pinned Account B')
  const accC = pool.createAccountSlot('Backup Account C')

  // User pins account B
  pool.pinAccount(accB.id)
  assert.equal(pool.getPinnedAccount()?.id, accB.id)

  // Initial selection uses pinned account B
  assert.equal(pool.selectAccount('google')?.id, accB.id)

  // Account B hits temporary cooldown
  pool.recordFailure(accB.id, 'google', '429 Rate Limit', new Date(Date.now() + 10_000).toISOString())

  // While in cooldown, runtime temporarily fails over to another healthy candidate
  const failover = pool.selectAccount('google')
  assert.ok(failover && failover.id !== accB.id, 'Fails over to alternative account during cooldown')

  // Cooldown on B is cleared / expires
  pool.clearCooldown(accB.id, 'google')

  // Immediately auto-recovers back to the pinned account B!
  const recovered = pool.selectAccount('google')
  assert.equal(recovered?.id, accB.id, 'Pinned account B is immediately restored once cooldown passes')

  // Unpinning account restores normal behavior
  pool.pinAccount(null)
  assert.equal(pool.getPinnedAccount(), null)
})
