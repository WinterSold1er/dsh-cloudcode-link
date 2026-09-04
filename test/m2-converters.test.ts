import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BlockAssembler, type CallId, type Message, type ToolSchema } from '@deepseek-ai/dsh-llm'
import {
  convertTools,
  dereferenceSchema,
  ensureRootObjectSchema,
  normalizeCustomToolSchema,
  stripMetaSchema,
} from '../src/host/schema-converter.ts'
import {
  convertMessages,
  isValidThoughtSignature,
  sanitizeTopology,
} from '../src/host/message-converter.ts'
import {
  calculateNetUsage,
  createFinishReason,
  mapFinishReason,
  mapSseStreamToChunks,
} from '../src/host/sse-mapper.ts'
import { getAntigravityRequestModelId } from '../src/host/models.ts'
import { antigravityRequestEnvelope } from '../src/host/client.ts'

describe('M2: Converters & Sanitizer', () => {
  describe('Schema Converter', () => {
    it('convertTools handles Gemini model with parametersJsonSchema', () => {
      const tools: ToolSchema[] = [
        {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      ]

      const converted = convertTools(tools, false)
      assert.ok(converted)
      assert.equal(converted.length, 1)
      const decl = converted[0]!.functionDeclarations[0]!
      assert.equal(decl.name, 'get_weather')
      assert.equal(decl.description, 'Get current weather')
      assert.ok(decl.parametersJsonSchema)
      assert.equal(decl.parameters, undefined)
      // $schema should be stripped
      assert.equal((decl.parametersJsonSchema as Record<string, unknown>).$schema, undefined)
    })

    it('convertTools handles Claude/GPT-OSS with legacy parameters and allowlist', () => {
      const tools: ToolSchema[] = [
        {
          name: 'bash',
          description: 'Run bash command',
          parameters: {
            type: 'object',
            $defs: { CustomType: { type: 'string' } },
            properties: {
              cmd: { type: 'string', nullable: true, extraKeyword: 'drop-me' },
            },
            required: ['cmd'],
          },
        },
      ]

      const converted = convertTools(tools, true)
      assert.ok(converted)
      const decl = converted[0]!.functionDeclarations[0]!
      assert.ok(decl.parameters)
      assert.equal(decl.parametersJsonSchema, undefined)
      const props = (decl.parameters as Record<string, unknown>).properties as Record<string, unknown>
      const cmdProp = props.cmd as Record<string, unknown>
      assert.equal(cmdProp.type, 'string')
      assert.equal(cmdProp.nullable, undefined)
      assert.equal(cmdProp.extraKeyword, undefined)
    })

    it('derives legacy schema and envelope labels for model aliases via wireModel', () => {
      const tools: ToolSchema[] = [
        {
          name: 'exec',
          description: 'Execute',
          parameters: {
            type: 'object',
            properties: { cmd: { type: 'string' } },
            required: ['cmd'],
          },
        },
      ]

      // Alias: sonnet -> claude-sonnet-4-6
      const wireSonnet = getAntigravityRequestModelId('sonnet')
      const isClaudeSonnet = wireSonnet.startsWith('claude-')
      const isGptOssSonnet = wireSonnet.startsWith('gpt-oss-')
      assert.equal(wireSonnet, 'claude-sonnet-4-6')
      assert.equal(isClaudeSonnet, true)
      const convertedSonnet = convertTools(tools, isClaudeSonnet || isGptOssSonnet)
      assert.ok(convertedSonnet?.[0]?.functionDeclarations[0]?.parameters)
      assert.equal(convertedSonnet?.[0]?.functionDeclarations[0]?.parametersJsonSchema, undefined)

      const envSonnet = antigravityRequestEnvelope(wireSonnet, isClaudeSonnet)
      assert.equal(envSonnet.labels.used_claude, 'true')
      assert.equal(envSonnet.labels.used_claude_conservative, 'true')

      // Alias: gpt-oss -> gpt-oss-120b-medium
      const wireGptOss = getAntigravityRequestModelId('gpt-oss')
      const isClaudeGptOss = wireGptOss.startsWith('claude-')
      const isGptOssGptOss = wireGptOss.startsWith('gpt-oss-')
      assert.equal(wireGptOss, 'gpt-oss-120b-medium')
      assert.equal(isGptOssGptOss, true)
      const convertedGptOss = convertTools(tools, isClaudeGptOss || isGptOssGptOss)
      assert.ok(convertedGptOss?.[0]?.functionDeclarations[0]?.parameters)
      assert.equal(convertedGptOss?.[0]?.functionDeclarations[0]?.parametersJsonSchema, undefined)

      const envGptOss = antigravityRequestEnvelope(wireGptOss, isClaudeGptOss)
      assert.equal(envGptOss.labels.used_claude, 'false')

      // Gemini wireModel -> modern schema
      const wireGemini = getAntigravityRequestModelId('gemini-3.7-flash', 'high')
      const isClaudeGemini = wireGemini.startsWith('claude-')
      const isGptOssGemini = wireGemini.startsWith('gpt-oss-')
      const convertedGemini = convertTools(tools, isClaudeGemini || isGptOssGemini)
      assert.ok(convertedGemini?.[0]?.functionDeclarations[0]?.parametersJsonSchema)
      assert.equal(convertedGemini?.[0]?.functionDeclarations[0]?.parameters, undefined)

      const envGemini = antigravityRequestEnvelope(wireGemini, isClaudeGemini)
      assert.equal(envGemini.labels.used_claude, 'false')
    })
  })

  describe('Message Converter & Sanitizer', () => {
    it('isValidThoughtSignature checks valid base64 signatures', () => {
      assert.equal(isValidThoughtSignature('abcd'), true)
      assert.equal(isValidThoughtSignature('YWJjZGVmZw=='), true)
      assert.equal(isValidThoughtSignature('invalid-sig!'), false)
      assert.equal(isValidThoughtSignature(''), false)
      assert.equal(isValidThoughtSignature(undefined), false)
    })

    it('convertMessages handles async ImageBlock readImage', async () => {
      const fakeImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])
      const msgs: Message[] = [
        {
          id: 'm1' as any,
          source: { kind: 'user' } as any,
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image:' },
            { type: 'image', attachment: { attachmentId: 'img-1' } as any },
          ],
        },
      ]

      const readImage = async (ref: any) => {
        if (ref.attachmentId === 'img-1') return fakeImageBytes
        return null
      }

      const contents = await convertMessages(msgs, readImage)
      assert.equal(contents.length, 1)
      assert.equal(contents[0]!.role, 'user')
      assert.equal(contents[0]!.parts.length, 2)
      const textPart = contents[0]!.parts[0]!
      const imgPart = contents[0]!.parts[1]!
      assert.ok('text' in textPart)
      assert.ok('inlineData' in imgPart)
      if ('inlineData' in imgPart) {
        assert.equal(imgPart.inlineData.mimeType, 'image/png')
        assert.equal(imgPart.inlineData.data, fakeImageBytes.toString('base64'))
      }
    })

    it('sanitizeTopology strips unsigned thoughts and sanitizes orphan functionResponses', () => {
      const input = [
        {
          role: 'user' as const,
          parts: [{ text: 'Run tool' }],
        },
        {
          role: 'model' as const,
          parts: [
            { thought: true as const, text: 'Thinking without signature' },
            { thought: true as const, text: 'Thinking with signature', thoughtSignature: 'YWJjZA==' },
            { functionCall: { id: 'call_1', name: 'read_file', args: { path: 'a.txt' } } },
          ],
        },
        {
          role: 'user' as const,
          parts: [
            { functionResponse: { id: 'call_1', name: 'read_file', response: { output: 'file content' } } },
            { functionResponse: { id: 'orphan_call', name: 'orphan_tool', response: { output: 'orphan content' } } },
          ],
        },
      ]

      const clean = sanitizeTopology(input)
      assert.equal(clean.length, 3)

      // Model turn: unsigned thought stripped to text
      const modelParts = clean[1]!.parts
      assert.equal(modelParts.length, 3)
      assert.equal('thought' in modelParts[0]!, false)
      assert.equal((modelParts[0] as { text: string }).text, 'Thinking without signature')
      assert.equal('thought' in modelParts[1]!, true)

      // User turn: matched response kept, orphan response turned into observation text
      const userParts = clean[2]!.parts
      assert.equal(userParts.length, 2)
      assert.ok('functionResponse' in userParts[0]!)
      assert.ok('text' in userParts[1]!)
      assert.match((userParts[1] as { text: string }).text, /\[Observation from `orphan_tool`:/)
    })

    it('prepends user hello if conversation starts with model', async () => {
      const msgs: Message[] = [
        {
          id: 'm2' as any,
          source: { kind: 'model', provider: 'antigravity', model: 'gemini-3.7-flash' } as any,
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, how can I help?' }],
        },
      ]

      const contents = await convertMessages(msgs)
      assert.equal(contents.length, 2)
      assert.equal(contents[0]!.role, 'user')
      assert.equal((contents[0]!.parts[0] as { text: string }).text, 'Hello')
      assert.equal(contents[1]!.role, 'model')
    })

    it('convertMessages handles empty messages array and empty content safely', async () => {
      const empty = await convertMessages([])
      assert.deepEqual(empty, [])

      const msgsEmptyContent: Message[] = [
        {
          id: 'm3' as any,
          source: { kind: 'user' } as any,
          role: 'user',
          content: [],
        },
      ]
      const converted = await convertMessages(msgsEmptyContent)
      assert.deepEqual(converted, [])
    })

    it('convertMessages preserves thoughtSignature on tool-call and reasoning blocks for multi-turn Gemini requests', async () => {
      const validSig = 'YWJjZA=='
      const msgs: Message[] = [
        {
          id: 'm1' as any,
          source: { kind: 'user' } as any,
          role: 'user',
          content: [{ type: 'text', text: 'Read file hello.txt' }],
        },
        {
          id: 'm2' as any,
          source: { kind: 'model', provider: 'antigravity', model: 'gemini-3.7-flash' } as any,
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Thinking about reading file...', thoughtSignature: validSig } as any,
            {
              type: 'tool-call',
              id: 'call_read_1' as CallId,
              name: 'default_api:read',
              arguments: JSON.stringify({ file_path: './hello.txt' }),
              thoughtSignature: validSig,
            } as any,
          ],
        },
        {
          id: 'm3' as any,
          source: { kind: 'user' } as any,
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_read_1' as CallId,
              content: [{ type: 'text', text: 'E2E_OK_12345' }],
            } as any,
          ],
        },
      ]

      const contents = await convertMessages(msgs)
      assert.equal(contents.length, 3)

      // Turn 1: user text
      assert.equal(contents[0]!.role, 'user')
      assert.equal((contents[0]!.parts[0] as { text: string }).text, 'Read file hello.txt')

      // Turn 2: model with thought + functionCall, both carrying thoughtSignature
      assert.equal(contents[1]!.role, 'model')
      assert.equal(contents[1]!.parts.length, 2)
      const thoughtPart = contents[1]!.parts[0] as any
      assert.equal(thoughtPart.thought, true)
      assert.equal(thoughtPart.text, 'Thinking about reading file...')
      assert.equal(thoughtPart.thoughtSignature, validSig)

      const funcCallPart = contents[1]!.parts[1] as any
      assert.ok(funcCallPart.functionCall)
      assert.equal(funcCallPart.functionCall.name, 'default_api:read')
      assert.equal(funcCallPart.functionCall.id, 'call_read_1')
      assert.deepEqual(funcCallPart.functionCall.args, { file_path: './hello.txt' })
      assert.equal(funcCallPart.thoughtSignature, validSig)

      // Turn 3: user functionResponse correctly matched to preceding functionCall
      assert.equal(contents[2]!.role, 'user')
      assert.equal(contents[2]!.parts.length, 1)
      const respPart = contents[2]!.parts[0] as any
      assert.ok(respPart.functionResponse)
      assert.equal(respPart.functionResponse.name, 'default_api:read')
      assert.equal(respPart.functionResponse.id, 'call_read_1')
      assert.deepEqual(respPart.functionResponse.response, { output: 'E2E_OK_12345' })
    })

    it('convertMessages handles unsigned or invalid signature tool-call and reasoning blocks', async () => {
      const msgs: Message[] = [
        {
          id: 'm1' as any,
          source: { kind: 'user' } as any,
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
        {
          id: 'm2' as any,
          source: { kind: 'model', provider: 'antigravity', model: 'gemini-3.7-flash' } as any,
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Thinking without signature' } as any,
            {
              type: 'tool-call',
              id: 'call_unsigned' as CallId,
              name: 'bash',
              arguments: JSON.stringify({ command: 'echo 1' }),
            } as any,
          ],
        },
      ]

      const contents = await convertMessages(msgs)
      assert.equal(contents.length, 2)
      const modelParts = contents[1]!.parts
      assert.equal(modelParts.length, 2)
      // Unsigned reasoning degrades to text in sanitizeTopology
      assert.equal('thought' in modelParts[0]!, false)
      assert.equal((modelParts[0] as { text: string }).text, 'Thinking without signature')
      // Unsigned tool-call retains functionCall but does not have thoughtSignature
      const funcPart = modelParts[1] as any
      assert.ok(funcPart.functionCall)
      assert.equal(funcPart.thoughtSignature, undefined)
    })
  })

  describe('SSE Mapper', () => {
    it('calculateNetUsage computes net prompt tokens and cached tokens', () => {
      const meta = {
        promptTokenCount: 1500,
        cachedContentTokenCount: 500,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 100,
        totalTokenCount: 1800,
      }

      const usage = calculateNetUsage(meta)
      assert.ok(usage)
      assert.equal(usage.inputTokens, 1000)
      assert.equal(usage.cacheReadTokens, 500)
      assert.equal(usage.outputTokens, 300)
      assert.equal(usage.reasoningTokens, 100)
    })

    it('createFinishReason produces type-safe finish reason objects', () => {
      assert.deepEqual(createFinishReason('STOP', false), { kind: 'stop' })
      assert.deepEqual(createFinishReason('STOP', true), { kind: 'tool-calls' })
      assert.deepEqual(createFinishReason('MAX_TOKENS', false), { kind: 'max-tokens' })
      const safety = createFinishReason('SAFETY', false)
      assert.equal(safety.kind, 'error')
      assert.ok('failure' in safety)
    })

    it('finish reason kind matches dsh-llm FinishReason whitelist', () => {
      const allowedKinds = new Set(['stop', 'tool-calls', 'max-tokens', 'aborted', 'error'])

      const r1 = createFinishReason(undefined, false)
      const r2 = createFinishReason('STOP', false)
      const r3 = createFinishReason('STOP', true)
      const r4 = createFinishReason('MAX_TOKENS', false)
      const r5 = createFinishReason('SAFETY', false)
      const r6 = createFinishReason('RECITATION', false)
      const r7 = createFinishReason('UNKNOWN_REASON', false)

      for (const r of [r1, r2, r3, r4, r5, r6, r7]) {
        assert.ok(allowedKinds.has(r.kind), `kind "${r.kind}" must be in allowed FinishReason kinds`)
      }

      assert.equal(mapFinishReason(undefined, false), 'stop')
      assert.equal(mapFinishReason('STOP', true), 'tool-calls')
      assert.equal(mapFinishReason('MAX_TOKENS', false), 'max-tokens')
      assert.equal(mapFinishReason('SAFETY', false), 'error')
    })

    it('mapSseStreamToChunks maps SSE stream to DSH StreamChunks with incremental tool deltas', async () => {
      const ssePayload = [
        'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Let me think"}]}}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Here is the answer"}]}}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"id":"call_100","name":"exec","args":{"cmd":"ls"}}}]}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":50}}}\n\n',
        'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n',
      ].join('')

      const mockResponse = new Response(ssePayload, {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const chunks = []
      for await (const chunk of mapSseStreamToChunks(mockResponse)) {
        chunks.push(chunk)
      }

      assert.ok(chunks.length > 0)
      const types = chunks.map((c) => c.type)

      // Should contain block-start for reasoning, text, tool-call
      assert.ok(types.includes('block-start'))
      assert.ok(types.includes('reasoning-delta'))
      assert.ok(types.includes('text-delta'))
      assert.ok(types.includes('tool-call-delta'))
      assert.ok(types.includes('block-end'))
      assert.ok(types.includes('usage'))
      assert.ok(types.includes('finish'))

      const finishChunk = chunks.find((c) => c.type === 'finish') as any
      assert.ok(finishChunk)
      assert.equal(typeof finishChunk.reason, 'object')
      assert.equal(finishChunk.reason.kind, 'tool-calls')
    })

    it('BlockAssembler incrementally stitches multiple tool-call-delta slices into valid JSON', () => {
      const assembler = new BlockAssembler()

      assembler.push({ type: 'block-start', index: 0, blockType: 'tool-call' })
      assembler.push({
        type: 'tool-call-delta',
        index: 0,
        id: 'call_multi' as CallId,
        name: 'write_file',
        argumentsDelta: '{"path": "test.txt", ',
      })
      assembler.push({
        type: 'tool-call-delta',
        index: 0,
        id: 'call_multi' as CallId,
        name: 'write_file',
        argumentsDelta: '"content": "hello world", ',
      })
      assembler.push({
        type: 'tool-call-delta',
        index: 0,
        id: 'call_multi' as CallId,
        argumentsDelta: '"mode": 420}',
      })
      assembler.push({ type: 'finish', reason: { kind: 'tool-calls' } })

      const blocks = assembler.blocks()
      assert.equal(blocks.length, 1)
      const tc = blocks[0]!
      assert.equal(tc.type, 'tool-call')
      if (tc.type === 'tool-call') {
        assert.equal(tc.id, 'call_multi')
        assert.equal(tc.name, 'write_file')
        const parsed = JSON.parse(tc.arguments)
        assert.deepEqual(parsed, { path: 'test.txt', content: 'hello world', mode: 420 })
      }

      const msg = assembler.message()
      assert.equal(msg.role, 'assistant')
      assert.equal(msg.content.length, 1)
    })

    it('BlockAssembler end-to-end consumes mapSseStreamToChunks output stream with reasoning, text, tool calls, and usage', async () => {
      const ssePayload = [
        'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking step 1... "}]}}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking step 2"}]}}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Executing command: "}]}}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"id":"call_e2e","name":"bash","args":{"command":"pwd"}}}]}}],"usageMetadata":{"promptTokenCount":250,"cachedContentTokenCount":50,"candidatesTokenCount":30,"thoughtsTokenCount":20}}}\n\n',
        'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n',
      ].join('')

      const mockResponse = new Response(ssePayload, {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const assembler = new BlockAssembler()
      for await (const chunk of mapSseStreamToChunks(mockResponse)) {
        assembler.push(chunk)
      }

      const blocks = assembler.blocks()
      assert.equal(blocks.length, 3)
      assert.equal(blocks[0]?.type, 'reasoning')
      assert.equal((blocks[0] as any).text, 'Thinking step 1... Thinking step 2')
      assert.equal(blocks[1]?.type, 'text')
      assert.equal((blocks[1] as any).text, 'Executing command: ')
      assert.equal(blocks[2]?.type, 'tool-call')
      assert.equal((blocks[2] as any).id, 'call_e2e')
      assert.equal((blocks[2] as any).name, 'bash')
      assert.deepEqual(JSON.parse((blocks[2] as any).arguments), { command: 'pwd' })

      assert.deepEqual(assembler.usage, {
        inputTokens: 200,
        outputTokens: 50,
        cacheReadTokens: 50,
        reasoningTokens: 20,
      })
      assert.deepEqual(assembler.finish, { kind: 'tool-calls' })
    })

    it('mapSseStreamToChunks retains thoughtSignature on tool-call and reasoning blocks', async () => {
      const sig1 = 'YWJjZA=='
      const sig2 = 'ZGVmZw=='
      const ssePayload = [
        `data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking...","thoughtSignature":"${sig1}"}]}}]}}\n\n`,
        `data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"id":"call_sig","name":"read_file","args":{"path":"test.txt"}},"thoughtSignature":"${sig2}"}]}}]}}\n\n`,
        'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n',
      ].join('')

      const mockResponse = new Response(ssePayload, {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const chunks = []
      for await (const chunk of mapSseStreamToChunks(mockResponse)) {
        chunks.push(chunk)
      }

      const blockEnds = chunks.filter((c) => c.type === 'block-end') as any[]
      assert.equal(blockEnds.length, 2)

      // Reasoning block-end carries thoughtSignature
      assert.equal(blockEnds[0].block.type, 'reasoning')
      assert.equal(blockEnds[0].block.text, 'Thinking...')
      assert.equal(blockEnds[0].block.thoughtSignature, sig1)

      // Tool call block-end carries thoughtSignature
      assert.equal(blockEnds[1].block.type, 'tool-call')
      assert.equal(blockEnds[1].block.name, 'read_file')
      assert.equal(blockEnds[1].block.thoughtSignature, sig2)
    })
  })
})
