import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fnv1a64Signed, SessionStore } from '../src/host/sessions.ts'
import { antigravityRequestEnvelope } from '../src/host/client.ts'
import { convertMessages, sanitizeTopology } from '../src/host/message-converter.ts'
import { AgyAdapter } from '../src/host/adapter.ts'
import { ModelCatalog } from '../src/host/models.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { defaultConfig } from '../src/common/types.ts'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

describe('6 Root Causes of Cache Misses Fixes (FR-01 to FR-06, AC-01 to AC-06)', () => {
  describe('FR-01 / AC-01: sessionId Deterministic FNV-1a 64-bit Signed Mapping & Session Affinity', () => {
    it('fnv1a64Signed outputs deterministic 64-bit signed integer strings', () => {
      const id1 = fnv1a64Signed('session-alpha')
      const id2 = fnv1a64Signed('session-alpha')
      const id3 = fnv1a64Signed('session-beta')

      assert.equal(id1, id2, 'Same input must produce identical wireSessionId')
      assert.notEqual(id1, id3, 'Different inputs produce different wireSessionIds')

      // Verify range of 64-bit signed integer
      const b1 = BigInt(id1)
      const min64 = -(2n ** 63n)
      const max64 = 2n ** 63n - 1n
      assert.ok(b1 >= min64 && b1 <= max64, 'Output must be within 64-bit signed integer range')
    })

    it('antigravityRequestEnvelope maps sessionId stably via FNV-1a', () => {
      const env1 = antigravityRequestEnvelope('gemini-3.7-flash', false, { sessionId: 'dsh-session-123' })
      const env2 = antigravityRequestEnvelope('gemini-3.7-flash', false, { sessionId: 'dsh-session-123' })

      assert.equal(env1.sessionId, fnv1a64Signed('dsh-session-123'))
      assert.equal(env1.sessionId, env2.sessionId)
    })

    it('SessionStore binds account and enforces session affinity across requests', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-session-affinity-'))
      const store = new SessionStore(join(dir, 'sessions.json'))

      const s1 = store.getOrCreate('session-x', 'acc_1')
      assert.equal(s1.accountId, 'acc_1')
      assert.equal(s1.wireSessionId, fnv1a64Signed('session-x'))

      // Second retrieval preserves bound account
      const s2 = store.getOrCreate('session-x', 'acc_2')
      assert.equal(s2.accountId, 'acc_1', 'Preserves previously bound account for affinity')
    })
  })

  describe('FR-02 / AC-02: trajectory_id Constant & last_step_index Monotonically Increasing', () => {
    it('SessionStore.nextStep monotonically increments step and maintains constant trajectoryId', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agy-session-step-'))
      const store = new SessionStore(join(dir, 'sessions.json'))

      const step1 = store.nextStep('sess-traj-1')
      const step2 = store.nextStep('sess-traj-1')
      const step3 = store.nextStep('sess-traj-1')

      assert.equal(step1.step, 1)
      assert.equal(step2.step, 2)
      assert.equal(step3.step, 3)

      assert.equal(step1.trajectoryId, step2.trajectoryId, 'trajectoryId must remain constant in session')
      assert.equal(step2.trajectoryId, step3.trajectoryId, 'trajectoryId must remain constant in session')
    })

    it('antigravityRequestEnvelope reflects constant trajectoryId and incrementing last_step_index', () => {
      const traj = '12345678-1234-1234-1234-123456789abc'
      const envStep1 = antigravityRequestEnvelope('gemini-3.7-flash', false, { trajectoryId: traj, step: 1 })
      const envStep2 = antigravityRequestEnvelope('gemini-3.7-flash', false, { trajectoryId: traj, step: 2 })

      assert.equal(envStep1.labels.trajectory_id, traj)
      assert.equal(envStep2.labels.trajectory_id, traj)
      assert.equal(envStep1.labels.last_step_index, '1')
      assert.equal(envStep2.labels.last_step_index, '2')
    })
  })

  describe('FR-03 / AC-03: thoughtSignature Retention & No Fallback to Plain Text', () => {
    it('convertMessages retains thoughtSignature and strictly excludes unsigned reasoning without degrading to text', async () => {
      const messages: Message[] = [
        {
          id: '1' as any,
          role: 'user',
          source: { kind: 'user' } as any,
          content: [{ type: 'text', text: 'Hi' }],
        },
        {
          id: '2' as any,
          role: 'assistant',
          source: { kind: 'model', provider: 'antigravity', model: 'gemini-3.7-flash' } as any,
          content: [
            {
              type: 'reasoning',
              text: 'Signed thoughts here',
              thoughtSignature: 'c2lnbmF0dXJlMQ==',
            } as any,
            {
              type: 'reasoning',
              text: 'Unsigned thoughts should be discarded',
            } as any,
            {
              type: 'text',
              text: 'Final response',
            },
          ],
        },
      ]

      const converted = await convertMessages(messages)
      assert.equal(converted.length, 2)

      const modelParts = converted[1]!.parts
      // Should have exactly 2 parts: signed thought and final text. Unsigned reasoning must NOT appear as text!
      assert.equal(modelParts.length, 2)

      const thoughtPart = modelParts[0] as any
      assert.equal(thoughtPart.thought, true)
      assert.equal(thoughtPart.text, 'Signed thoughts here')
      assert.equal(thoughtPart.thoughtSignature, 'c2lnbmF0dXJlMQ==')

      const textPart = modelParts[1] as any
      assert.equal(textPart.text, 'Final response')
      assert.equal('thought' in textPart, false)
    })

    it('sanitizeTopology strictly purges unsigned thoughts from model turns', () => {
      const input = [
        {
          role: 'user' as const,
          parts: [{ text: 'Question' }],
        },
        {
          role: 'model' as const,
          parts: [
            { thought: true as const, text: 'No signature' },
            { thought: true as const, text: 'Valid signature', thoughtSignature: 'YWJjZA==' },
          ],
        },
      ]

      const sanitized = sanitizeTopology(input)
      const modelParts = sanitized[1]!.parts
      assert.equal(modelParts.length, 1)
      assert.equal((modelParts[0] as any).text, 'Valid signature')
      assert.equal((modelParts[0] as any).thoughtSignature, 'YWJjZA==')
    })
  })

  describe('FR-04 / AC-04: requestId Determinism without Timestamp Jitter', () => {
    it('antigravityRequestEnvelope creates deterministic requestId without Date.now() timestamp', () => {
      const traj = 'stable-traj-uuid'
      const env1 = antigravityRequestEnvelope('gemini-3.7-flash', false, { trajectoryId: traj, step: 1 })
      const env2 = antigravityRequestEnvelope('gemini-3.7-flash', false, { trajectoryId: traj, step: 1 })

      assert.equal(env1.requestId, `agent/${traj}/1`)
      assert.equal(env1.requestId, env2.requestId, 'requestId must be identical for same trajectory and step')
      assert.ok(!env1.requestId.includes(String(Date.now())), 'requestId must not contain dynamic timestamp')
    })
  })

  describe('FR-05 / AC-05: systemInstruction Strips role: user for Standard Preheating', () => {
    it('AgyAdapter streams request with systemInstruction stripped of role: user and deterministic envelope', async () => {
      let interceptedBody: any = null

      // Create isolated mock server on dynamic port (never touch 3081)
      const server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            interceptedBody = JSON.parse(raw)
          } catch {}
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write(
            'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello response"}]}}]}}\n\n',
          )
          res.write('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n')
          res.end()
        })
      })

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve())
      })
      const port = (server.address() as { port: number }).port
      const endpoint = `http://127.0.0.1:${port}`

      try {
        const dir = mkdtempSync(join(tmpdir(), 'agy-adapter-sys-'))
        const pool = new AccountPoolManager(dir)
        const acc = pool.getAccounts()[0]!
        pool.setMemoryToken(acc.id, 'mock-access-token', Date.now() + 3600_000)

        const sessionStore = new SessionStore(join(dir, 'sessions.json'))
        const catalog = new ModelCatalog(undefined, [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }], 60_000)

        const adapter = new AgyAdapter({
          getConfig: () => defaultConfig(),
          catalog,
          pool,
          sessionStore,
          endpointCandidates: [endpoint],
        })

        const options: GenerateOptions = {
          provider: 'antigravity',
          model: 'gemini-3.7-flash',
          system: 'You are an intelligent caveman developer.',
          sessionId: 'test-session-dsh-999' as any,
          messages: [
            {
              id: 'm1' as any,
              role: 'user',
              source: { kind: 'user' } as any,
              content: [{ type: 'text', text: 'Hello' }],
            },
          ],
        }

        const chunks: StreamChunk[] = []
        for await (const chunk of adapter.stream(options)) {
          chunks.push(chunk)
        }

        assert.ok(interceptedBody, 'Request body must have reached endpoint')
        const reqObj = interceptedBody.request

        // AC-05 Verification: systemInstruction must NOT contain role: 'user'
        assert.ok(reqObj.systemInstruction, 'systemInstruction must be present')
        assert.equal(
          reqObj.systemInstruction.role,
          undefined,
          'systemInstruction.role must be undefined (stripped of role: user for standard preheating)!',
        )
        assert.deepEqual(reqObj.systemInstruction.parts, [
          { text: 'You are an intelligent caveman developer.' },
        ])

        // AC-01 Verification: wireSessionId is deterministic FNV-1a
        assert.equal(reqObj.sessionId, fnv1a64Signed('test-session-dsh-999'))

        // AC-02 Verification: trajectory_id and last_step_index
        assert.ok(reqObj.labels.trajectory_id)
        assert.equal(reqObj.labels.last_step_index, '1')

        // AC-04 Verification: requestId is deterministic agent/${traj}/1 without Date.now()
        assert.equal(interceptedBody.requestId, `agent/${reqObj.labels.trajectory_id}/1`)
      } finally {
        server.close()
      }
    })
  })

  describe('Issue 3 / Protocol Alignment: Orphan functionResponse Safely Degrades to Observation Block', () => {
    it('sanitizeTopology safely degrades orphan functionResponse to text observation part', () => {
      const input = [
        {
          role: 'user' as const,
          parts: [{ text: 'Start' }],
        },
        {
          role: 'model' as const,
          parts: [{ text: 'No tool call here' }],
        },
        {
          role: 'user' as const,
          parts: [
            {
              functionResponse: {
                id: 'unmatched-call-id',
                name: 'custom_orphan_tool',
                response: { output: 'result data' },
              },
            },
          ],
        },
      ]

      const sanitized = sanitizeTopology(input)
      const userParts = sanitized[2]!.parts
      assert.equal(userParts.length, 1)

      const part = userParts[0] as any
      assert.equal(part.functionResponse, undefined, 'Must NOT send orphan functionResponse to Google backend')
      assert.equal(part.text, '[Observation from `custom_orphan_tool`:\nresult data]')
    })
  })
})
