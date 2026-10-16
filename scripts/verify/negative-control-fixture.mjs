#!/usr/bin/env node
// NEGATIVE CONTROL for scripts/verify/post-restart-probe.mjs — NOT plugin evidence.
//
// The probe's quota/model assertions must be able to FAIL. This fixture serves a
// deliberately broken pool/catalog on a local port so the probe can be run against
// it and shown to reject the data. Its output must never be quoted as evidence
// about the real plugin; only the probe's verdict on the REAL host counts.
//
// Usage:
//   node scripts/verify/negative-control-fixture.mjs [--port 3999]
//       [--mode stale-quota|missing-models]
//   node scripts/verify/post-restart-probe.mjs --no-wait --base-url http://127.0.0.1:3999

import { createServer } from 'node:http'

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const port = portArg >= 0 ? Number(args[portArg + 1]) : 3999
const modeArg = args.indexOf('--mode')
const mode = modeArg >= 0 ? args[modeArg + 1] : 'stale-quota'

const PAST = '2020-01-01T00:00:00Z' // resetTime in the past -> countdown-provably broken

const poolBody = {
  version: 1,
  mode: 'round-robin',
  accounts: [
    {
      id: 'negative-control',
      email: 'control@example.invalid',
      quotas: {
        google: { remainingFraction: 0.5, resetTime: PAST, updatedAt: 0 },
      },
    },
  ],
}

const catalogBody = {
  ok: true,
  source: 'negative-control',
  count: 1,
  models: [{ id: mode === 'missing-models' ? 'not-a-real-model' : 'gemini-3-flash' }],
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (url === '/') return send(200, { ok: true })
  if (url === '/plugins/cloudcode-link/status') {
    return send(200, { plugin: 'dsh-cloudcode-link', transport: 'direct', auth: { phase: 'ok' } })
  }
  if (url === '/plugins/cloudcode-link/pool/refresh-quota') return send(200, { ok: true })
  if (url === '/plugins/cloudcode-link/pool') return send(200, poolBody)
  if (url === '/plugins/cloudcode-link/catalog') return send(200, catalogBody)
  return send(404, { error: 'not found' })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`negative-control fixture (mode=${mode}) on http://127.0.0.1:${port}\n`)
})
