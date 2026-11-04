import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  abortError,
  appendJsonl,
  clampInt,
  defaultDataDir,
  detectLocalProxy,
  ensureDir,
  ensureHttpUrl,
  errorText,
  fileNameFromDisposition,
  fileNameFromUrl,
  formatBytes,
  formatDuration,
  formatPercent,
  formatSpeed,
  hostOf,
  httpRequest,
  isAbort,
  nowIso,
  openFileForWrite,
  probeUrl,
  readJson,
  resolveProxy,
  safeUrl,
  sanitizeFileName,
  sleep,
  speedProbe,
  statOrNull,
  writeJsonAtomic,
} from './util.js'
import { discoverWithDeepSeek } from './discovery.js'

const ACTIVE = new Set(['queued', 'probing', 'downloading', 'pausing', 'paused', 'merging'])
const TERMINAL = new Set(['completed', 'failed', 'canceled'])

function httpError(statusCode, statusMessage) {
  const error = new Error(`HTTP ${statusCode}${statusMessage ? ` ${statusMessage}` : ''}`)
  error.code = `HTTP_${statusCode}`
  error.statusCode = statusCode
  return error
}

function retryable(error) {
  if (!error?.statusCode) return true
  return [408, 425, 429, 500, 502, 503, 504].includes(error.statusCode)
}

function backoffMs(attempt, base, max) {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  return Math.round(raw * (0.8 + Math.random() * 0.4))
}

function rangeHeader(start, end) {
  return end === undefined || end === null || !Number.isFinite(end) ? `bytes=${start}-` : `bytes=${start}-${end}`
}

export class DownloadManager {
  constructor({ ctx, config, store, logger }) {
    this.ctx = ctx
    this.config = config
    this.store = store
    this.logger = logger
    this.jobs = new Map()
    this.controllers = new Map()
    this.issueDedupe = new Map()
    this.jobsFile = path.join(this.store.dataDir, 'jobs.json')
    this.jobsChain = Promise.resolve()
    this.timer = undefined
    this.closed = false
    this.lastProxyDetect = 0
  }

  async init() {
    await this.store.init()
    await this.restoreJobs()
    await this.markInterrupted()
    this.timer = setInterval(() => this.tick(), 1000)
    this.timer.unref?.()
  }

  async restoreJobs() {
    const saved = await readJson(this.jobsFile, [])
    if (!Array.isArray(saved)) return
    for (const record of saved) {
      if (!record?.id || !record?.manifestPath) continue
      try {
        const manifest = await readJson(record.manifestPath, undefined)
        if (!manifest) continue
        const part = await statOrNull(record.partPath)
        if (!part) continue
        const job = {
          ...record,
          status: 'paused',
          error: '插件重启后已暂停；调用 downloader_control(action=resume) 可继续。',
          pauseRequested: false,
          cancelRequested: false,
          fatalError: undefined,
          fileHandle: undefined,
          finalizing: false,
          speedBps: 0,
          etaSeconds: undefined,
          lastProgressAt: Date.now(),
          lastSampleAt: undefined,
          lastSampleBytes: Number(record.downloadedBytes) || 0,
          updatedAt: nowIso(),
        }
        if (Array.isArray(manifest.segments)) {
          job.mode = manifest.mode === 'multi' ? 'multi' : 'single'
          job.segments = manifest.segments.map((segment, index) => ({
            index,
            start: Number(segment.start),
            end: Number(segment.end),
            pos: Math.max(0, Math.min(Number(segment.pos) || 0, Number(segment.end) - Number(segment.start) + 1)),
            status: 'paused',
            attempts: Number(segment.attempts) || 0,
            error: undefined,
          }))
          job.downloadedBytes = job.segments.reduce((sum, segment) => sum + segment.pos, 0)
        } else {
          job.mode = 'single'
          job.segments = []
          job.singlePos = Number(manifest.singlePos) || 0
          job.downloadedBytes = job.singlePos
        }
        job.totalBytes = manifest.totalBytes ?? job.totalBytes
        this.jobs.set(job.id, job)
        await this.store.addHistory(this.snapshot(job)).catch(() => {})
      } catch (error) {
        this.logger?.warn?.(`[dsh-downloader] 恢复任务 ${record.id} 失败: ${errorText(error)}`)
      }
    }
  }

  serializeJob(job) {
    return {
      id: job.id,
      query: job.query,
      url: job.url,
      originalUrl: job.originalUrl,
      host: job.host,
      fileName: job.fileName,
      destPath: job.destPath,
      partPath: job.partPath,
      manifestPath: job.manifestPath,
      totalBytes: job.totalBytes,
      downloadedBytes: job.downloadedBytes,
      status: job.status,
      mode: job.mode,
      acceptRanges: job.acceptRanges,
      contentType: job.contentType,
      etag: job.etag,
      lastModified: job.lastModified,
      connections: job.connections,
      initialConnections: job.initialConnections,
      maxRetries: job.maxRetries,
      timeoutMs: job.timeoutMs,
      idleTimeoutMs: job.idleTimeoutMs,
      proxyUrl: job.proxyUrl,
      mirrors: job.mirrors,
      segments: job.segments,
      singlePos: job.singlePos,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      agentSessionId: job.agentSessionId,
      discovery: job.discovery,
    }
  }

  async saveJobs() {
    const records = [...this.jobs.values()]
      .filter((job) => job.status !== 'completed' && job.status !== 'canceled')
      .map((job) => this.serializeJob(job))
    this.jobsChain = this.jobsChain
      .then(() => writeJsonAtomic(this.jobsFile, records))
      .catch((error) => this.logger?.warn?.(`[dsh-downloader] 保存任务索引失败: ${errorText(error)}`))
    await this.jobsChain
  }

  async markInterrupted() {
    for (const record of this.store.history.downloads) {
      if (ACTIVE.has(record.status)) {
        record.status = 'paused'
        record.error = '插件重启，下载已暂停；调用 downloader_control(action=resume) 可继续。'
        record.updatedAt = nowIso()
      }
    }
    await this.store.saveHistory().catch(() => {})
  }

  async shutdown() {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    for (const controller of this.controllers.values()) {
      try {
        controller.abort(abortError('插件卸载'))
      } catch {
        // ignore
      }
    }
    for (const job of this.jobs.values()) {
      if (ACTIVE.has(job.status)) {
        job.pauseRequested = true
        await this.persistManifest(job).catch(() => {})
      }
    }
    await this.saveJobs().catch(() => {})
  }

  async sessionCwd(exec) {
    try {
      const cwd = this.ctx.get('workingDirectory')?.get?.(exec?.agent?.session)
      if (cwd) return cwd
    } catch {
      // fall through
    }
    return process.cwd()
  }

  defaultDownloadDir(cwd) {
    const configured = String(this.config.downloadDir ?? '').trim()
    if (configured) return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured)
    return path.join(cwd || process.cwd(), 'downloads')
  }

  async start(input = {}, exec) {
    const query = String(input.query ?? '').trim()
    let originalUrl = ''
    if (input.url) originalUrl = ensureHttpUrl(input.url).href
    let discovery
    let learnedSeeds = []

    if (!originalUrl) {
      if (!query) {
        const error = new Error('请提供 url，或提供 query 让下载器搜索预置镜像 / 调用 DeepSeek 发现资源。')
        error.code = 'NO_URL_OR_QUERY'
        throw error
      }
      learnedSeeds = this.store.listResources(query, 6).map((item) => ({
        url: item.url,
        name: item.name,
        source: 'learned',
        verified: true,
        score: item.score,
      }))
      if (!learnedSeeds.length && this.config.useLlmDiscovery !== false && input.useLlm !== false) {
        try {
          discovery = await discoverWithDeepSeek({
            query,
            context: { platform: input.platform, format: input.format, notes: input.notes },
            config: this.config,
            store: this.store,
            adopt: true,
            limit: 6,
          })
          learnedSeeds = discovery.candidates.filter((item) => item.verified && item.url).map((item) => ({ ...item, source: 'deepseek' }))
        } catch (error) {
          const sources = this.store.listSources(query, 8).map((item) => ({ name: item.name, baseUrl: item.baseUrl }))
          const wrapped = new Error(`预置清单没有可直接下载的地址，DeepSeek 资源发现失败：${errorText(error)}`)
          wrapped.code = error.code === 'NO_DEEPSEEK_KEY' ? 'NO_DEEPSEEK_KEY' : 'DISCOVERY_FAILED'
          wrapped.details = { query, sources, cause: errorText(error) }
          throw wrapped
        }
      }
      if (!learnedSeeds.length) {
        const sources = this.store.listSources(query, 8).map((item) => ({ name: item.name, baseUrl: item.baseUrl }))
        const error = new Error(
          `没有找到「${query}」的可直接下载文件。预置清单只提供镜像站点根地址；请给出具体文件 URL，或配置 DeepSeek API Key 让插件自动发现并验证。`,
        )
        error.code = 'NO_DIRECT_URL'
        error.details = { query, sources }
        throw error
      }
      originalUrl = learnedSeeds[0].url
    }

    const proxyUrl = await resolveProxy(this.config.proxyMode, this.config.proxyUrl, input.proxy)
    const cwd = await this.sessionCwd(exec)
    const maxConnections = clampInt(input.connections, 1, 16, clampInt(this.config.maxConnections, 1, 16, 8))
    const retries = clampInt(input.retries, 0, 20, clampInt(this.config.maxRetries, 0, 20, 4))

    const candidates = await this.collectCandidates(originalUrl, learnedSeeds, proxyUrl, input)
    if (!candidates.length) {
      const error = new Error(`无法访问下载地址或候选镜像：${safeUrl(originalUrl)}`)
      error.code = 'NO_REACHABLE_MIRROR'
      error.details = { url: safeUrl(originalUrl), candidates: learnedSeeds.slice(0, 5).map((c) => safeUrl(c.url)) }
      throw error
    }
    const best = candidates[0]
    const totalBytes = Number.isFinite(best.total) ? best.total : undefined
    const fileName = this.pickFileName(input, best, originalUrl)
    const destPath = await this.resolveDest(input, fileName, cwd)
    const dir = path.dirname(destPath)
    await ensureDir(dir)

    if (await exists(destPath)) {
      if (!input.overwrite) {
        const error = new Error(`目标文件已存在：${destPath}。如需覆盖请传 overwrite: true，或换一个 dest。`)
        error.code = 'DEST_EXISTS'
        error.details = { destPath }
        throw error
      }
    }

    const id = `dl_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
    const host = hostOf(best.url)
    const profileConnections =
      input.connections !== undefined
        ? maxConnections
        : this.config.learnConnections === false
          ? maxConnections
          : this.store.recommendedConnections(host, maxConnections)
    const job = {
      id,
      query,
      url: best.url,
      originalUrl,
      host,
      fileName,
      destPath,
      partPath: `${destPath}.part`,
      manifestPath: `${destPath}.dshdl.json`,
      totalBytes,
      downloadedBytes: 0,
      status: 'queued',
      mode: totalBytes && totalBytes > 0 ? 'multi' : 'single',
      acceptRanges: Boolean(best.acceptRanges),
      contentType: best.contentType ?? '',
      etag: best.etag ?? '',
      lastModified: best.lastModified ?? '',
      connections: profileConnections,
      initialConnections: Math.min(clampInt(this.config.initialConnections, 1, 8, 2), profileConnections),
      maxRetries: retries,
      retryBaseDelayMs: clampInt(this.config.retryBaseDelayMs, 100, 10000, 800),
      retryMaxDelayMs: clampInt(this.config.retryMaxDelayMs, 1000, 120000, 15000),
      timeoutMs: clampInt(input.timeoutMs, 3000, 600000, clampInt(this.config.timeoutMs, 3000, 600000, 30000)),
      idleTimeoutMs: clampInt(this.config.idleTimeoutMs, 3000, 600000, 45000),
      proxyUrl,
      mirrors: candidates.map((c) => ({ url: c.url, total: c.total, acceptRanges: c.acceptRanges, score: c.score, source: c.source })),
      segments: [],
      singlePos: 0,
      nextSegment: 0,
      speedBps: 0,
      etaSeconds: undefined,
      attempts: 0,
      error: undefined,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: undefined,
      finishedAt: undefined,
      lastProgressAt: Date.now(),
      lastManifestAt: 0,
      lastNotifyAt: 0,
      agentSessionId: exec?.agent?.id,
      discovery: discovery
        ? {
            model: discovery.model,
            adopted: discovery.adopted,
            candidates: discovery.candidates.map((c) => ({
              name: c.name,
              url: safeUrl(c.finalUrl || c.url),
              verified: c.verified,
              total: c.total,
              speedBps: c.speedBps,
            })),
          }
        : undefined,
      pauseRequested: false,
      cancelRequested: false,
      fatalError: undefined,
      fileHandle: undefined,
    }

    const resumed = await this.prepareResume(job)
    if (!resumed) this.planSegments(job)
    this.jobs.set(id, job)
    await this.persistManifest(job)
    await this.saveJobs()
    this.emit('start', job)

    // Run in the background; callers poll downloader_status.
    this.run(job).catch((error) => {
      this.logger?.warn?.(`[dsh-downloader] 后台下载异常: ${errorText(error)}`)
    })

    return {
      ...this.snapshot(job),
      resumed,
      candidates: job.mirrors.map((m) => ({ ...m, url: safeUrl(m.url) })),
      discovery: job.discovery,
    }
  }

  async collectCandidates(originalUrl, seeds, proxyUrl, input) {
    const raw = []
    const add = (url, meta = {}) => {
      try {
        const u = ensureHttpUrl(url)
        if (!raw.some((item) => item.url === u.href)) raw.push({ url: u.href, ...meta })
      } catch {
        // skip malformed candidate
      }
    }
    for (const seed of seeds) {
      if (seed.url) add(seed.url, { ...seed, source: seed.source ?? 'learned' })
    }
    add(originalUrl, { source: 'direct', verified: true })
    for (const variant of mirrorVariants(originalUrl)) add(variant.url, { source: variant.source })
    for (const seed of seeds) {
      for (const variant of mirrorVariants(seed.url)) add(variant.url, { source: variant.source })
    }

    const probes = []
    const queue = raw.slice(0, 10)
    const workerCount = Math.min(3, queue.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length) {
        const item = queue.shift()
        try {
          if (item.verified && item.total && item.acceptRanges !== undefined) {
            probes.push({ ...item, ok: true, statusCode: 200, total: item.total, acceptRanges: item.acceptRanges, latencyMs: 0, contentType: item.contentType })
            continue
          }
          const probe = await probeUrl(item.url, { timeoutMs: 18000, proxyUrl })
          if (!probe.ok) {
            probes.push({ ...item, ...probe, ok: false })
            continue
          }
          let speedBps = 0
          if (probe.total && probe.acceptRanges && input?.probeSpeed !== false) {
            const measured = await speedProbe(item.url, { proxyUrl, bytes: 128 * 1024 }).catch(() => undefined)
            speedBps = measured?.speedBps ?? 0
          }
          probes.push({ ...item, ...probe, speedBps })
        } catch (error) {
          probes.push({ ...item, ok: false, error: errorText(error) })
        }
      }
    })
    await Promise.all(workers)
    const usable = probes.filter((item) => item.ok && !isHtmlProbe(item))
    usable.sort((a, b) => {
      const score = (item) =>
        (item.verified ? 20 : 0) +
        (item.acceptRanges ? 10 : 0) +
        (item.total ? 5 : 0) +
        Math.min(30, (item.speedBps ?? 0) / (256 * 1024)) -
        Math.min(8, (item.latencyMs ?? 0) / 1500)
      return score(b) - score(a)
    })
    return usable
  }

  pickFileName(input, best, originalUrl) {
    if (input.fileName) return sanitizeFileName(input.fileName)
    const fromDisposition = fileNameFromDisposition(best.disposition)
    if (fromDisposition) return fromDisposition
    const fromUrl = fileNameFromUrl(best.url || originalUrl, best.contentType)
    if (fromUrl) return fromUrl
    return sanitizeFileName(`download-${Date.now()}`)
  }

  async resolveDest(input, fileName, cwd) {
    const baseDir = this.defaultDownloadDir(cwd)
    const raw = String(input.dest ?? '').trim()
    if (!raw) return path.join(baseDir, fileName)
    let target = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd || baseDir, raw)
    const stat = await statOrNull(target)
    const looksLikeDir = /[\\/]$/.test(raw) || stat?.isDirectory() || (Boolean(input.fileName) && !path.extname(target))
    if (looksLikeDir) target = path.join(target, fileName)
    return target
  }

  planSegments(job) {
    const total = Number(job.totalBytes)
    if (!Number.isFinite(total) || total <= 0 || !job.acceptRanges || total < Math.max(512 * 1024, this.config.minSegmentBytes ?? 2 * 1024 * 1024)) {
      job.mode = 'single'
      job.segments = []
      job.singlePos = job.downloadedBytes || 0
      job.connections = 1
      return
    }
    const minSegment = clampInt(this.config.minSegmentBytes, 256 * 1024, 64 * 1024 * 1024, 2 * 1024 * 1024)
    const desired = clampInt(job.connections, 1, 16, 8)
    const count = Math.max(1, Math.min(desired, Math.ceil(total / minSegment)))
    const segSize = Math.ceil(total / count)
    job.mode = count > 1 ? 'multi' : 'single'
    job.connections = count
    if (job.mode === 'single') {
      job.segments = []
      job.singlePos = 0
      return
    }
    job.segments = Array.from({ length: count }, (_, index) => {
      const start = index * segSize
      const end = Math.min(total - 1, start + segSize - 1)
      return { index, start, end, pos: 0, status: 'pending', attempts: 0, error: undefined }
    })
    job.nextSegment = 0
  }

  async prepareResume(job) {
    const manifest = await readJson(job.manifestPath, undefined).catch(() => undefined)
    if (!manifest) return false
    if (manifest.totalBytes && job.totalBytes && manifest.totalBytes !== job.totalBytes) return false
    if (manifest.etag && job.etag && manifest.etag !== job.etag) return false
    const part = await statOrNull(job.partPath)
    if (!part) return false
    job.mode = manifest.mode === 'multi' ? 'multi' : 'single'
    job.totalBytes = manifest.totalBytes ?? job.totalBytes
    job.etag = manifest.etag ?? job.etag
    job.singlePos = Number(manifest.singlePos) || 0
    if (Array.isArray(manifest.segments)) {
      job.segments = manifest.segments.map((seg, index) => ({
        index,
        start: Number(seg.start),
        end: Number(seg.end),
        pos: Math.max(0, Math.min(Number(seg.pos) || 0, Number(seg.end) - Number(seg.start) + 1)),
        status: seg.pos >= Number(seg.end) - Number(seg.start) + 1 ? 'done' : 'pending',
        attempts: Number(seg.attempts) || 0,
        error: undefined,
      }))
      job.nextSegment = 0
      job.connections = Math.max(1, job.segments.length)
      job.downloadedBytes = job.segments.reduce((sum, seg) => sum + seg.pos, 0)
    } else {
      job.segments = []
      job.downloadedBytes = job.singlePos
    }
    if (job.mode === 'multi' && job.totalBytes) {
      const target = Number(job.totalBytes)
      if (part.size < target) {
        const handle = await fs.open(job.partPath, 'r+')
        try {
          await handle.truncate(target)
        } finally {
          await handle.close()
        }
      } else if (part.size > target) {
        const handle = await fs.open(job.partPath, 'r+')
        try {
          await handle.truncate(target)
        } finally {
          await handle.close()
        }
      }
    }
    return true
  }

  async run(job) {
    if (this.closed) return
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    job.status = 'downloading'
    job.finalizing = false
    job.startedAt = job.startedAt ?? Date.now()
    job.updatedAt = nowIso()
    job.pauseRequested = false
    job.cancelRequested = false
    job.fatalError = undefined
    job.error = undefined
    job.finishedAt = undefined
    job.lastProgressAt = Date.now()
    job.lastSampleAt = undefined
    job.lastSampleBytes = job.downloadedBytes
    job.speedBps = 0
    job.etaSeconds = undefined
    this.emit('update', job)

    let handle
    try {
      await ensureDir(path.dirname(job.partPath))
      handle = await openFileForWrite(job.partPath)
      job.fileHandle = handle
      if (job.mode === 'multi') {
        if (job.totalBytes) {
          const stat = await handle.stat()
          if (stat.size !== job.totalBytes) await handle.truncate(job.totalBytes)
        }
        await this.runMulti(job, handle, controller.signal)
      } else {
        if (!job.singlePos) {
          await handle.truncate(0)
          job.downloadedBytes = 0
        }
        await this.runSingle(job, handle, controller.signal)
      }
      if (controller.signal.aborted) throw controller.signal.reason ?? abortError()
      await this.finish(job, handle)
      handle = undefined
    } catch (error) {
      if (handle) {
        await handle.sync().catch(() => {})
        await handle.close().catch(() => {})
        handle = undefined
        job.fileHandle = undefined
      }
      const effectiveError = job.fatalError ?? error
      if (effectiveError?.code === 'RANGE_UNSUPPORTED' && job.mode === 'multi' && !job.fallbackTried) {
        // The probe said Range was supported, but the server ignored this
        // request. Restart once as a single stream rather than surfacing a
        // confusing multi-connection failure.
        job.fallbackTried = true
        job.mode = 'single'
        job.connections = 1
        job.segments = []
        job.singlePos = 0
        job.downloadedBytes = 0
        job.nextSegment = 0
        job.status = 'queued'
        job.error = undefined
        job.pauseRequested = false
        job.cancelRequested = false
        await fs.rm(job.partPath, { force: true }).catch(() => {})
        await fs.rm(job.manifestPath, { force: true }).catch(() => {})
        this.controllers.delete(job.id)
        await this.saveJobs().catch(() => {})
        setTimeout(() => {
          this.run(job).catch((restartError) => {
            this.logger?.warn?.(`[dsh-downloader] 回退单连接失败: ${errorText(restartError)}`)
          })
        }, 20)
        return
      }
      await this.persistManifest(job).catch(() => {})
      if (job.cancelRequested) {
        job.status = 'canceled'
        job.error = '已取消'
        job.finishedAt = nowIso()
      } else if (job.pauseRequested || isAbort(effectiveError)) {
        job.status = 'paused'
        job.error = job.pauseRequested ? '已暂停，可续传' : '已中断，可续传'
        job.finishedAt = nowIso()
      } else {
        job.status = 'failed'
        job.error = errorText(effectiveError)
        job.finishedAt = nowIso()
        await this.recordIssue(job, {
          kind: 'download-failed',
          severity: 'error',
          message: job.error,
          code: effectiveError?.code,
          attempts: job.attempts,
          solution: suggestionForError(effectiveError),
        })
        await this.store.recordHostFailure(job.host, {
          connections: job.connections,
          message: job.error,
          code: effectiveError?.code,
        }).catch(() => {})
      }
      await this.store.addHistory(this.snapshot(job)).catch(() => {})
      await this.saveJobs().catch(() => {})
      this.notifyAgent(job, true).catch(() => {})
      this.emit('end', job)
    } finally {
      this.controllers.delete(job.id)
      job.fileHandle = undefined
      this.emit('update', job)
    }
  }

  async runMulti(job, handle, signal) {
    const segments = job.segments
    let cursor = 0
    const take = () => {
      while (cursor < segments.length) {
        const segment = segments[cursor]
        cursor += 1
        if (segment.pos >= segment.end - segment.start + 1) {
          segment.status = 'done'
          continue
        }
        return segment
      }
      return undefined
    }
    const workerCount = Math.max(1, Math.min(job.initialConnections, segments.length))
    const controller = this.controllers.get(job.id)
    let activeWorkers = 0
    let firstError
    let resolveDrained
    const drained = new Promise((resolve) => {
      resolveDrained = resolve
    })
    const worker = async () => {
      try {
        while (!signal.aborted) {
          const segment = take()
          if (!segment) return
          await this.downloadSegment(job, segment, handle, signal)
          segment.status = 'done'
        }
      } catch (error) {
        job.fatalError = job.fatalError ?? error
        try {
          controller?.abort(error)
        } catch {
          // ignore
        }
        throw error
      }
    }
    const spawn = () => {
      if (signal.aborted || firstError) return false
      activeWorkers += 1
      worker()
        .catch((error) => {
          firstError = firstError ?? error
        })
        .finally(() => {
          activeWorkers -= 1
          if (activeWorkers === 0) resolveDrained()
        })
      return true
    }
    for (let i = 0; i < workerCount; i += 1) spawn()
    const scaler = setInterval(() => {
      if (signal.aborted || firstError || job.fatalError) return
      if (activeWorkers >= segments.length) return
      if (job.speedBps < 256 * 1024) return
      spawn()
    }, 2500)
    scaler.unref?.()
    try {
      await drained
    } finally {
      clearInterval(scaler)
    }
    if (firstError) throw firstError
    if (signal.aborted) throw signal.reason ?? abortError()
    if (job.fatalError) throw job.fatalError
    if (segments.some((segment) => segment.pos < segment.end - segment.start + 1)) {
      throw new Error('分段下载未全部完成')
    }
    job.downloadedBytes = job.totalBytes
  }

  async downloadSegment(job, segment, handle, signal) {
    const length = segment.end - segment.start + 1
    let attempt = 0
    while (attempt <= job.maxRetries) {
      if (signal.aborted) throw signal.reason ?? abortError()
      const start = segment.start + segment.pos
      if (start > segment.end) {
        segment.status = 'done'
        return
      }
      try {
        const { res, statusCode, headers } = await httpRequest(job.url, {
          method: 'GET',
          headers: { Range: rangeHeader(start, segment.end) },
          timeoutMs: job.timeoutMs,
          idleTimeoutMs: job.idleTimeoutMs,
          proxyUrl: job.proxyUrl,
          signal,
          redirects: 5,
        })
        job.attempts += 1
        if (statusCode === 416) {
          const error = httpError(416, 'Range Not Satisfiable')
          res.resume()
          if (segment.pos > 0) {
            segment.pos = 0
            job.downloadedBytes = Math.max(0, job.downloadedBytes - (start - segment.start))
            segment.attempts += 1
            attempt += 1
            await sleep(backoffMs(attempt, job.retryBaseDelayMs, job.retryMaxDelayMs), signal)
            continue
          }
          throw error
        }
        if (statusCode === 200) {
          if (job.mode === 'multi') {
            res.resume()
            const error = new Error('服务端忽略 Range 请求，无法多路续传；自动回退为单连接。')
            error.code = 'RANGE_UNSUPPORTED'
            throw error
          }
          if (start > 0) {
            await handle.truncate(0)
            segment.pos = 0
            job.downloadedBytes = 0
          }
        } else if (statusCode !== 206) {
          res.resume()
          throw httpError(statusCode, res.statusMessage)
        } else {
          const range = parseContentRangeHeader(headers['content-range'])
          if (range && range.start !== start) {
            throw new Error(`服务端返回的区间起点不匹配：期望 ${start}，实际 ${range.start}`)
          }
        }
        await this.consumeIntoFile(res, job, handle, segment, start, signal)
        segment.attempts = attempt
        if (segment.pos >= length) {
          segment.status = 'done'
          return
        }
        throw new Error('响应提前结束，准备续传')
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? abortError()
        if (error?.code === 'RANGE_UNSUPPORTED') throw error
        segment.attempts += 1
        attempt += 1
        if (attempt > job.maxRetries || !retryable(error)) {
          segment.status = 'failed'
          segment.error = errorText(error)
          await this.recordIssue(job, {
            kind: 'segment-failed',
            severity: 'error',
            message: `分段 ${segment.index} 失败：${errorText(error)}`,
            code: error?.code,
            attempts: attempt,
            solution: suggestionForError(error),
          })
          throw error
        }
        this.logger?.debug?.(`[dsh-downloader] ${job.id} 分段 ${segment.index} 第 ${attempt} 次重试: ${errorText(error)}`)
        await sleep(backoffMs(attempt, job.retryBaseDelayMs, job.retryMaxDelayMs), signal)
      }
    }
  }

  async runSingle(job, handle, signal) {
    let attempt = 0
    let pos = Math.max(0, Number(job.singlePos) || 0)
    job.downloadedBytes = pos
    if (job.totalBytes && pos >= job.totalBytes) return
    while (attempt <= job.maxRetries) {
      if (signal.aborted) throw signal.reason ?? abortError()
      try {
        const headers = pos > 0 ? { Range: rangeHeader(pos) } : {}
        const { res, statusCode, headers: responseHeaders } = await httpRequest(job.url, {
          method: 'GET',
          headers,
          timeoutMs: job.timeoutMs,
          idleTimeoutMs: job.idleTimeoutMs,
          proxyUrl: job.proxyUrl,
          signal,
          redirects: 5,
        })
        job.attempts += 1
        if (statusCode === 416) {
          res.resume()
          if (pos > 0) {
            await handle.truncate(0)
            pos = 0
            job.singlePos = 0
            job.downloadedBytes = 0
            attempt += 1
            await sleep(backoffMs(attempt, job.retryBaseDelayMs, job.retryMaxDelayMs), signal)
            continue
          }
          throw httpError(416, 'Range Not Satisfiable')
        }
        if (statusCode === 200 && pos > 0) {
          await handle.truncate(0)
          pos = 0
          job.singlePos = 0
          job.downloadedBytes = 0
        } else if (statusCode === 206) {
          const range = parseContentRangeHeader(responseHeaders['content-range'])
          if (range && range.start !== pos) throw new Error(`续传起点不匹配：期望 ${pos}，实际 ${range.start}`)
        } else if (statusCode !== 200) {
          res.resume()
          throw httpError(statusCode, res.statusMessage)
        }
        let received = 0
        for await (const chunk of res) {
          if (signal.aborted) throw signal.reason ?? abortError()
          const buffer = Buffer.from(chunk)
          await writeAll(handle, buffer, pos)
          pos += buffer.length
          received += buffer.length
          job.singlePos = pos
          job.downloadedBytes = pos
          job.lastProgressAt = Date.now()
          this.touch(job)
        }
        if (job.totalBytes && pos < job.totalBytes && received > 0) {
          throw new Error('连接提前结束，继续续传')
        }
        job.singlePos = pos
        job.downloadedBytes = pos
        return
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? abortError()
        attempt += 1
        if (attempt > job.maxRetries || !retryable(error)) {
          await this.recordIssue(job, {
            kind: 'stream-failed',
            severity: 'error',
            message: `单连接下载失败：${errorText(error)}`,
            code: error?.code,
            attempts: attempt,
            solution: suggestionForError(error),
          })
          throw error
        }
        this.logger?.debug?.(`[dsh-downloader] ${job.id} 单连接第 ${attempt} 次重试: ${errorText(error)}`)
        await sleep(backoffMs(attempt, job.retryBaseDelayMs, job.retryMaxDelayMs), signal)
      }
    }
  }

  async consumeIntoFile(res, job, handle, segment, expectedStart, signal) {
    const length = segment.end - segment.start + 1
    for await (const chunk of res) {
      if (signal.aborted) throw signal.reason ?? abortError()
      const remaining = length - segment.pos
      if (remaining <= 0) break
      let buffer = Buffer.from(chunk)
      if (buffer.length > remaining) buffer = buffer.subarray(0, remaining)
      const position = segment.start + segment.pos
      if (position < expectedStart) throw new Error('分段写入位置异常')
      await writeAll(handle, buffer, position)
      segment.pos += buffer.length
      job.downloadedBytes += buffer.length
      job.lastProgressAt = Date.now()
      this.touch(job)
      if (segment.pos >= length) break
    }
  }

  async finish(job, handle) {
    job.status = 'merging'
    job.finalizing = true
    await handle.sync()
    await handle.close()
    job.fileHandle = undefined
    const stat = await statOrNull(job.partPath)
    if (!stat) throw new Error('临时文件在合并前消失')
    if (job.totalBytes && stat.size !== job.totalBytes) {
      throw new Error(`合并校验失败：期望 ${job.totalBytes} 字节，实际 ${stat.size} 字节`)
    }
    let dest = job.destPath
    if (await exists(dest)) await fs.rm(dest, { force: true })
    await fs.rename(job.partPath, dest)
    await fs.rm(job.manifestPath, { force: true }).catch(() => {})
    job.status = 'completed'
    job.downloadedBytes = job.totalBytes ?? stat.size
    job.totalBytes = job.totalBytes ?? stat.size
    job.speedBps = 0
    job.finishedAt = nowIso()
    job.elapsedMs = job.startedAt ? Date.now() - job.startedAt : undefined
    job.updatedAt = nowIso()
    await this.store.recordHostSuccess(job.host, {
      connections: job.connections,
      speedBps: job.averageSpeedBps ?? 0,
      proxy: Boolean(job.proxyUrl),
      totalBytes: job.totalBytes,
    }).catch(() => {})
    await this.store.addHistory(this.snapshot(job)).catch(() => {})
    await this.saveJobs().catch(() => {})
    this.notifyAgent(job, true).catch(() => {})
    this.emit('end', job)
  }

  touch(job) {
    job.updatedAt = nowIso()
    const now = Date.now()
    if (now - job.lastManifestAt > 2500) {
      job.lastManifestAt = now
      this.persistManifest(job).catch(() => {})
    }
  }

  async persistManifest(job) {
    if (!job.destPath || job.finalizing || job.status === 'completed' || job.status === 'canceled') return
    const record = {
      version: 1,
      id: job.id,
      url: job.url,
      originalUrl: job.originalUrl,
      destPath: job.destPath,
      totalBytes: job.totalBytes,
      etag: job.etag,
      lastModified: job.lastModified,
      mode: job.mode,
      segments: job.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        pos: segment.pos,
        attempts: segment.attempts,
      })),
      singlePos: job.singlePos,
      createdAt: job.createdAt,
      updatedAt: nowIso(),
    }
    await writeJsonAtomic(job.manifestPath, record)
  }

  tick() {
    if (this.closed) return
    const now = Date.now()
    for (const job of this.jobs.values()) {
      if (!ACTIVE.has(job.status) || job.status === 'paused') continue
      if (job.status !== 'downloading') continue
      const elapsed = Math.max(1, now - (job.lastSampleAt ?? now))
      if (job.lastSampleAt) {
        const instant = ((job.downloadedBytes - (job.lastSampleBytes ?? job.downloadedBytes)) / elapsed) * 1000
        job.speedBps = job.speedBps ? job.speedBps * 0.65 + instant * 0.35 : instant
        job.averageSpeedBps = job.averageSpeedBps
          ? job.averageSpeedBps * 0.92 + instant * 0.08
          : instant
      }
      job.lastSampleAt = now
      job.lastSampleBytes = job.downloadedBytes
      if (job.totalBytes && job.speedBps > 0) {
        job.etaSeconds = Math.max(0, (job.totalBytes - job.downloadedBytes) / job.speedBps)
      }
      if (now - job.lastProgressAt > (this.config.stallTimeoutMs ?? 90000)) {
        try {
          this.controllers.get(job.id)?.abort(new Error(`下载停滞超过 ${Math.round((this.config.stallTimeoutMs ?? 90000) / 1000)} 秒`))
        } catch {
          // ignore
        }
      }
      const notifyInterval = Number(this.config.agentProgressIntervalMs)
      if (notifyInterval > 0 && now - (job.lastNotifyAt ?? 0) > notifyInterval) {
        if (job.speedBps > 0 || job.downloadedBytes > 2 * 1024 * 1024) {
          job.lastNotifyAt = now
          this.notifyAgent(job, false).catch(() => {})
        }
      }
    }
  }

  async notifyAgent(job, terminal) {
    if (!job.agentSessionId) return
    if (terminal && this.config.notifyOnComplete === false) return
    const agent = this.ctx.get('agents')?.get?.(job.agentSessionId)
    if (!agent) return
    const text = terminal
      ? job.status === 'completed'
        ? `[dsh-downloader] 下载完成：${job.fileName}（${formatBytes(job.totalBytes)}），保存到 ${job.destPath}。`
        : `[dsh-downloader] 下载${job.status === 'paused' ? '已暂停' : job.status === 'canceled' ? '已取消' : '失败'}：${job.fileName}。${job.error ?? ''}`
      : `[dsh-downloader] 进度：${job.fileName} ${formatPercent(job.downloadedBytes, job.totalBytes)}（${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}），${job.speedBps > 0 ? formatSpeed(job.speedBps) : '测速中'}，剩余 ${formatDuration(job.etaSeconds)}。`
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }
    try {
      if (terminal) agent.followup(message)
      else agent.inject(message)
    } catch (error) {
      await this.recordIssue(job, {
        kind: 'agent-notify-failed',
        severity: 'warn',
        message: `无法向 Agent 推送进度：${errorText(error)}`,
        code: error?.code,
      })
    }
  }

  async recordIssue(job, issue) {
    const key = `${job?.id ?? 'global'}|${issue.code ?? ''}|${issue.message ?? ''}`
    const now = Date.now()
    const last = this.issueDedupe.get(key) ?? 0
    if (now - last < 30000) return
    this.issueDedupe.set(key, now)
    await this.store.recordIssue({
      ...issue,
      downloadId: job?.id,
      host: job?.host,
      url: job?.url ? safeUrl(job.url) : undefined,
    })
  }

  async pause(id) {
    const job = this.requireJob(id)
    if (job.status === 'paused') return this.snapshot(job)
    if (!ACTIVE.has(job.status)) throw new Error(`下载 ${id} 当前状态为 ${job.status}，无法暂停`)
    job.pauseRequested = true
    job.status = 'pausing'
    this.controllers.get(id)?.abort(abortError('用户暂停'))
    await this.waitFor(id, 8)
    if (ACTIVE.has(job.status) && job.status !== 'paused') {
      job.status = 'paused'
      job.error = '已暂停，可续传'
      job.finishedAt = nowIso()
    }
    await this.persistManifest(job).catch(() => {})
    await this.store.addHistory(this.snapshot(job)).catch(() => {})
    await this.saveJobs().catch(() => {})
    return this.snapshot(job)
  }

  async resume(id) {
    const job = this.requireJob(id)
    if (job.status === 'completed') return this.snapshot(job)
    if (job.status === 'downloading' || job.status === 'queued') return this.snapshot(job)
    job.pauseRequested = false
    job.cancelRequested = false
    job.error = undefined
    job.finishedAt = undefined
    job.status = 'queued'
    if (job.downloadedBytes === 0 && job.mirrors.length > 1) {
      const current = job.mirrors.findIndex((m) => m.url === job.url)
      const next = job.mirrors[(current + 1) % job.mirrors.length]
      if (next) job.url = next.url
    }
    await this.store.addHistory(this.snapshot(job)).catch(() => {})
    await this.saveJobs().catch(() => {})
    this.run(job).catch((error) => this.logger?.warn?.(`[dsh-downloader] 恢复下载异常: ${errorText(error)}`))
    return this.snapshot(job)
  }

  async cancel(id, { removePartial = false } = {}) {
    const job = this.requireJob(id)
    if (TERMINAL.has(job.status) && job.status !== 'failed') return this.snapshot(job)
    job.cancelRequested = true
    job.pauseRequested = false
    this.controllers.get(id)?.abort(abortError('用户取消'))
    await this.waitFor(id, 8)
    if (!TERMINAL.has(job.status)) {
      job.status = 'canceled'
      job.error = '已取消'
      job.finishedAt = nowIso()
    }
    if (removePartial) {
      await fs.rm(job.partPath, { force: true }).catch(() => {})
      await fs.rm(job.manifestPath, { force: true }).catch(() => {})
    }
    await this.store.addHistory(this.snapshot(job)).catch(() => {})
    await this.saveJobs().catch(() => {})
    this.notifyAgent(job, true).catch(() => {})
    return this.snapshot(job)
  }

  requireJob(id) {
    const job = this.jobs.get(String(id ?? ''))
    if (!job) throw new Error(`找不到下载任务 ${id}；用 downloader_status 查看有效 id。`)
    return job
  }

  get(id) {
    return this.jobs.get(String(id ?? ''))
  }

  list({ activeOnly = false } = {}) {
    const jobs = [...this.jobs.values()]
    const sorted = jobs.sort((a, b) => {
      const aActive = ACTIVE.has(a.status) ? 0 : 1
      const bActive = ACTIVE.has(b.status) ? 0 : 1
      return aActive - bActive || String(b.updatedAt).localeCompare(String(a.updatedAt))
    })
    return activeOnly ? sorted.filter((job) => ACTIVE.has(job.status)) : sorted
  }

  history(limit = 20) {
    return this.store.history.downloads.slice(-limit).reverse()
  }

  snapshot(job) {
    const total = Number(job.totalBytes) || 0
    const done = Number(job.downloadedBytes) || 0
    return {
      id: job.id,
      status: job.status,
      url: safeUrl(job.url),
      originalUrl: safeUrl(job.originalUrl),
      host: job.host,
      fileName: job.fileName,
      destPath: job.destPath,
      partPath: job.partPath,
      totalBytes: total,
      downloadedBytes: done,
      progress: total ? Math.min(1, done / total) : undefined,
      progressText: formatPercent(done, total),
      speedBps: Math.round(job.speedBps || 0),
      speedText: formatSpeed(job.speedBps),
      etaSeconds: job.etaSeconds,
      etaText: formatDuration(job.etaSeconds),
      mode: job.mode,
      connections: job.connections,
      acceptRanges: job.acceptRanges,
      contentType: job.contentType,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      elapsedMs: job.elapsedMs ?? (job.startedAt ? Date.now() - job.startedAt : undefined),
      attempts: job.attempts,
      error: job.error,
      resumable: job.mode === 'multi' ? Boolean(job.totalBytes) : job.singlePos > 0 || job.status !== 'completed',
      segments: job.segments.length
        ? {
            total: job.segments.length,
            done: job.segments.filter((s) => s.pos >= s.end - s.start + 1).length,
            failed: job.segments.filter((s) => s.status === 'failed').length,
          }
        : { total: 1, done: job.status === 'completed' ? 1 : 0, failed: 0 },
      discovery: job.discovery,
    }
  }

  async state() {
    const active = this.list({ activeOnly: true }).map((job) => this.snapshot(job))
    const recent = this.list()
      .filter((job) => !ACTIVE.has(job.status))
      .slice(0, 12)
      .map((job) => this.snapshot(job))
    const storedRecent = this.store.history.downloads
      .slice(-12)
      .reverse()
      .filter((item) => !recent.some((job) => job.id === item.id))
    return {
      version: 1,
      active,
      recent: [...recent, ...storedRecent].slice(0, 20),
      stats: {
        ...this.store.stats(),
        active: active.length,
        aggregateSpeedBps: active.reduce((sum, job) => sum + (job.speedBps || 0), 0),
      },
      issues: await this.store.recentIssues(8),
      lessons: await this.store.lessons(5),
      config: {
        downloadDir: this.config.downloadDir || '',
        maxConnections: this.config.maxConnections,
        proxyMode: this.config.proxyMode,
        llmDiscovery: this.config.useLlmDiscovery !== false,
        deepseekConfigured: Boolean(this.config.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY),
      },
    }
  }

  async waitFor(id, seconds = 0) {
    const deadline = Date.now() + Math.max(0, seconds) * 1000
    let job = id ? this.jobs.get(id) : undefined
    if (!job) throw new Error(`找不到下载任务 ${id}`)
    while (Date.now() < deadline) {
      if (TERMINAL.has(job.status) || job.status === 'paused') break
      await sleep(350)
    }
    return this.snapshot(job)
  }

  emit(event, job) {
    // Intentionally empty: the Web panel polls state; this hook keeps room for
    // future subscribers without coupling the manager to the HTTP layer.
    void event
    void job
  }
}

function exists(file) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

async function writeAll(handle, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset)
    if (!bytesWritten) throw new Error('磁盘写入返回 0 字节')
    offset += bytesWritten
  }
}

function parseContentRangeHeader(value) {
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(String(value ?? ''))
  if (!match) return undefined
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? undefined : Number(match[3]) }
}

function isHtmlProbe(item) {
  const type = String(item.contentType ?? '').toLowerCase()
  const disposition = String(item.disposition ?? '').toLowerCase()
  return type.includes('text/html') && !disposition.includes('attachment')
}

function mirrorVariants(rawUrl) {
  const variants = []
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase()
    if (host === 'github.com') {
      variants.push({ url: `https://ghfast.top/${url.href}`, source: 'mirror:ghfast' })
      variants.push({ url: `https://gh-proxy.com/${url.href}`, source: 'mirror:gh-proxy' })
      variants.push({ url: `https://ghproxy.net/${url.href}`, source: 'mirror:ghproxy.net' })
    } else if (host === 'raw.githubusercontent.com') {
      variants.push({ url: `https://ghfast.top/${url.href}`, source: 'mirror:ghfast' })
      variants.push({ url: `https://gh-proxy.com/${url.href}`, source: 'mirror:gh-proxy' })
    } else if (host === 'nodejs.org' && url.pathname.startsWith('/dist/')) {
      variants.push({ url: `https://npmmirror.com/mirrors/node/${url.pathname.slice('/dist/'.length)}`, source: 'mirror:npmmirror-node' })
    } else if (host === 'huggingface.co') {
      variants.push({ url: `https://hf-mirror.com${url.pathname}${url.search}`, source: 'mirror:hf-mirror' })
    }
  } catch {
    // ignore
  }
  return variants
}

async function httpRequestWithRetryOnce(job, signal, options) {
  return await httpRequest(job.url, {
    ...options,
    timeoutMs: job.timeoutMs,
    idleTimeoutMs: job.idleTimeoutMs,
    proxyUrl: job.proxyUrl,
    signal,
    redirects: 5,
  })
}

function suggestionForError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '')
  if (code === 'ETIMEDOUT' || /超时/.test(message)) return '降低并发或延长 timeoutMs/idleTimeoutMs；检查代理稳定性。'
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') return '检查 DNS、网络和代理地址；可换预置国内镜像。'
  if (code === 'HTTP_403' || code === 'HTTP_401') return '地址可能需要鉴权或防盗链；换官方/镜像地址，或提供有效的直接链接。'
  if (code === 'HTTP_416') return '续传区间与服务端不一致；删除 .part 与 .dshdl.json 后重试。'
  if (code === 'RANGE_UNSUPPORTED') return '该服务器不支持 Range，已回退单连接；大文件建议换支持断点续传的镜像。'
  if (code === 'DEST_EXISTS') return '目标文件已存在；传 overwrite: true 或更换 dest。'
  return '可重试、换镜像，或用 downloader_report 记录问题。'
}
