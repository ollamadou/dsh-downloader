import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { Store } from '../lib/store.js'
import { DownloadManager } from '../lib/downloader.js'

const data = Buffer.alloc(10 * 1024 * 1024)
for (let i = 0; i < data.length; i += 1) data[i] = (i * 31) % 251

let requests = 0
let failFirst = 3
const etag = '"fixture-v1"'
const server = http.createServer((req, res) => {
  requests += 1
  if (req.url === '/flaky.bin' && failFirst > 0) {
    failFirst -= 1
    res.writeHead(503, { 'Content-Length': 0 })
    res.end()
    return
  }
  if (req.url === '/fake-range.bin') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes', ETag: etag })
      res.end()
      return
    }
    // Advertise Range support but ignore it, forcing the fallback path.
    res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes', ETag: etag })
    writeSlow(res, data)
    return
  }
  const slow = req.url === '/slow.bin'
  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Length': data.length,
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Content-Disposition': 'attachment; filename="fixture.bin"',
    })
    res.end()
    return
  }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : data.length - 1
    const body = data.subarray(start, end + 1)
    res.writeHead(206, {
      'Content-Length': body.length,
      'Content-Range': `bytes ${start}-${end}/${data.length}`,
      'Accept-Ranges': 'bytes',
      ETag: etag,
    })
    writeSlow(res, body, slow)
  } else {
    res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes', ETag: etag })
    writeSlow(res, data, slow)
  }
})

function writeSlow(res, body, slow = false) {
  let offset = 0
  const step = slow ? 16 * 1024 : 64 * 1024
  const timer = setInterval(() => {
    if (offset >= body.length) {
      clearInterval(timer)
      res.end()
      return
    }
    res.write(body.subarray(offset, offset + step))
    offset += step
  }, slow ? 65 : 12)
  res.on('close', () => clearInterval(timer))
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dshdl-test-'))
const config = {
  downloadDir: path.join(temp, 'downloads'),
  dataDir: path.join(temp, 'data'),
  maxConnections: 4,
  initialConnections: 2,
  minSegmentBytes: 1024 * 1024,
  timeoutMs: 10000,
  idleTimeoutMs: 10000,
  maxRetries: 3,
  retryBaseDelayMs: 100,
  retryMaxDelayMs: 500,
  stallTimeoutMs: 60000,
  agentProgressIntervalMs: 60000,
  proxyMode: 'off',
  proxyUrl: '',
  useLlmDiscovery: false,
  learnConnections: false,
}
const logger = { info: console.log, warn: console.warn, debug: () => {}, error: console.error }
const store = new Store({ dataDir: config.dataDir, logger })
const ctx = {
  logger,
  get(name) {
    if (name === 'workingDirectory') return { get: () => temp }
    return undefined
  },
}
const manager = new DownloadManager({ ctx, config, store, logger })
await manager.init()

function verify(file, label) {
  return fs.readFile(file).then((actual) => {
    const a = createHash('sha256').update(actual).digest('hex')
    const b = createHash('sha256').update(data).digest('hex')
    if (a !== b) throw new Error(`${label}: hash mismatch`)
    console.log(`${label}: OK (${actual.length} bytes)`)
  })
}

// 1. Normal multi-connection download.
{
  const dest = path.join(temp, 'normal.bin')
  const started = await manager.start({ url: `${base}/normal.bin`, dest, connections: 4, retries: 2 }, { cwd: temp })
  console.log('started', started.id, started.status, started.mode, started.totalBytes, started.connections)
  const done = await manager.waitFor(started.id, 30)
  console.log('done', done.status, done.downloadedBytes, done.attempts)
  if (done.status !== 'completed') throw new Error(`normal failed: ${done.error}`)
  await verify(dest, 'normal')
}

// 2. Pause and resume.
{
  const dest = path.join(temp, 'resume.bin')
  const started = await manager.start({ url: `${base}/resume.bin`, dest, connections: 4, retries: 2 }, { cwd: temp })
  await new Promise((r) => setTimeout(r, 450))
  const paused = await manager.pause(started.id)
  console.log('paused', paused.status, paused.downloadedBytes, paused.segments)
  const part = await fs.stat(`${dest}.part`).catch(() => null)
  if (!part) throw new Error('part file missing after pause')
  const resumed = await manager.resume(started.id)
  console.log('resumed', resumed.status, resumed.downloadedBytes)
  const done = await manager.waitFor(started.id, 30)
  console.log('resume done', done.status, done.downloadedBytes)
  if (done.status !== 'completed') throw new Error(`resume failed: ${done.error}`)
  await verify(dest, 'resume')
}

// 3. Retry after 503.
{
  const dest = path.join(temp, 'flaky.bin')
  const started = await manager.start({ url: `${base}/flaky.bin`, dest, connections: 2, retries: 5 }, { cwd: temp })
  const done = await manager.waitFor(started.id, 40)
  console.log('flaky', done.status, done.attempts, done.error)
  if (done.status !== 'completed') throw new Error(`flaky failed: ${done.error}`)
  await verify(dest, 'flaky')
}

// 4. Server falsely advertises Range support; auto fall back to one stream.
{
  const dest = path.join(temp, 'fallback.bin')
  const started = await manager.start({ url: `${base}/fake-range.bin`, dest, connections: 4, retries: 2 }, { cwd: temp })
  const done = await manager.waitFor(started.id, 40)
  console.log('fallback', done.status, done.mode, done.connections, done.error)
  if (done.status !== 'completed') throw new Error(`fallback failed: ${done.error}`)
  await verify(dest, 'fallback')
}

// 5. Pause after the adaptive scaler has added connections, then resume.
{
  const dest = path.join(temp, 'slow.bin')
  const started = await manager.start({ url: `${base}/slow.bin`, dest, connections: 4, retries: 2 }, { cwd: temp })
  await new Promise((r) => setTimeout(r, 3200))
  const running = await manager.waitFor(started.id, 0)
  console.log('slow running', running.status, running.downloadedBytes, running.connections)
  const paused = await manager.pause(started.id)
  console.log('slow paused', paused.status, paused.downloadedBytes)
  await manager.resume(started.id)
  const done = await manager.waitFor(started.id, 60)
  console.log('slow done', done.status, done.downloadedBytes, done.error)
  if (done.status !== 'completed') throw new Error(`slow resume failed: ${done.error}`)
  await verify(dest, 'slow-resume')
}

// 6. Persist a paused job and resume it from a fresh manager (plugin restart).
{
  const dest = path.join(temp, 'restart.bin')
  const started = await manager.start({ url: `${base}/restart.bin`, dest, connections: 4, retries: 2 }, { cwd: temp })
  await new Promise((r) => setTimeout(r, 450))
  await manager.shutdown()
  await new Promise((r) => setTimeout(r, 400))
  const store2 = new Store({ dataDir: config.dataDir, logger })
  const manager2 = new DownloadManager({ ctx, config, store: store2, logger })
  await manager2.init()
  const restored = manager2.get(started.id)
  console.log('restored', restored?.status, restored?.downloadedBytes)
  if (!restored) throw new Error('paused job was not restored after restart')
  await manager2.resume(started.id)
  const done = await manager2.waitFor(started.id, 40)
  console.log('restart done', done.status, done.downloadedBytes)
  if (done.status !== 'completed') throw new Error(`restart resume failed: ${done.error}`)
  await verify(dest, 'restart')
  await manager2.shutdown()
}

const state = await manager.state()
console.log('state', JSON.stringify(state.stats))
console.log('requests', requests)
server.close()
await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
