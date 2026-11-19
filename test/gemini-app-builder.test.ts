// Tests for Gemini App request builder.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  formatMessagesToPrompt,
  buildProcessQueryRequest,
} from '../packages/core/src/gemini-app/builder.ts'
import {
  RobinBardMode,
  type GeminiAppConfig,
} from '../packages/core/src/gemini-app/types.ts'
import type { GenerateOptions, Message } from '../packages/core/src/types/protocol.ts'

describe('Gemini App: Request Builder', () => {
  it('formats single user prompt directly without conversational boilerplate', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Explain quantum computing in simple terms.',
      },
    ]

    const result = formatMessagesToPrompt(messages)
    assert.strictEqual(result.promptText, 'Explain quantum computing in simple terms.')
    assert.strictEqual(result.attachments.length, 0)
  })

  it('formats multi-turn conversation with system instructions, user, assistant, and tool turns', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: 'You are a helpful coding assistant.' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'How do I sort an array in JS?' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Use Array.prototype.sort().' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Does it mutate the original?' }],
      },
    ]

    const result = formatMessagesToPrompt(messages)
    assert.ok(result.promptText.includes('[System Instructions]'))
    assert.ok(result.promptText.includes('You are a helpful coding assistant.'))
    assert.ok(result.promptText.includes('User: How do I sort an array in JS?'))
    assert.ok(result.promptText.includes('Model: Use Array.prototype.sort().'))
    assert.ok(result.promptText.includes('User: Does it mutate the original?'))
  })

  it('extracts multimodal image attachments from content blocks', () => {
    const rawImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG header
    const base64Data = Buffer.from(rawImageBytes).toString('base64')

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          {
            type: 'image',
            mimeType: 'image/png',
            data: `data:image/png;base64,${base64Data}`,
            attachment: { id: 'img-123' },
          },
          {
            type: 'image',
            mimeType: 'image/jpeg',
            data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
            attachment: { id: 'img-456' },
          },
          {
            type: 'image',
            mimeType: 'image/png',
            offloaded: true,
          },
        ],
      },
    ]

    const result = formatMessagesToPrompt(messages)
    assert.strictEqual(result.attachments.length, 2, 'Should extract 2 valid non-offloaded images')
    assert.strictEqual(result.attachments[0]?.mimeType, 'image/png')
    assert.strictEqual(result.attachments[0]?.name, 'img-123')
    assert.deepStrictEqual(result.attachments[0]?.data, rawImageBytes)

    assert.strictEqual(result.attachments[1]?.mimeType, 'image/jpeg')
    assert.strictEqual(result.attachments[1]?.name, 'img-456')
  })

  it('maps model mode correctly between standard and advanced', () => {
    const standardOptions: GenerateOptions = {
      model: 'gemini-app-default',
      messages: [{ role: 'user', content: 'Hi' }],
    }
    const reqStandard = buildProcessQueryRequest(standardOptions)
    assert.strictEqual(reqStandard.modeConfig?.modeId, RobinBardMode.STANDARD)
    assert.strictEqual(reqStandard.modeConfig?.bardModeName, 'Standard')

    const advancedOptions: GenerateOptions = {
      model: 'gemini-app-advanced',
      messages: [{ role: 'user', content: 'Hi' }],
    }
    const reqAdvanced = buildProcessQueryRequest(advancedOptions)
    assert.strictEqual(reqAdvanced.modeConfig?.modeId, RobinBardMode.ADVANCED)
    assert.strictEqual(reqAdvanced.modeConfig?.bardModeName, 'Advanced')
  })

  it('populates device context with defaults and user overrides', () => {
    const options: GenerateOptions = {
      model: 'gemini-app-default',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    // With defaults
    const reqDefault = buildProcessQueryRequest(options)
    assert.strictEqual(reqDefault.deviceContext?.deviceModel, 'OnePlus PJZ110')
    assert.strictEqual(reqDefault.deviceContext?.agsaVersion, '15.42.34.28.arm64')
    assert.strictEqual(reqDefault.deviceContext?.locale, 'zh-CN')

    // With custom config
    const customConfig: GeminiAppConfig = {
      deviceModel: 'Pixel 9 Pro',
      agsaVersion: '16.0.0.arm64',
      locale: 'en-US',
      timeZone: 'America/New_York',
    }
    const reqCustom = buildProcessQueryRequest(options, customConfig)
    assert.strictEqual(reqCustom.deviceContext?.deviceModel, 'Pixel 9 Pro')
    assert.strictEqual(reqCustom.deviceContext?.agsaVersion, '16.0.0.arm64')
    assert.strictEqual(reqCustom.deviceContext?.locale, 'en-US')
    assert.strictEqual(reqCustom.deviceContext?.timeZone, 'America/New_York')
  })
})
