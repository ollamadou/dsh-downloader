import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Store } from '../lib/store.js'
import { askDeepSeek, verifyCandidates } from '../lib/discovery.js'

const data = Buffer.alloc(2 * 1024 * 1024, 9)
const server = http.createServer((req, res) => {
  if (req.url === '/chat/completions') {
    const port = server.address().port
    const content = JSON.stringify({
      resources: [
        {
          name: 'fixture-model',
          url: `http://127.0.0.1:${port}/fixture.bin`,
          size: data.length,
          kind: 'model',
          note: 'test fixture',
          confidence: 0.9,
        },
      ],
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    return
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes', ETag: '"d"' })
    res.end()
    return
  }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : data.length - 1
    const body = data.subarray(start, end + 1)
    res.writeHead(206, { 'Content-Length': body.length, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes' })
    res.end(body)
    return
  }
  res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes' })
  res.end(data)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dshdl-disc-'))
const config = {
  proxyMode: 'off',
  proxyUrl: '',
  deepseek: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat', timeoutMs: 10000 },
}
const logger = { info: console.log, warn: console.warn, debug: () => {}, error: console.error }
const store = new Store({ dataDir: path.join(temp, 'data'), logger })
await store.init()
const raw = await askDeepSeek('fixture model', { platform: 'test' }, config)
console.log('raw', raw)
if (!raw.length) throw new Error('no raw candidates')
const verified = await verifyCandidates(raw, { config, store, query: 'fixture model', restrictPrivate: false, limit: 5 })
console.log('verified', verified.map((v) => ({ verified: v.verified, adopted: Boolean(v.adopted), total: v.total })))
if (!verified.some((v) => v.verified && v.adopted)) throw new Error('candidate not verified/adopted')
const resources = store.listResources('fixture', 5)
console.log('resources', resources.map((r) => r.url))
if (!resources.length) throw new Error('resource not persisted')
await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
server.close()
