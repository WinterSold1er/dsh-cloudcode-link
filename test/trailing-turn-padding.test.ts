import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { convertMessages, sanitizeTopology } from '../src/host/message-converter.ts'
import type { GeminiContent } from '../src/host/client.ts'

/**
 * Regression tests for the Google CloudCode protocol constraint:
 *   HTTP 400 "Requests ending with a model turn are not supported."
 *
 * Contract: any NON-EMPTY output of `convertMessages()` / `sanitizeTopology()`
 * must end with a `user` turn. Previously both only guaranteed the FIRST turn
 * was `user`, so every shape below could emit a trailing `model` turn.
 *
 * The closing turn is either the literal `Continue.` text (trailing model text)
 * or a `functionResponse` that closes the trailing model `functionCall`; when
 * no result was recorded, that response uses the error channel — the converter
 * never invents a successful tool output.
 */
const PADDING_TEXT = 'Continue.'

function lastTurn(contents: GeminiContent[]): GeminiContent {
  const turn = contents[contents.length - 1]
  assert.ok(turn, 'expected non-empty contents')
  return turn
}

/** Universal invariant: non-empty CloudCode contents must never end with a model turn. */
function assertEndsWithUser(contents: GeminiContent[], label: string): void {
  assert.ok(contents.length > 0, `${label}: expected non-empty contents`)
  assert.equal(
    lastTurn(contents).role,
    'user',
    `${label}: contents must end with a 'user' turn, but ended with '${lastTurn(contents).role}'`,
  )
}

describe('Trailing-turn padding: CloudCode contents must end with a user turn', () => {
  describe('convertMessages', () => {
    // ------------------------------------------------------------------
    // Core contract
    // ------------------------------------------------------------------
    it('appends the "Continue." user turn after trailing assistant text (Anthropic-style prefill)', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Sure, here is' }] },
      ])

      assertEndsWithUser(contents, 'trailing assistant text')
      assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user'])
      assert.deepEqual(lastTurn(contents), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })

    it('appends a matching functionResponse (name + id preserved) after an unanswered trailing functionCall', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'Read a.txt' },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'call_read_1', name: 'read_file', arguments: { path: 'a.txt' } }],
        },
      ])

      assertEndsWithUser(contents, 'trailing unanswered functionCall')
      const padded = lastTurn(contents)
      assert.equal(padded.parts.length, 1)
      const part = padded.parts[0] as any
      assert.ok(
        'functionResponse' in part,
        'padding after a trailing functionCall must be a functionResponse, not a bare text turn',
      )
      assert.equal(part.functionResponse.name, 'read_file')
      assert.equal(part.functionResponse.id, 'call_read_1')
    })

    it('does not add a padding turn when the conversation already ends with a user turn', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        { role: 'user', content: 'bye' },
      ])

      // Deep-equal to the pre-fix behavior: no extra padding turn.
      assert.deepEqual(contents, [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
        { role: 'user', parts: [{ text: 'bye' }] },
      ])
    })

    it('keeps [] for empty messages and for user messages that contribute no parts', async () => {
      assert.deepEqual(await convertMessages([]), [])
      assert.deepEqual(await convertMessages([{ role: 'user', content: [] }]), [])
      assert.deepEqual(await convertMessages([{ role: 'user', content: '' }]), [])
    })

    // ------------------------------------------------------------------
    // Previously-broken shapes (each one used to emit a trailing model turn)
    // ------------------------------------------------------------------
    it('pads case "empty-string user text": trailing user message with "" contributes no part', async () => {
      const contents = await convertMessages([
        { role: 'assistant', content: [{ type: 'text', text: 'I am the model' }] },
        { role: 'user', content: '' },
      ])

      assertEndsWithUser(contents, 'trailing empty-string user text')
      assert.deepEqual(lastTurn(contents), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })

    it('keeps the text of a trailing unknown block instead of dropping it and padding', async () => {
      const contents = await convertMessages([
        { role: 'assistant', content: [{ type: 'text', text: 'model text' }] },
        { role: 'user', content: [{ type: 'agent_message', text: 'unmapped block' }] },
      ])

      assertEndsWithUser(contents, 'trailing unknown-block user message')
      // Unmapped blocks are no longer dropped: their readable text is forwarded.
      assert.deepEqual(lastTurn(contents), { role: 'user', parts: [{ text: 'unmapped block' }] })
      assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'Hello' }] })
    })

    it('converts a legacy {role:"tool"} result into its real functionResponse, so no padding is needed', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'Call the tool' },
        { role: 'assistant', content: [{ type: 'tool-call', id: 'call_tool_1', name: 'bash', arguments: { command: 'ls' } }] },
        { role: 'tool', content: 'file.txt' },
      ])

      assertEndsWithUser(contents, 'trailing {role:"tool"} result')
      const part = lastTurn(contents).parts[0] as any
      assert.ok(
        'functionResponse' in part,
        'a tool result must be converted into the functionResponse that answers its call',
      )
      assert.equal(part.functionResponse.name, 'bash')
      assert.equal(part.functionResponse.id, 'call_tool_1')
      // The tool's own output reaches the model; nothing is invented here.
      assert.equal(part.functionResponse.response.output, 'file.txt')
    })

    it('routes a trailing {role:"system"} reminder to the system slot and still closes the model turn', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'question' },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'system', content: 'Be concise' },
      ])

      assertEndsWithUser(contents, 'trailing {role:"system"} reminder')
      assert.deepEqual(lastTurn(contents), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })

    it('pads case "image without data": trailing user image with no data and no readImage contributes no part', async () => {
      const contents = await convertMessages([
        { role: 'assistant', content: [{ type: 'text', text: 'here you go' }] },
        { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'img-1' } }] },
      ])

      assertEndsWithUser(contents, 'trailing user image without data')
      assert.deepEqual(lastTurn(contents), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })

    it('pads case "appendTurn merge": consecutive assistant messages merge into one model turn that ends the request', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'part one' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'part two' }] },
      ])

      assertEndsWithUser(contents, 'trailing assistant message merged by appendTurn')
      // The merge itself must be preserved (both parts in one model turn)...
      assert.deepEqual(contents[1]!.parts, [{ text: 'part one' }, { text: 'part two' }])
      // ...and the merged trailing model turn must still be followed by a user turn.
      assert.deepEqual(lastTurn(contents), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })

    it('answers a trailing turn that has BOTH text and an unanswered functionCall (no bare text pad)', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'Do a thing' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will call the tool' },
            { type: 'tool-call', id: 'call_mix_1', name: 'bash', arguments: { command: 'ls' } },
          ],
        },
      ])

      assertEndsWithUser(contents, 'trailing text + functionCall')
      // Model prose stays in the model turn; the padding turn is the tool observation only.
      assert.deepEqual(contents[1]!.parts, [
        { text: 'I will call the tool' },
        { functionCall: { name: 'bash', args: { command: 'ls' }, id: 'call_mix_1' } },
      ])
      const padded = lastTurn(contents)
      assert.equal(padded.parts.length, 1)
      const part = padded.parts[0] as any
      assert.ok('functionResponse' in part)
      assert.equal(part.functionResponse.name, 'bash')
      assert.equal(part.functionResponse.id, 'call_mix_1')
    })

    it('answers every unanswered functionCall of a trailing turn, preserving order and per-call ids (name-only when id absent)', async () => {
      const contents = await convertMessages([
        { role: 'user', content: 'Run three tools' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', id: 'call_a', name: 'alpha', arguments: { n: 1 } },
            { type: 'tool-call', id: 'call_b', name: 'beta', arguments: { n: 2 } },
            { type: 'tool-call', name: 'gamma', arguments: { n: 3 } },
          ],
        },
      ])

      assertEndsWithUser(contents, 'multiple unanswered functionCalls')
      const responses = lastTurn(contents).parts as any[]
      assert.equal(responses.length, 3)
      assert.deepEqual(
        responses.map((p) => p.functionResponse.name),
        ['alpha', 'beta', 'gamma'],
      )
      assert.equal(responses[0]!.functionResponse.id, 'call_a')
      assert.equal(responses[1]!.functionResponse.id, 'call_b')
      // A call without an id gets a name-only functionResponse (no id key at all).
      assert.equal('id' in responses[2]!.functionResponse, false)
      for (const p of responses) {
        // No result was ever recorded: the call is closed through the error
        // channel, never with an invented successful output.
        assert.equal(typeof p.functionResponse.response.error, 'string')
        assert.equal('output' in p.functionResponse.response, false)
      }
    })

    it('keeps whitespace-only user text (truthy) instead of dropping it and padding', async () => {
      const whitespace = await convertMessages([
        { role: 'assistant', content: [{ type: 'text', text: 'model' }] },
        { role: 'user', content: '   ' },
      ])

      assertEndsWithUser(whitespace, 'whitespace-only trailing user text')
      assert.deepEqual(lastTurn(whitespace), { role: 'user', parts: [{ text: '   ' }] })

      // Sibling case: the empty string IS falsy, so it is dropped and then padded.
      const empty = await convertMessages([
        { role: 'assistant', content: [{ type: 'text', text: 'model' }] },
        { role: 'user', content: '' },
      ])
      assert.deepEqual(lastTurn(empty), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })
  })

  describe('sanitizeTopology', () => {
    it('appends a user turn when the sanitized result ends with a plain model turn', () => {
      const clean = sanitizeTopology([
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'done' }] },
      ])

      assertEndsWithUser(clean, 'sanitizeTopology trailing plain model turn')
      assert.deepEqual(clean.map((c) => c.role), ['user', 'model', 'user'])
      assert.deepEqual(lastTurn(clean), { role: 'user', parts: [{ text: PADDING_TEXT }] })
    })

    it('appends a matching functionResponse user turn for a trailing model functionCall', () => {
      const clean = sanitizeTopology([
        { role: 'user', parts: [{ text: 'go' }] },
        { role: 'model', parts: [{ functionCall: { id: 'call_s', name: 'search', args: { q: 'x' } } }] },
      ])

      assertEndsWithUser(clean, 'sanitizeTopology trailing functionCall')
      const part = lastTurn(clean).parts[0] as any
      assert.ok('functionResponse' in part, 'trailing functionCall must be answered with a functionResponse')
      assert.equal(part.functionResponse.name, 'search')
      assert.equal(part.functionResponse.id, 'call_s')
    })

    it('leaves an already user-terminated conversation untouched', () => {
      const clean = sanitizeTopology([
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
        { role: 'user', parts: [{ text: 'bye' }] },
      ])

      assert.deepEqual(clean, [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
        { role: 'user', parts: [{ text: 'bye' }] },
      ])
    })

    it('keeps [] for empty input', () => {
      assert.deepEqual(sanitizeTopology([]), [])
    })

    it('is idempotent: sanitizing an already-padded conversation adds no second user turn', () => {
      const once = sanitizeTopology([
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'done' }] },
      ])
      const twice = sanitizeTopology(once)

      assert.deepEqual(twice, once)
      assert.deepEqual(
        twice.map((c) => c.role),
        ['user', 'model', 'user'],
      )
    })
  })
})
