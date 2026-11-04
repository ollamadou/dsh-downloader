import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const file = path.join(process.env.TEMP || '.', 'dsh-downloader-live-fixture.bin')
const size = 16 * 1024 * 1024
const data = Buffer.alloc(size)
for (let i = 0; i < size; i += 1) data[i] = (i * 17) % 253
await fs.writeFile(file, data)

const server = http.createServer((req, res) => {
  const slowMode = req.url === '/slow.bin'
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes', ETag: '"live-v1"', 'Content-Disposition': 'attachment; filename="live-fixture.bin"' })
    res.end()
    return
  }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : data.length - 1
    const body = data.subarray(start, end + 1)
    res.writeHead(206, { 'Content-Length': body.length, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', ETag: '"live-v1"' })
    slow(res, body, slowMode)
    return
  }
  res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes', ETag: '"live-v1"' })
  slow(res, data, slowMode)
})

function slow(res, body, slowMode = false) {
  let offset = 0
  const step = slowMode ? 32 * 1024 : 128 * 1024
  const delay = slowMode ? 50 : 8
  const timer = setInterval(() => {
    if (offset >= body.length) {
      clearInterval(timer)
      res.end()
      return
    }
    res.write(body.subarray(offset, offset + step))
    offset += step
  }, delay)
  res.on('close', () => clearInterval(timer))
}

server.listen(18765, '127.0.0.1', () => {
  console.log(`LIVE_SERVER http://127.0.0.1:18765/fixture.bin file=${file} size=${size}`)
})
