// Comprehensive tests for GeminiAppClient.

import { describe, it } from 'node:test'
import assert from 'node:assert'
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
  decodeGrpcFrames,
  decodeProcessQueryResponse,
  encodeProcessQueryRequest,
  ProtobufReader,
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
    assert.strictEqual(capturedHeaders['te'], 'trailers')
    assert.strictEqual(capturedHeaders['authorization'], 'Bearer ya29.mock_token_123')
    assert.ok(capturedHeaders['user-agent']?.includes('grpc-java-cronet'))
    assert.strictEqual(capturedHeaders['x-goog-api-client'], 'gl-android/35')

    // Decode and assert the request body
    const { frames } = decodeGrpcFrames(capturedBody)
    assert.strictEqual(frames.length, 1)
    const reader = new ProtobufReader(frames[0]!)
    const tag = reader.readTag()
    assert.strictEqual(tag?.fieldNumber, 1) // SessionInput
    const sessionReader = reader.readSubReader()
    const sessionTag = sessionReader.readTag()
    assert.strictEqual(sessionTag?.fieldNumber, 1)
    assert.strictEqual(sessionReader.readString(), 'Ping')

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
})
