import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cclCommandDefinition, agyCommandDefinition, type CommandDeps } from '../src/host/commands.ts'
import { defaultConfig } from '../src/common/types.ts'
import { ModelCatalog } from '../src/host/models.ts'

function createMockDeps(): CommandDeps {
  const catalog = new ModelCatalog(undefined, [{ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' }], 60_000)
  return {
    cfg: () => defaultConfig(),
    auth: () => null,
    catalog: () => catalog,
    lastRun: () => null,
    setOverride: () => {},
    runDoctor: async () => '/tmp/doctor.txt',
  }
}

describe('ccl and cloudcode slash commands', () => {
  it('cclCommandDefinition defines command with name ccl by default', () => {
    const deps = createMockDeps()
    const cmd = cclCommandDefinition(deps)
    assert.equal(cmd.name, 'ccl')
    assert.ok(cmd.description.includes('CloudCode Link bridge'))
  })

  it('cclCommandDefinition supports cloudcode alias', () => {
    const deps = createMockDeps()
    const cmd = cclCommandDefinition(deps, 'cloudcode')
    assert.equal(cmd.name, 'cloudcode')
    assert.ok(cmd.description.includes('CloudCode Link bridge'))
  })

  it('agyCommandDefinition is exported as legacy alias to cclCommandDefinition', () => {
    assert.equal(agyCommandDefinition, cclCommandDefinition)
  })

  it('ccl help output references /ccl commands and no /agy mentions', async () => {
    const deps = createMockDeps()
    const cmd = cclCommandDefinition(deps)
    const res = await cmd.handler({ rawInput: 'help' } as any)
    assert.equal(res.kind, 'success')
    assert.ok(res.text, 'Help text must be present')
    assert.ok(res.text.includes('**/ccl** — CloudCode Link bridge'))
    assert.ok(res.text.includes('/ccl status'))
    assert.ok(res.text.includes('/ccl pool'))
    assert.ok(res.text.includes('/ccl auth'))
    assert.ok(!res.text.includes('/agy'), 'Help text must not contain legacy /agy command')
  })

  it('command usage errors reference /ccl', async () => {
    const deps = createMockDeps()
    const cmd = cclCommandDefinition(deps)
    const resEffort = await cmd.handler({ rawInput: 'effort invalid' } as any)
    assert.equal(resEffort.kind, 'error')
    assert.equal(resEffort.text, 'usage: /ccl effort <low|medium|high|default>')

    const resRemove = await cmd.handler({ rawInput: 'remove-account' } as any)
    assert.equal(resRemove.kind, 'error')
    assert.equal(resRemove.text, 'usage: /ccl remove-account <id>')

    const resAuthCode = await cmd.handler({ rawInput: 'auth-code' } as any)
    assert.equal(resAuthCode.kind, 'error')
    assert.equal(resAuthCode.text, 'usage: /ccl auth-code <code-or-callback-url>')
  })

  it('client source and build output contain no references to the 3 deleted buttons', () => {
    const clientSource = readFileSync(join(import.meta.dirname, '../src/client/index.ts'), 'utf8')
    assert.ok(!clientSource.includes('权限模式'), 'src/client/index.ts must not contain 权限模式')
    assert.ok(!clientSource.includes('思考强度'), 'src/client/index.ts must not contain 思考强度')
    assert.ok(!clientSource.includes('号池调度'), 'src/client/index.ts must not contain 号池调度')

    const clientBundle = readFileSync(join(import.meta.dirname, '../dist/client.js'), 'utf8')
    assert.ok(!clientBundle.includes('权限模式'), 'dist/client.js must not contain 权限模式')
    assert.ok(!clientBundle.includes('思考强度'), 'dist/client.js must not contain 思考强度')
    assert.ok(!clientBundle.includes('号池调度'), 'dist/client.js must not contain 号池调度')
  })
})
