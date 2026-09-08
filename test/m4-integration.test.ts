import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inlineFiles, runAgyOnce } from '../src/host/oneshot.ts'
import { AuthHelper } from '../src/host/auth.ts'
import { resolveConfig } from '../src/common/config.ts'
import { defaultConfig } from '../src/common/types.ts'
import { apply } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'

describe('M4: Cleanup & Top-level', () => {
  it('inlineFiles inlines text files and skips missing', async () => {
    const prompt = 'Review this code'
    const inlined = await inlineFiles(prompt, ['package.json'], process.cwd())
    assert.ok(inlined.includes('Review this code'))
    assert.ok(inlined.includes('--- file:'))
    assert.ok(inlined.includes('"dsh-cloudcode-link"') || inlined.includes('"dsh-agy-link"'))
  })

  it('runAgyOnce fails cleanly without token', async () => {
    const res = await runAgyOnce(
      {
        cfg: () => defaultConfig(),
      },
      {
        prompt: 'Say hi',
        model: 'gemini-3.7-flash',
      },
    )
    assert.equal(res.ok, false)
    assert.ok(res.error)
  })

  it('AuthHelper probeSignedIn returns false when no token exists', async () => {
    const old = process.env.ANTIGRAVITY_TOKEN
    delete process.env.ANTIGRAVITY_TOKEN
    try {
      const helper = new AuthHelper()
      const signedIn = await helper.probeSignedIn(true)
      assert.equal(signedIn, false)
    } finally {
      if (old !== undefined) process.env.ANTIGRAVITY_TOKEN = old
    }
  })

  it('resolveConfig defaults baseUrl and endpointCandidates', () => {
    const cfg = resolveConfig({})
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.baseUrl, '')
    assert.equal(cfg.endpointCandidates.length, 3)
    assert.ok(cfg.endpointCandidates[0]?.includes('cloudcode-pa'))
  })

  it('registers /plugins/agy-link/catalog route and returns catalog data (TC-06)', async () => {
    const routes: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => void }> = []
    const mockWebServer = {
      register: (r: { kind: string; path: string; handler: (req: unknown, res: unknown) => void }) => {
        routes.push(r)
        return () => {}
      },
    }

    const mockCtx = {
      on: () => {},
      effect: () => () => {},
      get: () => undefined,
      llm: { registerAdapter: () => () => {} },
      commands: { register: () => () => {} },
      inject: (deps: string[], cb: (sub: unknown) => void) => {
        if (deps.includes('webServer')) {
          cb({ get: () => mockWebServer })
        }
      },
    }

    apply(mockCtx as unknown as Context)

    const catalogRoute = routes.find((r) => r.path === '/plugins/agy-link/catalog')
    assert.ok(catalogRoute, 'GET /plugins/agy-link/catalog should be registered')

    let statusCode = 0
    let headers: Record<string, string> = {}
    let responseBody = ''
    const mockRes = {
      writeHead: (code: number, h: Record<string, string>) => {
        statusCode = code
        headers = h
      },
      end: (data: string) => {
        responseBody = String(data)
      },
    }

    catalogRoute.handler({}, mockRes)
    assert.equal(statusCode, 200)
    assert.ok(headers['Content-Type']?.includes('application/json'))
    const parsed = JSON.parse(responseBody)
    assert.equal(parsed.ok, true)
    assert.ok(typeof parsed.count === 'number')
    assert.ok(Array.isArray(parsed.models))
    assert.equal(parsed.count, parsed.models.length)
  })
})
