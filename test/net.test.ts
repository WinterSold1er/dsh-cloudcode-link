import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { agyFetch } from '../src/host/net.ts'

test('agyFetch completes normal request and uses default timeout signal', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as { port: number }
  const url = `http://127.0.0.1:${addr.port}/test`

  try {
    const res = await agyFetch(url)
    assert.equal(res.status, 200)
    const json = (await res.json()) as { ok: boolean }
    assert.equal(json.ok, true)
  } finally {
    server.close()
  }
})

test('agyFetch honors caller-provided custom abort signal', async () => {
  const server = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200)
      res.end('done')
    }, 500)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as { port: number }
  const url = `http://127.0.0.1:${addr.port}/hang`

  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(
      async () => {
        await agyFetch(url, { signal: controller.signal })
      },
      (err: unknown) => {
        const error = err as Error & { code?: string }
        return error.name === 'AbortError' || error.code === 'UND_ERR_ABORTED' || /abort/i.test(error.message)
      },
    )
  } finally {
    server.close()
  }
})
