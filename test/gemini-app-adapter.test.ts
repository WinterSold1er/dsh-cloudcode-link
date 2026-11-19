// Tests for GeminiAppAdapter and DSH integration.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GeminiAppAdapter,
  GEMINI_APP_MODELS,
} from '../src/host/gemini-app-adapter.ts'
import { GEMINI_APP_PROVIDER_ID, defaultConfig, type PluginConfig } from '../src/common/types.ts'
import {
  RobinStreamingState,
  type GeminiAppTransport,
} from '../packages/core/src/gemini-app/index.ts'
import { ProtobufWriter } from '../packages/core/src/gemini-app/proto.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

describe('Gemini App: Host Adapter', () => {
  const createMockConfig = (overrides: Partial<PluginConfig> = {}): PluginConfig => ({
    ...defaultConfig(),
    geminiAppEnabled: true,
    geminiAppEndpoint: 'robinfrontend-pa.googleapis.com',
    geminiAppToken: 'ya29.test_adapter_token',
    geminiAppTimeoutMs: 5000,
    ...overrides,
  })

  it('provides correct provider metadata and model roster', async () => {
    const adapter = new GeminiAppAdapter({
      getConfig: () => createMockConfig(),
    })

    const info = adapter.providerInfo(GEMINI_APP_PROVIDER_ID)
    assert.strictEqual(info.id, GEMINI_APP_PROVIDER_ID)
    assert.strictEqual(info.name, 'Google Gemini (App/Robin)')

    const models = await adapter.listModels(GEMINI_APP_PROVIDER_ID)
    assert.strictEqual(models.length, 3)
    assert.deepStrictEqual(
      models.map((m) => m.id),
      ['gemini-app-default', 'gemini-app-advanced', 'gemini-app-flash'],
    )
  })

  it('resolves model specifications with appropriate context windows', async () => {
    const adapter = new GeminiAppAdapter({
      getConfig: () => createMockConfig(),
    })

    const defModel = await adapter.resolveModel(GEMINI_APP_PROVIDER_ID, 'gemini-app-default')
    assert.strictEqual(defModel.id, 'gemini-app-default')
    assert.strictEqual(defModel.context?.contextWindow, 1_048_576)
    assert.strictEqual(defModel.defaultMaxTokens, 8192)

    const advModel = await adapter.resolveModel(GEMINI_APP_PROVIDER_ID, 'gemini-app-advanced')
    assert.strictEqual(advModel.id, 'gemini-app-advanced')
    assert.strictEqual(advModel.context?.contextWindow, 2_097_152)
  })

  it('streams model responses through mock transport', async () => {
    const mockTransport: GeminiAppTransport = async () => {
      const w1 = new ProtobufWriter()
      const c1 = new ProtobufWriter()
      c1.writeString(1, 'Streaming from ')
      w1.writeMessage(1, c1.toUint8Array())
      w1.writeInt32(2, RobinStreamingState.IN_PROGRESS)

      const w2 = new ProtobufWriter()
      const c2 = new ProtobufWriter()
      c2.writeString(1, 'GeminiAppAdapter!')
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

    const adapter = new GeminiAppAdapter({
      getConfig: () => createMockConfig(),
      transport: mockTransport,
    })

    const call = await adapter.prepareCall(GEMINI_APP_PROVIDER_ID, 'gemini-app-default')
    assert.strictEqual(call.model.id, 'gemini-app-default')

    const options: GenerateOptions = {
      provider: GEMINI_APP_PROVIDER_ID,
      model: 'gemini-app-default',
      messages: [
        {
          id: 'msg-1' as any,
          source: { kind: 'user' },
          role: 'user',
          content: [{ type: 'text', text: 'Hello Gemini Adapter' }],
        },
      ],
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of call.stream(options)) {
      chunks.push(chunk)
    }

    const textDeltas = chunks.filter((c) => c.type === 'text-delta')
    assert.strictEqual(textDeltas.length, 2)
    assert.strictEqual((textDeltas[0] as { text: string }).text, 'Streaming from ')
    assert.strictEqual((textDeltas[1] as { text: string }).text, 'GeminiAppAdapter!')

    const finish = chunks.find((c) => c.type === 'finish') as { reason?: { kind?: string } }
    assert.strictEqual(finish?.reason?.kind, 'stop')
  })

  it('enforces watchdog timeout when transport stalls', async () => {
    const hangingTransport: GeminiAppTransport = async (_endpoint, _headers, _body, signal) => {
      async function* infiniteFrames(): AsyncGenerator<Uint8Array> {
        while (!signal?.aborted) {
          await new Promise((r) => setTimeout(r, 50))
        }
      }
      return {
        frames: infiniteFrames(),
      }
    }

    const adapter = new GeminiAppAdapter({
      getConfig: () => createMockConfig({ geminiAppTimeoutMs: 50 }),
      transport: hangingTransport,
    })

    const options: GenerateOptions = {
      provider: GEMINI_APP_PROVIDER_ID,
      model: 'gemini-app-default',
      messages: [
        {
          id: 'msg-hang' as any,
          source: { kind: 'user' },
          role: 'user',
          content: [{ type: 'text', text: 'Hanging call' }],
        },
      ],
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) {
      chunks.push(chunk)
    }

    const finish = chunks.find((c) => c.type === 'finish') as {
      reason?: { kind?: string; failure?: { code?: string; message?: string } }
    }
    assert.ok(finish)
    assert.strictEqual(finish.reason?.kind, 'aborted')
  })
})
