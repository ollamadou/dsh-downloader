import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

export const VERSION = '0.1.0'

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export function abortError(message = 'aborted') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = 'ABORTED'
  return error
}

export function isAbort(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORTED' || error?.code === 'ABORT_ERR'
}

export function errorText(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  const code = error.code ? `${error.code}: ` : ''
  return `${code}${error.message ?? String(error)}`
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function nowIso() {
  return new Date().toISOString()
}

export function newId(prefix = 'dl') {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

export function shortHash(text, length = 12) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, length)
}

export function formatBytes(bytes, digits = 1) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : digits)} ${units[unit]}`
}

export function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

export function formatPercent(done, total) {
  if (!total || total <= 0) return '—'
  return `${Math.min(100, (done / total) * 100).toFixed(1)}%`
}

export function safeUrl(url, withQuery = false) {
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    if (!withQuery) {
      u.search = ''
      u.hash = ''
    }
    return u.href
  } catch {
    return String(url)
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return 'invalid'
  }
}

export function redactProxy(proxyUrl) {
  if (!proxyUrl) return ''
  try {
    const u = new URL(proxyUrl)
    if (u.username || u.password) {
      u.username = '***'
      u.password = '***'
    }
    return u.href
  } catch {
    return '***'
  }
}

export function sanitizeFileName(input, fallback = `download-${Date.now()}`) {
  let name = String(input ?? '').trim()
  try {
    name = decodeURIComponent(name)
  } catch {
    // Keep the original text when it is not percent-encoded.
  }
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
  name = name.replace(/^\.+/, '').replace(/\.+$/, '').trim()
  if (!name) name = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = `_${name}`
  if (name.length > 180) {
    const ext = path.extname(name).slice(0, 20)
    name = name.slice(0, 180 - ext.length) + ext
  }
  return name
}

const CONTENT_TYPE_EXT = {
  'application/zip': '.zip',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'application/x-gzip': '.gz',
  'application/x-msdownload': '.exe',
  'application/vnd.microsoft.portable-executable': '.exe',
  'application/x-msi': '.msi',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'text/plain': '.txt',
  'application/octet-stream': '',
}

export function fileNameFromDisposition(value) {
  if (!value) return ''
  const star = /filename\*\s*=\s*([^;]+)/i.exec(value)
  if (star) {
    const raw = star[1].trim().replace(/^"|"$/g, '')
    const parts = raw.split("''")
    try {
      return sanitizeFileName(decodeURIComponent(parts.length > 1 ? parts.slice(1).join("''") : raw))
    } catch {
      return sanitizeFileName(raw)
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(value)
  if (plain) return sanitizeFileName((plain[2] ?? plain[3] ?? '').trim())
  return ''
}

export function fileNameFromUrl(url, contentType = '') {
  try {
    const u = new URL(url)
    const base = path.basename(u.pathname)
    if (base && base !== '/') return sanitizeFileName(base)
  } catch {
    // fall through
  }
  const ext = CONTENT_TYPE_EXT[String(contentType).split(';')[0].trim().toLowerCase()] ?? ''
  return sanitizeFileName(`download-${Date.now()}${ext}`)
}

export function isPrivateHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '0.0.0.0') return true
  if (net.isIP(host) === 4) {
    const parts = host.split('.').map(Number)
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
  }
  if (net.isIP(host) === 6) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  }
  return false
}

export function ensureHttpUrl(value) {
  let text = String(value ?? '').trim()
  if (!text) throw new Error('URL 为空')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`
  const url = new URL(text)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`仅支持 http/https，收到 ${url.protocol}`)
  return url
}

export function parseContentRange(value) {
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(String(value ?? ''))
  if (!match) return undefined
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? undefined : Number(match[3]),
  }
}

export function parseLength(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function requestHeaders(url, extra = {}) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DSH-Downloader/0.1',
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    ...extra,
    Host: url.host,
  }
}

function proxyAuthHeader(proxy) {
  if (!proxy.username && !proxy.password) return {}
  const token = Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
  return { 'Proxy-Authorization': `Basic ${token}` }
}

function requestOnceDirect(url, options) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const headers = requestHeaders(url, options.headers)
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        method: options.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        headers,
        signal: options.signal,
      },
      (res) => {
        res.on('error', (error) => finish(reject, error))
        finish(resolve, res)
      },
    )
    req.on('error', (error) => finish(reject, error))
    const connectTimer = setTimeout(() => {
      req.destroy(timeoutError(options.timeoutMs))
    }, Math.max(1000, options.timeoutMs ?? 30000))
    connectTimer.unref?.()
    req.on('close', () => clearTimeout(connectTimer))
    req.setTimeout(Math.max(1000, options.idleTimeoutMs ?? options.timeoutMs ?? 30000), () => {
      req.destroy(timeoutError(options.idleTimeoutMs ?? options.timeoutMs ?? 30000))
    })
    if (options.body !== undefined && options.body !== null) req.end(options.body)
    else req.end()
  })
}

function connectTunnel(url, proxy, options) {
  return new Promise((resolve, reject) => {
    const mod = proxy.protocol === 'https:' ? https : http
    const targetPort = url.port || (url.protocol === 'https:' ? 443 : 80)
    const authority = `${url.hostname}:${targetPort}`
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const req = mod.request(
      {
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
        method: 'CONNECT',
        path: authority,
        headers: {
          Host: authority,
          'User-Agent': 'DSH-Downloader/0.1',
          ...proxyAuthHeader(proxy),
        },
        signal: options.signal,
      },
      (res) => {
        res.resume()
        finish(reject, new Error(`代理 CONNECT 失败: HTTP ${res.statusCode}`))
      },
    )
    req.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        return finish(reject, new Error(`代理 CONNECT 失败: HTTP ${res.statusCode}`))
      }
      if (head?.length) socket.unshift(head)
      const tlsSocket = tls.connect(
        {
          socket,
          servername: url.hostname,
          ALPNProtocols: ['http/1.1'],
        },
        () => finish(resolve, tlsSocket),
      )
      tlsSocket.on('error', (error) => finish(reject, error))
    })
    req.on('error', (error) => finish(reject, error))
    const timer = setTimeout(() => req.destroy(timeoutError(options.timeoutMs ?? 30000)), Math.max(1000, options.timeoutMs ?? 30000))
    timer.unref?.()
    req.on('close', () => clearTimeout(timer))
    req.end()
  })
}

async function requestOnceProxy(url, options, proxy) {
  const method = options.method ?? 'GET'
  const headers = { ...requestHeaders(url, options.headers), ...proxyAuthHeader(proxy) }
  if (url.protocol === 'http:') {
    return await new Promise((resolve, reject) => {
      const mod = proxy.protocol === 'https:' ? https : http
      const req = mod.request(
        {
          hostname: proxy.hostname,
          port: proxy.port || undefined,
          method,
          path: url.href,
          headers,
          signal: options.signal,
        },
        (res) => resolve(res),
      )
      req.on('error', reject)
      const timer = setTimeout(() => req.destroy(timeoutError(options.timeoutMs ?? 30000)), Math.max(1000, options.timeoutMs ?? 30000))
      timer.unref?.()
      req.on('close', () => clearTimeout(timer))
      req.setTimeout(Math.max(1000, options.idleTimeoutMs ?? options.timeoutMs ?? 30000), () => {
        req.destroy(timeoutError(options.idleTimeoutMs ?? options.timeoutMs ?? 30000))
      })
      if (options.body !== undefined && options.body !== null) req.end(options.body)
      else req.end()
    })
  }

  const tlsSocket = await connectTunnel(url, proxy, options)
  return await new Promise((resolve, reject) => {
    const agent = new https.Agent({ keepAlive: false, maxSockets: 1 })
    agent.createConnection = (_opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, tlsSocket)
        return undefined
      }
      return tlsSocket
    }
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        agent,
        signal: options.signal,
      },
      (res) => resolve(res),
    )
    req.on('error', (error) => {
      tlsSocket.destroy()
      reject(error)
    })
    const timer = setTimeout(() => {
      req.destroy(timeoutError(options.timeoutMs ?? 30000))
    }, Math.max(1000, options.timeoutMs ?? 30000))
    timer.unref?.()
    req.on('close', () => clearTimeout(timer))
    req.setTimeout(Math.max(1000, options.idleTimeoutMs ?? options.timeoutMs ?? 30000), () => {
      req.destroy(timeoutError(options.idleTimeoutMs ?? options.timeoutMs ?? 30000))
    })
    if (options.body !== undefined && options.body !== null) req.end(options.body)
    else req.end()
  })
}

function timeoutError(ms) {
  const error = new Error(`请求超时（${ms}ms 无响应/无数据）`)
  error.code = 'ETIMEDOUT'
  return error
}

/**
 * Minimal HTTP(S) client with HTTP proxy tunnelling. SOCKS proxies are rejected
 * with an actionable error rather than silently bypassed.
 */
export async function httpRequest(rawUrl, options = {}) {
  let url = rawUrl instanceof URL ? rawUrl : ensureHttpUrl(rawUrl)
  const maxRedirects = options.redirects ?? 5
  const proxyUrl = options.proxyUrl || ''
  let proxy
  if (proxyUrl) {
    proxy = new URL(proxyUrl)
    if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
      throw new Error(`暂不支持 ${proxy.protocol} 代理，请使用 http:// 或 https:// HTTP 代理（SOCKS 需先转 HTTP）`)
    }
    // Never send a local/private target through an external proxy.
    if (isPrivateHost(url.hostname)) proxy = undefined
  }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const proxyForHop = isPrivateHost(url.hostname) ? undefined : proxy
    const res = proxyForHop
      ? await requestOnceProxy(url, options, proxyForHop)
      : await requestOnceDirect(url, options)
    const status = res.statusCode ?? 0
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume()
      url = new URL(res.headers.location, url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`重定向到不支持的协议: ${url.protocol}`)
      }
      if (options.onRedirect) options.onRedirect(url)
      continue
    }
    return { res, url, statusCode: status, headers: res.headers }
  }
  throw new Error(`重定向次数过多（>${maxRedirects}）`)
}

export async function readBody(res, limit = 2 * 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of res) {
    total += chunk.length
    if (total > limit) throw new Error(`响应体超过限制（>${limit} bytes）`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 120000, idleTimeoutMs = 120000, proxyUrl, signal } = {}) {
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  const { res, url: finalUrl } = await httpRequest(url, {
    method,
    headers: {
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: payload,
    timeoutMs,
    idleTimeoutMs,
    proxyUrl,
    signal,
  })
  const text = (await readBody(res, 8 * 1024 * 1024)).toString('utf8')
  if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
    throw new Error(`HTTP ${res.statusCode} ${res.statusMessage ?? ''}: ${text.slice(0, 500)}`)
  }
  try {
    return { data: JSON.parse(text), url: finalUrl, statusCode: res.statusCode }
  } catch {
    throw new Error(`服务端返回的不是 JSON: ${text.slice(0, 300)}`)
  }
}

/** Probe one URL and return real size/range/content metadata. */
export async function probeUrl(url, options = {}) {
  const started = performance.now()
  const errors = []
  const timeoutMs = options.timeoutMs ?? 20000
  let head
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const candidate = await httpRequest(url, {
        method: 'HEAD',
        timeoutMs,
        idleTimeoutMs: timeoutMs,
        proxyUrl: options.proxyUrl,
        signal: options.signal,
        redirects: 5,
      })
      candidate.res.resume()
      if (isTransientStatus(candidate.statusCode) && attempt < 2) {
        errors.push(`HEAD: HTTP ${candidate.statusCode}`)
        await sleep(250 * (attempt + 1), options.signal)
        continue
      }
      head = candidate
      break
    } catch (error) {
      errors.push(`HEAD: ${errorText(error)}`)
      if (attempt < 2) await sleep(250 * (attempt + 1), options.signal)
    }
  }

  let total = parseLength(head?.headers?.['content-length'])
  let acceptRanges = /bytes/i.test(String(head?.headers?.['accept-ranges'] ?? ''))
  let contentType = String(head?.headers?.['content-type'] ?? '')
  let etag = String(head?.headers?.['etag'] ?? '')
  let lastModified = String(head?.headers?.['last-modified'] ?? '')
  let disposition = String(head?.headers?.['content-disposition'] ?? '')
  let finalUrl = head?.url?.href ?? String(url)
  let statusCode = head?.statusCode ?? 0

  const needRangeProbe = !head || statusCode >= 400 || total === undefined || !acceptRanges
  if (needRangeProbe) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const probe = await httpRequest(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          timeoutMs,
          idleTimeoutMs: timeoutMs,
          proxyUrl: options.proxyUrl,
          signal: options.signal,
          redirects: 5,
        })
        if (isTransientStatus(probe.statusCode) && attempt < 2) {
          probe.res.resume()
          errors.push(`GET range: HTTP ${probe.statusCode}`)
          await sleep(250 * (attempt + 1), options.signal)
          continue
        }
        statusCode = probe.statusCode
        finalUrl = probe.url.href
        const headers = probe.headers
        if (probe.statusCode === 206) {
          acceptRanges = true
          const range = parseContentRange(headers['content-range'])
          if (range?.total !== undefined) total = range.total
        }
        if (probe.statusCode === 200) {
          const len = parseLength(headers['content-length'])
          if (len !== undefined) total = len
        }
        contentType = String(headers['content-type'] ?? contentType)
        etag = String(headers['etag'] ?? etag)
        lastModified = String(headers['last-modified'] ?? lastModified)
        disposition = String(headers['content-disposition'] ?? disposition)
        try {
          for await (const _chunk of probe.res) break
        } catch {
          // The probe only needs headers.
        }
        probe.res.destroy()
        break
      } catch (error) {
        errors.push(`GET range: ${errorText(error)}`)
        if (attempt < 2) await sleep(250 * (attempt + 1), options.signal)
      }
    }
  }

  const latencyMs = Math.round(performance.now() - started)
  const ok = statusCode > 0 && statusCode < 400
  return {
    ok,
    url: finalUrl,
    statusCode,
    total,
    acceptRanges,
    contentType,
    etag,
    lastModified,
    disposition,
    latencyMs,
    errors,
  }
}

function isTransientStatus(statusCode) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(statusCode))
}

/** Read the first N bytes to estimate throughput for mirror selection. */
export async function speedProbe(url, options = {}) {
  const bytes = options.bytes ?? 256 * 1024
  const started = performance.now()
  const { res } = await httpRequest(url, {
    method: 'GET',
    headers: { Range: `bytes=0-${bytes - 1}` },
    timeoutMs: options.timeoutMs ?? 15000,
    idleTimeoutMs: options.idleTimeoutMs ?? 15000,
    proxyUrl: options.proxyUrl,
    signal: options.signal,
  })
  let received = 0
  for await (const chunk of res) {
    received += chunk.length
    if (received >= bytes) break
  }
  res.destroy()
  const elapsed = Math.max(1, performance.now() - started)
  return {
    bytes: received,
    elapsedMs: elapsed,
    speedBps: (received / elapsed) * 1000,
    ok: received > 0,
  }
}

let proxyCache = { at: 0, url: '' }

export async function detectLocalProxy(ports = [7890, 7897, 10809, 1080, 8118], timeoutMs = 250) {
  if (Date.now() - proxyCache.at < 30000) return proxyCache.url
  for (const port of ports) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      const done = (value) => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(value)
      }
      socket.setTimeout(timeoutMs, () => done(false))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })
    if (open) {
      proxyCache = { at: Date.now(), url: `http://127.0.0.1:${port}` }
      return proxyCache.url
    }
  }
  proxyCache = { at: Date.now(), url: '' }
  return ''
}

export async function resolveProxy(mode, configuredUrl, explicitUrl) {
  if (explicitUrl) return explicitUrl
  if (mode === 'off') return ''
  if (mode === 'custom') return configuredUrl || ''
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || ''
  if (env) return env
  return await detectLocalProxy()
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file))
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await fs.rename(temp, file)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
      await fs.rm(file, { force: true })
      await fs.rename(temp, file)
    } else {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }
}

export async function appendJsonl(file, record) {
  await ensureDir(path.dirname(file))
  await fs.appendFile(file, `${JSON.stringify({ at: nowIso(), ...record })}\n`, 'utf8')
}

export async function readJsonlTail(file, limit = 20) {
  try {
    const text = await fs.readFile(file, 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return { raw: line }
        }
      })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export function homeDownloads() {
  return path.join(os.homedir(), 'Downloads')
}

export function defaultDataDir() {
  const profile = process.env.DSH_PROFILE_DIR
  if (profile) return path.join(profile, 'data', 'dsh-downloader')
  return path.join(os.homedir(), '.dsh', 'data', 'dsh-downloader')
}

/** Resolve a target path without allowing a destination directory escape. */
export function resolveDestination(dest, cwd, defaultDir) {
  const raw = String(dest ?? '').trim()
  if (raw) {
    if (path.isAbsolute(raw)) return path.normalize(raw)
    return path.resolve(cwd || defaultDir, raw)
  }
  return path.join(defaultDir, fileNameFromUrl('https://example.invalid/file'))
}

export function pathExists(file) {
  return fs.access(file).then(() => true, () => false)
}

export function statOrNull(file) {
  return fs.stat(file).then((s) => s, () => null)
}

export function openFileForWrite(file) {
  return fs.open(file, 'r+').catch(async (error) => {
    if (error?.code === 'ENOENT') return fs.open(file, 'w+')
    throw error
  })
}

export function streamToFile(file) {
  return createReadStream(file)
}

export function truncateMiddle(text, max = 400) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `${value.slice(0, max - 20)}… (${value.length} chars)`
}

export function humanList(items, limit = 8) {
  const list = [...items]
  const shown = list.slice(0, limit)
  return shown.join('、') + (list.length > limit ? ` 等 ${list.length} 项` : '')
}
