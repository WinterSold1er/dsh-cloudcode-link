// Tests for Gemini App configuration resolution and commands.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { resolveConfig } from '../src/common/config.ts'
import { defaultConfig, GEMINI_APP_PROVIDER_ID } from '../src/common/types.ts'
import { cclCommandDefinition, renderStatus, type CommandDeps } from '../src/host/commands.ts'
import { existsSync, unlinkSync } from 'node:fs'
import { GEMINI_APP_TOKEN_FILE } from '../packages/core/src/gemini-app/auth.ts'

describe('Gemini App: Configuration & Commands', () => {
  it('resolves defaults when no env or overrides are present', () => {
    const cfg = resolveConfig(undefined, {})
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
      catalog: () => ({
        get: () => ({ source: 'fallback', models: [] }),
        refreshIfNeeded: async () => {},
        forceRefresh: async () => ({ source: 'fallback', models: [] }),
      } as any),
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
      catalog: () => ({
        get: () => ({ source: 'fallback', models: [] }),
      } as any),
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
    } as any)

    assert.strictEqual(result.kind, 'success')
    assert.ok(result.text?.includes('Gemini App token saved and enabled'))
    assert.strictEqual(overrideKey, 'geminiAppEnabled')
    assert.strictEqual(overrideVal, true)

    assert.ok(existsSync(GEMINI_APP_TOKEN_FILE))
    // Clean up
    try {
      unlinkSync(GEMINI_APP_TOKEN_FILE)
    } catch {
      // ignore
    }
  })
})
