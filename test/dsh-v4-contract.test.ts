import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { convertMessages, convertRequest } from '../src/host/message-converter.ts'
import type { GeminiContent } from '../src/host/client.ts'

/**
 * Contract tests for the DSH v4 provider-message shape (dsh-llm >= 0.1.7).
 *
 * DSH v4 hands adapters these roles: system, developer, user, assistant, tool
 * (plus identity-free `RequestUserInput` with role 'user'). Tool results are
 * their own `role: 'tool'` message carrying `toolCallId` / `isError` / content.
 *
 * The conversion layer must be TOTAL and EXPLICIT:
 *   - every role and every content block has a defined mapping,
 *   - nothing is dropped silently (unmapped input is degraded and reported in
 *     `warnings`),
 *   - the emitted wire form satisfies every CloudCode topology invariant.
 */

const text = (t: string) => ({ type: 'text', text: t })
const call = (id: string | undefined, name: string, args: unknown) => ({
  type: 'tool-call',
  ...(id === undefined ? {} : { id }),
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
})
const result = (toolCallId: string | undefined, content: string, isError = false) => ({
  role: 'tool',
  ...(toolCallId === undefined ? {} : { toolCallId }),
  isError,
  content: [text(content)],
  ...(toolCallId === undefined ? {} : { source: { kind: 'tool', callId: toolCallId } }),
})

/** Wire invariant: every model functionCall is answered by the very next user turn. */
function assertEveryCallAnswered(contents: GeminiContent[], label: string): void {
  for (let i = 0; i < contents.length; i++) {
    const turn = contents[i]!
    if (turn.role !== 'model') continue
    const calls = turn.parts.filter((p) => 'functionCall' in p)
    if (calls.length === 0) continue
    const next = contents[i + 1]
    assert.ok(next, `${label}: model turn ${i} has functionCalls but no following turn`)
    assert.equal(next.role, 'user', `${label}: model turn ${i} must be answered by a user turn`)
    const answers = next.parts.filter((p) => 'functionResponse' in p)
    for (const c of calls) {
      const fc = (c as { functionCall: { id?: string; name: string } }).functionCall
      const hit = answers.some((a) => {
        const fr = (a as { functionResponse: { id?: string; name: string } }).functionResponse
        return fc.id && fr.id ? fc.id === fr.id : fc.name === fr.name
      })
      assert.ok(hit, `${label}: functionCall ${fc.id ?? fc.name} is unanswered`)
    }
  }
}

describe('DSH v4 contract: role coverage', () => {
  it("maps a role:'tool' message to a functionResponse carrying the real tool output", async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('read a.txt')] },
      { role: 'assistant', content: [call('c1', 'read', { file_path: 'a.txt' })] },
      result('c1', 'FILE CONTENTS OK'),
    ])

    assert.deepEqual(projection.contents, [
      { role: 'user', parts: [{ text: 'read a.txt' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read', args: { file_path: 'a.txt' }, id: 'c1' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read', id: 'c1', response: { output: 'FILE CONTENTS OK' } } }] },
    ])
    assert.equal(projection.systemInstruction, undefined)
    assert.deepEqual(projection.warnings, [])
    assertEveryCallAnswered(projection.contents, 'role:tool')
  })

  it("maps an isError role:'tool' result to the error channel", async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('run it')] },
      { role: 'assistant', content: [call('c1', 'bash', { command: 'false' })] },
      result('c1', 'exit code 1', true),
    ])

    const last = projection.contents.at(-1)!
    assert.deepEqual(last.parts, [
      { functionResponse: { name: 'bash', id: 'c1', response: { error: 'exit code 1' } } },
    ])
  })

  it('merges parallel tool results into one user turn, one response per call in order', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('run both')] },
      {
        role: 'assistant',
        content: [call('c1', 'alpha', { n: 1 }), call('c2', 'beta', { n: 2 })],
      },
      result('c1', 'A'),
      result('c2', 'B'),
    ])

    assert.equal(projection.contents.length, 3)
    assert.deepEqual(projection.contents[2], {
      role: 'user',
      parts: [
        { functionResponse: { name: 'alpha', id: 'c1', response: { output: 'A' } } },
        { functionResponse: { name: 'beta', id: 'c2', response: { output: 'B' } } },
      ],
    })
    assertEveryCallAnswered(projection.contents, 'parallel results')
    assert.deepEqual(projection.warnings, [])
  })

  it('attributes a result without a toolCallId to the single unanswered preceding call', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('search')] },
      { role: 'assistant', content: [call('c9', 'search', { q: 'x' })] },
      result(undefined, 'RESULT'),
    ])

    assert.deepEqual(projection.contents.at(-1)!.parts, [
      { functionResponse: { name: 'search', id: 'c9', response: { output: 'RESULT' } } },
    ])
    assertEveryCallAnswered(projection.contents, 'positional attribution')
  })

  it('degrades an ambiguously-attributed result to a text observation instead of guessing', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('run both')] },
      { role: 'assistant', content: [call('c1', 'alpha', {}), call('c2', 'beta', {})] },
      result(undefined, 'WHO AM I'),
    ])

    const wire = JSON.stringify(projection.contents)
    assert.ok(wire.includes('WHO AM I'), 'the result text must stay visible to the model')
    assert.ok(
      !projection.contents.some((t) =>
        t.parts.some(
          (p) => 'functionResponse' in p && (p.functionResponse.response as { output?: string }).output === 'WHO AM I',
        ),
      ),
      'an ambiguous result must not be attached as if it were one call output',
    )
    assert.ok(
      projection.warnings.some((w) => w.includes('ambiguous')),
      `expected an ambiguity warning, got ${JSON.stringify(projection.warnings)}`,
    )
    assertEveryCallAnswered(projection.contents, 'ambiguous attribution')
  })

  it("never emits the placeholder tool name 'tool'", async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('run it')] },
      { role: 'assistant', content: [call('c1', 'read', {})] },
      result('unknown-call-id', 'ORPHAN OUTPUT'),
    ])

    const names = projection.contents.flatMap((t) =>
      t.parts.flatMap((p) => ('functionResponse' in p ? [p.functionResponse.name] : [])),
    )
    assert.ok(!names.includes('tool'), `placeholder name leaked: ${JSON.stringify(names)}`)
    assert.ok(
      projection.warnings.some((w) => w.includes('unknown-call-id')),
      `expected an unmatched-result warning, got ${JSON.stringify(projection.warnings)}`,
    )
    assertEveryCallAnswered(projection.contents, 'orphan result')
  })

  it("routes role:'system' content into the system instruction slot instead of dropping it", async () => {
    const projection = await convertRequest([
      { role: 'system', content: [text('You are an AI agent powered by DeepSeek Harness.')] },
      { role: 'user', content: [text('hi')] },
    ])

    assert.deepEqual(projection.systemInstruction, {
      parts: [{ text: 'You are an AI agent powered by DeepSeek Harness.' }],
    })
    assert.deepEqual(projection.contents, [{ role: 'user', parts: [{ text: 'hi' }] }])
  })

  it('merges several system/developer messages in order, ahead of the one-shot system text', async () => {
    const projection = await convertRequest(
      [
        { role: 'system', content: [text('SYS-1')] },
        { role: 'developer', content: [text('DEV-1')] },
        { role: 'user', content: [text('hi')] },
      ],
      { system: 'ONE-SHOT' },
    )

    assert.deepEqual(projection.systemInstruction, {
      parts: [{ text: 'ONE-SHOT' }, { text: 'SYS-1' }, { text: 'DEV-1' }],
    })
  })

  it('reports developer tool-change blocks as unrepresentable instead of ignoring them silently', async () => {
    const projection = await convertRequest([
      { role: 'developer', content: [text('DEV'), { type: 'tool-addition', toolName: 'deferred_tool' }] },
      { role: 'user', content: [text('hi')] },
    ])

    assert.deepEqual(projection.systemInstruction, { parts: [{ text: 'DEV' }] })
    assert.ok(
      projection.warnings.some((w) => w.includes('tool-addition')),
      `expected a tool-addition warning, got ${JSON.stringify(projection.warnings)}`,
    )
  })

  it('keeps an unknown role visible as a user turn and warns', async () => {
    const projection = await convertRequest([
      { role: 'agent', content: [text('do the thing')] },
      { role: 'user', content: [text('hi')] },
    ])

    const wire = JSON.stringify(projection.contents)
    assert.ok(wire.includes('do the thing'), 'unknown-role content must stay visible')
    assert.ok(
      projection.warnings.some((w) => w.includes('"agent"')),
      `expected an unknown-role warning, got ${JSON.stringify(projection.warnings)}`,
    )
  })

  it('accepts an identity-free RequestUserInput (role user, no source)', async () => {
    const projection = await convertRequest([{ role: 'user', content: [text('one-shot input')] }])

    assert.deepEqual(projection.contents, [{ role: 'user', parts: [{ text: 'one-shot input' }] }])
  })
})

describe('DSH v4 contract: content block coverage', () => {
  it('keeps the text of an unknown block type and warns', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [{ type: 'agent_message', text: 'unmapped block' }] },
    ])

    const wire = JSON.stringify(projection.contents)
    assert.ok(wire.includes('unmapped block'), 'unknown block text must stay visible')
    assert.ok(
      projection.warnings.some((w) => w.includes('agent_message')),
      `expected an unknown-block warning, got ${JSON.stringify(projection.warnings)}`,
    )
  })

  it('parses JSON-string tool arguments and warns on malformed JSON', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('go')] },
      { role: 'assistant', content: [call('c1', 'read', '{"file_path":"a.txt"}'), call('c2', 'read', '{oops')] },
    ])

    const calls = projection.contents[1]!.parts.filter((p) => 'functionCall' in p)
    assert.deepEqual((calls[0] as { functionCall: { args: unknown } }).functionCall.args, { file_path: 'a.txt' })
    assert.deepEqual((calls[1] as { functionCall: { args: unknown } }).functionCall.args, {})
    assert.ok(
      projection.warnings.some((w) => w.includes('arguments')),
      `expected a malformed-arguments warning, got ${JSON.stringify(projection.warnings)}`,
    )
  })

  it('inlines an image attachment through readImage and skips an offloaded one', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const projection = await convertRequest(
      [
        {
          role: 'user',
          content: [
            { type: 'image', attachment: { attachmentId: 'img-1', mimeType: 'image/png' } },
            { type: 'image', attachment: { attachmentId: 'img-2' }, offloaded: true },
            text('look'),
          ],
        },
      ],
      { readImage: async () => png },
    )

    const parts = projection.contents[0]!.parts
    assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/png', data: png.toString('base64') } })
    assert.equal(parts.length, 2, 'the offloaded image must not be sent as bytes')
    assert.deepEqual(parts[1], { text: 'look' })
  })

  it('keeps valid thought signatures and drops unsigned reasoning', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('go')] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'signed thought', thoughtSignature: 'YWJjZA==' },
          { type: 'reasoning', text: 'unsigned thought' },
          call('c1', 'read', {}),
        ],
      },
      result('c1', 'OK'),
    ])

    assert.deepEqual(projection.contents[1]!.parts[0], {
      thought: true,
      text: 'signed thought',
      thoughtSignature: 'YWJjZA==',
    })
    assert.ok(
      !JSON.stringify(projection.contents).includes('unsigned thought'),
      'unsigned reasoning must not reach the wire',
    )
  })

  it('aggregates a repeated mapping loss into one counted warning', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('go')] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'first unsigned thought' },
          { type: 'reasoning', text: 'second unsigned thought' },
        ],
      },
    ])

    const reasoningWarnings = projection.warnings.filter((w) => w.includes('thoughtSignature'))
    assert.equal(reasoningWarnings.length, 1, `expected one aggregated warning, got ${JSON.stringify(projection.warnings)}`)
    assert.ok(reasoningWarnings[0]!.includes('x2'), `expected a repetition count, got "${reasoningWarnings[0]}"`)
  })

  it('accepts string content shorthands for user and assistant messages', async () => {
    const projection = await convertRequest([
      { role: 'user', content: 'plain user text' },
      { role: 'assistant', content: 'plain model text' },
    ])

    assert.deepEqual(projection.contents, [
      { role: 'user', parts: [{ text: 'plain user text' }] },
      { role: 'model', parts: [{ text: 'plain model text' }] },
      // A trailing model turn must still be closed by a user turn.
      { role: 'user', parts: [{ text: 'Continue.' }] },
    ])
  })
})

describe('DSH v4 contract: CloudCode topology invariants', () => {
  it('answers a genuinely unanswered trailing functionCall with an error notice, never a fake output', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('do a thing')] },
      { role: 'assistant', content: [call('c1', 'bash', { command: 'ls' })] },
    ])

    assert.equal(projection.contents.at(-1)!.role, 'user')
    const part = projection.contents.at(-1)!.parts[0] as { functionResponse: { response: Record<string, unknown> } }
    assert.ok('error' in part.functionResponse.response, 'an unexecuted call is an error, not a successful output')
    assert.ok(
      !JSON.stringify(projection.contents).includes('not executed'),
      'the fabricated "not executed" text must not exist anywhere in the wire form',
    )
    assert.ok(
      projection.warnings.some((w) => w.includes('c1')),
      `expected a warning naming the unresolved call, got ${JSON.stringify(projection.warnings)}`,
    )
    assertEveryCallAnswered(projection.contents, 'unanswered trailing call')
  })

  it('answers every unanswered trailing call of a mixed text + multi-call model turn', async () => {
    const projection = await convertRequest([
      { role: 'user', content: [text('run three')] },
      {
        role: 'assistant',
        content: [text('calling'), call('a', 'alpha', {}), call('b', 'beta', {}), call(undefined, 'gamma', {})],
      },
    ])

    const responses = projection.contents.at(-1)!.parts
    assert.deepEqual(
      responses.map((p) => (p as { functionResponse: { name: string } }).functionResponse.name),
      ['alpha', 'beta', 'gamma'],
    )
    assert.equal(
      'id' in (responses[2] as { functionResponse: Record<string, unknown> }).functionResponse,
      false,
      'a call without an id is answered name-only',
    )
    assertEveryCallAnswered(projection.contents, 'multi-call trailing')
  })

  it('never ends with a model turn and never starts with one', async () => {
    const cases: unknown[][] = [
      [{ role: 'user', content: [text('hi')] }, { role: 'assistant', content: [text('partial')] }],
      [{ role: 'assistant', content: [text('model first')] }],
      [{ role: 'user', content: [text('hi')] }, { role: 'assistant', content: [text('a')] }, { role: 'assistant', content: [text('b')] }],
      [{ role: 'user', content: [] }],
      [{ role: 'user', content: '' }],
    ]

    for (const messages of cases) {
      const { contents } = await convertRequest(messages)
      if (contents.length === 0) continue
      assert.equal(contents[0]!.role, 'user', `first turn must be user for ${JSON.stringify(messages)}`)
      assert.equal(contents.at(-1)!.role, 'user', `last turn must be user for ${JSON.stringify(messages)}`)
      assertEveryCallAnswered(contents, JSON.stringify(messages))
    }
  })

  it('keeps [] for empty input and emits no system instruction', async () => {
    const projection = await convertRequest([])

    assert.deepEqual(projection.contents, [])
    assert.equal(projection.systemInstruction, undefined)
    assert.deepEqual(projection.warnings, [])
  })

  it('runs every role/block mix without dropping a single tool result', async () => {
    const projection = await convertRequest([
      { role: 'system', content: [text('SYS')] },
      { role: 'user', content: [text('one')] },
      { role: 'assistant', content: [call('c1', 'read', '{"file_path":"a"}'), call('c2', 'bash', '{"command":"ls"}')] },
      result('c1', 'FILE'),
      result('c2', 'LISTING'),
      { role: 'assistant', content: [text('done')] },
      { role: 'user', content: [text('again')] },
      { role: 'assistant', content: [call('c3', 'read', '{"file_path":"b"}')] },
      result('c3', 'FILE-B'),
    ])

    const wire = JSON.stringify(projection.contents)
    for (const payload of ['FILE', 'LISTING', 'FILE-B']) {
      assert.ok(wire.includes(payload), `tool output ${payload} was dropped`)
    }
    assert.deepEqual(projection.warnings, [])
    assertEveryCallAnswered(projection.contents, 'mixed session')
  })
})

describe('convertMessages compatibility wrapper', () => {
  it('returns exactly the contents of the projection', async () => {
    const messages = [
      { role: 'system', content: [text('SYS')] },
      { role: 'user', content: [text('read')] },
      { role: 'assistant', content: [call('c1', 'read', { file_path: 'a.txt' })] },
      result('c1', 'FILE CONTENTS OK'),
    ]

    assert.deepEqual(await convertMessages(messages), (await convertRequest(messages)).contents)
  })
})
