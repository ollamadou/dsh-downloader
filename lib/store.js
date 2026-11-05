import path from 'node:path'
import {
  appendJsonl,
  ensureDir,
  hostOf,
  nowIso,
  readJson,
  readJsonlTail,
  shortHash,
  writeJsonAtomic,
} from './util.js'
import { BUILTIN_PROXIES, BUILTIN_SOURCES, scoreSource, searchBuiltin } from './presets.js'

const EMPTY = Object.freeze({ version: 1, learnedSources: [], learnedResources: [] })

function tokenScore(text, query) {
  const haystack = String(text ?? '').toLowerCase()
  const q = String(query ?? '').toLowerCase().trim()
  if (!q) return 0
  if (haystack === q) return 100
  let score = 0
  if (haystack.includes(q)) score += 60
  const tokens = q.split(/[\s,;/\\|]+/).filter((t) => t.length >= 2)
  for (const token of tokens) if (haystack.includes(token)) score += 12
  return score
}

export class Store {
  constructor({ dataDir, logger }) {
    this.dataDir = dataDir
    this.logger = logger
    this.sourcesFile = path.join(dataDir, 'sources.json')
    this.hostsFile = path.join(dataDir, 'hosts.json')
    this.historyFile = path.join(dataDir, 'history.json')
    this.issuesFile = path.join(dataDir, 'issues.jsonl')
    this.learned = { ...EMPTY, learnedSources: [], learnedResources: [] }
    this.hosts = { version: 1, hosts: {} }
    this.history = { version: 1, downloads: [] }
    this.saveChain = Promise.resolve()
  }

  async init() {
    await ensureDir(this.dataDir)
    const [sources, hosts, history] = await Promise.all([
      readJson(this.sourcesFile, EMPTY),
      readJson(this.hostsFile, { version: 1, hosts: {} }),
      readJson(this.historyFile, { version: 1, downloads: [] }),
    ])
    this.learned = {
      version: 1,
      learnedSources: Array.isArray(sources?.learnedSources) ? sources.learnedSources : [],
      learnedResources: Array.isArray(sources?.learnedResources) ? sources.learnedResources : [],
    }
    this.hosts = {
      version: 1,
      hosts: hosts && typeof hosts.hosts === 'object' && hosts.hosts ? hosts.hosts : {},
    }
    this.history = {
      version: 1,
      downloads: Array.isArray(history?.downloads) ? history.downloads.slice(-100) : [],
    }
  }

  saveSources() {
    this.saveChain = this.saveChain
      .then(() => writeJsonAtomic(this.sourcesFile, this.learned))
      .catch((error) => this.logger?.warn?.(`[dshdownloader] 保存资源清单失败: ${error?.message ?? error}`))
    return this.saveChain
  }

  saveHosts() {
    this.saveChain = this.saveChain
      .then(() => writeJsonAtomic(this.hostsFile, this.hosts))
      .catch((error) => this.logger?.warn?.(`[dshdownloader] 保存主机学习数据失败: ${error?.message ?? error}`))
    return this.saveChain
  }

  saveHistory() {
    this.saveChain = this.saveChain
      .then(() => writeJsonAtomic(this.historyFile, this.history))
      .catch((error) => this.logger?.warn?.(`[dshdownloader] 保存下载历史失败: ${error?.message ?? error}`))
    return this.saveChain
  }

  listSources(query = '', limit = 50) {
    const learnedSources = this.learned.learnedSources.map((item) => ({
      ...item,
      source: 'learned',
      score: scoreSource(item, query),
    }))
    const builtin = BUILTIN_SOURCES.map((item) => ({ ...item, source: 'builtin', score: scoreSource(item, query) }))
    let all = [...builtin, ...learnedSources]
    if (String(query ?? '').trim()) all = all.filter((item) => item.score > 0)
    all.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'))
    return all.slice(0, limit)
  }

  listProxies() {
    return BUILTIN_PROXIES.map((item) => ({ ...item, source: 'builtin' }))
  }

  searchBuiltin(query, limit) {
    return searchBuiltin(query, limit)
  }

  listResources(query = '', limit = 20) {
    const q = String(query ?? '').trim()
    return this.learned.learnedResources
      .map((item) => ({
        ...item,
        score:
          tokenScore(item.name, q) +
          tokenScore(item.query, q) +
          tokenScore(item.url, q) +
          (item.query && q && item.query.toLowerCase() === q.toLowerCase() ? 30 : 0),
      }))
      .filter((item) => !q || item.score > 0)
      .sort((a, b) => b.score - a.score || String(b.verifiedAt ?? '').localeCompare(String(a.verifiedAt ?? '')))
      .slice(0, limit)
  }

  async adoptResource({ name, url, query, size, contentType, etag, note, origin = 'deepseek', score = 0 }) {
    if (!url) throw new Error('资源 URL 为空')
    const normalized = String(url)
    const existing = this.learned.learnedResources.find((item) => item.url === normalized)
    const record = {
      id: existing?.id ?? `res_${shortHash(normalized, 10)}`,
      name: name || existing?.name || hostOf(normalized),
      url: normalized,
      host: hostOf(normalized),
      query: query || existing?.query || '',
      size: Number.isFinite(size) ? size : existing?.size,
      contentType: contentType || existing?.contentType || '',
      etag: etag || existing?.etag || '',
      note: note || existing?.note || '',
      origin,
      score,
      learnedAt: existing?.learnedAt ?? nowIso(),
      verifiedAt: nowIso(),
      adoptCount: (existing?.adoptCount ?? 0) + 1,
    }
    if (existing) Object.assign(existing, record)
    else this.learned.learnedResources.push(record)
    this.learned.learnedResources = this.learned.learnedResources.slice(-500)
    await this.saveSources()
    return record
  }

  async adoptSource({ name, baseUrl, kind = 'learned', note = '', keywords = [], origin = 'deepseek' }) {
    if (!baseUrl) return undefined
    let originUrl
    try {
      originUrl = new URL(baseUrl)
    } catch {
      return undefined
    }
    const existing = this.learned.learnedSources.find(
      (item) => item.baseUrl === baseUrl || (item.host && item.host === originUrl.host),
    )
    const record = {
      id: existing?.id ?? `site_${shortHash(originUrl.host, 10)}`,
      name: name || existing?.name || originUrl.host,
      kind,
      baseUrl,
      host: originUrl.host,
      aliases: existing?.aliases ?? [],
      keywords: [...new Set([...(existing?.keywords ?? []), ...keywords])],
      note: note || existing?.note || '',
      origin,
      learnedAt: existing?.learnedAt ?? nowIso(),
      verifiedAt: nowIso(),
      adoptCount: (existing?.adoptCount ?? 0) + 1,
    }
    if (existing) Object.assign(existing, record)
    else this.learned.learnedSources.push(record)
    this.learned.learnedSources = this.learned.learnedSources.slice(-300)
    await this.saveSources()
    return record
  }

  async removeLearned(id) {
    const before = this.learned.learnedSources.length + this.learned.learnedResources.length
    this.learned.learnedSources = this.learned.learnedSources.filter((item) => item.id !== id)
    this.learned.learnedResources = this.learned.learnedResources.filter((item) => item.id !== id)
    const removed = before - (this.learned.learnedSources.length + this.learned.learnedResources.length)
    if (removed) await this.saveSources()
    return removed > 0
  }

  async recordIssue(issue) {
    const record = {
      kind: issue.kind ?? 'download',
      severity: issue.severity ?? 'warn',
      message: String(issue.message ?? '').slice(0, 2000),
      downloadId: issue.downloadId,
      host: issue.host,
      url: issue.url,
      code: issue.code,
      attempts: issue.attempts,
      solution: issue.solution,
    }
    try {
      await appendJsonl(this.issuesFile, record)
    } catch (error) {
      this.logger?.warn?.(`[dshdownloader] 写入问题日志失败: ${error?.message ?? error}`)
    }
    return record
  }

  async report(issue) {
    return await this.recordIssue({ ...issue, kind: issue.kind ?? 'manual', severity: issue.severity ?? 'info' })
  }

  async recentIssues(limit = 10) {
    return await readJsonlTail(this.issuesFile, limit)
  }

  async lessons(limit = 8) {
    const issues = await this.recentIssues(80)
    const grouped = new Map()
    for (const issue of issues) {
      const key = `${issue.code ?? ''}|${issue.message ?? ''}`.slice(0, 300)
      if (!grouped.has(key)) grouped.set(key, { count: 0, last: issue, solutions: new Set() })
      const entry = grouped.get(key)
      entry.count += 1
      entry.last = issue
      if (issue.solution) entry.solutions.add(String(issue.solution).slice(0, 300))
    }
    return [...grouped.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((entry) => ({
        count: entry.count,
        message: entry.last?.message,
        kind: entry.last?.kind,
        code: entry.last?.code,
        host: entry.last?.host,
        lastAt: entry.last?.at,
        solutions: [...entry.solutions],
        suggestion: suggestionFor(entry.last, entry.solutions),
      }))
  }

  hostProfile(host) {
    return this.hosts.hosts[host]
  }

  recommendedConnections(host, fallback) {
    const profile = this.hosts.hosts[host]
    if (!profile?.connections) return fallback
    return Math.min(16, Math.max(1, profile.connections))
  }

  async recordHostSuccess(host, { connections, speedBps, proxy, totalBytes }) {
    if (!host) return
    const previous = this.hosts.hosts[host] ?? {
      host,
      successes: 0,
      failures: 0,
      connections: 2,
      avgSpeedBps: 0,
      bestSpeedBps: 0,
      firstAt: nowIso(),
    }
    const speed = Number.isFinite(speedBps) ? speedBps : 0
    const next = {
      ...previous,
      host,
      successes: previous.successes + 1,
      connections: Number(connections) || previous.connections,
      avgSpeedBps: previous.avgSpeedBps ? previous.avgSpeedBps * 0.7 + speed * 0.3 : speed,
      bestSpeedBps: Math.max(previous.bestSpeedBps ?? 0, speed),
      lastBytes: Number.isFinite(totalBytes) ? totalBytes : previous.lastBytes,
      proxy: proxy ? true : previous.proxy,
      lastSuccessAt: nowIso(),
      lastAt: nowIso(),
    }
    this.hosts.hosts[host] = next
    await this.saveHosts()
  }

  async recordHostFailure(host, { connections, message, code }) {
    if (!host) return
    const previous = this.hosts.hosts[host] ?? {
      host,
      successes: 0,
      failures: 0,
      connections: Number(connections) || 2,
      avgSpeedBps: 0,
      bestSpeedBps: 0,
      firstAt: nowIso(),
    }
    this.hosts.hosts[host] = {
      ...previous,
      host,
      failures: previous.failures + 1,
      connections: Math.max(1, Math.min(previous.connections, (Number(connections) || previous.connections) - 1)),
      lastError: String(message ?? '').slice(0, 300),
      lastCode: code,
      lastFailureAt: nowIso(),
      lastAt: nowIso(),
    }
    await this.saveHosts()
  }

  async addHistory(snapshot) {
    const slim = {
      id: snapshot.id,
      name: snapshot.fileName,
      url: snapshot.url,
      host: snapshot.host,
      destPath: snapshot.destPath,
      status: snapshot.status,
      totalBytes: snapshot.totalBytes,
      downloadedBytes: snapshot.downloadedBytes,
      speedBps: snapshot.speedBps,
      connections: snapshot.connections,
      createdAt: snapshot.createdAt,
      finishedAt: snapshot.finishedAt,
      error: snapshot.error,
      elapsedMs: snapshot.elapsedMs,
    }
    this.history.downloads = [...this.history.downloads.filter((item) => item.id !== slim.id), slim].slice(-100)
    await this.saveHistory()
  }

  stats() {
    return {
      learnedSources: this.learned.learnedSources.length,
      learnedResources: this.learned.learnedResources.length,
      knownHosts: Object.keys(this.hosts.hosts).length,
      history: this.history.downloads.length,
      builtinSources: BUILTIN_SOURCES.length,
      proxies: BUILTIN_PROXIES.length,
    }
  }
}

function suggestionFor(issue, solutions) {
  if (solutions.size) return [...solutions][0]
  const code = String(issue?.code ?? '').toUpperCase()
  const message = String(issue?.message ?? '')
  if (code === 'ETIMEDOUT' || /超时/.test(message)) return '降低并发连接数或延长 timeoutMs/idleTimeoutMs；若走代理，检查代理是否稳定。'
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') return '检查网络与代理地址；国内资源可换用预置镜像。'
  if (/403|401/.test(message)) return '该地址可能有防盗链或鉴权，换官方/镜像地址或补充可用的 Referer。'
  if (/416/.test(message)) return '续传位置与服务端不一致，删除 .part 与 .dshdl.json 后重新开始。'
  if (/range|206/i.test(message)) return '服务端不支持 Range 时会自动回退单连接；大文件建议换支持断点续传的镜像。'
  return '重试或换镜像；用 downloader_report 记录现象，插件会沉淀到问题日志。'
}
