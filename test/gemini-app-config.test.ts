// Tests for Gemini App configuration resolution and commands.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { resolveConfig } from '../src/common/config.ts'
import { defaultConfig, GEMINI_APP_PROVIDER_ID } from '../src/common/types.ts'
import { cclCommandDefinition, renderStatus, type CommandDeps } from '../src/host/commands.ts'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { GEMINI_APP_TOKEN_FILE } from '../packages/core/src/gemini-app/auth.ts'
import { apply } from '../src/index.ts'

describe('Gemini App: Configuration & Commands', () => {
  it('resolves defaults when no env or overrides are present', () => {
    const cfg = resolveConfig(undefined, {}, {})
    assert.strictEqual(cfg.geminiAppEnabled, false)
    assert.strictEqual(cfg.geminiAppEndpoint, 'robinfrontend-pa.googleapis.com')
    assert.strictEqual(cfg.geminiAppToken, undefined)
    assert.strictEqual(cfg.geminiAppTimeoutMs, 120_000)
    assert.strictEqual(cfg.geminiAppDefaultModel, 'gemini-app-default')
  })

  it('honors environment variables and auto-enables when token is provided', () => {
    const env: NodeJS.ProcessEnv = {
      DSH_GEMINI_APP_ENDPOINT: 'custom-robin.googleapis.com',
      DSH_GEMINI_APP_TOKEN: 'ya29.env_test_token',
      DSH_GEMINI_APP_TIMEOUT_MS: '60000',
      DSH_GEMINI_APP_DEFAULT_MODEL: 'gemini-app-advanced',
    }

    const cfg = resolveConfig(undefined, env)
    assert.strictEqual(cfg.geminiAppEnabled, true, 'Should auto-enable when token is supplied in env')
    assert.strictEqual(cfg.geminiAppEndpoint, 'custom-robin.googleapis.com')
    assert.strictEqual(cfg.geminiAppToken, 'ya29.env_test_token')
    assert.strictEqual(cfg.geminiAppTimeoutMs, 60000)
    assert.strictEqual(cfg.geminiAppDefaultModel, 'gemini-app-advanced')
  })

  it('respects explicit DSH_GEMINI_APP_ENABLED=false even if token is present', () => {
    const env: NodeJS.ProcessEnv = {
      DSH_GEMINI_APP_ENABLED: 'false',
      DSH_GEMINI_APP_TOKEN: 'ya29.env_test_token',
    }

    const cfg = resolveConfig(undefined, env)
    assert.strictEqual(cfg.geminiAppEnabled, false)
    assert.strictEqual(cfg.geminiAppToken, 'ya29.env_test_token')
  })

  it('includes gemini-app status in renderStatus when enabled', async () => {
    const mockDeps: CommandDeps = {
      cfg: () => ({
        ...defaultConfig(),
        geminiAppEnabled: true,
        geminiAppEndpoint: 'robinfrontend-pa.googleapis.com',
        geminiAppToken: 'ya29.configured_token',
      }),
      auth: () => null,
      catalog: () =>
        ({
          get: () => ({ source: 'fallback', models: [] }),
          refreshIfNeeded: async () => {},
          forceRefresh: async () => ({ source: 'fallback', models: [] }),
        }) as unknown as ReturnType<CommandDeps['catalog']>,
      lastRun: () => null,
      setOverride: () => {},
      runDoctor: async () => '/tmp/doc.txt',
    }

    const statusText = await renderStatus(mockDeps)
    assert.ok(statusText.includes('- gemini-app: enabled'))
    assert.ok(statusText.includes('robinfrontend-pa.googleapis.com'))
    assert.ok(statusText.includes('token: configured'))
  })

  it('handles /ccl gemini-token <token> command and saves token to disk', async () => {
    let overrideKey = ''
    let overrideVal: unknown = null

    const mockDeps: CommandDeps = {
      cfg: () => defaultConfig(),
      auth: () => null,
      catalog: () =>
        ({
          get: () => ({ source: 'fallback', models: [] }),
        }) as unknown as ReturnType<CommandDeps['catalog']>,
      lastRun: () => null,
      setOverride: (k, v) => {
        overrideKey = k
        overrideVal = v
      },
      runDoctor: async () => '/tmp/doc.txt',
    }

    const cmd = cclCommandDefinition(mockDeps)
    const result = await cmd.handler({
      rawInput: 'gemini-token ya29.test_token_from_command',
    } as Parameters<typeof cmd.handler>[0])

    assert.strictEqual(result.kind, 'success')
    assert.ok(result.text?.includes('Gemini App token saved and enabled'))
    assert.strictEqual(overrideKey, 'geminiAppEnabled')
    assert.strictEqual(overrideVal, true)

    assert.ok(existsSync(GEMINI_APP_TOKEN_FILE))
    rmSync(GEMINI_APP_TOKEN_FILE, { force: true })
  })
})

describe('Gemini App HTTP /status and /config routes', () => {
  it('exposes geminiApp* fields in GET /status (masking token) and updates them via POST /config', async () => {
    const prevHome = process.env.HOME
    const prevDshHome = process.env.DSH_HOME
    const prevTokenEnv = process.env.DSH_GEMINI_APP_TOKEN
    const prevGeminiTokenEnv = process.env.GEMINI_APP_TOKEN
    const sandboxHome = mkdtempSync(join(tmpdir(), 'gemini-app-http-home-'))
    const sandboxDsh = mkdtempSync(join(tmpdir(), 'gemini-app-http-dsh-'))
    const hadTokenFileBefore = existsSync(GEMINI_APP_TOKEN_FILE)
    process.env.HOME = sandboxHome
    process.env.DSH_HOME = sandboxDsh
    delete process.env.DSH_GEMINI_APP_TOKEN
    delete process.env.GEMINI_APP_TOKEN

    const routes = new Map<string, (req: unknown, res: unknown) => void>()
    const registeredAdapters: string[][] = []
    const registeredTools = new Set<string>()
    const disposeCallbacks: Array<() => void> = []

    const mockCtx = {
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
      get: () => undefined,
      effect: (cb: () => (() => void) | void) => {
        const d = cb()
        if (typeof d === 'function') disposeCallbacks.push(d)
      },
      llm: {
        registerAdapter: (ids: string[]) => {
          registeredAdapters.push(ids)
          return () => {}
        },
      },
      commands: {
        register: () => () => {},
      },
      inject: (deps: string[], cb: (sub: { get: (k: string) => unknown }) => (() => void) | void) => {
        if (deps.includes('tools')) {
          const d = cb({
            get: () => ({
              register: (tool: { name: string }) => {
                registeredTools.add(tool.name)
                return () => {
                  registeredTools.delete(tool.name)
                }
              },
            }),
          })
          if (typeof d === 'function') disposeCallbacks.push(d)
        }
        if (deps.includes('webServer')) {
          const d = cb({
            get: () => ({
              register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => {
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
      on: (ev: string, cb: () => void) => {
        if (ev === 'dispose') disposeCallbacks.push(cb)
      },
    }

    const invokeRoute = async (
      path: string,
      method: 'GET' | 'POST',
      body?: Record<string, unknown>,
    ): Promise<{ status: number; json: Record<string, unknown> }> => {
      const handler = routes.get(path)
      assert.ok(handler, `Route ${path} should be registered`)
      const req = new EventEmitter() as EventEmitter & { method: string; url: string }
      req.method = method
      req.url = path
      return await new Promise((resolve) => {
        let statusCode = 200
        const res = {
          writeHead: (s: number) => {
            statusCode = s
          },
          end: (raw: string) => {
            resolve({ status: statusCode, json: JSON.parse(raw) as Record<string, unknown> })
          },
        }
        handler(req, res)
        if (method === 'POST') {
          queueMicrotask(() => {
            req.emit('data', Buffer.from(JSON.stringify(body ?? {}), 'utf8'))
            req.emit('end')
          })
        }
      })
    }

    try {
      apply(mockCtx as never, { enabled: true, geminiAppEnabled: false, geminiAppOffloadEnabled: false })

      // Initially gemini-app adapter and gemini_app_ask tool are not registered
      assert.strictEqual(registeredTools.has('gemini_app_ask'), false)
      assert.strictEqual(
        registeredAdapters.some((ids) => ids.includes('gemini-app')),
        false,
      )

      const st1 = await invokeRoute('/plugins/cloudcode-link/status', 'GET')
      assert.strictEqual(st1.status, 200)
      assert.strictEqual(st1.json.geminiAppEnabled, false)
      assert.strictEqual(st1.json.geminiAppOffloadEnabled, false)
      assert.strictEqual(st1.json.geminiAppAskToolEnabled, false)
      assert.strictEqual(st1.json.geminiAppFreshSessionSingleTurn, false)
      assert.strictEqual(st1.json.geminiAppOffloadFallbackToAgy, true)
      assert.strictEqual(st1.json.geminiAppOffloadMaxContextChars, 3_000_000)
      assert.strictEqual(st1.json.hasGeminiAppToken, false)
      assert.strictEqual('geminiAppToken' in st1.json, false)

      // Enabling geminiAppOffloadEnabled auto-enables geminiAppEnabled, registers gemini-app adapter & gemini_app_ask tool
      const cfgOffload = await invokeRoute('/plugins/cloudcode-link/config', 'POST', {
        key: 'geminiAppOffloadEnabled',
        value: true,
      })
      assert.strictEqual(cfgOffload.status, 200)
      assert.strictEqual(cfgOffload.json.ok, true)
      assert.strictEqual(registeredTools.has('gemini_app_ask'), true)
      assert.strictEqual(
        registeredAdapters.some((ids) => ids.includes('gemini-app')),
        true,
      )

      // Saving geminiAppToken persists without echoing plaintext token
      const secretToken = 'ya29.m.test_secret_token_value'
      const cfgToken = await invokeRoute('/plugins/cloudcode-link/config', 'POST', {
        key: 'geminiAppToken',
        value: secretToken,
      })
      assert.strictEqual(cfgToken.status, 200)
      assert.strictEqual(cfgToken.json.hasGeminiAppToken, true)
      assert.strictEqual('value' in cfgToken.json, false)

      const st2 = await invokeRoute('/plugins/cloudcode-link/status', 'GET')
      assert.strictEqual(st2.json.geminiAppEnabled, true)
      assert.strictEqual(st2.json.geminiAppOffloadEnabled, true)
      assert.strictEqual(st2.json.geminiAppAskToolEnabled, true)
      assert.strictEqual(st2.json.hasGeminiAppToken, true)
      assert.strictEqual(JSON.stringify(st2.json).includes(secretToken), false)

      // Toggling geminiAppAskToolEnabled off unregisters gemini_app_ask
      const cfgAskOff = await invokeRoute('/plugins/cloudcode-link/config', 'POST', {
        key: 'geminiAppAskToolEnabled',
        value: false,
      })
      assert.strictEqual(cfgAskOff.status, 200)
      assert.strictEqual(registeredTools.has('gemini_app_ask'), false)
    } finally {
      for (const d of disposeCallbacks) {
        d()
      }
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      if (prevDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevDshHome
      if (prevTokenEnv === undefined) delete process.env.DSH_GEMINI_APP_TOKEN
      else process.env.DSH_GEMINI_APP_TOKEN = prevTokenEnv
      if (prevGeminiTokenEnv === undefined) delete process.env.GEMINI_APP_TOKEN
      else process.env.GEMINI_APP_TOKEN = prevGeminiTokenEnv
      rmSync(sandboxHome, { recursive: true, force: true })
      rmSync(sandboxDsh, { recursive: true, force: true })
      if (!hadTokenFileBefore) {
        rmSync(GEMINI_APP_TOKEN_FILE, { force: true })
      }
    }
  })
})
