// Tests for Gemini App streaming response mapper.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mapRobinResponsesToChunks,
  parseRobinGrpcFramesToChunks,
} from '../packages/core/src/gemini-app/stream-mapper.ts'
import {
  RobinStreamingState,
  type ProcessQueryResponse,
} from '../packages/core/src/gemini-app/types.ts'
import {
  ProtobufWriter,
} from '../packages/core/src/gemini-app/proto.ts'
import type { StreamChunk } from '../packages/core/src/types/protocol.ts'

describe('Gemini App: Stream Mapper', () => {
  it('maps sequential text deltas into block-start, text-delta, block-end, usage, and finish', async () => {
    async function* generateResponses(): AsyncGenerator<ProcessQueryResponse> {
      yield {
        chatHistoryOutput: { deltaText: 'Hello ' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
      yield {
        chatHistoryOutput: { deltaText: 'world!' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
      yield {
        streamingState: RobinStreamingState.FINISHED,
      }
    }

    let firstEmitted = false
    const chunks: StreamChunk[] = []
    for await (const chunk of mapRobinResponsesToChunks(generateResponses(), undefined, () => {
      firstEmitted = true
    })) {
      chunks.push(chunk)
    }

    assert.strictEqual(firstEmitted, true)
    assert.ok(chunks.length >= 5)

    // Verify chunk sequence
    assert.strictEqual(chunks[0]?.type, 'block-start')
    assert.strictEqual((chunks[0] as { blockType: string }).blockType, 'text')

    assert.strictEqual(chunks[1]?.type, 'text-delta')
    assert.strictEqual((chunks[1] as { text: string }).text, 'Hello ')

    assert.strictEqual(chunks[2]?.type, 'text-delta')
    assert.strictEqual((chunks[2] as { text: string }).text, 'world!')

    assert.strictEqual(chunks[3]?.type, 'block-end')
    assert.strictEqual((chunks[3] as { block?: { text?: string } }).block?.text, 'Hello world!')

    assert.strictEqual(chunks[4]?.type, 'usage')
    assert.ok((chunks[4] as { usage?: { outputTokens?: number } }).usage?.outputTokens! > 0)

    assert.strictEqual(chunks[5]?.type, 'finish')
    assert.strictEqual((chunks[5] as { reason?: { kind?: string } }).reason?.kind, 'stop')
  })

  it('maps interleaved reasoning thoughts followed by answer text into distinct blocks', async () => {
    async function* generateThinkingResponses(): AsyncGenerator<ProcessQueryResponse> {
      yield {
        chatHistoryOutput: { thoughtsText: 'Thinking step 1... ' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
      yield {
        chatHistoryOutput: { thoughtsText: 'Thinking step 2.' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
      yield {
        chatHistoryOutput: { deltaText: 'Final answer: 42' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
      yield {
        streamingState: RobinStreamingState.FINISHED,
      }
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of mapRobinResponsesToChunks(generateThinkingResponses())) {
      chunks.push(chunk)
    }

    // Must have block-start(reasoning) -> reasoning-delta -> block-end(reasoning) -> block-start(text) -> text-delta -> block-end(text)
    const blockStarts = chunks.filter((c) => c.type === 'block-start')
    assert.strictEqual(blockStarts.length, 2)
    assert.strictEqual((blockStarts[0] as { blockType: string }).blockType, 'reasoning')
    assert.strictEqual((blockStarts[1] as { blockType: string }).blockType, 'text')

    const reasoningDeltas = chunks.filter((c) => c.type === 'reasoning-delta')
    assert.strictEqual(reasoningDeltas.length, 2)

    const textDeltas = chunks.filter((c) => c.type === 'text-delta')
    assert.strictEqual(textDeltas.length, 1)
    assert.strictEqual((textDeltas[0] as { text: string }).text, 'Final answer: 42')

    const finish = chunks.find((c) => c.type === 'finish') as { reason?: { kind?: string } }
    assert.strictEqual(finish?.reason?.kind, 'stop')
  })

  it('handles server-reported Robin error payloads with classified error finish', async () => {
    async function* generateErrorResponse(): AsyncGenerator<ProcessQueryResponse> {
      yield {
        error: { code: 8, message: 'Resource exhausted (quota limit reached)' },
        streamingState: RobinStreamingState.ERROR,
      }
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of mapRobinResponsesToChunks(generateErrorResponse())) {
      chunks.push(chunk)
    }

    assert.strictEqual(chunks.length, 1)
    assert.strictEqual(chunks[0]?.type, 'finish')
    const finish = chunks[0] as { reason?: { kind?: string; failure?: { code?: string; message?: string } } }
    assert.strictEqual(finish.reason?.kind, 'error')
    assert.strictEqual(finish.reason?.failure?.code, 'ROBIN_ERROR_8')
    assert.ok(finish.reason?.failure?.message?.includes('Resource exhausted'))
  })

  it('handles client AbortSignal mid-stream gracefully', async () => {
    const controller = new AbortController()

    async function* generateHangingStream(): AsyncGenerator<ProcessQueryResponse> {
      yield {
        chatHistoryOutput: { deltaText: 'Starting...' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
      // Abort after first chunk
      controller.abort()
      yield {
        chatHistoryOutput: { deltaText: 'Unseen chunk' },
        streamingState: RobinStreamingState.IN_PROGRESS,
      }
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of mapRobinResponsesToChunks(generateHangingStream(), controller.signal)) {
      chunks.push(chunk)
    }

    const finish = chunks.find((c) => c.type === 'finish') as { reason?: { kind?: string } }
    assert.strictEqual(finish?.reason?.kind, 'aborted')
  })

  it('parses raw binary Protobuf frames end-to-end to StreamChunks', async () => {
    // Generate binary protobuf frames
    const writer1 = new ProtobufWriter()
    const chatWriter = new ProtobufWriter()
    chatWriter.writeString(1, 'Binary stream verified!')
    writer1.writeMessage(1, chatWriter.toUint8Array())
    writer1.writeInt32(2, RobinStreamingState.IN_PROGRESS)

    const writer2 = new ProtobufWriter()
    writer2.writeInt32(2, RobinStreamingState.FINISHED)

    async function* rawFrames(): AsyncGenerator<Uint8Array> {
      yield writer1.toUint8Array()
      yield writer2.toUint8Array()
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of parseRobinGrpcFramesToChunks(rawFrames())) {
      chunks.push(chunk)
    }

    const textDelta = chunks.find((c) => c.type === 'text-delta') as { text?: string }
    assert.strictEqual(textDelta?.text, 'Binary stream verified!')

    const finish = chunks.find((c) => c.type === 'finish') as { reason?: { kind?: string } }
    assert.strictEqual(finish?.reason?.kind, 'stop')
  })
})
