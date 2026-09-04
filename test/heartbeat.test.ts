import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HeartbeatManager, type HeartbeatDeps } from '../src/host/heartbeat.ts'
import { defaultConfig, type PluginConfig } from '../src/common/types.ts'
import { resolveConfig } from '../src/common/config.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function createMockDeps(overrides: Partial<HeartbeatDeps> = {}): {
  deps: HeartbeatDeps
  logs: string[]
  pings: Array<{ token: string; proxyUrl?: string; customEndpoints?: string[] }>
} {
  const logs: string[] = []
  const pings: Array<{ token: string; proxyUrl?: string; customEndpoints?: string[] }> = []
  let cfg: PluginConfig = {
    ...defaultConfig(),
    heartbeatEnabled: true,
    heartbeatIntervalMs: 30_000,
  }

  const dir = mkdtempSync(join(tmpdir(), 'agy-heartbeat-test-'))
  const pool = new AccountPoolManager(dir)
  const quota = new QuotaService(pool)

  const deps: HeartbeatDeps = {
    getConfig: () => cfg,
    quota,
    pool,
    log: (msg) => logs.push(msg),
    pingFn: async (token, proxyUrl, customEndpoints) => {
      pings.push({ token, proxyUrl, customEndpoints })
      return 'ok'
    },
    ...overrides,
  }

  return { deps, logs, pings }
}

test('HeartbeatManager tracks subagent lifecycle and starts/stops timer', () => {
  const { deps } = createMockDeps()
  const heartbeat = new HeartbeatManager(deps)

  assert.equal(heartbeat.getStatus().activeSubagents, 0)
  assert.equal(heartbeat.getStatus().isRunning, false)

  // Start with id
  heartbeat.onSubagentStart('sub-1')
  assert.equal(heartbeat.getStatus().activeSubagents, 1)
  assert.equal(heartbeat.getStatus().isRunning, true)

  // Start another with id
  heartbeat.onSubagentStart('sub-2')
  assert.equal(heartbeat.getStatus().activeSubagents, 2)
  assert.equal(heartbeat.getStatus().isRunning, true)

  // Start anonymous
  heartbeat.onSubagentStart()
  assert.equal(heartbeat.getStatus().activeSubagents, 3)

  // End sub-1
  heartbeat.onSubagentEnd('sub-1')
  assert.equal(heartbeat.getStatus().activeSubagents, 2)
  assert.equal(heartbeat.getStatus().isRunning, true)

  // End anonymous
  heartbeat.onSubagentEnd()
  assert.equal(heartbeat.getStatus().activeSubagents, 1)
  assert.equal(heartbeat.getStatus().isRunning, true)

  // End sub-2 (all done)
  heartbeat.onSubagentEnd('sub-2')
  assert.equal(heartbeat.getStatus().activeSubagents, 0)
  assert.equal(heartbeat.getStatus().isRunning, false)

  heartbeat.dispose()
})

test('HeartbeatManager does not start timer when heartbeatEnabled is false', () => {
  const { deps } = createMockDeps({
    getConfig: () => ({
      ...defaultConfig(),
      heartbeatEnabled: false,
    }),
  })
  const heartbeat = new HeartbeatManager(deps)

  heartbeat.onSubagentStart('sub-1')
  assert.equal(heartbeat.getStatus().activeSubagents, 1)
  assert.equal(heartbeat.getStatus().isRunning, false)

  heartbeat.dispose()
})

test('HeartbeatManager triggerHeartbeat executes pings across accounts silently', async () => {
  const { deps, pings } = createMockDeps()
  // Mock pool memory token for primary account
  const accounts = deps.pool!.getAccounts()
  assert.ok(accounts.length > 0)
  deps.pool!.setMemoryToken(accounts[0]!.id, 'fake-token-abc', Date.now() + 600_000)

  const heartbeat = new HeartbeatManager(deps)
  await (heartbeat as unknown as { triggerHeartbeat: () => Promise<void> }).triggerHeartbeat()

  assert.equal(pings.length, 1)
  assert.equal(pings[0]?.token, 'fake-token-abc')

  const status = heartbeat.getStatus()
  assert.ok(status.lastPingAt && status.lastPingAt > 0)
  assert.equal(status.lastPingOk, true)

  heartbeat.dispose()
})

test('HeartbeatManager triggerHeartbeat logs errors without throwing', async () => {
  const logs: string[] = []
  const { deps } = createMockDeps({
    log: (msg) => logs.push(msg),
    pingFn: async () => {
      throw new Error('network down')
    },
  })
  const accounts = deps.pool!.getAccounts()
  deps.pool!.setMemoryToken(accounts[0]!.id, 'fake-token-abc', Date.now() + 600_000)

  const heartbeat = new HeartbeatManager(deps)
  await (heartbeat as unknown as { triggerHeartbeat: () => Promise<void> }).triggerHeartbeat()

  const status = heartbeat.getStatus()
  assert.ok(status.lastPingAt && status.lastPingAt > 0)
  assert.equal(status.lastPingOk, false)
  assert.ok(logs.some((l) => l.includes('heartbeat ping error: Error: network down')))

  heartbeat.dispose()
})

test('HeartbeatManager dispose stops timer, clears subagents, and ignores subsequent starts', () => {
  const { deps } = createMockDeps()
  const heartbeat = new HeartbeatManager(deps)

  heartbeat.onSubagentStart('sub-1')
  heartbeat.onSubagentStart()
  assert.equal(heartbeat.getStatus().isRunning, true)
  assert.equal(heartbeat.getStatus().activeSubagents, 2)

  heartbeat.dispose()
  assert.equal(heartbeat.getStatus().isRunning, false)
  assert.equal(heartbeat.getStatus().activeSubagents, 0)

  // Subagent event arriving after dispose must not restart timer
  heartbeat.onSubagentStart('sub-after-dispose')
  assert.equal(heartbeat.getStatus().isRunning, false)
  assert.equal(heartbeat.getStatus().activeSubagents, 0)
})

test('HeartbeatManager triggerHeartbeat does not set lastPingOk to true when no accounts have valid token', async () => {
  const { deps, pings } = createMockDeps({
    quota: {
      getValidAccessToken: async () => null,
    } as unknown as QuotaService,
  })
  const heartbeat = new HeartbeatManager(deps)
  await (heartbeat as unknown as { triggerHeartbeat: () => Promise<void> }).triggerHeartbeat()

  assert.equal(pings.length, 0)
  const status = heartbeat.getStatus()
  assert.equal(status.lastPingOk, undefined)
  assert.equal(status.lastPingAt, undefined)

  heartbeat.dispose()
})

test('config resolution supports heartbeatEnabled and heartbeatIntervalMs', () => {
  const defaultCfg = resolveConfig(undefined, {})
  assert.equal(defaultCfg.heartbeatEnabled, true)
  assert.equal(defaultCfg.heartbeatIntervalMs, 180_000)

  const customCfg = resolveConfig({
    heartbeatEnabled: false,
    heartbeatIntervalMs: 60_000,
  }, {})
  assert.equal(customCfg.heartbeatEnabled, false)
  assert.equal(customCfg.heartbeatIntervalMs, 60_000)

  const clampedCfg = resolveConfig({
    heartbeatIntervalMs: 5_000, // below 30_000 min
  }, {})
  assert.equal(clampedCfg.heartbeatIntervalMs, 30_000)

  const envCfg = resolveConfig(undefined, {
    DSH_AGY_HEARTBEAT_ENABLED: 'false',
    DSH_AGY_HEARTBEAT_INTERVAL_MS: '45000',
    DSH_AGY_TIMEOUT_MS: '0',
    DSH_AGY_MAX_CONCURRENT: '0',
  })
  assert.equal(envCfg.heartbeatEnabled, false)
  assert.equal(envCfg.heartbeatIntervalMs, 45_000)
  assert.equal(envCfg.timeoutMs, 0)
  assert.equal(envCfg.maxConcurrent, 0)
})
