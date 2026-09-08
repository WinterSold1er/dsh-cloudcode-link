import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fnv1a64Signed, SessionStore } from '../src/host/sessions.ts'
import { antigravityRequestEnvelope } from '../src/host/client.ts'
import { convertMessages, sanitizeTopology, isValidThoughtSignature } from '../src/host/message-converter.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AccountPoolManager, defaultPoolDir } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'
import { dshHome } from '../src/common/config.ts'
import { defaultConfig } from '../src/common/types.ts'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

describe('QA Adversarial Verification Suite: Boundary, Failure Paths & Externalized Config', () => {
  // ==========================================================================
  // Group 1: Configuration Externalization & Environment Isolation
  // ==========================================================================
  describe('Group 1: Configuration Externalization & Non-Functional Resilience', () => {
    it('C1: DSH_HOME & DSH_STATE_DIR dynamic override correctly directs persistence path and permissions', () => {
      const origHome = process.env.DSH_HOME
      const origState = process.env.DSH_STATE_DIR

      const tempDirA = mkdtempSync(join(tmpdir(), 'qa-dsh-home-'))
      const tempDirB = mkdtempSync(join(tmpdir(), 'qa-dsh-state-'))

      try {
        // Priority test: DSH_HOME takes precedence
        process.env.DSH_HOME = tempDirA
        process.env.DSH_STATE_DIR = tempDirB
        assert.equal(dshHome(), tempDirA, 'DSH_HOME must have highest precedence')
        assert.equal(defaultPoolDir(), join(tempDirA, 'agy-accounts'))

        // Fallback test: DSH_STATE_DIR takes over when DSH_HOME is absent
        delete process.env.DSH_HOME
        assert.equal(dshHome(), tempDirB, 'DSH_STATE_DIR must take over when DSH_HOME is missing')
        assert.equal(defaultPoolDir(), join(tempDirB, 'agy-accounts'))

        // AccountPoolManager bootstraps securely in externalized dir
        const pool = new AccountPoolManager(defaultPoolDir())
        const dirStat = statSync(defaultPoolDir())
        assert.equal(dirStat.mode & 0o777, 0o700, 'Pool base directory must be strictly 0o700')

        const poolJsonStat = statSync(join(defaultPoolDir(), 'pool.json'))
        assert.equal(poolJsonStat.mode & 0o666, 0o600, 'pool.json file must be strictly 0o600')
      } finally {
        if (origHome !== undefined) process.env.DSH_HOME = origHome
        else delete process.env.DSH_HOME
        if (origState !== undefined) process.env.DSH_STATE_DIR = origState
        else delete process.env.DSH_STATE_DIR
        rmSync(tempDirA, { recursive: true, force: true })
        rmSync(tempDirB, { recursive: true, force: true })
      }
    })

    it('C2: ANTIGRAVITY_TOKEN external env override takes immediate precedence over pool and cleans up cleanly', async () => {
      const origEnvToken = process.env.ANTIGRAVITY_TOKEN
      const tempDir = mkdtempSync(join(tmpdir(), 'qa-env-token-'))

      try {
        const pool = new AccountPoolManager(tempDir)
        const acc = pool.getAccounts()[0]!
        pool.setMemoryToken(acc.id, 'memory-pool-token', Date.now() + 3600_000)

        const quota = new QuotaService(pool)

        // Case 1: Without env override, resolves memory token
        delete process.env.ANTIGRAVITY_TOKEN
        const token1 = await quota.getValidAccessToken(acc)
        assert.equal(token1, 'memory-pool-token')

        // Case 2: External env override injected
        process.env.ANTIGRAVITY_TOKEN = 'external-env-override-token'
        const token2 = await quota.getValidAccessToken(acc)
        assert.equal(
          token2,
          'external-env-override-token',
          'External ANTIGRAVITY_TOKEN must take precedence over memory/disk token',
        )

        // Case 3: External env removed -> reverts to memory token
        delete process.env.ANTIGRAVITY_TOKEN
        const token3 = await quota.getValidAccessToken(acc)
        assert.equal(token3, 'memory-pool-token', 'Reverts to pool token when env is cleared')
      } finally {
        if (origEnvToken !== undefined) process.env.ANTIGRAVITY_TOKEN = origEnvToken
        else delete process.env.ANTIGRAVITY_TOKEN
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('C3: Multi-endpoint external configuration failover without hardcoded addresses', async () => {
      let endpoint1Hits = 0
      let endpoint2Hits = 0

      // Server 1: Dead / 500 error endpoint
      const server1 = createServer((req, res) => {
        endpoint1Hits++
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server 1 internal error' }))
      })
      // Server 2: Healthy backup endpoint handling loadCodeAssist and streamGenerateContent
      const server2 = createServer((req, res) => {
        endpoint2Hits++
        const url = req.url || ''
        if (url.includes('loadCodeAssist')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ cloudaicompanionProject: { id: 'mock-healthy-project' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"response":{"candidates":[{"content":{"parts":[{"text":"Server 2 success"}]}}]}}\n\n')
        res.write('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n')
        res.end()
      })

      await Promise.all([
        new Promise<void>((r) => server1.listen(0, '127.0.0.1', r)),
        new Promise<void>((r) => server2.listen(0, '127.0.0.1', r)),
      ])

      const port1 = (server1.address() as { port: number }).port
      const port2 = (server2.address() as { port: number }).port
      const endpoint1 = `http://127.0.0.1:${port1}`
      const endpoint2 = `http://127.0.0.1:${port2}`

      try {
        const tempDir = mkdtempSync(join(tmpdir(), 'qa-endpoint-failover-'))
        const pool = new AccountPoolManager(tempDir)
        const acc = pool.getAccounts()[0]!
        pool.setMemoryToken(acc.id, 'tok-valid', Date.now() + 3600_000)

        const sessionStore = new SessionStore(join(tempDir, 'sessions.json'))
        const catalog = new ModelCatalog(undefined, [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }], 60_000)

        // Inject custom external endpoints
        const adapter = new AgyAdapter({
          getConfig: () => ({
            ...defaultConfig(),
            endpointCandidates: [endpoint1, endpoint2],
          }),
          catalog,
          pool,
          sessionStore,
          endpointCandidates: [endpoint1, endpoint2],
        })

        const options: GenerateOptions = {
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          sessionId: 'test-endpoint-failover' as any,
          messages: [{ id: '1' as any, role: 'user', content: [{ type: 'text', text: 'Ping' }] } as any],
        }

        const chunks: StreamChunk[] = []
        for await (const chunk of adapter.stream(options)) {
          chunks.push(chunk)
        }

        assert.ok(endpoint1Hits >= 1, 'Endpoint 1 must have been attempted')
        assert.ok(endpoint2Hits >= 1, 'Endpoint 2 must have successfully handled request after failover')
        const deltaChunks = chunks.filter((c) => c.type === 'text-delta')
        assert.ok(deltaChunks.length > 0, 'Must produce stream chunks from successful endpoint')
        assert.equal((deltaChunks[0] as any).text, 'Server 2 success')
      } finally {
        server1.close()
        server2.close()
      }
    })
  })

  // ==========================================================================
  // Group 2: Root Causes 1-6 (AC-01 to AC-06) Boundary & Extreme Conditions
  // ==========================================================================
  describe('Group 2: Cache Hit Rate Root Causes Boundary & Resilience (AC-01 to AC-06)', () => {
    it('AC-01: fnv1a64Signed boundary handling for empty, huge 100KB, Unicode, and Emoji strings', () => {
      // 1. Empty string boundary
      const emptyHash = fnv1a64Signed('')
      assert.equal(typeof emptyHash, 'string')
      assert.ok(BigInt(emptyHash) >= -(2n ** 63n) && BigInt(emptyHash) <= 2n ** 63n - 1n)
      assert.equal(emptyHash, fnv1a64Signed(''), 'Empty string hash must be deterministic')

      // 2. Huge 100KB payload
      const hugeInput = 'A'.repeat(1024 * 100)
      const hugeHash1 = fnv1a64Signed(hugeInput)
      const hugeHash2 = fnv1a64Signed(hugeInput)
      assert.equal(hugeHash1, hugeHash2, 'Huge 100KB string hash must be deterministic')

      // 3. Multi-byte Unicode and Complex Emojis
      const unicodeInput = '你好世界-こんにちは-안녕하세요-🚀👨‍💻🔥-special-chars-@#$%^&*()'
      const unicodeHash = fnv1a64Signed(unicodeInput)
      assert.equal(unicodeHash, fnv1a64Signed(unicodeInput))
      assert.notEqual(unicodeHash, emptyHash)
    })

    it('AC-01: Session affinity safely switches when bound account becomes disabled or unavailable', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'qa-affinity-failover-'))
      const pool = new AccountPoolManager(tempDir)
      const acc1 = pool.getAccounts()[0]!
      const acc2 = pool.createAccountSlot('Account 2')

      const sessionStore = new SessionStore(join(tempDir, 'sessions.json'))
      sessionStore.bindAccount('session-qa-1', acc1.id)
      assert.equal(sessionStore.getBoundAccount('session-qa-1'), acc1.id)

      // When acc1 is disabled by admin/system
      pool.setAccountEnabled(acc1.id, false)
      assert.equal(pool.isAccountHealthy(acc1, 'google'), false)
      assert.equal(pool.isAccountHealthy(acc2, 'google'), true)

      // Priority arbitration: since bound acc1 is disabled, fall through to selectAccount -> acc2
      const candidate = pool.selectAccount('google')
      assert.equal(candidate?.id, acc2.id, 'Must gracefully advance to healthy account when bound account is disabled')
    })

    it('AC-02: 100-step stress test maintains 100% constant trajectoryId and strict step monotonically incrementing', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'qa-step-100-'))
      const store = new SessionStore(join(tempDir, 'sessions.json'))

      let initialTrajId = ''
      for (let i = 1; i <= 100; i++) {
        const { step, trajectoryId } = store.nextStep('sess-100-turns')
        assert.equal(step, i, `Step index must strictly be ${i}`)
        if (i === 1) {
          initialTrajId = trajectoryId
          assert.ok(initialTrajId.length > 0)
        } else {
          assert.equal(trajectoryId, initialTrajId, `trajectoryId must remain constant at step ${i}`)
        }
      }
    })

    it('AC-03: thoughtSignature invalid signature defense and non-leakage into plain text', async () => {
      // Test matrix of malformed signatures
      assert.equal(isValidThoughtSignature(''), false)
      assert.equal(isValidThoughtSignature(undefined), false)
      assert.equal(isValidThoughtSignature('not-base-64-!!@@'), false)
      assert.equal(isValidThoughtSignature('abc'), false, 'Length not multiple of 4')
      assert.equal(isValidThoughtSignature('YWJjZA=='), true, 'Valid base64')

      // Turn with mixed reasoning blocks: 1 valid, 2 invalid
      const messages: Message[] = [
        { id: '1' as any, role: 'user', content: [{ type: 'text', text: 'Solve riddle' }] } as any,
        {
          id: '2' as any,
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'Valid thoughts with signature',
              thoughtSignature: 'YWJjZA==',
            } as any,
            {
              type: 'reasoning',
              text: 'MALICIOUS_OR_CORRUPT_THOUGHTS_SHOULD_BE_DROPPED',
              thoughtSignature: 'invalid!#@$',
            } as any,
            {
              type: 'reasoning',
              text: 'ANOTHER_UNSIGNED_THOUGHT',
            } as any,
            {
              type: 'text',
              text: 'The answer is 42.',
            },
          ],
        } as any,
      ]

      const converted = await convertMessages(messages)
      assert.equal(converted.length, 2)
      const modelParts = converted[1]!.parts

      // Strictly 2 parts: valid thought part + answer text part.
      // Unsigned/invalid thoughts must NOT be converted to text or appended to text!
      assert.equal(modelParts.length, 2)
      const p0 = modelParts[0] as any
      assert.equal(p0.thought, true)
      assert.equal(p0.thoughtSignature, 'YWJjZA==')
      assert.equal(p0.text, 'Valid thoughts with signature')

      const p1 = modelParts[1] as any
      assert.equal(p1.text, 'The answer is 42.')
      assert.equal('thought' in p1, false)

      // Ensure invalid thought strings never appear anywhere in parts
      const rawJson = JSON.stringify(converted)
      assert.ok(!rawJson.includes('MALICIOUS_OR_CORRUPT_THOUGHTS_SHOULD_BE_DROPPED'))
      assert.ok(!rawJson.includes('ANOTHER_UNSIGNED_THOUGHT'))
    })

    it('AC-03: Model turn with ONLY invalid thoughts converts safely to placeholder and preserves alternating turns', () => {
      const input = [
        { role: 'user' as const, parts: [{ text: 'Question 1' }] },
        {
          role: 'model' as const,
          parts: [
            { thought: true as const, text: 'Thinking 1', thoughtSignature: 'bad-sig-1' },
            { thought: true as const, text: 'Thinking 2' },
          ],
        },
        { role: 'user' as const, parts: [{ text: 'Question 2' }] },
      ]

      const sanitized = sanitizeTopology(input)
      assert.equal(sanitized.length, 3, 'Must maintain 3 turns to prevent user-user collapse')
      assert.equal(sanitized[0]!.role, 'user')
      assert.equal(sanitized[1]!.role, 'model')
      assert.equal(sanitized[2]!.role, 'user')

      const modelParts = sanitized[1]!.parts
      assert.equal(modelParts.length, 1)
      assert.equal((modelParts[0] as any).text, '(thought omitted)')
    })

    it('AC-04: requestId byte-level determinism without Date.now() or Math.random()', () => {
      const traj = 'constant-traj-id'
      const envelopeA = antigravityRequestEnvelope('gemini-3.7-flash', false, { trajectoryId: traj, step: 5 })
      const envelopeB = antigravityRequestEnvelope('gemini-3.7-flash', false, { trajectoryId: traj, step: 5 })

      assert.equal(envelopeA.requestId, 'agent/constant-traj-id/5')
      assert.equal(envelopeA.requestId, envelopeB.requestId)
      assert.equal(envelopeA.labels.last_step_index, '5')
      assert.equal(envelopeA.labels.trajectory_id, traj)
    })

    it('AC-05: systemInstruction strictly strips role user across diverse system inputs', async () => {
      let capturedRequest: any = null
      const server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            capturedRequest = JSON.parse(raw)
          } catch {}
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write('data: {"response":{"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}}\n\n')
          res.write('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n')
          res.end()
        })
      })

      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const port = (server.address() as { port: number }).port

      try {
        const tempDir = mkdtempSync(join(tmpdir(), 'qa-sys-instruction-'))
        const pool = new AccountPoolManager(tempDir)
        const acc = pool.getAccounts()[0]!
        pool.setMemoryToken(acc.id, 'tok-sys', Date.now() + 3600_000)

        const sessionStore = new SessionStore(join(tempDir, 'sessions.json'))
        const catalog = new ModelCatalog(undefined, [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }], 60_000)

        const adapter = new AgyAdapter({
          getConfig: () => defaultConfig(),
          catalog,
          pool,
          sessionStore,
          endpointCandidates: [`http://127.0.0.1:${port}`],
        })

        const testSystems = [
          'Line 1\nLine 2\nLine 3',
          'Special: <system>{"role": "user"}</system>',
          'Minimal single token',
        ]

        for (const sys of testSystems) {
          for await (const _ of adapter.stream({
            provider: 'antigravity',
            model: 'gemini-3.7-flash',
            system: sys,
            sessionId: 'sess-sys' as any,
            messages: [{ id: '1' as any, role: 'user', content: [{ type: 'text', text: 'hi' }] } as any],
          })) {}

          const sysInst = capturedRequest.request.systemInstruction
          assert.ok(sysInst, 'systemInstruction must exist')
          assert.equal(sysInst.role, undefined, 'systemInstruction.role MUST be undefined (no role user allowed)')
          assert.deepEqual(sysInst.parts, [{ text: sys }])
        }
      } finally {
        server.close()
      }
    })

    it('AC-06: Out-of-order, mixed, and complex payload orphan functionResponses safely degrade to observation blocks', () => {
      const input = [
        { role: 'user' as const, parts: [{ text: 'Execute tools' }] },
        {
          role: 'model' as const,
          parts: [
            { functionCall: { id: 'call-alpha', name: 'toolAlpha', args: { x: 1 } } },
            { functionCall: { id: 'call-beta', name: 'toolBeta', args: { y: 2 } } },
          ],
        },
        {
          role: 'user' as const,
          parts: [
            // Out of order: Beta comes first, correctly paired
            {
              functionResponse: {
                id: 'call-beta',
                name: 'toolBeta',
                response: { output: 'result beta' },
              },
            },
            // Alpha comes second, correctly paired
            {
              functionResponse: {
                id: 'call-alpha',
                name: 'toolAlpha',
                response: { output: 'result alpha' },
              },
            },
            // Orphan 1: Complex JSON nested object
            {
              functionResponse: {
                id: 'call-orphan-1',
                name: 'orphanComplex',
                response: { deep: { nested: [1, 2, 3] }, flag: true },
              },
            },
            // Orphan 2: Raw string response
            {
              functionResponse: {
                id: 'call-orphan-2',
                name: 'orphanRaw',
                response: 'plain string error' as any,
              },
            },
          ],
        },
      ]

      const sanitized = sanitizeTopology(input)
      const userParts = sanitized[2]!.parts
      assert.equal(userParts.length, 4)

      // Both paired responses are preserved
      assert.equal((userParts[0] as any).functionResponse.name, 'toolBeta')
      assert.equal((userParts[1] as any).functionResponse.name, 'toolAlpha')

      // Orphan 1 degraded to text block containing JSON representation
      assert.equal('functionResponse' in userParts[2]!, false)
      assert.ok((userParts[2] as any).text.startsWith('[Observation from `orphanComplex`:\n'))
      assert.ok((userParts[2] as any).text.includes('"deep"'))

      // Orphan 2 degraded to text block
      assert.equal('functionResponse' in userParts[3]!, false)
      assert.equal((userParts[3] as any).text, '[Observation from `orphanRaw`:\nplain string error]')
    })
  })

  // ==========================================================================
  // Group 3: Account Switching & Pin Mechanism (AC-07, AC-08)
  // ==========================================================================
  describe('Group 3: Account Switching, Pin Mechanism & Zero Disk-Overwrite Proof', () => {
    it('AC-07: selectAccount does NOT write to disk pool.json during repeated failover calls (Zero Disk Mutation)', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'qa-zero-disk-mutation-'))
      const pool = new AccountPoolManager(tempDir)

      const accB = pool.createAccountSlot('Account B')
      const accC = pool.createAccountSlot('Account C')
      pool.setPrimaryAccount(accB.id)

      const poolJsonPath = join(tempDir, 'pool.json')
      const initialBytes = readFileSync(poolJsonPath)
      const initialHash = createHash('sha256').update(initialBytes).digest('hex')
      const initialMtime = statSync(poolJsonPath).mtimeMs

      // Trigger rate limit on account B to force failover during selectAccount
      pool.recordFailure(accB.id, 'google', 'rate_limit', new Date(Date.now() + 60_000).toISOString())

      // Record hash immediately after recordFailure (which is an explicit failure write)
      const postFailHash = createHash('sha256').update(readFileSync(poolJsonPath)).digest('hex')
      const postFailMtime = statSync(poolJsonPath).mtimeMs

      // Now perform 50 consecutive selectAccount calls
      for (let i = 0; i < 50; i++) {
        const chosen = pool.selectAccount('google')
        assert.ok(chosen && chosen.id !== accB.id, 'Must failover to healthy account')
      }

      // Verify that after 50 selectAccount calls, pool.json has NOT changed at all!
      const finalBytes = readFileSync(poolJsonPath)
      const finalHash = createHash('sha256').update(finalBytes).digest('hex')
      const finalMtime = statSync(poolJsonPath).mtimeMs

      assert.equal(finalHash, postFailHash, 'SHA256 of pool.json must NOT change across 50 selectAccount calls')
      assert.equal(finalMtime, postFailMtime, 'mtime of pool.json must NOT change across 50 selectAccount calls')
    })

    it('AC-08: Complete Pin Lifecycle: Precedence, Cooldown Temporary Failover, Auto-Recovery, and Pin Disabling Rules', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'qa-pin-full-lifecycle-'))
      const pool = new AccountPoolManager(tempDir)

      const accA = pool.getAccounts()[0]!
      const accB = pool.createAccountSlot('Account B')

      // Rule 1: Cannot pin a disabled account
      pool.setAccountEnabled(accB.id, false)
      const pinDisabled = pool.pinAccount(accB.id)
      assert.equal(pinDisabled, false, 'pinAccount must return false for disabled account')
      assert.equal(pool.getPinnedAccount(), null)

      // Re-enable B and pin it
      pool.setAccountEnabled(accB.id, true)
      const pinEnabled = pool.pinAccount(accB.id)
      assert.equal(pinEnabled, true)
      assert.equal(pool.getPinnedAccount()?.id, accB.id)

      // Rule 2: Disabling pinned account immediately revokes Pin
      pool.setAccountEnabled(accB.id, false)
      assert.equal(pool.getPinnedAccount(), null, 'Disabling account must unpin it immediately')

      // Re-enable and pin A
      pool.setAccountEnabled(accB.id, true)
      pool.pinAccount(accA.id)
      assert.equal(pool.getPinnedAccount()?.id, accA.id)

      // Rule 3: Pin precedence over Sticky Sequential & Session Affinity
      assert.equal(pool.selectAccount('google')?.id, accA.id)

      // Cooldown trigger on A
      pool.recordFailure(accA.id, 'google', 'rate_limit', new Date(Date.now() + 5000).toISOString())
      assert.equal(pool.isAccountHealthy(accA, 'google'), false)

      // Temporary failover to B
      const failoverAcc = pool.selectAccount('google')
      assert.equal(failoverAcc?.id, accB.id, 'While pinned A is in cooldown, safely failover to B')

      // Cooldown cleared / expired -> Next round automatically returns to Pinned A!
      pool.clearCooldown(accA.id, 'google')
      assert.equal(pool.isAccountHealthy(accA, 'google'), true)
      const recoveredAcc = pool.selectAccount('google')
      assert.equal(recoveredAcc?.id, accA.id, 'Must automatically switch back to pinned A upon cooldown expiry!')
    })
  })
})
