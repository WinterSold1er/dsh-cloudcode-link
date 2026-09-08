import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AccountPoolManager, defaultPoolDir } from '../src/host/pool.ts'
import { SessionStore } from '../src/host/sessions.ts'
import { convertMessages, sanitizeTopology } from '../src/host/message-converter.ts'
import { QuotaService } from '../src/host/quota.ts'
import { dshHome } from '../src/common/config.ts'
import { defaultConfig } from '../src/common/types.ts'
import type { Message } from '@deepseek-ai/dsh-llm'

describe('Comprehensive Remediation Verification: 8 Issues', () => {
  // --------------------------------------------------------------------------
  // Issue 1: Priority Inversion: Pin > Session Affinity > Sticky Sequential & Auto-recovery
  // --------------------------------------------------------------------------
  describe('Issue 1: Arbitration Priority (Pin > Session Affinity > Sequential) & Cooldown Recovery', () => {
    it('Pin takes precedence over Session Affinity, and auto-recovers when cooldown expires', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-test-issue1-'))
      const pool = new AccountPoolManager(dir)

      const accA = pool.getAccounts()[0]! // primary / pinned candidate
      pool.setAccountAlias(accA.id, 'Account A (Pinned)')
      const accB = pool.createAccountSlot('Account B (Affinity Target)')

      pool.setMemoryToken(accA.id, 'tok-a', Date.now() + 3600_000)
      pool.setMemoryToken(accB.id, 'tok-b', Date.now() + 3600_000)

      // Pin Account A
      pool.pinAccount(accA.id)
      assert.equal(pool.getPinnedAccount()?.id, accA.id)

      // Set up SessionStore where session-1 was previously bound to Account B
      const sessionStore = new SessionStore(join(dir, 'sessions.json'))
      sessionStore.bindAccount('session-1', accB.id)
      assert.equal(sessionStore.getBoundAccount('session-1'), accB.id)

      let lastUsedAuthHeader = ''
      const server = createServer((req, res) => {
        lastUsedAuthHeader = req.headers['authorization'] || ''
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: ' + JSON.stringify({
          response: {
            candidates: [{
              content: { role: 'model', parts: [{ text: 'OK' }] },
              finishReason: 'STOP',
            }],
          },
        }) + '\n\n')
        res.end()
      })

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve())
      })
      const port = (server.address() as { port: number }).port
      const endpoint = `http://127.0.0.1:${port}`

      try {
        const catalog = new ModelCatalog(undefined, [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }], 60_000)
        const adapter = new AgyAdapter({
          getConfig: () => defaultConfig(),
          catalog,
          pool,
          sessionStore,
          endpointCandidates: [endpoint],
        })

        // --- Turn 1: Account A is pinned and healthy.
        // Even though session-1 is bound to Account B, Pin takes precedence over Session Affinity!
        const msgs: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'Turn 1' }] } as any]
        for await (const _ of adapter.stream({
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          messages: msgs,
          sessionId: 'session-1' as any,
        })) {}

        assert.equal(lastUsedAuthHeader, 'Bearer tok-a', 'Turn 1: Pinned Account A must override bound Account B')
        assert.equal(sessionStore.getBoundAccount('session-1'), accA.id, 'Session must rebind to Pinned Account A')

        // --- Turn 2: Account A goes into temporary cooldown.
        pool.recordFailure(accA.id, 'google', 'rate_limit', new Date(Date.now() + 5000).toISOString())
        assert.equal(pool.isAccountHealthy(accA, 'google'), false, 'Account A is in cooldown')

        // Now Pin is not healthy. Adapter falls through to Session Affinity / Sequential -> picks Account B
        for await (const _ of adapter.stream({
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          messages: msgs,
          sessionId: 'session-1' as any,
        })) {}

        assert.equal(lastUsedAuthHeader, 'Bearer tok-b', 'Turn 2: Failover to Account B while Account A is cooling down')
        assert.equal(sessionStore.getBoundAccount('session-1'), accB.id, 'Session affinity temporarily binds to Account B')

        // --- Turn 3: Account A recovers from cooldown.
        pool.clearCooldown(accA.id, 'google')
        assert.equal(pool.isAccountHealthy(accA, 'google'), true, 'Account A is healthy again')

        // Priority check: Pin (Account A) > Session Affinity (Account B)!
        // Must automatically switch back to Account A!
        for await (const _ of adapter.stream({
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          messages: msgs,
          sessionId: 'session-1' as any,
        })) {}

        assert.equal(lastUsedAuthHeader, 'Bearer tok-a', 'Turn 3: Automatically recovered to Pinned Account A!')
        assert.equal(sessionStore.getBoundAccount('session-1'), accA.id, 'Session affinity rebound back to Pinned Account A')
      } finally {
        server.close()
      }
    })
  })

  // --------------------------------------------------------------------------
  // Issue 2: Empty reasoning model turn converts to placeholder `(thought omitted)`
  // --------------------------------------------------------------------------
  describe('Issue 2: Discarded Unsigned Reasoning Protected by Placeholder', () => {
    it('convertMessages fills placeholder when model reasoning lacks valid signature', async () => {
      const msgs: Message[] = [
        {
          id: '1' as any,
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        } as any,
        {
          id: '2' as any,
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'Internal thinking without signature',
            } as any,
          ],
        } as any,
        {
          id: '3' as any,
          role: 'user',
          content: [{ type: 'text', text: 'Next question' }],
        } as any,
      ]

      const converted = await convertMessages(msgs)
      // Must maintain alternating turns: user -> model -> user
      assert.equal(converted.length, 3, 'Must maintain 3 turns and not collapse model turn')
      assert.equal(converted[0]!.role, 'user')
      assert.equal(converted[1]!.role, 'model')
      assert.equal(converted[2]!.role, 'user')

      const modelParts = converted[1]!.parts
      assert.equal(modelParts.length, 1)
      assert.equal((modelParts[0] as any).text, '(thought omitted)')
    })

    it('sanitizeTopology fills placeholder when all thoughts in a model turn are stripped', () => {
      const input = [
        {
          role: 'user' as const,
          parts: [{ text: 'Question' }],
        },
        {
          role: 'model' as const,
          parts: [
            { thought: true as const, text: 'No signature 1' },
            { thought: true as const, text: 'No signature 2' },
          ],
        },
        {
          role: 'user' as const,
          parts: [{ text: 'Follow up' }],
        },
      ]

      const sanitized = sanitizeTopology(input)
      assert.equal(sanitized.length, 3, 'Must not drop model turn or create consecutive user turns')
      assert.equal(sanitized[0]!.role, 'user')
      assert.equal(sanitized[1]!.role, 'model')
      assert.equal(sanitized[2]!.role, 'user')

      const modelPart = sanitized[1]!.parts[0] as any
      assert.equal(modelPart.text, '(thought omitted)')
    })
  })

  // --------------------------------------------------------------------------
  // Issue 3: Orphan functionResponse safely degrades to text observation block
  // --------------------------------------------------------------------------
  describe('Issue 3: Alignment with Gemini Protocol for functionResponse', () => {
    it('preserves paired functionResponse and safely degrades orphan functionResponse', () => {
      const input = [
        {
          role: 'user' as const,
          parts: [{ text: 'Run tools' }],
        },
        {
          role: 'model' as const,
          parts: [
            { functionCall: { id: 'call_valid', name: 'search', args: { q: 'test' } } },
          ],
        },
        {
          role: 'user' as const,
          parts: [
            {
              functionResponse: {
                id: 'call_valid',
                name: 'search',
                response: { output: 'search result' },
              },
            },
            {
              functionResponse: {
                id: 'unmatched_call',
                name: 'calculator',
                response: { output: '42' },
              },
            },
            {
              functionResponse: {
                id: 'error_call',
                name: 'bash',
                response: { error: 'command not found' },
              },
            },
          ],
        },
      ]

      const sanitized = sanitizeTopology(input)
      assert.equal(sanitized.length, 3)

      const userParts = sanitized[2]!.parts
      assert.equal(userParts.length, 3)

      // 1. Paired functionResponse preserved as structured object
      assert.ok('functionResponse' in userParts[0]!)
      assert.equal((userParts[0] as any).functionResponse.name, 'search')
      assert.deepEqual((userParts[0] as any).functionResponse.response, { output: 'search result' })

      // 2. Orphan calculator degraded to text observation block
      assert.equal('functionResponse' in userParts[1]!, false)
      assert.equal((userParts[1] as any).text, '[Observation from `calculator`:\n42]')

      // 3. Orphan bash with error degraded to text observation block
      assert.equal('functionResponse' in userParts[2]!, false)
      assert.equal((userParts[2] as any).text, '[Observation from `bash`:\ncommand not found]')
    })

    it('safely degrades functionResponse when there is no preceding model turn (history truncation)', () => {
      const input = [
        {
          role: 'user' as const,
          parts: [
            {
              functionResponse: {
                name: 'read_file',
                response: { output: 'content' },
              },
            },
          ],
        },
      ]

      const sanitized = sanitizeTopology(input)
      assert.equal(sanitized.length, 1)
      assert.equal('functionResponse' in sanitized[0]!.parts[0]!, false)
      assert.equal((sanitized[0]!.parts[0] as any).text, '[Observation from `read_file`:\ncontent]')
    })
  })

  // --------------------------------------------------------------------------
  // Issue 4: Disabling account clears Pin state & Pinning disabled account rejected
  // --------------------------------------------------------------------------
  describe('Issue 4: Pin State Consistency on Account Disable / Pin Validation', () => {
    it('disabling a pinned account clears pinned state from pool and account', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-test-issue4-'))
      const pool = new AccountPoolManager(dir)

      const accB = pool.createAccountSlot('Account B')
      const pinnedOk = pool.pinAccount(accB.id)
      assert.equal(pinnedOk, true)
      assert.equal(pool.getPinnedAccount()?.id, accB.id)

      // Disable the pinned account
      const disableOk = pool.setAccountEnabled(accB.id, false)
      assert.equal(disableOk, true)

      // Pinned state must be wiped clean
      assert.equal(pool.getPinnedAccount(), null)
      assert.equal((pool as any).data.pinnedAccountId, undefined)
      const reloadedAcc = pool.getAccount(accB.id)
      assert.equal(reloadedAcc?.enabled, false)
      assert.equal(reloadedAcc?.pinned, undefined)
    })

    it('pinAccount rejects disabled account and returns false', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-test-issue4-disabled-'))
      const pool = new AccountPoolManager(dir)

      const accB = pool.createAccountSlot('Disabled Account B')
      pool.setAccountEnabled(accB.id, false)

      const pinResult = pool.pinAccount(accB.id)
      assert.equal(pinResult, false, 'Must reject pinning a disabled account')
      assert.equal(pool.getPinnedAccount(), null)
    })
  })

  // --------------------------------------------------------------------------
  // Issue 5: SessionStore Temp File PID+Timestamp and 0o600 Mode
  // --------------------------------------------------------------------------
  describe('Issue 5: SessionStore Concurrency & File Permissions', () => {
    it('persists session file with mode 0o600', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-test-issue5-'))
      const sessionFile = join(dir, 'sessions.json')
      const store = new SessionStore(sessionFile)

      store.bindAccount('session-abc', 'acc_123')

      const stat = statSync(sessionFile)
      // Check 0o600 permissions
      assert.equal(stat.mode & 0o777, 0o600, 'sessions.json file must have 0o600 permissions')

      // Verify nextStep advances atomically and maintains 0o600
      store.nextStep('session-abc')
      const stat2 = statSync(sessionFile)
      assert.equal(stat2.mode & 0o777, 0o600)
    })
  })

  // --------------------------------------------------------------------------
  // Issue 6: OAuth Token File Persistence with 0o600 Mode and chmodSync
  // --------------------------------------------------------------------------
  describe('Issue 6: OAuth Token File 0o600 Permissions', () => {
    it('persistRefreshedToken sets token file permissions to 0o600', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-test-issue6-'))
      const pool = new AccountPoolManager(dir)
      const quota = new QuotaService(pool)

      const acc = pool.createAccountSlot('Secondary Acc')
      const tokenFile = join(acc.dir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')

      ;(quota as any).persistRefreshedToken(acc, {
        access_token: 'test-new-access-token',
        expiryMs: Date.now() + 3600_000,
      })

      const stat = statSync(tokenFile)
      assert.equal(stat.mode & 0o777, 0o600, 'Token file must have 0o600 permissions')
    })
  })

  // --------------------------------------------------------------------------
  // Issue 7: AccountPoolManager.isAccountHealthy Public Method & Deduplication
  // --------------------------------------------------------------------------
  describe('Issue 7: Public isAccountHealthy Method', () => {
    it('isAccountHealthy handles all restriction states accurately', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-test-issue7-'))
      const pool = new AccountPoolManager(dir)
      const acc = pool.getAccounts()[0]!

      // 1. Initial: healthy
      assert.equal(pool.isAccountHealthy(acc, 'google'), true)

      // 2. Disabled
      pool.setAccountEnabled(acc.id, false)
      assert.equal(pool.isAccountHealthy(acc, 'google'), false)
      pool.setAccountEnabled(acc.id, true)
      assert.equal(pool.isAccountHealthy(acc, 'google'), true)

      // 3. Auth required
      pool.markAuthRequired(acc.id, 'revoked')
      assert.equal(pool.isAccountHealthy(acc, 'google'), false)
      pool.clearAuthRequired(acc.id)
      assert.equal(pool.isAccountHealthy(acc, 'google'), true)

      // 4. Cooldown
      pool.recordFailure(acc.id, 'google', 'rate_limit', new Date(Date.now() + 10_000).toISOString())
      assert.equal(pool.isAccountHealthy(acc, 'google'), false)
      pool.clearCooldown(acc.id, 'google')
      assert.equal(pool.isAccountHealthy(acc, 'google'), true)

      // 5. 5h Quota exhaustion
      pool.updateAccountQuotas(acc.id, {
        google: {
          remainingFraction: 0.01,
          resetTime: new Date(Date.now() + 60_000).toISOString(),
        },
      })
      assert.equal(pool.isAccountHealthy(acc, 'google'), false)

      // Reset in past -> healthy
      pool.updateAccountQuotas(acc.id, {
        google: {
          remainingFraction: 0.01,
          resetTime: new Date(Date.now() - 60_000).toISOString(),
        },
      })
      assert.equal(pool.isAccountHealthy(acc, 'google'), true)

      // 6. Weekly Quota exhaustion
      pool.updateAccountQuotas(acc.id, {
        google: {
          remainingFraction: 0.5,
          weeklyFraction: 0.005,
          weeklyResetTime: new Date(Date.now() + 60_000).toISOString(),
        },
      })
      assert.equal(pool.isAccountHealthy(acc, 'google'), false)
    })
  })

  // --------------------------------------------------------------------------
  // Issue 8: Canonical Base Directory Resolution
  // --------------------------------------------------------------------------
  describe('Issue 8: Canonical Base Directory Resolution', () => {
    it('dshHome honors DSH_HOME and DSH_STATE_DIR, and defaultPoolDir aligns', () => {
      const origHome = process.env.DSH_HOME
      const origState = process.env.DSH_STATE_DIR

      try {
        delete process.env.DSH_HOME
        process.env.DSH_STATE_DIR = '/custom/dsh/state'
        assert.equal(dshHome(), '/custom/dsh/state')
        assert.equal(defaultPoolDir(), '/custom/dsh/state/agy-accounts')

        process.env.DSH_HOME = '/priority/dsh/home'
        assert.equal(dshHome(), '/priority/dsh/home')
        assert.equal(defaultPoolDir(), '/priority/dsh/home/agy-accounts')
      } finally {
        if (origHome !== undefined) process.env.DSH_HOME = origHome
        else delete process.env.DSH_HOME
        if (origState !== undefined) process.env.DSH_STATE_DIR = origState
        else delete process.env.DSH_STATE_DIR
      }
    })
  })
})
