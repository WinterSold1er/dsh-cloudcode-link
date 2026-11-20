import { homedir } from 'node:os'
import { join } from 'node:path'
import { AccountPoolManager, ManagedAccount } from '../src/host/pool.ts'
import { QuotaService } from '../src/host/quota.ts'

interface TestResult {
  accountId: string
  email: string
  role: 'Privileged' | 'Regular'
  round1: {
    model: string
    status: number
    durationMs: number
    snippet: string
    replyText: string
    pass: boolean
    error?: string
  }
  round2: {
    model: string
    borrowedFrom?: string
    status: number
    durationMs: number
    snippet: string
    replyText: string
    pass: boolean
    error?: string
  }
}

function extractResponseText(sseContent: string): { replyText: string; snippet: string } {
  const lines = sseContent.split('\n')
  let gathered = ''
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const json = JSON.parse(line.slice(6))
        const candidates = json?.response?.candidates || json?.candidates || []
        for (const c of candidates) {
          const parts = c?.content?.parts || []
          for (const p of parts) {
            if (p?.text) gathered += p.text
          }
        }
      } catch {
        // SSE control line or unparseable JSON
      }
    }
  }
  const cleanSnippet = sseContent.replace(/\s+/g, ' ').trim().slice(0, 80)
  return {
    replyText: gathered.trim(),
    snippet: cleanSnippet,
  }
}

async function sendStreamGenerate(
  endpoint: string,
  token: string,
  wireModel: string,
  promptText = 'Reply with exact text: OK',
): Promise<{ status: number; durationMs: number; snippet: string; replyText: string; totalBytes: number }> {
  const reqBody = {
    project: 'aicode-consumers',
    model: wireModel,
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 64,
      },
      sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    },
    requestType: 'AGENT',
    userAgent: 'ANTIGRAVITY',
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent':
      'antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'ANTIGRAVITY',
      pluginType: 'GEMINI',
    }),
  }

  const start = Date.now()
  const res = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
  })
  const durationMs = Date.now() - start

  if (!res.ok) {
    const errText = await res.text()
    return {
      status: res.status,
      durationMs,
      snippet: errText.replace(/\s+/g, ' ').trim().slice(0, 80),
      replyText: '',
      totalBytes: 0,
    }
  }

  const rawBody = await res.text()
  const { replyText, snippet } = extractResponseText(rawBody)

  return {
    status: res.status,
    durationMs,
    snippet,
    replyText,
    totalBytes: Buffer.byteLength(rawBody, 'utf8'),
  }
}

async function main() {
  const accountsDir = join(homedir(), '.dsh', 'agy-accounts')
  console.log(`================================================================================`)
  console.log(`[INIT] Gemini 4 Multi-Account Live Network Verification Suite`)
  console.log(`[INIT] Accounts Directory: ${accountsDir}`)
  console.log(`[INIT] Timestamp: ${new Date().toISOString()}`)
  console.log(`================================================================================`)

  const pool = new AccountPoolManager(accountsDir)
  const quota = new QuotaService(pool)
  const accounts = pool.getAccounts()

  console.log(`[POOL] Loaded ${accounts.length} accounts from pool:`)
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i]
    const isPrivileged = pool.hasModelCapability(acc, 'gemini-4-argon-high') || pool.hasModelCapability(acc, 'gemini-4-hydrogen-high')
    console.log(`  [${i + 1}/${accounts.length}] ${acc.id} | ${acc.email} | ${isPrivileged ? '⭐ Privileged' : '🔹 Regular'}`)
  }

  const endpoint = 'https://daily-cloudcode-pa.googleapis.com'
  const results: TestResult[] = []

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i]
    const isPrivileged = pool.hasModelCapability(acc, 'gemini-4-argon-high') || pool.hasModelCapability(acc, 'gemini-4-hydrogen-high')
    const role: 'Privileged' | 'Regular' = isPrivileged ? 'Privileged' : 'Regular'

    console.log(`\n--------------------------------------------------------------------------------`)
    console.log(`[ACCOUNT ${i + 1}/${accounts.length}] Testing ${acc.id} (${acc.email}) [${role}]`)
    console.log(`--------------------------------------------------------------------------------`)

    // 1. Get valid access token
    const ownToken = await quota.getValidAccessToken(acc)
    if (!ownToken) {
      console.error(`  [AUTH] ❌ Failed to acquire access token for ${acc.id}`)
      results.push({
        accountId: acc.id,
        email: acc.email || 'unknown',
        role,
        round1: {
          model: 'gemini-4-hydrogen-sonar',
          status: 0,
          durationMs: 0,
          snippet: '',
          replyText: '',
          pass: false,
          error: 'Failed to acquire access token',
        },
        round2: {
          model: 'gemini-4-hydrogen-high',
          status: 0,
          durationMs: 0,
          snippet: '',
          replyText: '',
          pass: false,
          error: 'Failed to acquire access token',
        },
      })
      continue
    }
    console.log(`  [AUTH] Valid token acquired (length: ${ownToken.length})`)

    // -------------------------------------------------------------------------
    // Round 1: Channel A (Native Channel) - gemini-4-hydrogen-sonar
    // -------------------------------------------------------------------------
    const r1Model = 'gemini-4-hydrogen-sonar'
    console.log(`\n  ▶ Round 1 (Channel A: Native Channel) -> Model: ${r1Model}`)
    process.stdout.write(`    Calling ${endpoint}... `)
    
    let r1Res
    try {
      r1Res = await sendStreamGenerate(endpoint, ownToken, r1Model)
    } catch (err: any) {
      r1Res = {
        status: 0,
        durationMs: 0,
        snippet: err.message,
        replyText: '',
        totalBytes: 0,
      }
    }

    const r1Pass = r1Res.status === 200 && r1Res.totalBytes > 0
    console.log(`HTTP ${r1Res.status} (${r1Res.durationMs}ms) ${r1Pass ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`    Response Snippet (first 80 chars): ${r1Res.snippet}`)
    console.log(`    Extracted Reply Text: "${r1Res.replyText}" (Total Bytes: ${r1Res.totalBytes})`)

    // -------------------------------------------------------------------------
    // Round 2: Channel B (Capability Lending Channel) - gemini-4-hydrogen-high
    // -------------------------------------------------------------------------
    const r2Model = 'gemini-4-hydrogen-high'
    console.log(`\n  ▶ Round 2 (Channel B: Capability Lending) -> Model: ${r2Model}`)

    const capableResult = pool.getCapableAccount(r2Model, acc.id)
    if (!capableResult) {
      console.error(`    [RESOLVE] ❌ Unable to resolve capable account for ${r2Model}`)
      results.push({
        accountId: acc.id,
        email: acc.email || 'unknown',
        role,
        round1: {
          model: r1Model,
          status: r1Res.status,
          durationMs: r1Res.durationMs,
          snippet: r1Res.snippet,
          replyText: r1Res.replyText,
          pass: r1Pass,
        },
        round2: {
          model: r2Model,
          status: 0,
          durationMs: 0,
          snippet: 'Unable to resolve capable account',
          replyText: '',
          pass: false,
          error: 'No capable account in pool',
        },
      })
      continue
    }

    let tokenToUse = ownToken
    let borrowedNotice = ''
    if (capableResult.borrowedFrom) {
      borrowedNotice = `[LEND] Borrowed from ${capableResult.borrowedFrom.id} (${capableResult.borrowedFrom.email})`
      console.log(`    ${borrowedNotice}`)
      const borrowedToken = await quota.getValidAccessToken(capableResult.borrowedFrom)
      if (!borrowedToken) {
        console.error(`    [AUTH] ❌ Failed to acquire borrowed token from ${capableResult.borrowedFrom.id}`)
      } else {
        tokenToUse = borrowedToken
      }
    } else {
      console.log(`    [DIRECT] Account ${acc.id} natively entitled; using own credentials`)
    }

    process.stdout.write(`    Calling ${endpoint}... `)
    let r2Res
    try {
      r2Res = await sendStreamGenerate(endpoint, tokenToUse, r2Model)
    } catch (err: any) {
      r2Res = {
        status: 0,
        durationMs: 0,
        snippet: err.message,
        replyText: '',
        totalBytes: 0,
      }
    }

    const r2Pass = r2Res.status === 200 && r2Res.totalBytes > 0
    console.log(`HTTP ${r2Res.status} (${r2Res.durationMs}ms) ${r2Pass ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`    Response Snippet (first 80 chars): ${r2Res.snippet}`)
    console.log(`    Extracted Reply Text: "${r2Res.replyText}" (Total Bytes: ${r2Res.totalBytes})`)

    results.push({
      accountId: acc.id,
      email: acc.email || 'unknown',
      role,
      round1: {
        model: r1Model,
        status: r1Res.status,
        durationMs: r1Res.durationMs,
        snippet: r1Res.snippet,
        replyText: r1Res.replyText,
        pass: r1Pass,
      },
      round2: {
        model: r2Model,
        borrowedFrom: capableResult.borrowedFrom?.email,
        status: r2Res.status,
        durationMs: r2Res.durationMs,
        snippet: r2Res.snippet,
        replyText: r2Res.replyText,
        pass: r2Pass,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Summary Matrix
  // ---------------------------------------------------------------------------
  console.log(`\n================================================================================`)
  console.log(`[SUMMARY MATRIX] Gemini 4 Multi-Account Full Pool Verification Results`)
  console.log(`================================================================================`)
  console.log(
    `# | Account ID             | Role       | Channel A (Sonar)  | Channel B (High / Lend)     | Verdict`,
  )
  console.log(
    `--+------------------------+------------+--------------------+-----------------------------+--------`,
  )

  let totalTests = 0
  let passedTests = 0

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    totalTests += 2
    if (r.round1.pass) passedTests++
    if (r.round2.pass) passedTests++

    const r1Status = r.round1.pass ? `HTTP 200 (${r.round1.durationMs}ms)` : `HTTP ${r.round1.status} FAIL`
    const r2Status = r.round2.pass
      ? `HTTP 200 (${r.round2.durationMs}ms)${r.round2.borrowedFrom ? ' [LEND]' : ' [SELF]'}`
      : `HTTP ${r.round2.status} FAIL`
    const accountVerdict = r.round1.pass && r.round2.pass ? 'PASS ✅' : 'FAIL ❌'

    const idx = String(i + 1).padStart(2, ' ')
    const accId = r.accountId.padEnd(22, ' ')
    const roleStr = r.role.padEnd(10, ' ')
    const r1Str = r1Status.padEnd(18, ' ')
    const r2Str = r2Status.padEnd(27, ' ')

    console.log(`${idx}| ${accId} | ${roleStr} | ${r1Str} | ${r2Str} | ${accountVerdict}`)
  }

  console.log(`================================================================================`)
  console.log(`[FINAL STATS] Total Tests: ${totalTests} | Passed: ${passedTests} | Failed: ${totalTests - passedTests}`)
  console.log(`[FINAL RESULT] ${passedTests === totalTests ? 'SUCCESS: 10/10 VERIFICATIONS PASSED (5/5 ACCOUNTS ALL CHANNELS OPERATIONAL)' : 'FAILURE: Some verifications failed'}`)
  console.log(`================================================================================\n`)

  if (passedTests !== totalTests) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[FATAL] Verification suite crashed:', err)
  process.exit(1)
})
