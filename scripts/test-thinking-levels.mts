import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { dshHome } from '../src/common/config.ts'
import { AccountPoolManager } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'
import {
  ensureProject,
  streamGenerateContent,
  antigravityRequestEnvelope,
  type AntigravityGenerateRequest,
} from '../packages/core/src/client.ts'
import { getAntigravityRequestModelId, getThinkingConfig } from '../packages/core/src/models.ts'

// Prompts
export const PROMPTS = {
  A_STRAWBERRY: {
    id: 'A',
    name: 'Strawberry R Count & Analysis',
    text: "How many letters 'r' are in 'strawberry'? Explain your detailed step-by-step reasoning with phonetic and character analysis.",
  },
  B_BAT_AND_BALL: {
    id: 'B',
    name: 'Bat & Ball Complex Math Split',
    text: "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? But wait, suppose the seller gives a 10% discount on the total, and sales tax of 8% is applied after discount, and 3 people split the bill unevenly in ratio 1:2:3. Exactly how much does each person pay in cents? Trace every fraction carefully.",
  },
  C_NQUEENS: {
    id: 'C',
    name: '6-Queens Unique Solutions Proof',
    text: "Solve the 8-queens problem generalized for N=6 (placing 6 non-attacking queens on a 6x6 board). List all unique solutions modulo rotation and reflection, and prove step by step why there are no other solutions.",
  },
}

export interface TestCase {
  id: string
  suite: 'task-2-gemini-3.8' | 'task-3-gemini-3.7' | 'task-3-disentangle'
  description: string
  promptKey: keyof typeof PROMPTS
  model: string
  thinkingConfig?: {
    includeThoughts?: boolean
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
    thinkingBudget?: number
  }
  maxOutputTokens?: number
}

export interface TestResult {
  testId: string
  suite: string
  description: string
  promptId: string
  promptName: string
  wireModelSent: string
  thinkingConfigSent: any
  httpStatus: number
  ok: boolean
  error?: string
  modelVersion?: string
  responseId?: string
  durationMs: number
  thoughtChunksCount: number
  thoughtCharsCount: number
  answerCharsCount: number
  promptTokenCount: number
  candidatesTokenCount: number
  thoughtsTokenCount: number
  totalTokenCount: number
  thoughtPreview?: string
  answerPreview?: string
}

async function main() {
  console.log('=== Initializing Live Tester Credentials ===')
  const dshAccountsDir = join(dshHome(), 'agy-accounts')
  const pool = new AccountPoolManager(dshAccountsDir)
  const quota = new QuotaService(pool)
  const acc = pool.getAccounts()[0]
  if (!acc) throw new Error('No accounts found in pool!')

  console.log(`Account: ${acc.id} (${acc.email})`)
  const tok = await quota.getValidAccessToken(acc)
  if (!tok) throw new Error('Failed to get access token!')
  console.log(`Token acquired: ${tok.slice(0, 15)}...`)

  const proj = await ensureProject(tok, acc.alias || acc.id || acc.email, acc.proxyUrl)
  console.log(`Project: ${proj}`)

  // Build test cases
  const testCases: TestCase[] = [
    // --- SUITE 1: Task 2 Core - gemini-3.8-flash standard pipeline (low, medium, high, xhigh, off) across prompts ---
    // Prompt A
    {
      id: 'T2-3.8-PromptA-low',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=low on Strawberry',
      promptKey: 'A_STRAWBERRY',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'low'), // gemini-3.8-flash-low
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'low'), // { includeThoughts: true, thinkingLevel: 'LOW' }
    },
    {
      id: 'T2-3.8-PromptA-medium',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=medium on Strawberry',
      promptKey: 'A_STRAWBERRY',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'medium'), // gemini-3.8-flash-medium
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'medium'), // { includeThoughts: true, thinkingLevel: 'MEDIUM' }
    },
    {
      id: 'T2-3.8-PromptA-high',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=high on Strawberry',
      promptKey: 'A_STRAWBERRY',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'high'), // gemini-3.8-flash-high
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'high'), // { includeThoughts: true, thinkingLevel: 'HIGH' }
    },
    // Prompt B (Bat & Ball)
    {
      id: 'T2-3.8-PromptB-low',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=low on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'low'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'low'),
    },
    {
      id: 'T2-3.8-PromptB-medium',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=medium on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'medium'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'medium'),
    },
    {
      id: 'T2-3.8-PromptB-high',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=high on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'high'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'high'),
    },
    {
      id: 'T2-3.8-PromptB-xhigh',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=xhigh on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'xhigh'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'xhigh'),
    },
    {
      id: 'T2-3.8-PromptB-off',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=off (no thinking) on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'off'),
      thinkingConfig: undefined,
    },
    // Prompt C (N-Queens)
    {
      id: 'T2-3.8-PromptC-low',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=low on 6-Queens',
      promptKey: 'C_NQUEENS',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'low'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'low'),
    },
    {
      id: 'T2-3.8-PromptC-medium',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=medium on 6-Queens',
      promptKey: 'C_NQUEENS',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'medium'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'medium'),
    },
    {
      id: 'T2-3.8-PromptC-high',
      suite: 'task-2-gemini-3.8',
      description: '3.8-flash effort=high on 6-Queens',
      promptKey: 'C_NQUEENS',
      model: getAntigravityRequestModelId('gemini-3.8-flash', 'high'),
      thinkingConfig: getThinkingConfig('gemini-3.8-flash', 'high'),
    },

    // --- SUITE 2: Task 3 Comparative - gemini-3.7-flash across same prompts ---
    {
      id: 'T3-3.7-PromptA-low',
      suite: 'task-3-gemini-3.7',
      description: '3.7-flash effort=low on Strawberry',
      promptKey: 'A_STRAWBERRY',
      model: getAntigravityRequestModelId('gemini-3.7-flash', 'low'),
      thinkingConfig: getThinkingConfig('gemini-3.7-flash', 'low'),
    },
    {
      id: 'T3-3.7-PromptA-high',
      suite: 'task-3-gemini-3.7',
      description: '3.7-flash effort=high on Strawberry',
      promptKey: 'A_STRAWBERRY',
      model: getAntigravityRequestModelId('gemini-3.7-flash', 'high'),
      thinkingConfig: getThinkingConfig('gemini-3.7-flash', 'high'),
    },
    {
      id: 'T3-3.7-PromptB-low',
      suite: 'task-3-gemini-3.7',
      description: '3.7-flash effort=low on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.7-flash', 'low'),
      thinkingConfig: getThinkingConfig('gemini-3.7-flash', 'low'),
    },
    {
      id: 'T3-3.7-PromptB-medium',
      suite: 'task-3-gemini-3.7',
      description: '3.7-flash effort=medium on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.7-flash', 'medium'),
      thinkingConfig: getThinkingConfig('gemini-3.7-flash', 'medium'),
    },
    {
      id: 'T3-3.7-PromptB-high',
      suite: 'task-3-gemini-3.7',
      description: '3.7-flash effort=high on Bat&Ball',
      promptKey: 'B_BAT_AND_BALL',
      model: getAntigravityRequestModelId('gemini-3.7-flash', 'high'),
      thinkingConfig: getThinkingConfig('gemini-3.7-flash', 'high'),
    },
    {
      id: 'T3-3.7-PromptC-high',
      suite: 'task-3-gemini-3.7',
      description: '3.7-flash effort=high on 6-Queens',
      promptKey: 'C_NQUEENS',
      model: getAntigravityRequestModelId('gemini-3.7-flash', 'high'),
      thinkingConfig: getThinkingConfig('gemini-3.7-flash', 'high'),
    },

    // --- SUITE 3: Task 3 Parameter Disentanglement on Prompt B ---
    // What if wireModel is 'gemini-3.8-flash-tiered' instead of 'gemini-3.8-flash-high'?
    {
      id: 'T3-Dis-tiered-high',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-tiered + thinkingLevel=HIGH',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-tiered',
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
    },
    {
      id: 'T3-Dis-tiered-low',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-tiered + thinkingLevel=LOW',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-tiered',
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'LOW' },
    },
    // What if wireModel is 'gemini-3.8-flash' (bare slug) + thinkingLevel=HIGH?
    {
      id: 'T3-Dis-bare-high',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash (bare) + thinkingLevel=HIGH',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash',
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
    },
    // What if wireModel is 'gemini-3.8-flash-high' but thinkingLevel is LOW?
    {
      id: 'T3-Dis-modelHigh-levelLow',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-high + thinkingLevel=LOW (Cross test)',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-high',
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'LOW' },
    },
    // What if wireModel is 'gemini-3.8-flash-low' but thinkingLevel is HIGH?
    {
      id: 'T3-Dis-modelLow-levelHigh',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-low + thinkingLevel=HIGH (Cross test)',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-low',
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
    },
    // What if thinkingBudget is used on gemini-3.8-flash-high? (e.g. 1024 vs 8192 vs 16384)
    {
      id: 'T3-Dis-budget-1024',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-high + thinkingBudget=1024 (no level)',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-high',
      thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 },
    },
    {
      id: 'T3-Dis-budget-16384',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-high + thinkingBudget=16384 (no level)',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-high',
      thinkingConfig: { includeThoughts: true, thinkingBudget: 16384 },
    },
    // What if BOTH thinkingLevel and thinkingBudget are sent?
    {
      id: 'T3-Dis-levelHIGH-budget16k',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-high + thinkingLevel=HIGH + thinkingBudget=16384',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-high',
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH', thinkingBudget: 16384 },
    },
    // What if thinkingBudget on gemini-3.8-flash-tiered?
    {
      id: 'T3-Dis-tiered-budget16k',
      suite: 'task-3-disentangle',
      description: 'model=gemini-3.8-flash-tiered + thinkingBudget=16384',
      promptKey: 'B_BAT_AND_BALL',
      model: 'gemini-3.8-flash-tiered',
      thinkingConfig: { includeThoughts: true, thinkingBudget: 16384 },
    },
  ]

  console.log(`\nTotal test cases to execute: ${testCases.length}\n`)

  const results: TestResult[] = []

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]!
    const promptInfo = PROMPTS[tc.promptKey]
    console.log(`[${i + 1}/${testCases.length}] Running ${tc.id}: ${tc.description}...`)

    const envelope = antigravityRequestEnvelope(tc.model, false)
    const requestBody: AntigravityGenerateRequest = {
      project: proj,
      model: tc.model,
      request: {
        contents: [{ role: 'user', parts: [{ text: promptInfo.text }] }],
        generationConfig: {
          maxOutputTokens: tc.maxOutputTokens ?? 8192,
          ...(tc.thinkingConfig ? { thinkingConfig: tc.thinkingConfig } : {}),
        },
        sessionId: envelope.sessionId,
        labels: envelope.labels,
      },
      requestType: 'AGENT',
      userAgent: 'ANTIGRAVITY',
      requestId: envelope.requestId,
    }

    const startTime = Date.now()
    try {
      const { response } = await streamGenerateContent(tok, requestBody, undefined, acc.proxyUrl)
      if (!response.ok) {
        const errorText = await response.text()
        console.error(`  -> FAILED: HTTP ${response.status}: ${errorText.slice(0, 200)}`)
        results.push({
          testId: tc.id,
          suite: tc.suite,
          description: tc.description,
          promptId: promptInfo.id,
          promptName: promptInfo.name,
          wireModelSent: tc.model,
          thinkingConfigSent: tc.thinkingConfig,
          httpStatus: response.status,
          ok: false,
          error: errorText,
          durationMs: Date.now() - startTime,
          thoughtChunksCount: 0,
          thoughtCharsCount: 0,
          answerCharsCount: 0,
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          thoughtsTokenCount: 0,
          totalTokenCount: 0,
        })
        continue
      }

      // Stream parsing
      const text = await response.text()
      const durationMs = Date.now() - startTime

      let thoughtText = ''
      let answerText = ''
      let thoughtChunksCount = 0
      let modelVersion: string | undefined
      let responseId: string | undefined
      let usageMetadata: any = null

      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const jsonStr = line.slice(5).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue
        try {
          const data = JSON.parse(jsonStr)
          const resp = data.response || data
          if (resp.modelVersion) modelVersion = resp.modelVersion
          if (resp.responseId) responseId = resp.responseId
          if (resp.usageMetadata) usageMetadata = resp.usageMetadata
          for (const cand of resp.candidates || []) {
            for (const part of cand.content?.parts || []) {
              if (part.thought === true) {
                thoughtChunksCount++
                thoughtText += part.text || ''
              } else if (part.text) {
                answerText += part.text
              }
            }
          }
        } catch {
          // ignore chunk parse errors
        }
      }

      const res: TestResult = {
        testId: tc.id,
        suite: tc.suite,
        description: tc.description,
        promptId: promptInfo.id,
        promptName: promptInfo.name,
        wireModelSent: tc.model,
        thinkingConfigSent: tc.thinkingConfig,
        httpStatus: response.status,
        ok: true,
        modelVersion,
        responseId,
        durationMs,
        thoughtChunksCount,
        thoughtCharsCount: thoughtText.length,
        answerCharsCount: answerText.length,
        promptTokenCount: usageMetadata?.promptTokenCount ?? 0,
        candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? 0,
        thoughtsTokenCount: usageMetadata?.thoughtsTokenCount ?? 0,
        totalTokenCount: usageMetadata?.totalTokenCount ?? 0,
        thoughtPreview: thoughtText.slice(0, 100),
        answerPreview: answerText.slice(0, 100),
      }

      console.log(
        `  -> OK (${durationMs}ms): modelVer=${modelVersion}, thoughtsTokens=${res.thoughtsTokenCount}, thoughtChars=${res.thoughtCharsCount}, candTokens=${res.candidatesTokenCount}`
      )
      results.push(res)
    } catch (err: any) {
      console.error(`  -> EXCEPTION: ${err.message}`)
      results.push({
        testId: tc.id,
        suite: tc.suite,
        description: tc.description,
        promptId: promptInfo.id,
        promptName: promptInfo.name,
        wireModelSent: tc.model,
        thinkingConfigSent: tc.thinkingConfig,
        httpStatus: 0,
        ok: false,
        error: err.message,
        durationMs: Date.now() - startTime,
        thoughtChunksCount: 0,
        thoughtCharsCount: 0,
        answerCharsCount: 0,
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        thoughtsTokenCount: 0,
        totalTokenCount: 0,
      })
    }

    // Small delay between calls
    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  // Save full JSON results
  const outPath = join(process.cwd(), 'scripts/test-thinking-results.json')
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`\nAll results saved to ${outPath}\n`)

  // Render markdown summary
  renderMarkdownSummary(results)
}

function renderMarkdownSummary(results: TestResult[]) {
  console.log('========================================================================================')
  console.log('### EXPERIMENTAL RESULTS SUMMARY')
  console.log('========================================================================================\n')

  console.log('#### 1. Task-2: gemini-3.8-flash Standard Pipeline Across Thinking Levels')
  console.log('| Test ID | Prompt | Effort / Level | Wire Model | Model Version | Thoughts Tokens | Thought Chars | Output Tokens | Latency (ms) |')
  console.log('| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |')
  for (const r of results.filter((x) => x.suite === 'task-2-gemini-3.8')) {
    console.log(
      `| ${r.testId} | ${r.promptId} | ${r.thinkingConfigSent?.thinkingLevel ?? 'OFF'} | ${r.wireModelSent} | ${r.modelVersion ?? 'ERR'} | **${r.thoughtsTokenCount}** | ${r.thoughtCharsCount} | ${r.candidatesTokenCount} | ${r.durationMs} |`
    )
  }

  console.log('\n#### 2. Task-3: Comparative Testing with gemini-3.7-flash')
  console.log('| Test ID | Prompt | Model | Thinking Level | Model Version | Thoughts Tokens | Thought Chars | Output Tokens | Latency (ms) |')
  console.log('| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |')
  for (const r of results.filter((x) => x.suite === 'task-3-gemini-3.7')) {
    console.log(
      `| ${r.testId} | ${r.promptId} | ${r.wireModelSent} | ${r.thinkingConfigSent?.thinkingLevel ?? 'NONE'} | ${r.modelVersion ?? 'ERR'} | **${r.thoughtsTokenCount}** | ${r.thoughtCharsCount} | ${r.candidatesTokenCount} | ${r.durationMs} |`
    )
  }

  console.log('\n#### 3. Task-3: Parameter Disentanglement on Prompt B (Bat & Ball Math)')
  console.log('| Test ID | Description | Wire Model | Thinking Config | Thoughts Tokens | Output Tokens | Latency (ms) |')
  console.log('| :--- | :--- | :--- | :--- | :---: | :---: | :---: |')
  for (const r of results.filter((x) => x.suite === 'task-3-disentangle')) {
    const cfgStr = r.thinkingConfigSent ? JSON.stringify(r.thinkingConfigSent) : 'none'
    console.log(
      `| ${r.testId} | ${r.description} | ${r.wireModelSent} | \`${cfgStr}\` | **${r.thoughtsTokenCount}** | ${r.candidatesTokenCount} | ${r.durationMs} |`
    )
  }
}

main().catch((err) => {
  console.error('Fatal in test runner:', err)
  process.exit(1)
})
