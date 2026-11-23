// Comprehensive tests for GeminiAppClient.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { gzipSync } from 'node:zlib'
import {
  GeminiAppClient,
  GeminiAppError,
  type GeminiAppTransport,
} from '../packages/core/src/gemini-app/client.ts'
import {
  RobinStreamingState,
  type ProcessQueryRequest,
  type GeminiAppConfig,
} from '../packages/core/src/gemini-app/types.ts'
import {
  ProtobufWriter,
  encodeGrpcFrame,
  decodeGrpcFrames,
  ProtobufReader,
  ROBIN_EXT_INITIAL,
  ROBIN_EXT_PREFETCH_OR_COMMIT,
  ROBIN_CLIENT_TYPE_AGSA,
} from '../packages/core/src/gemini-app/proto.ts'
import type { StreamChunk } from '../packages/core/src/types/protocol.ts'

describe('Gemini App: Client & Transport', () => {
  it('yields AUTH_REQUIRED when no bearer token is configured', async () => {
    const origEnv = process.env.DSH_GEMINI_APP_TOKEN
    delete process.env.DSH_GEMINI_APP_TOKEN
    delete process.env.GEMINI_APP_TOKEN

    try {
      const client = new GeminiAppClient({ token: '' })
      const request: ProcessQueryRequest = {
        sessionInput: { textPrompt: 'Test' },
      }

      const chunks: StreamChunk[] = []
      for await (const chunk of client.streamProcessQuery(request)) {
        chunks.push(chunk)
      }

      assert.strictEqual(chunks.length, 1)
      const finish = chunks[0] as { reason?: { kind?: string; failure?: { code?: string; message?: string } } }
      assert.strictEqual(finish.reason?.kind, 'error')
      assert.strictEqual(finish.reason?.failure?.code, 'AUTH_REQUIRED')
      assert.ok(finish.reason?.failure?.message?.includes('token is missing'))
    } finally {
      if (origEnv !== undefined) process.env.DSH_GEMINI_APP_TOKEN = origEnv
    }
  })

  it('correctly dispatches gRPC request with required headers and length-prefixed frame', async () => {
    let capturedEndpoint = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Uint8Array = new Uint8Array(0)

    const mockTransport: GeminiAppTransport = async (endpoint, headers, body) => {
      capturedEndpoint = endpoint
      capturedHeaders = headers
      capturedBody = body

      // Build mock responses
      const w1 = new ProtobufWriter()
      const c1 = new ProtobufWriter()
      c1.writeString(1, 'Hello from ')
      w1.writeMessage(1, c1.toUint8Array())
      w1.writeInt32(2, RobinStreamingState.IN_PROGRESS)

      const w2 = new ProtobufWriter()
      const c2 = new ProtobufWriter()
      c2.writeString(1, 'Gemini App!')
      w2.writeMessage(1, c2.toUint8Array())
      w2.writeInt32(2, RobinStreamingState.FINISHED)

      async function* frames(): AsyncGenerator<Uint8Array> {
        yield w1.toUint8Array()
        yield w2.toUint8Array()
      }

      return {
        frames: frames(),
        getTrailers: () => ({ 'grpc-status': 0 }),
      }
    }

    const config: GeminiAppConfig = {
      endpoint: 'robinfrontend-pa.googleapis.com',
      token: 'ya29.mock_token_123',
    }
    const client = new GeminiAppClient(config, mockTransport)

    const request: ProcessQueryRequest = {
      sessionInput: { textPrompt: 'Ping' },
      deviceContext: { deviceModel: 'OnePlus PJZ110' },
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of client.streamProcessQuery(request)) {
      chunks.push(chunk)
    }

    // Assert transport inputs
    assert.strictEqual(capturedEndpoint, 'robinfrontend-pa.googleapis.com')
    assert.strictEqual(capturedHeaders['content-type'], 'application/grpc')
    assert.strictEqual(capturedHeaders['grpc-accept-encoding'], 'gzip')
    assert.strictEqual(capturedHeaders['te'], 'trailers')
    assert.strictEqual(capturedHeaders['authorization'], 'Bearer ya29.mock_token_123')
    assert.ok(capturedHeaders['user-agent']?.includes('grpc-java-cronet'))
    assert.strictEqual(capturedHeaders['x-goog-api-client'], 'gl-android/35')

    // Decode and assert the 3-frame BIDI_STREAMING request body
    const { frames } = decodeGrpcFrames(capturedBody)
    assert.strictEqual(frames.length, 3)

    // Frame 1: ext 1000 -> field 1 (field 4 = 1 AGSA), field 2 (field 1 = 'Ping')
    const r1 = new ProtobufReader(frames[0]!)
    const t1 = r1.readTag()
    assert.strictEqual(t1?.fieldNumber, ROBIN_EXT_INITIAL)
    const ext1 = r1.readSubReader()
    const cTag = ext1.readTag()
    assert.strictEqual(cTag?.fieldNumber, 1)
    const cSub = ext1.readSubReader()
    assert.strictEqual(cSub.readTag()?.fieldNumber, 4)
    assert.strictEqual(cSub.readInt32(), ROBIN_CLIENT_TYPE_AGSA)
    const qTag = ext1.readTag()
    assert.strictEqual(qTag?.fieldNumber, 2)
    const qSub = ext1.readSubReader()
    assert.strictEqual(qSub.readTag()?.fieldNumber, 1)
    assert.strictEqual(qSub.readString(), 'Ping')

    // Frame 2: ext 1007 -> field 1 = 'Ping'
    const r2 = new ProtobufReader(frames[1]!)
    assert.strictEqual(r2.readTag()?.fieldNumber, ROBIN_EXT_PREFETCH_OR_COMMIT)
    const ext2 = r2.readSubReader()
    assert.strictEqual(ext2.readTag()?.fieldNumber, 1)
    assert.strictEqual(ext2.readString(), 'Ping')

    // Frame 3: ext 1007 -> field 2 = Empty (0x12 0x00)
    assert.deepStrictEqual(Array.from(frames[2]!), [0xfa, 0x3e, 0x02, 0x12, 0x00])

    // Assert stream chunks
    const textDeltas = chunks.filter((c) => c.type === 'text-delta')
    assert.strictEqual(textDeltas.length, 2)
    assert.strictEqual((textDeltas[0] as { text: string }).text, 'Hello from ')
    assert.strictEqual((textDeltas[1] as { text: string }).text, 'Gemini App!')

    const finish = chunks.find((c) => c.type === 'finish') as { reason?: { kind?: string } }
    assert.strictEqual(finish?.reason?.kind, 'stop')
  })

  it('aggregates chunks cleanly for non-streaming processQuery', async () => {
    const mockTransport: GeminiAppTransport = async () => {
      const w1 = new ProtobufWriter()
      const c1 = new ProtobufWriter()
      c1.writeString(1, 'Complete non-')
      w1.writeMessage(1, c1.toUint8Array())
      w1.writeInt32(2, RobinStreamingState.IN_PROGRESS)

      const w2 = new ProtobufWriter()
      const c2 = new ProtobufWriter()
      c2.writeString(1, 'streaming response.')
      w2.writeMessage(1, c2.toUint8Array())
      w2.writeInt32(2, RobinStreamingState.FINISHED)

      async function* frames(): AsyncGenerator<Uint8Array> {
        yield w1.toUint8Array()
        yield w2.toUint8Array()
      }

      return {
        frames: frames(),
        getTrailers: () => ({ 'grpc-status': 0 }),
      }
    }

    const client = new GeminiAppClient({ token: 'ya29.test' }, mockTransport)
    const res = await client.processQuery({ sessionInput: { textPrompt: 'Hi' } })

    assert.strictEqual(res.text, 'Complete non-streaming response.')
    assert.strictEqual(res.response.chatHistoryOutput?.fullText, 'Complete non-streaming response.')
  })

  it('handles transport connection errors gracefully with error finish', async () => {
    const failingTransport: GeminiAppTransport = async () => {
      throw new GeminiAppError('Network unreachable', 'CONNECTION_FAILED', 503)
    }

    const client = new GeminiAppClient({ token: 'ya29.test' }, failingTransport)
    const chunks: StreamChunk[] = []
    for await (const chunk of client.streamProcessQuery({ sessionInput: { textPrompt: 'Hi' } })) {
      chunks.push(chunk)
    }

    assert.strictEqual(chunks.length, 1)
    const finish = chunks[0] as { reason?: { kind?: string; failure?: { code?: string; message?: string } } }
    assert.strictEqual(finish?.reason?.kind, 'error')
    assert.strictEqual(finish?.reason?.failure?.code, 'CONNECTION_FAILED')
    assert.ok(finish?.reason?.failure?.message?.includes('Network unreachable'))
  })

  it('throws GeminiAppError when non-streaming processQuery fails', async () => {
    const failingTransport: GeminiAppTransport = async () => {
      throw new GeminiAppError('Rate limit exceeded', 'RATE_LIMIT', 429)
    }

    const client = new GeminiAppClient({ token: 'ya29.test' }, failingTransport)
    await assert.rejects(
      async () => {
        await client.processQuery({ sessionInput: { textPrompt: 'Hi' } })
      },
      (err: unknown) => {
        assert.ok(err instanceof GeminiAppError)
        assert.strictEqual(err.code, 'RATE_LIMIT')
        return true
      },
    )
  })

  it('decompresses gzip-compressed gRPC response frames transparently', async () => {
    const gzipTransport: GeminiAppTransport = async () => {
      async function* frames() {
        const w = new ProtobufWriter()
        const c = new ProtobufWriter()
        c.writeString(1, 'Gzipped response text')
        w.writeMessage(1, c.toUint8Array())
        w.writeInt32(2, RobinStreamingState.FINISHED)
        const compressed = new Uint8Array(gzipSync(w.toUint8Array()))
        // Transport yields raw frame payload; test decodeGrpcFrames + client integration via raw chunk
        // Note: GeminiAppTransport yields already-unframed protobuf payloads, so we verify encodeGrpcFrame(compressed, true) -> decodeGrpcFrames
        const grpcBytes = encodeGrpcFrame(compressed, true)
        const decoded = decodeGrpcFrames(grpcBytes)
        for (const f of decoded.frames) {
          yield f
        }
      }
      return {
        frames: frames(),
        getTrailers: () => ({ 'grpc-status': 0 }),
      }
    }

    const client = new GeminiAppClient({ token: 'ya29.test' }, gzipTransport)
    const result = await client.processQuery({ sessionInput: { textPrompt: 'Hi' } })
    assert.strictEqual(result.text, 'Gzipped response text')
  })

  it('streams cumulative f1003 frames without duplicating text and finishes on f1003.f2', async () => {
    const f1003Transport: GeminiAppTransport = async () => {
      async function* frames() {
        const makeTextFrame = (text: string) => {
          const cand = new ProtobufWriter()
          cand.writeString(7, text)
          const ids = new ProtobufWriter()
          ids.writeString(1, 'c_stream_1')
          ids.writeString(2, 'r_stream_1')
          const bard = new ProtobufWriter()
          bard.writeMessage(1, cand.toUint8Array())
          bard.writeMessage(2, ids.toUint8Array())
          const ext = new ProtobufWriter()
          ext.writeMessage(1, bard.toUint8Array())
          const resp = new ProtobufWriter()
          resp.writeMessage(1003, ext.toUint8Array())
          return resp.toUint8Array()
        }

        yield makeTextFrame('O')
        yield makeTextFrame('OK')

        const extEnd = new ProtobufWriter()
        extEnd.writeEmptyMessage(2)
        const respEnd = new ProtobufWriter()
        respEnd.writeMessage(1003, extEnd.toUint8Array())
        yield respEnd.toUint8Array()
      }
      return {
        frames: frames(),
        getTrailers: () => ({ 'grpc-status': 0 }),
      }
    }

    const client = new GeminiAppClient({ token: 'ya29.test' }, f1003Transport)
    const chunks = []
    for await (const chunk of client.streamProcessQuery({ sessionInput: { textPrompt: 'Reply with OK only.' } })) {
      chunks.push(chunk)
    }
    const textDeltas = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { text: string }).text)
    assert.deepStrictEqual(textDeltas, ['O', 'K'])
    const finish = chunks.find((c) => c.type === 'finish') as { reason?: { kind?: string } } | undefined
    assert.strictEqual(finish?.reason?.kind, 'stop')

    const result = await client.processQuery({ sessionInput: { textPrompt: 'Reply with OK only.' } })
    assert.strictEqual(result.text, 'OK')
  })
})
