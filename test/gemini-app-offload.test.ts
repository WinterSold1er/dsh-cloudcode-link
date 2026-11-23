// Comprehensive tests for Gemini App dual-track offload (Track A: Adapter offload + fresh session,
// Track B: gemini_app_ask tool, config, and /ccl gemini-offload command).

import { describe, it } from 'node:test'
import assert from 'node:assert'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { defaultConfig, type PluginConfig } from '../src/common/types.ts'
import { resolveConfig } from '../src/common/config.ts'
import { cclCommandDefinition, renderStatus, type CommandDeps } from '../src/host/commands.ts'
import { GeminiAppAdapter } from '../src/host/gemini-app-adapter.ts'
import {
  estimateContextChars,
  hasToolUsageInMessages,
  shouldOffloadToGeminiApp,
  buildFreshSessionOptions,
  streamWithGeminiAppOffload,
} from '../src/host/gemini-app-offload.ts'
import { defineGeminiAppAskTool } from '../src/host/gemini-app-ask-tool.ts'
import {
  ProtobufWriter,
  ProtobufReader,
  WIRE_TYPE_LENGTH_DELIMITED,
  WIRE_TYPE_VARINT,
  encodeGrpcFrame,
  decodeGrpcFrames,
  type GeminiAppTransport,
} from '../src/host/gemini-app.ts'
import { RobinBardMode, RobinStreamingState } from '../packages/core/src/gemini-app/types.ts'

function encodeMockResponseFrame(text: string, state: number): Uint8Array {
  const chatOut = new ProtobufWriter()
  chatOut.writeString(1, text)
  chatOut.writeString(2, text)
  const resp = new ProtobufWriter()
  resp.writeMessage(1, chatOut.toUint8Array())
  resp.writeInt32(2, state)
  return resp.toUint8Array()
}

function extractPromptAndModeFromRequest(body: Uint8Array): { prompt: string; modeId?: number } {
  const { frames } = decodeGrpcFrames(body)
  const reader = new ProtobufReader(frames[0]!)
  let prompt = ''
  let modeId: number | undefined
  while (!reader.isAtEnd()) {
    const tag = reader.readTag()
    if (!tag) break
    if (tag.fieldNumber === 1000 && tag.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const ext = new ProtobufReader(reader.readBytes())
      while (!ext.isAtEnd()) {
        const et = ext.readTag()
        if (!et) break
        if (et.fieldNumber === 2 && et.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
          const q = new ProtobufReader(ext.readBytes())
          while (!q.isAtEnd()) {
            const qt = q.readTag()
            if (!qt) break
            if (qt.fieldNumber === 1 && qt.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
              prompt = q.readString()
            } else {
              q.skipField(qt.wireType)
            }
          }
        } else {
          ext.skipField(et.wireType)
        }
      }
    } else if (tag.fieldNumber === 3 && tag.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const sub = new ProtobufReader(reader.readBytes())
      while (!sub.isAtEnd()) {
        const st = sub.readTag()
        if (!st) break
        if (st.fieldNumber === 1 && st.wireType === WIRE_TYPE_VARINT) {
          modeId = sub.readInt32()
        } else {
          sub.skipField(st.wireType)
        }
      }
    } else {
      reader.skipField(tag.wireType)
    }
  }
  return { prompt, modeId }
}

function makeOffloadConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    ...defaultConfig(),
    geminiAppEnabled: true,
    geminiAppToken: 'ya29.test_offload_token',
    geminiAppOffloadEnabled: true,
    geminiAppAskToolEnabled: true,
    ...overrides,
  }
}

function makeSuccessTransport(
  replyText: string,
  onRequest?: (body: Uint8Array, headers: Record<string, string>) => void,
): GeminiAppTransport {
  return async (_endpoint, headers, body) => {
    onRequest?.(body, headers)
    const frame = encodeMockResponseFrame(replyText, RobinStreamingState.FINISHED)
    return {
      frames: (async function* () {
        yield frame
      })(),
      getTrailers: () => ({ 'grpc-status': '0' }),
    }
  }
}

describe('Gemini App Offload: Config & Commands', () => {
  it('resolves offload defaults and follows geminiAppOffloadEnabled for geminiAppAskToolEnabled', () => {
    const base = resolveConfig({}, {}, {})
    assert.strictEqual(base.geminiAppOffloadEnabled, false)
    assert.strictEqual(base.geminiAppOffloadMaxContextChars, 3_000_000)
    assert.strictEqual(base.geminiAppFreshSessionMaxChars, 32_000)
    assert.strictEqual(base.geminiAppFreshSessionSingleTurn, false)
    assert.strictEqual(base.geminiAppOffloadFallbackToAgy, true)
    assert.strictEqual(base.geminiAppAskToolEnabled, false)

    const envEnabled = resolveConfig(
      {},
      {
        DSH_GEMINI_APP_OFFLOAD_ENABLED: 'true',
        DSH_GEMINI_APP_OFFLOAD_MAX_CHARS: '80000',
        DSH_GEMINI_APP_FRESH_SESSION_MAX_CHARS: '16000',
        DSH_GEMINI_APP_FRESH_SESSION_SINGLE_TURN: 'true',
        DSH_GEMINI_APP_OFFLOAD_FALLBACK: 'false',
      },
      {},
    )
    assert.strictEqual(envEnabled.geminiAppOffloadEnabled, true)
    assert.strictEqual(envEnabled.geminiAppAskToolEnabled, true)
    assert.strictEqual(envEnabled.geminiAppOffloadMaxContextChars, 80_000)
    assert.strictEqual(envEnabled.geminiAppFreshSessionMaxChars, 16_000)
    assert.strictEqual(envEnabled.geminiAppFreshSessionSingleTurn, true)
    assert.strictEqual(envEnabled.geminiAppOffloadFallbackToAgy, false)

    const envAskOverride = resolveConfig(
      {},
      {
        DSH_GEMINI_APP_OFFLOAD_ENABLED: 'true',
        DSH_GEMINI_APP_ASK_TOOL: 'false',
      },
      {},
    )
    assert.strictEqual(envAskOverride.geminiAppOffloadEnabled, true)
    assert.strictEqual(envAskOverride.geminiAppAskToolEnabled, false)
  })

  it('handles /ccl gemini-offload on|off and renders offload status in /ccl status', async () => {
    const overrides: Record<string, unknown> = {}
    const cfg = makeOffloadConfig({ geminiAppOffloadEnabled: false, geminiAppAskToolEnabled: false })
    const deps: CommandDeps = {
      cfg: () => ({ ...cfg, ...overrides } as PluginConfig),
      auth: () => null,
      catalog: () => ({ get: () => ({ source: 'fallback', models: [] }) }) as never,
      lastRun: () => null,
      setOverride: (k, v) => {
        overrides[k] = v
      },
      runDoctor: async () => '/tmp/doc.txt',
    }

    const cmd = cclCommandDefinition(deps)
    const onRes = await cmd.handler({ rawInput: 'gemini-offload on' } as never)
    assert.strictEqual(onRes.kind, 'success')
    assert.strictEqual(overrides.geminiAppOffloadEnabled, true)

    const statusOn = await renderStatus(deps)
    assert.ok(statusOn.includes('offload: on'))

    const offRes = await cmd.handler({ rawInput: 'gemini-offload off' } as never)
    assert.strictEqual(offRes.kind, 'success')
    assert.strictEqual(overrides.geminiAppOffloadEnabled, false)

    const badRes = await cmd.handler({ rawInput: 'gemini-offload maybe' } as never)
    assert.strictEqual(badRes.kind, 'error')
    assert.ok(badRes.text?.includes('usage: /ccl gemini-offload <on|off>'))
  })
})

describe('Gemini App Offload: Eligibility & Fresh Session Trimming', () => {
  it('estimates context chars and detects tool usage across roles and blocks', () => {
    const opts = {
      system: 'Be concise.',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
      ],
    } as unknown as GenerateOptions

    assert.strictEqual(estimateContextChars(opts), 'Be concise.'.length + 'Hello'.length + 'Hi there'.length)
    assert.strictEqual(hasToolUsageInMessages(opts.messages), false)

    assert.strictEqual(
      hasToolUsageInMessages([{ role: 'tool', content: 'ok' }] as unknown as GenerateOptions['messages']),
      true,
    )
    assert.strictEqual(
      hasToolUsageInMessages([
        { role: 'assistant', content: [{ type: 'tool-call', name: 'bash', arguments: '{}' }] },
      ] as unknown as GenerateOptions['messages']),
      true,
    )
    assert.strictEqual(
      hasToolUsageInMessages([
        { role: 'user', content: [{ type: 'tool_result', content: 'done' }] },
      ] as unknown as GenerateOptions['messages']),
      true,
    )
  })

  it('rejects offload when tools, tool history, stop sequences, oversized context, or missing token', async () => {
    const cfg = makeOffloadConfig({ geminiAppOffloadMaxContextChars: 50 })
    const baseOpts = {
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'Summarize this.' }],
    } as unknown as GenerateOptions

    assert.strictEqual(await shouldOffloadToGeminiApp(baseOpts, cfg), true)

    assert.strictEqual(
      await shouldOffloadToGeminiApp(baseOpts, makeOffloadConfig({ geminiAppOffloadEnabled: false })),
      false,
    )
    assert.strictEqual(
      await shouldOffloadToGeminiApp(
        { ...baseOpts, tools: [{ name: 'bash', description: 'run', parameters: {} }] } as unknown as GenerateOptions,
        cfg,
      ),
      false,
    )
    assert.strictEqual(
      await shouldOffloadToGeminiApp(
        {
          ...baseOpts,
          messages: [
            { role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] },
            { role: 'user', content: 'next' },
          ],
        } as unknown as GenerateOptions,
        cfg,
      ),
      false,
    )
    assert.strictEqual(
      await shouldOffloadToGeminiApp({ ...baseOpts, stop: ['END'] } as unknown as GenerateOptions, cfg),
      false,
    )
    assert.strictEqual(
      await shouldOffloadToGeminiApp(
        { ...baseOpts, messages: [{ role: 'user', content: 'x'.repeat(51) }] } as unknown as GenerateOptions,
        cfg,
      ),
      false,
    )

    const prevEnv = process.env.DSH_GEMINI_APP_TOKEN
    delete process.env.DSH_GEMINI_APP_TOKEN
    try {
      assert.strictEqual(
        await shouldOffloadToGeminiApp(baseOpts, makeOffloadConfig({ geminiAppToken: undefined })),
        false,
      )
    } finally {
      if (prevEnv !== undefined) process.env.DSH_GEMINI_APP_TOKEN = prevEnv
    }
  })

  it('trims small-context multi-turn history to fresh single-turn session preserving system and images', () => {
    const cfg = makeOffloadConfig({ geminiAppFreshSessionMaxChars: 500, geminiAppFreshSessionSingleTurn: true })
    const imgBlock = { type: 'image', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }
    const opts = {
      model: 'gemini-3.8-flash',
      sessionId: 'sess-123',
      system: 'Top-level system prompt',
      messages: [
        { role: 'system', content: 'Role system prompt' },
        { role: 'user', content: 'Old question' },
        { role: 'assistant', content: 'Old answer' },
        { role: 'user', content: [{ type: 'text', text: 'Describe this image' }, imgBlock] },
      ],
    } as unknown as GenerateOptions

    const trimmed = buildFreshSessionOptions(opts, cfg)
    assert.strictEqual((trimmed as { sessionId?: string }).sessionId, undefined)
    assert.strictEqual((trimmed as { system?: string }).system, 'Top-level system prompt')
    assert.strictEqual(trimmed.messages.length, 2)
    assert.strictEqual(trimmed.messages[0]?.role, 'system')
    assert.strictEqual(trimmed.messages[1]?.role, 'user')
    assert.ok(Array.isArray(trimmed.messages[1]?.content))
    assert.strictEqual((trimmed.messages[1]?.content as unknown[]).length, 2)

    // When context exceeds freshSessionMaxChars, keep full history (still strip sessionId)
    const largeCfg = makeOffloadConfig({ geminiAppFreshSessionMaxChars: 10, geminiAppFreshSessionSingleTurn: true })
    const untrimmed = buildFreshSessionOptions(opts, largeCfg)
    assert.strictEqual((untrimmed as { sessionId?: string }).sessionId, undefined)
    assert.strictEqual(untrimmed.messages.length, 4)
  })
})

describe('Gemini App Offload: Streaming & Fallback', () => {
  it('offloads eligible request with trimmed single-turn prompt and streams response', async () => {
    let capturedPrompt = ''
    const transport = makeSuccessTransport('Offloaded answer', (body) => {
      capturedPrompt = extractPromptAndModeFromRequest(body).prompt
    })

    const cfg = makeOffloadConfig({ geminiAppFreshSessionSingleTurn: true })
    const geminiAdapter = new GeminiAppAdapter({ getConfig: () => cfg, transport })
    let agyCalled = false

    const opts = {
      model: 'gemini-3.8-flash',
      sessionId: 'sess-abc',
      messages: [
        { role: 'user', content: 'Earlier turn' },
        { role: 'assistant', content: 'Earlier reply' },
        { role: 'user', content: 'Fresh question' },
      ],
    } as unknown as GenerateOptions

    const chunks: StreamChunk[] = []
    for await (const chunk of streamWithGeminiAppOffload(opts, {
      getConfig: () => cfg,
      geminiAdapter,
      fallbackToAgy: async function* () {
        agyCalled = true
      },
    })) {
      chunks.push(chunk)
    }

    assert.strictEqual(agyCalled, false)
    assert.strictEqual(capturedPrompt, 'Fresh question')
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    assert.strictEqual(text, 'Offloaded answer')
  })

  it('falls back to AGY with original untrimmed options on pre-emit failure', async () => {
    const failingTransport: GeminiAppTransport = async () => {
      throw new Error('Robin upstream 503 unavailable')
    }
    const cfg = makeOffloadConfig({ geminiAppOffloadFallbackToAgy: true })
    const geminiAdapter = new GeminiAppAdapter({ getConfig: () => cfg, transport: failingTransport })

    let fallbackMessageCount = 0
    const opts = {
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'user', content: 'Turn 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Turn 2' },
      ],
    } as unknown as GenerateOptions

    const chunks: StreamChunk[] = []
    for await (const chunk of streamWithGeminiAppOffload(opts, {
      getConfig: () => cfg,
      geminiAdapter,
      fallbackToAgy: async function* (fallbackOpts) {
        fallbackMessageCount = fallbackOpts.messages.length
        yield { type: 'text-delta', index: 0, text: 'AGY fallback reply' } as unknown as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as unknown as StreamChunk
      },
    })) {
      chunks.push(chunk)
    }

    assert.strictEqual(fallbackMessageCount, 3)
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    assert.strictEqual(text, 'AGY fallback reply')
  })

  it('does NOT fall back to AGY if error occurs after content has already been emitted', async () => {
    const midStreamFailTransport: GeminiAppTransport = async () => ({
      frames: (async function* () {
        yield encodeMockResponseFrame('Partial', RobinStreamingState.IN_PROGRESS)
        throw new Error('Mid-stream socket reset')
      })(),
    })

    const cfg = makeOffloadConfig({ geminiAppOffloadFallbackToAgy: true })
    const geminiAdapter = new GeminiAppAdapter({ getConfig: () => cfg, transport: midStreamFailTransport })
    let agyCalled = false

    const opts = {
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    } as unknown as GenerateOptions

    const chunks: StreamChunk[] = []
    for await (const chunk of streamWithGeminiAppOffload(opts, {
      getConfig: () => cfg,
      geminiAdapter,
      fallbackToAgy: async function* () {
        agyCalled = true
      },
    })) {
      chunks.push(chunk)
    }

    assert.strictEqual(agyCalled, false)
    const finish = chunks.find((c) => c.type === 'finish') as
      | { reason?: { kind?: string; failure?: { message?: string } } }
      | undefined
    assert.strictEqual(finish?.reason?.kind, 'error')
    assert.ok(finish?.reason?.failure?.message?.includes('Mid-stream socket reset'))
  })
})

describe('Gemini App Offload: gemini_app_ask Tool', () => {
  it('executes stateless request with system prompt and mode selection', async () => {
    let capturedPrompt = ''
    let capturedMode: number | undefined
    const transport = makeSuccessTransport('Tool result text', (body) => {
      const parsed = extractPromptAndModeFromRequest(body)
      capturedPrompt = parsed.prompt
      capturedMode = parsed.modeId
    })

    const tool = defineGeminiAppAskTool({
      cfg: () => makeOffloadConfig(),
      transport,
    })

    const result = await tool.execute(
      {
        prompt: 'Translate hello to French',
        system: 'Output only the translation.',
        mode: 'advanced',
      },
      { signal: new AbortController().signal } as never,
    )

    assert.strictEqual(result, 'Tool result text')
    assert.ok(capturedPrompt.includes('[System Instructions]'))
    assert.ok(capturedPrompt.includes('Output only the translation.'))
    assert.ok(capturedPrompt.includes('Translate hello to French'))
    assert.strictEqual(capturedMode, RobinBardMode.ADVANCED)
  })

  it('validates inputs and surfaces classified errors without swallowing', async () => {
    const tool = defineGeminiAppAskTool({
      cfg: () => makeOffloadConfig({ geminiAppToken: undefined }),
    })

    await assert.rejects(
      () => tool.execute({ prompt: '   ' }, {} as never),
      /prompt must be a non-empty string/,
    )

    await assert.rejects(
      () => tool.execute({ prompt: 'hi', mode: 'turbo' }, {} as never),
      /invalid mode "turbo"/,
    )

    const prevEnv = process.env.DSH_GEMINI_APP_TOKEN
    delete process.env.DSH_GEMINI_APP_TOKEN
    try {
      await assert.rejects(
        () => tool.execute({ prompt: 'hi' }, {} as never),
        /gemini_app_ask failed \[AUTH_REQUIRED\]/,
      )
    } finally {
      if (prevEnv !== undefined) process.env.DSH_GEMINI_APP_TOKEN = prevEnv
    }
  })
})
