import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultConfig, type PluginConfig } from '../src/common/types.ts'
import { GeminiAppError } from '../src/host/gemini-app.ts'
import {
  EXPERT_ROLES,
  ROLE_SYSTEM_PROMPTS,
  EXPERT_FIRST_SYSTEM_PROMPT,
  readSandboxedFiles,
  registerExpertAskTool,
  syncExpertAskRegistration,
  type ExpertAskRegistrationState,
  type ExpertRole,
} from '../src/host/expert-ask-tool.ts'

function makeConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    ...defaultConfig(),
    geminiAppEnabled: true,
    geminiAppAskToolEnabled: true,
    geminiAppToken: 'test-token',
    ...overrides,
  }
}

interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<string>
}

function createMockTools() {
  const registered: RegisteredTool[] = []
  let disposed = false
  const tools = {
    register(tool: unknown) {
      registered.push(tool as RegisteredTool)
      return () => {
        disposed = true
      }
    },
  }
  return {
    tools,
    getTool: (): RegisteredTool => {
      const t = registered[0]
      assert.ok(t)
      return t
    },
    isDisposed: () => disposed,
  }
}

describe('expert_ask tool', () => {
  let tmpDir: string
  let outsideDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-ask-ws-'))
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-ask-out-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(outsideDir, { recursive: true, force: true })
  })

  it('exports EXPERT_ROLES, ROLE_SYSTEM_PROMPTS, and EXPERT_FIRST_SYSTEM_PROMPT', () => {
    assert.deepEqual(EXPERT_ROLES, ['coding', 'review', 'debug', 'writing', 'math', 'general'])
    for (const role of EXPERT_ROLES) {
      assert.equal(typeof ROLE_SYSTEM_PROMPTS[role], 'string')
      assert.ok(ROLE_SYSTEM_PROMPTS[role].trim().length > 20, `role ${role} prompt should be non-trivial`)
    }
    assert.equal(typeof EXPERT_FIRST_SYSTEM_PROMPT, 'string')
    assert.ok(EXPERT_FIRST_SYSTEM_PROMPT.includes('expert_ask'))
  })

  it('registers tool named expert_ask with delegation description and returns disposer', () => {
    const { tools, getTool, isDisposed } = createMockTools()
    const dispose = registerExpertAskTool(tools, { cfg: () => makeConfig() })
    const tool = getTool()
    assert.equal(tool.name, 'expert_ask')
    assert.ok(tool.description.toLowerCase().includes('delegate'))
    assert.ok(tool.description.includes('file_paths'))
    assert.equal(typeof dispose, 'function')
    dispose()
    assert.equal(isDisposed(), true)
  })

  it('rejects empty/missing task, invalid role, and invalid mode', async () => {
    const { tools, getTool } = createMockTools()
    registerExpertAskTool(tools, {
      cfg: () => makeConfig(),
      callGeminiApp: async () => 'ok',
    })
    const tool = getTool()

    await assert.rejects(() => tool.execute({}), /task/i)
    await assert.rejects(() => tool.execute({ task: '   ' }), /task/i)
    await assert.rejects(() => tool.execute({ task: 'hello', role: 'hacker' }), /role/i)
    await assert.rejects(() => tool.execute({ task: 'hello', mode: 'turbo' }), /mode/i)
  })

  it('defaults role to general and mode to advanced, injecting role system prompt', async () => {
    const calls: Array<{ prompt: string; system: string; mode: string }> = []
    const { tools, getTool } = createMockTools()
    registerExpertAskTool(tools, {
      cfg: () => makeConfig(),
      callGeminiApp: async (params) => {
        calls.push({ prompt: params.prompt, system: params.system, mode: params.mode })
        return 'expert answer'
      },
    })
    const tool = getTool()

    const res = await tool.execute({ task: 'Compare A vs B', context: 'Constraint: low latency' })
    assert.equal(res, 'expert answer')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.mode, 'advanced')
    assert.equal(calls[0]?.system, ROLE_SYSTEM_PROMPTS.general)
    assert.ok(calls[0]?.prompt.includes('Compare A vs B'))
    assert.ok(calls[0]?.prompt.includes('Constraint: low latency'))

    for (const role of EXPERT_ROLES as readonly ExpertRole[]) {
      await tool.execute({ task: `Task for ${role}`, role, mode: 'standard' })
      const last: { prompt: string; system: string; mode: string } | undefined = calls[calls.length - 1]
      assert.ok(last)
      assert.equal(last.mode, 'standard')
      assert.equal(last.system, ROLE_SYSTEM_PROMPTS[role])
    }
  })

  it('resolves file_paths relative to getCwd(exec) and falls back to process.cwd()', async () => {
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'line1\nline2\nline3\n', 'utf8')

    let capturedPrompt = ''
    const { tools, getTool } = createMockTools()
    registerExpertAskTool(tools, {
      cfg: () => makeConfig(),
      getCwd: (exec) => (exec as { cwd?: string } | undefined)?.cwd,
      callGeminiApp: async (params) => {
        capturedPrompt = params.prompt
        return 'done'
      },
    })
    const tool = getTool()

    await tool.execute(
      { task: 'Inspect hello.ts', file_paths: ['hello.ts'] },
      { cwd: tmpDir },
    )
    assert.ok(capturedPrompt.includes('hello.ts'))
    assert.ok(capturedPrompt.includes('1: line1'))
    assert.ok(capturedPrompt.includes('2: line2'))

    // Fallback to process.cwd() when getCwd returns undefined
    await tool.execute(
      { task: 'Inspect package.json', file_paths: ['package.json'] },
      {},
    )
    assert.ok(capturedPrompt.includes('dsh-cloudcode-link'))
  })

  it('supports :start-end 1-based inclusive line ranges with line numbers', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'sample.ts'),
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n'),
      'utf8',
    )

    const result = readSandboxedFiles(['sample.ts:2-4'], tmpDir)
    assert.ok(result.includes('sample.ts:2-4'))
    assert.ok(!result.includes('1: alpha'))
    assert.ok(result.includes('2: beta'))
    assert.ok(result.includes('3: gamma'))
    assert.ok(result.includes('4: delta'))
    assert.ok(!result.includes('5: epsilon'))
  })

  it('rejects invalid :start-end line range syntax', () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'a\nb\nc\n', 'utf8')

    assert.throws(() => readSandboxedFiles(['foo.ts:50-10'], tmpDir), /line range/i)
    assert.throws(() => readSandboxedFiles(['foo.ts:0-5'], tmpDir), /line range/i)
    assert.throws(() => readSandboxedFiles(['foo.ts:abc'], tmpDir), /line range/i)
    assert.throws(() => readSandboxedFiles(['foo.ts:1-'], tmpDir), /line range/i)
  })

  it('rejects missing files and directory paths with clear error naming the path', () => {
    fs.mkdirSync(path.join(tmpDir, 'subdir'))

    assert.throws(() => readSandboxedFiles(['missing.ts'], tmpDir), /missing\.ts/)
    assert.throws(() => readSandboxedFiles(['subdir'], tmpDir), /subdir/)
  })

  it('rejects path traversal, outside absolute paths, and symlink escapes', () => {
    const secretFile = path.join(outsideDir, 'secret.txt')
    fs.writeFileSync(secretFile, 'TOP_SECRET', 'utf8')

    // Relative traversal
    assert.throws(
      () => readSandboxedFiles([`../${path.basename(outsideDir)}/secret.txt`], tmpDir),
      /outside|sandbox|escape|traversal/i,
    )

    // Absolute path outside cwd
    assert.throws(
      () => readSandboxedFiles([secretFile], tmpDir),
      /outside|sandbox|escape|traversal/i,
    )

    // Symlink inside cwd pointing outside cwd
    const linkPath = path.join(tmpDir, 'evil-link.txt')
    fs.symlinkSync(secretFile, linkPath)
    assert.throws(
      () => readSandboxedFiles(['evil-link.txt'], tmpDir),
      /outside|sandbox|escape|symlink/i,
    )
  })

  it('truncates oversized single files (>30k) and total context (>100k) with explicit markers', () => {
    const bigSingle = 'A'.repeat(35_000)
    fs.writeFileSync(path.join(tmpDir, 'big.txt'), bigSingle, 'utf8')

    const singleOut = readSandboxedFiles(['big.txt'], tmpDir)
    assert.ok(singleOut.includes('[truncated:'))
    assert.ok(singleOut.length < 35_000)

    // Create 4 files of 28,000 chars each (total 112,000 > 100,000)
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(tmpDir, `part${i}.txt`), String(i).repeat(28_000), 'utf8')
    }
    const totalOut = readSandboxedFiles(
      ['part1.txt', 'part2.txt', 'part3.txt', 'part4.txt'],
      tmpDir,
    )
    assert.ok(totalOut.includes('[truncated:'))
    assert.ok(totalOut.length <= 102_000)
  })

  it('propagates GeminiAppError and generic errors cleanly without swallowing them', async () => {
    const logs: string[] = []
    const { tools, getTool } = createMockTools()
    let mode: 'gemini' | 'generic' = 'gemini'

    registerExpertAskTool(tools, {
      cfg: () => makeConfig(),
      log: (m) => logs.push(m),
      callGeminiApp: async () => {
        if (mode === 'gemini') {
          throw new GeminiAppError('Too many requests', 'RATE_LIMITED')
        }
        throw new Error('Network socket hang up')
      },
    })
    const tool = getTool()

    await assert.rejects(
      () => tool.execute({ task: 'Test error' }),
      /expert_ask failed \[RATE_LIMITED\]: Too many requests/,
    )
    assert.ok(logs.some((l) => l.includes('RATE_LIMITED')))

    mode = 'generic'
    await assert.rejects(
      () => tool.execute({ task: 'Test generic error' }),
      /expert_ask failed: Network socket hang up/,
    )
    assert.ok(logs.some((l) => l.includes('Network socket hang up')))
  })
})

describe('syncExpertAskRegistration', () => {
  it('registers both expert_ask tool and tool:expert_ask system prompt section when enabled', () => {
    const registeredTools: Array<{ name: string }> = []
    const registeredSections: Array<{ name: string; order: number; text: string }> = []
    let toolDisposed = 0
    let promptDisposed = 0

    const toolsSvc = {
      register: (tool: unknown) => {
        registeredTools.push(tool as { name: string })
        return () => {
          toolDisposed += 1
        }
      },
    }
    const systemPromptSvc = {
      section: (opts: { name: string; order: number; text: string }) => {
        registeredSections.push(opts)
        return () => {
          promptDisposed += 1
        }
      },
    }
    const state: ExpertAskRegistrationState = { toolDispose: null, promptDispose: null }

    syncExpertAskRegistration({
      enabled: true,
      toolsSvc,
      systemPromptSvc,
      state,
      deps: { cfg: () => makeConfig() },
    })

    assert.equal(registeredTools.length, 1)
    assert.equal(registeredTools[0]?.name, 'expert_ask')
    assert.equal(registeredSections.length, 1)
    assert.equal(registeredSections[0]?.name, 'tool:expert_ask')
    assert.equal(registeredSections[0]?.text, EXPERT_FIRST_SYSTEM_PROMPT)
    assert.equal(typeof state.toolDispose, 'function')
    assert.equal(typeof state.promptDispose, 'function')
    assert.equal(toolDisposed, 0)
    assert.equal(promptDisposed, 0)

    // Calling again while enabled should be idempotent
    syncExpertAskRegistration({
      enabled: true,
      toolsSvc,
      systemPromptSvc,
      state,
      deps: { cfg: () => makeConfig() },
    })
    assert.equal(registeredTools.length, 1)
    assert.equal(registeredSections.length, 1)
  })

  it('disposes both tool and system prompt section when enabled becomes false', () => {
    let toolActive = false
    let promptActive = false

    const toolsSvc = {
      register: () => {
        toolActive = true
        return () => {
          toolActive = false
        }
      },
    }
    const systemPromptSvc = {
      section: () => {
        promptActive = true
        return () => {
          promptActive = false
        }
      },
    }
    const state: ExpertAskRegistrationState = { toolDispose: null, promptDispose: null }

    syncExpertAskRegistration({
      enabled: true,
      toolsSvc,
      systemPromptSvc,
      state,
      deps: { cfg: () => makeConfig() },
    })
    assert.equal(toolActive, true)
    assert.equal(promptActive, true)

    syncExpertAskRegistration({
      enabled: false,
      toolsSvc,
      systemPromptSvc,
      state,
      deps: { cfg: () => makeConfig() },
    })
    assert.equal(toolActive, false)
    assert.equal(promptActive, false)
    assert.equal(state.toolDispose, null)
    assert.equal(state.promptDispose, null)
  })

  it('handles missing systemPromptSvc gracefully without crashing', () => {
    const registeredTools: Array<{ name: string }> = []
    const toolsSvc = {
      register: (tool: unknown) => {
        registeredTools.push(tool as { name: string })
        return () => undefined
      },
    }
    const state: ExpertAskRegistrationState = { toolDispose: null, promptDispose: null }

    syncExpertAskRegistration({
      enabled: true,
      toolsSvc,
      systemPromptSvc: null,
      state,
      deps: { cfg: () => makeConfig() },
    })

    assert.equal(registeredTools.length, 1)
    assert.equal(typeof state.toolDispose, 'function')
    assert.equal(state.promptDispose, null)
  })
})
