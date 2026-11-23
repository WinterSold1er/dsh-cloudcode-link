// Comprehensive tests for Gemini App GMS auth, multi-account pool, host routes, and offload integration.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  GMS_EMBEDDED_SETUP_URL,
  parseGmsKeyValueResponse,
  exchangeOAuthTokenForMasterToken,
  exchangeMasterTokenForAccessToken,
  GeminiAppPoolManager,
  GeminiAppClient,
  GeminiAppError,
  ProtobufWriter,
} from '../packages/core/src/gemini-app/index.ts'
import { defaultConfig } from '../src/common/types.ts'
import { shouldOffloadToGeminiApp } from '../src/host/gemini-app-offload.ts'
import { apply } from '../src/index.ts'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function buildExt1003TextFrame(text: string): Uint8Array {
  const cand = new ProtobufWriter()
  cand.writeString(7, text)
  const bardResp = new ProtobufWriter()
  bardResp.writeMessage(1, cand.toUint8Array())
  const ext1003 = new ProtobufWriter()
  ext1003.writeMessage(1, bardResp.toUint8Array())
  ext1003.writeEmptyMessage(2)
  const root = new ProtobufWriter()
  root.writeMessage(1003, ext1003.toUint8Array())
  return root.toUint8Array()
}

describe('Gemini App: GMS Auth Exchange', () => {
  it('parses key=value GMS responses and exchanges oauth_token -> masterToken -> accessToken', async () => {
    const parsed = parseGmsKeyValueResponse('SID=abc\nToken=aas_et/MASTER_123\nEmail=user@example.com\n')
    assert.equal(parsed.Token, 'aas_et/MASTER_123')
    assert.equal(parsed.Email, 'user@example.com')

    const masterRes = await exchangeOAuthTokenForMasterToken(
      'oauth2_4/TEST_CODE',
      undefined,
      async (_url, init) => {
        assert.ok(String(init?.body).includes('Token=oauth2_4%2FTEST_CODE'))
        return new Response('Token=aas_et/MASTER_XYZ\nEmail=alice@gmail.com\n', { status: 200 })
      },
    )
    assert.equal(masterRes.masterToken, 'aas_et/MASTER_XYZ')
    assert.equal(masterRes.email, 'alice@gmail.com')

    const accessRes = await exchangeMasterTokenForAccessToken(
      'aas_et/MASTER_XYZ',
      'alice@gmail.com',
      async (_url, init) => {
        assert.ok(String(init?.body).includes('Token=aas_et%2FMASTER_XYZ'))
        return new Response('Auth=ya29.m.ACCESS_999\nExpiry=1800000000\n', { status: 200 })
      },
    )
    assert.equal(accessRes.accessToken, 'ya29.m.ACCESS_999')
    assert.equal(accessRes.expiresAt, 1800000000 * 1000)
  })

  it('throws descriptive error when GMS returns Error=BadAuthentication', async () => {
    await assert.rejects(
      () =>
        exchangeOAuthTokenForMasterToken('bad_token', undefined, async () => {
          return new Response('Error=BadAuthentication\nErrorDetail=Invalid token\n', { status: 403 })
        }),
      /BadAuthentication/,
    )
  })
})

describe('Gemini App: Multi-Account Pool Manager & Client Failover', () => {
  it('persists pool.json atomically, rotates LRU, and applies 429 cooldown', () => {
    const dir = makeTempDir('gemini-app-pool-')
    try {
      const poolPath = join(dir, 'pool.json')
      const pool = new GeminiAppPoolManager(poolPath)
      const a1 = pool.addAccount({
        email: 'a1@gmail.com',
        masterToken: 'aas_et/M1',
        accessToken: 'ya29.m.A1',
        expiresAt: Date.now() + 3600_000,
      })
      const a2 = pool.addAccount({
        email: 'a2@gmail.com',
        masterToken: 'aas_et/M2',
        accessToken: 'ya29.m.A2',
        expiresAt: Date.now() + 3600_000,
      })

      assert.ok(existsSync(poolPath))
      const raw = JSON.parse(readFileSync(poolPath, 'utf8')) as { accounts: Array<{ email: string }> }
      assert.equal(raw.accounts.length, 2)

      const first = pool.selectAccount()
      assert.equal(first?.id, a1.id)
      pool.markSuccess(a1.id)

      const second = pool.selectAccount()
      assert.equal(second?.id, a2.id)

      pool.markCooldown(a2.id, '429 RESOURCE_EXHAUSTED')
      const summary = pool.getSummary()
      assert.equal(summary.total, 2)
      assert.equal(summary.ready, 1)
      assert.equal(summary.accounts.find((x) => x.id === a2.id)?.status, 'cooldown')

      const reloaded = new GeminiAppPoolManager(poolPath)
      assert.equal(reloaded.getSummary().total, 2)
      assert.equal(reloaded.removeAccount(a1.id), true)
      assert.equal(reloaded.getSummary().total, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('silently refreshes expired token on 401/16 and fails over on 429', async () => {
    const dir = makeTempDir('gemini-app-failover-')
    try {
      const poolPath = join(dir, 'pool.json')
      let refreshCalls = 0
      const pool = new GeminiAppPoolManager(poolPath, async (_url, init) => {
        refreshCalls++
        const bodyStr = String(init?.body ?? '')
        const master = bodyStr.includes('Token=M1') ? 'M1' : 'M2'
        return new Response(`Auth=ya29.m.REFRESHED_${master}\nExpiry=1900000000\n`, { status: 200 })
      })

      pool.addAccount({
        email: 'acc1@gmail.com',
        masterToken: 'M1',
        accessToken: 'ya29.m.OLD1',
        expiresAt: Date.now() + 3600_000,
      })
      pool.addAccount({
        email: 'acc2@gmail.com',
        masterToken: 'M2',
        accessToken: 'ya29.m.OLD2',
        expiresAt: Date.now() + 3600_000,
      })

      const seenTokens: string[] = []
      const client = new GeminiAppClient(
        { endpoint: 'robinfrontend-pa.googleapis.com' },
        async (_endpoint, headers) => {
          const auth = headers.authorization ?? ''
          seenTokens.push(auth)
          if (auth === 'Bearer ya29.m.OLD1') {
            throw new GeminiAppError('invalid_token', 'AUTH_REQUIRED', 401, 16)
          }
          if (auth === 'Bearer ya29.m.REFRESHED_M1') {
            throw new GeminiAppError('RESOURCE_EXHAUSTED', 'RATE_LIMIT', 429, 8)
          }
          const frame = buildExt1003TextFrame('OK from acc2')
          return {
            frames: (async function* () {
              yield frame
            })(),
            getTrailers: () => ({ 'grpc-status': '0' }),
          }
        },
        pool,
      )

      const res = await client.processQuery({ sessionInput: { textPrompt: 'hi' } })
      assert.equal(res.text, 'OK from acc2')
      assert.equal(refreshCalls, 1)
      assert.deepEqual(seenTokens, [
        'Bearer ya29.m.OLD1',
        'Bearer ya29.m.REFRESHED_M1',
        'Bearer ya29.m.OLD2',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Gemini App: Host Pool Routes & Offload Integration', () => {
  it('allows offload when geminiAppPool has accounts even without single token', async () => {
    const dir = makeTempDir('gemini-app-offload-pool-')
    try {
      const pool = new GeminiAppPoolManager(join(dir, 'pool.json'))
      const cfg = {
        ...defaultConfig(),
        geminiAppEnabled: true,
        geminiAppOffloadEnabled: true,
        geminiAppToken: undefined,
      }
      const opts = {
        provider: 'antigravity',
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as unknown as GenerateOptions
      assert.equal(await shouldOffloadToGeminiApp(opts, cfg, pool), false)

      pool.addAccount({
        email: 'pool@gmail.com',
        accessToken: 'ya29.m.POOL_TOKEN',
        expiresAt: Date.now() + 3600_000,
      })
      assert.equal(await shouldOffloadToGeminiApp(opts, cfg, pool), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exposes login-url, pool/login, pool/remove and masks tokens in GET /status', async () => {
    const dir = makeTempDir('gemini-app-routes-')
    const prevDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = dir

    type RouteHandler = (req: unknown, res: unknown) => void
    const routes = new Map<string, RouteHandler>()
    const disposeCallbacks: Array<() => void> = []

    const mockCtx = {
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
      on: () => () => {},
      effect: (fn: () => unknown) => {
        const d = fn()
        if (typeof d === 'function') disposeCallbacks.push(d as () => void)
      },
      llm: { registerAdapter: () => () => {} },
      commands: { register: () => () => {} },
      inject: (deps: string[], cb: (sub: { get: (k: string) => unknown }) => (() => void) | void) => {
        if (deps.includes('webServer')) {
          const d = cb({
            get: () => ({
              register: (route: { path: string; handler: RouteHandler }) => {
                routes.set(route.path, route.handler)
                return () => {
                  routes.delete(route.path)
                }
              },
            }),
          })
          if (typeof d === 'function') disposeCallbacks.push(d)
        }
      },
    } as unknown as Context

    const invokeRoute = async (
      path: string,
      method: 'GET' | 'POST',
      body?: Record<string, unknown>,
    ): Promise<{ status: number; json: Record<string, unknown> }> => {
      const handler = routes.get(path)
      assert.ok(handler, `Route ${path} should be registered`)
      return new Promise((resolve) => {
        const req = new EventEmitter() as EventEmitter & { method: string }
        req.method = method
        let statusCode = 200
        const res = {
          statusCode: 200,
          setHeader: () => {},
          writeHead: (code: number) => {
            statusCode = code
          },
          end: (chunk?: string) => {
            const parsed = chunk ? (JSON.parse(chunk) as Record<string, unknown>) : {}
            resolve({ status: statusCode, json: parsed })
          },
        }
        handler(req, res)
        if (body !== undefined) {
          req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
        }
        req.emit('end')
      })
    }

    try {
      apply(mockCtx, { enabled: false })

      const loginUrlRes = await invokeRoute('/plugins/cloudcode-link/gemini-app/login-url', 'GET')
      assert.equal(loginUrlRes.status, 200)
      assert.equal(loginUrlRes.json.url, GMS_EMBEDDED_SETUP_URL)

      const badLogin = await invokeRoute('/plugins/cloudcode-link/gemini-app/pool/login', 'POST', {})
      assert.equal(badLogin.status, 400)

      const addRes = await invokeRoute('/plugins/cloudcode-link/gemini-app/pool/login', 'POST', {
        email: 'secret-user@gmail.com',
        accessToken: 'ya29.m.SUPER_SECRET_TOKEN',
        expiresAt: Date.now() + 3600_000,
      })
      assert.equal(addRes.status, 200)
      assert.equal(addRes.json.ok, true)

      const statusRes = await invokeRoute('/plugins/cloudcode-link/status', 'GET')
      assert.equal(statusRes.status, 200)
      assert.equal(statusRes.json.hasGeminiAppToken, true)
      const rawStatus = JSON.stringify(statusRes.json)
      assert.equal(rawStatus.includes('SUPER_SECRET_TOKEN'), false)

      const poolSummary = statusRes.json.geminiAppPool as {
        total: number
        ready: number
        accounts: Array<{ id: string; email: string; status: string }>
      }
      assert.equal(poolSummary.total, 1)
      assert.equal(poolSummary.ready, 1)
      assert.equal(poolSummary.accounts[0]?.email, 'secret-user@gmail.com')

      const removeRes = await invokeRoute('/plugins/cloudcode-link/gemini-app/pool/remove', 'POST', {
        id: poolSummary.accounts[0]?.id,
      })
      assert.equal(removeRes.status, 200)
      const afterPool = removeRes.json.pool as { total: number }
      assert.equal(afterPool.total, 0)
    } finally {
      for (const d of disposeCallbacks) d()
      if (prevDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevDshHome
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
