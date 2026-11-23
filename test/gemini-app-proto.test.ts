// Comprehensive tests for Gemini App (Robin) Protobuf and gRPC framing.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { gzipSync } from 'node:zlib'
import {
  ProtobufWriter,
  ProtobufReader,
  encodeGrpcFrame,
  decodeGrpcFrames,
  encodeProcessQueryRequest,
  encodeProcessQueryFrames,
  decodeProcessQueryResponse,
  ROBIN_EXT_INITIAL,
  ROBIN_EXT_PREFETCH_OR_COMMIT,
  ROBIN_CLIENT_TYPE_AGSA,
  WIRE_TYPE_VARINT,
  WIRE_TYPE_LENGTH_DELIMITED,
} from '../packages/core/src/gemini-app/proto.ts'
import {
  RobinStreamingState,
  RobinBardMode,
  type ProcessQueryRequest,
  type ProcessQueryResponse,
} from '../packages/core/src/gemini-app/types.ts'

describe('Gemini App: Protobuf Wire Codec', () => {
  it('correctly encodes and decodes varints of various magnitudes and negative values', () => {
    const testCases: bigint[] = [
      0n,
      1n,
      127n,
      128n,
      300n,
      16383n,
      16384n,
      2097151n,
      2147483647n,
      9007199254740991n,
      -1n,
      -42n,
    ]

    for (const val of testCases) {
      const writer = new ProtobufWriter()
      writer.writeVarint(val)
      const bytes = writer.toUint8Array()
      assert.ok(bytes.length > 0, `Expected bytes for ${val}`)

      const reader = new ProtobufReader(bytes)
      const decoded = reader.readVarint()
      if (val < 0n) {
        // Two's complement 64-bit equality
        assert.strictEqual(decoded, BigInt.asUintN(64, val))
      } else {
        assert.strictEqual(decoded, val)
      }
      assert.strictEqual(reader.isAtEnd(), true)
    }
  })

  it('correctly encodes and decodes UTF-8 strings including multilingual and emojis', () => {
    const writer = new ProtobufWriter()
    const originalText = 'Hello Gemini! 你好，双子座 🚀 \u{1F916} Special chars: <>&"\''
    writer.writeString(1, originalText)
    const bytes = writer.toUint8Array()

    const reader = new ProtobufReader(bytes)
    const tag = reader.readTag()
    assert.deepStrictEqual(tag, { fieldNumber: 1, wireType: WIRE_TYPE_LENGTH_DELIMITED })
    const decoded = reader.readString()
    assert.strictEqual(decoded, originalText)
    assert.strictEqual(reader.isAtEnd(), true)
  })

  it('skips unknown fields gracefully for backward and forward compatibility', () => {
    const writer = new ProtobufWriter()
    writer.writeInt32(1, 42) // field 1: varint
    writer.writeString(2, 'skip me') // field 2: length-delimited
    writer.writeFixed32(3, 0x12345678) // field 3: 32-bit
    writer.writeFixed64(5, 0x123456789abcdef0n) // field 5: 64-bit
    writer.writeString(4, 'keep me') // field 4: target

    const bytes = writer.toUint8Array()
    const reader = new ProtobufReader(bytes)

    let kept = ''
    while (!reader.isAtEnd()) {
      const tag = reader.readTag()
      if (!tag) break
      if (tag.fieldNumber === 4) {
        kept = reader.readString()
      } else {
        reader.skipField(tag.wireType)
      }
    }
    assert.strictEqual(kept, 'keep me')
  })
})

describe('Gemini App: gRPC Length-Prefixed Framing', () => {
  it('encodes and decodes a single gRPC length-prefixed frame', () => {
    const payload = new TextEncoder().encode('gRPC protobuf payload')
    const frame = encodeGrpcFrame(payload)

    assert.strictEqual(frame.length, 5 + payload.length)
    assert.strictEqual(frame[0], 0, 'Compression flag must be 0 (uncompressed)')

    const len = ((frame[1]! << 24) >>> 0) + (frame[2]! << 16) + (frame[3]! << 8) + frame[4]!
    assert.strictEqual(len, payload.length)

    const { frames, rest } = decodeGrpcFrames(frame)
    assert.strictEqual(frames.length, 1)
    assert.deepStrictEqual(frames[0], payload)
    assert.strictEqual(rest.length, 0)
  })

  it('decodes multiple frames received in a single chunk', () => {
    const p1 = new Uint8Array([10, 20, 30])
    const p2 = new Uint8Array([40, 50, 60, 70])
    const f1 = encodeGrpcFrame(p1)
    const f2 = encodeGrpcFrame(p2)

    const merged = new Uint8Array(f1.length + f2.length)
    merged.set(f1, 0)
    merged.set(f2, f1.length)

    const { frames, rest } = decodeGrpcFrames(merged)
    assert.strictEqual(frames.length, 2)
    assert.deepStrictEqual(frames[0], p1)
    assert.deepStrictEqual(frames[1], p2)
    assert.strictEqual(rest.length, 0)
  })

  it('handles partial frames by returning the remainder for subsequent reassembly', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const fullFrame = encodeGrpcFrame(payload)

    // Slice in half
    const part1 = fullFrame.subarray(0, 7) // header (5) + 2 bytes of payload
    const part2 = fullFrame.subarray(7) // remaining 6 bytes

    const res1 = decodeGrpcFrames(part1)
    assert.strictEqual(res1.frames.length, 0)
    assert.strictEqual(res1.rest.length, 7)

    const combined = new Uint8Array(res1.rest.length + part2.length)
    combined.set(res1.rest, 0)
    combined.set(part2, res1.rest.length)

    const res2 = decodeGrpcFrames(combined)
    assert.strictEqual(res2.frames.length, 1)
    assert.deepStrictEqual(res2.frames[0], payload)
    assert.strictEqual(res2.rest.length, 0)
  })
})

describe('Gemini App: Protobuf Request & Response Serialization', () => {
  it('serializes ProcessQueryRequest with text prompt and device context', () => {
    const req: ProcessQueryRequest = {
      sessionInput: {
        textPrompt: 'What is the speed of light?',
      },
      deviceContext: {
        deviceModel: 'OnePlus PJZ110',
        agsaVersion: '15.42.34.28.arm64',
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai',
      },
      modeConfig: {
        modeId: RobinBardMode.ADVANCED,
        bardModeName: 'Advanced',
      },
    }

    const encoded = encodeProcessQueryRequest(req)
    assert.ok(encoded.length > 0)

    // Inspect fields through ProtobufReader
    const reader = new ProtobufReader(encoded)
    let hasExt1000 = false
    let hasDevice = false
    let hasMode = false

    while (!reader.isAtEnd()) {
      const tag = reader.readTag()
      if (!tag) break
      if (tag.fieldNumber === ROBIN_EXT_INITIAL) {
        hasExt1000 = true
        const extReader = reader.readSubReader()
        let clientType = 0
        let prompt = ''
        while (!extReader.isAtEnd()) {
          const extTag = extReader.readTag()
          if (!extTag) break
          if (extTag.fieldNumber === 1) {
            const clientReader = extReader.readSubReader()
            const cTag = clientReader.readTag()
            assert.strictEqual(cTag?.fieldNumber, 4)
            clientType = clientReader.readInt32()
          } else if (extTag.fieldNumber === 2) {
            const queryReader = extReader.readSubReader()
            const qTag = queryReader.readTag()
            assert.strictEqual(qTag?.fieldNumber, 1)
            prompt = queryReader.readString()
          } else {
            extReader.skipField(extTag.wireType)
          }
        }
        assert.strictEqual(clientType, ROBIN_CLIENT_TYPE_AGSA)
        assert.strictEqual(prompt, 'What is the speed of light?')
      } else if (tag.fieldNumber === 2) {
        hasDevice = true
        reader.skipField(tag.wireType)
      } else if (tag.fieldNumber === 3) {
        hasMode = true
        const sub = reader.readSubReader()
        const subTag = sub.readTag()
        assert.strictEqual(subTag?.fieldNumber, 1)
        assert.strictEqual(sub.readInt32(), RobinBardMode.ADVANCED)
      } else {
        reader.skipField(tag.wireType)
      }
    }

    assert.strictEqual(hasExt1000, true)
    assert.strictEqual(hasDevice, true)
    assert.strictEqual(hasMode, true)
  })

  it('encodes 3-frame BIDI_STREAMING ProcessQueryRequest (ext 1000 + ext 1007 prefetch + ext 1007 commit 0x12 0x00)', () => {
    const req: ProcessQueryRequest = {
      sessionInput: { textPrompt: 'Hello Robin' },
    }
    const [frame1, frame2, frame3] = encodeProcessQueryFrames(req)
    assert.ok(frame1.length > 0)
    assert.ok(frame2.length > 0)
    assert.ok(frame3.length > 0)

    // Frame 2: ext 1007 -> field 1 = 'Hello Robin'
    const r2 = new ProtobufReader(frame2)
    const t2 = r2.readTag()
    assert.strictEqual(t2?.fieldNumber, ROBIN_EXT_PREFETCH_OR_COMMIT)
    const sub2 = r2.readSubReader()
    const st2 = sub2.readTag()
    assert.strictEqual(st2?.fieldNumber, 1)
    assert.strictEqual(sub2.readString(), 'Hello Robin')

    // Frame 3: ext 1007 -> field 2 = Empty (explicit 0x12 0x00)
    assert.deepStrictEqual(Array.from(frame3), [0xfa, 0x3e, 0x02, 0x12, 0x00])
  })

  it('decodes gzip-compressed gRPC frames (compressed = 1)', () => {
    const respWriter = new ProtobufWriter()
    const chatWriter = new ProtobufWriter()
    chatWriter.writeString(1, 'Compressed hello')
    chatWriter.writeString(5, 'conv_123')
    chatWriter.writeString(6, 'resp_456')
    respWriter.writeMessage(1, chatWriter.toUint8Array())
    respWriter.writeInt32(2, RobinStreamingState.FINISHED)

    const rawProto = respWriter.toUint8Array()
    const gzipped = new Uint8Array(gzipSync(rawProto))
    const grpcFrame = encodeGrpcFrame(gzipped, true)

    const { frames, rest } = decodeGrpcFrames(grpcFrame)
    assert.strictEqual(rest.length, 0)
    assert.strictEqual(frames.length, 1)

    const decoded = decodeProcessQueryResponse(frames[0]!)
    assert.strictEqual(decoded.chatHistoryOutput?.deltaText, 'Compressed hello')
    assert.strictEqual(decoded.conversationId, 'conv_123')
    assert.strictEqual(decoded.responseId, 'resp_456')
    assert.strictEqual(decoded.streamingState, RobinStreamingState.FINISHED)
  })

  it('deserializes ProcessQueryResponse with delta text and streaming state', () => {
    // Construct a binary payload using ProtobufWriter
    const writer = new ProtobufWriter()

    // Field 1: ChatHistoryOutput
    const chatWriter = new ProtobufWriter()
    chatWriter.writeString(1, 'The speed of light is ')
    chatWriter.writeString(4, 'Let me calculate...') // thoughtsText
    writer.writeMessage(1, chatWriter.toUint8Array())

    // Field 2: StreamingState = IN_PROGRESS (1)
    writer.writeInt32(2, RobinStreamingState.IN_PROGRESS)

    const responseBytes = writer.toUint8Array()
    const decoded = decodeProcessQueryResponse(responseBytes)

    assert.strictEqual(decoded.chatHistoryOutput?.deltaText, 'The speed of light is ')
    assert.strictEqual(decoded.chatHistoryOutput?.thoughtsText, 'Let me calculate...')
    assert.strictEqual(decoded.streamingState, RobinStreamingState.IN_PROGRESS)
  })

  it('deserializes ProcessQueryResponse error payloads correctly', () => {
    const writer = new ProtobufWriter()

    // Field 4: RobinError
    const errWriter = new ProtobufWriter()
    errWriter.writeInt32(1, 401)
    errWriter.writeString(2, 'Request not authenticated')
    writer.writeMessage(4, errWriter.toUint8Array())

    // Field 2: StreamingState = ERROR (3)
    writer.writeInt32(2, RobinStreamingState.ERROR)

    const decoded = decodeProcessQueryResponse(writer.toUint8Array())
    assert.strictEqual(decoded.streamingState, RobinStreamingState.ERROR)
    assert.strictEqual(decoded.error?.code, 401)
    assert.strictEqual(decoded.error?.message, 'Request not authenticated')
  })

  it('deserializes live extension 1003 (f1003) BardResponse and stream-end frames', () => {
    // Frame with f1003.f1 (Candidate f7 + f2.f1 fallback + session ids)
    const cand1 = new ProtobufWriter()
    const f2Sub = new ProtobufWriter()
    f2Sub.writeString(1, 'Fallback text')
    cand1.writeMessage(2, f2Sub.toUint8Array())
    cand1.writeString(7, 'OK')

    const ids = new ProtobufWriter()
    ids.writeString(1, 'c_live_123')
    ids.writeString(2, 'r_live_456')

    const bardResp = new ProtobufWriter()
    bardResp.writeMessage(1, cand1.toUint8Array())
    bardResp.writeMessage(2, ids.toUint8Array())

    const ext1003 = new ProtobufWriter()
    ext1003.writeMessage(1, bardResp.toUint8Array())

    const resp1 = new ProtobufWriter()
    resp1.writeMessage(1003, ext1003.toUint8Array())

    const decoded1 = decodeProcessQueryResponse(resp1.toUint8Array())
    assert.strictEqual(decoded1.chatHistoryOutput?.fullText, 'OK')
    assert.strictEqual(decoded1.conversationId, 'c_live_123')
    assert.strictEqual(decoded1.responseId, 'r_live_456')

    // Frame with f1003.f1 using f2.f1 when f7 is absent
    const cand2 = new ProtobufWriter()
    const f2Only = new ProtobufWriter()
    f2Only.writeString(1, 'Only f2 text')
    cand2.writeMessage(2, f2Only.toUint8Array())
    const bardResp2 = new ProtobufWriter()
    bardResp2.writeMessage(1, cand2.toUint8Array())
    const ext1003_2 = new ProtobufWriter()
    ext1003_2.writeMessage(1, bardResp2.toUint8Array())
    const resp2 = new ProtobufWriter()
    resp2.writeMessage(1003, ext1003_2.toUint8Array())

    const decoded2 = decodeProcessQueryResponse(resp2.toUint8Array())
    assert.strictEqual(decoded2.chatHistoryOutput?.fullText, 'Only f2 text')

    // Frame with f1003.f2 (empty stream-end message)
    const ext1003End = new ProtobufWriter()
    ext1003End.writeEmptyMessage(2)
    const respEnd = new ProtobufWriter()
    respEnd.writeMessage(1003, ext1003End.toUint8Array())

    const decodedEnd = decodeProcessQueryResponse(respEnd.toUint8Array())
    assert.strictEqual(decodedEnd.streamingState, RobinStreamingState.FINISHED)
  })
})
