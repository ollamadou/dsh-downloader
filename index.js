import {
  deepMerge,
  defaultDataDir,
  errorText,
  formatBytes,
  formatSpeed,
  isPlainObject,
  nowIso,
  truncateMiddle,
} from './lib/util.js'
import { Store } from './lib/store.js'
import { DownloadManager } from './lib/downloader.js'
import { discoverWithDeepSeek, deepseekConfig, verifyCandidates } from './lib/discovery.js'
import { BUILTIN_PROXIES, BUILTIN_SOURCES } from './lib/presets.js'

const DEFAULTS = Object.freeze({
  downloadDir: '',
  dataDir: '',
  maxConnections: 8,
  initialConnections: 2,
  minSegmentBytes: 2 * 1024 * 1024,
  timeoutMs: 30000,
  idleTimeoutMs: 45000,
  maxRetries: 4,
  retryBaseDelayMs: 800,
  retryMaxDelayMs: 15000,
  stallTimeoutMs: 90000,
  agentProgressIntervalMs: 20000,
  progressIntervalMs: 3000,
  proxyMode: 'auto',
  proxyUrl: '',
  useLlmDiscovery: true,
  learnConnections: true,
  notifyOnComplete: false,
  overwriteByDefault: false,
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    timeoutMs: 120000,
  },
})

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (item === undefined ? null : item)))
}

function textResult(text) {
  return [{ type: 'text', text }]
}

function outputFor(render) {
  return {
    schema: OUTPUT_SCHEMA,
    render(_args, value) {
      return textResult(render ? render(value) : truncateMiddle(JSON.stringify(value, null, 2), 8000))
    },
  }
}

function errorPayload(error, extra = {}) {
  return {
    ok: false,
    code: error?.code ?? 'ERROR',
    error: errorText(error),
    details: error?.details,
    suggestion: suggestionFor(error),
    at: nowIso(),
    ...extra,
  }
}

function suggestionFor(error) {
  switch (error?.code) {
    case 'NO_DEEPSEEK_KEY':
      return '在插件配置 deepseek.apiKey 填入 Key，或设置环境变量 DEEPSEEK_API_KEY；也可直接传 url。'
    case 'NO_DIRECT_URL':
      return '用 downloader_sources(action=search) 查看镜像；给出具体文件 URL；或让 Agent 用 web_search 找到直链后 downloader_sources(action=add) 采纳。'
    case 'DEST_EXISTS':
      return '传 overwrite: true 覆盖，或换 dest。'
    case 'NO_REACHABLE_MIRROR':
      return '检查网络/代理；换镜像或稍后重试；国内资源可试 proxyMode: off。'
    case 'RANGE_UNSUPPORTED':
      return '该服务器不支持多线程 Range，插件会以单连接下载；重试前可把 connections 设为 1。'
    default:
      return '用 downloader_status 查看任务状态；必要时 downloader_report 记录问题。'
  }
}

function summaryOfDownload(value) {
  if (!value) return '（无结果）'
  if (value.ok === false) {
    const lines = [`下载未开始：${value.error}`]
    if (value.code) lines.push(`代码：${value.code}`)
    if (value.suggestion) lines.push(`建议：${value.suggestion}`)
    if (value.details?.sources?.length) {
      lines.push('可用镜像/站点：')
      for (const source of value.details.sources.slice(0, 6)) lines.push(`- ${source.name}: ${source.baseUrl}`)
    }
    return lines.join('\n')
  }
  const lines = [
    `任务 ${value.id}：${value.status}`,
    `文件：${value.fileName ?? '—'}`,
    `地址：${value.url ?? '—'}`,
    `保存到：${value.destPath ?? '—'}`,
    `进度：${value.progressText ?? '—'}（${formatBytes(value.downloadedBytes)} / ${formatBytes(value.totalBytes)}）`,
    `速度：${value.speedText ?? formatSpeed(value.speedBps)}，剩余：${value.etaText ?? '—'}`,
    `连接：${value.connections ?? 1}，模式：${value.mode ?? '—'}，重试：${value.attempts ?? 0}`,
  ]
  if (value.resumed) lines.push('已从上次进度续传。')
  if (value.error) lines.push(`错误：${value.error}`)
  if (value.discovery?.candidates?.length) {
    lines.push(`DeepSeek 候选（${value.discovery.model}）：`)
    for (const candidate of value.discovery.candidates.slice(0, 5)) lines.push(`- ${candidate.name}: ${candidate.url}`)
  }
  lines.push(
    value.status === 'completed'
      ? '下载已完成；向用户报告文件名、大小和 destPath 即可。'
      : '下一步：用 downloader_status(id, waitSeconds=15~30) 查看进度；完成后才向用户报告成功。',
  )
  return lines.join('\n')
}

function summarizeState(value) {
  const lines = []
  if (value.active?.length) {
    lines.push(`进行中 ${value.active.length} 个任务，总速度 ${formatSpeed(value.stats?.aggregateSpeedBps)}：`)
    for (const job of value.active) {
      lines.push(`- ${job.id} ${job.status} ${job.fileName} ${job.progressText} ${job.speedText} → ${job.destPath}`)
    }
  } else {
    lines.push('当前没有进行中的下载。')
  }
  if (value.recent?.length) {
    lines.push('最近任务：')
    for (const job of value.recent.slice(0, 6)) lines.push(`- ${job.id} ${job.status} ${job.fileName} ${job.error ?? ''}`)
  }
  if (value.issues?.length) {
    lines.push('最近问题：')
    for (const issue of value.issues.slice(0, 4)) lines.push(`- [${issue.severity ?? 'warn'}] ${issue.message}`)
  }
  if (value.lessons?.length) {
    lines.push('经验：')
    for (const lesson of value.lessons.slice(0, 3)) lines.push(`- ${lesson.message}（${lesson.count} 次）${lesson.suggestion ?? ''}`)
  }
  return lines.join('\n')
}

function buildToolDefinitions(manager, store, config) {
  const download = {
    name: 'downloader_download',
    description:
      'Start a robust background download with resume, multi-connection acceleration, timeout retries and mirror selection. Give a direct URL, or a natural-language query to use the built-in China mirror list and DeepSeek discovery. Returns immediately with a download id; poll downloader_status until completed before reporting success.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Direct http(s) file URL. Provide this or query.' },
        query: {
          type: 'string',
          description: 'What to download, e.g. "Node.js 22 LTS Windows x64 installer". Used for preset search and DeepSeek discovery when url is absent.',
        },
        dest: {
          type: 'string',
          description: 'Destination file or directory. Relative paths resolve under the session working directory. Defaults to <workspace>/downloads/<filename>.',
        },
        fileName: { type: 'string', description: 'Override the file name; when set, dest is treated as a directory.' },
        connections: { type: 'integer', minimum: 1, maximum: 16, description: 'Maximum parallel connections. Default from config (8); small files use 1.' },
        retries: { type: 'integer', minimum: 0, maximum: 20, description: 'Per-segment/stream retry limit. Default 4.' },
        proxy: { type: 'string', description: 'Per-download HTTP proxy URL override, e.g. http://127.0.0.1:7890. SOCKS is not supported.' },
        timeoutMs: { type: 'integer', minimum: 3000, maximum: 600000, description: 'Connect/headers timeout in milliseconds. Default 30000.' },
        overwrite: { type: 'boolean', description: 'Overwrite an existing destination. Default false.' },
        useLlm: { type: 'boolean', description: 'Allow DeepSeek discovery when no verified direct URL is found. Default true.' },
        waitSeconds: { type: 'integer', minimum: 0, maximum: 30, description: 'Wait up to this long after starting and return the latest progress. Default 0.' },
      },
    },
    output: outputFor(summaryOfDownload),
    timeoutMs: 180000,
    async execute(args, exec) {
      try {
        const started = await manager.start(args ?? {}, exec)
        const waitSeconds = Number(args?.waitSeconds) || 0
        const value = waitSeconds > 0 ? await manager.waitFor(started.id, Math.min(30, waitSeconds)) : started
        return { ok: true, ...jsonSafe(value) }
      } catch (error) {
        return jsonSafe(errorPayload(error))
      }
    },
  }

  const status = {
    name: 'downloader_status',
    description:
      'Read download progress, active/recent tasks, recorded problems and lessons. With an id, optionally long-poll for up to 30 seconds; without an id, returns the whole manager state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Download id returned by downloader_download.' },
        waitSeconds: { type: 'integer', minimum: 0, maximum: 30, description: 'Wait for completion or the next progress sample before returning.' },
        verbose: { type: 'boolean', description: 'Include segment-level details for one task.' },
      },
    },
    output: outputFor((value) => (value?.id ? summaryOfDownload(value) : summarizeState(value))),
    timeoutMs: 45000,
    async execute(args) {
      try {
        if (args?.id) {
          const value = await manager.waitFor(args.id, Number(args.waitSeconds) || 0)
          return { ok: true, ...jsonSafe(value) }
        }
        return { ok: true, ...jsonSafe(await manager.state()) }
      } catch (error) {
        return jsonSafe(errorPayload(error))
      }
    },
  }

  const control = {
    name: 'downloader_control',
    description: 'Pause, resume or cancel a background download. Resuming keeps the .part file and continues from the saved segment offsets.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'id'],
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'cancel'], description: 'Operation to perform.' },
        id: { type: 'string', description: 'Download id.' },
        removePartial: { type: 'boolean', description: 'For cancel only: delete the .part and resume manifest. Default false.' },
      },
    },
    output: outputFor(summaryOfDownload),
    timeoutMs: 30000,
    async execute(args) {
      try {
        let value
        if (args.action === 'pause') value = await manager.pause(args.id)
        else if (args.action === 'resume') value = await manager.resume(args.id)
        else if (args.action === 'cancel') value = await manager.cancel(args.id, { removePartial: Boolean(args.removePartial) })
        else throw new Error(`未知操作: ${args.action}`)
        return { ok: true, ...jsonSafe(value) }
      } catch (error) {
        return jsonSafe(errorPayload(error))
      }
    },
  }

  const sources = {
    name: 'downloader_sources',
    description:
      'Browse or extend the persisted resource directory. Search built-in China mirrors/proxies; verify and adopt a direct URL (so it is remembered for later downloads); add a mirror site; or remove a learned entry. Adopted entries are stored in the plugin data directory, never written back to the bundled preset file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'search', 'add', 'addSite', 'remove', 'proxies'], description: 'Directory operation.' },
        query: { type: 'string', description: 'Search text for list/search, or context for add.' },
        url: { type: 'string', description: 'Direct file URL for action=add.' },
        baseUrl: { type: 'string', description: 'Mirror/site root URL for action=addSite.' },
        name: { type: 'string', description: 'Display name.' },
        note: { type: 'string', description: 'Optional note stored with the entry.' },
        id: { type: 'string', description: 'Learned entry id for action=remove.' },
        adopt: { type: 'boolean', description: 'For action=add, persist the verified resource. Default true.' },
      },
    },
    output: outputFor((value) => {
      const lines = []
      if (value.stats) {
        lines.push(
          `预置：${value.stats.builtinSources ?? 0} 个站点 / ${value.stats.proxies ?? 0} 个代理；已学习：${value.stats.learnedResources ?? 0} 个资源 / ${value.stats.learnedSources ?? 0} 个站点。`,
        )
      }
      if (value.proxies?.length) {
        lines.push('代理预置：')
        for (const p of value.proxies) lines.push(`- ${p.name}: ${p.url || p.mode}${p.note ? `（${p.note}）` : ''}`)
      }
      if (value.sources?.length) {
        lines.push('镜像/站点：')
        for (const source of value.sources.slice(0, 14)) {
          lines.push(`- ${source.name} [${source.kind}] ${source.baseUrl}${source.source === 'learned' ? '（已学习）' : ''}`)
        }
      }
      if (value.resources?.length) {
        lines.push('已学习的直链资源：')
        for (const resource of value.resources.slice(0, 10)) {
          lines.push(`- ${resource.name} ${formatBytes(resource.size)} ${resource.url}`)
        }
      }
      if (value.candidates) {
        lines.push('验证结果：')
        for (const candidate of value.candidates) {
          lines.push(`- ${candidate.verified ? '✓' : '✗'} ${candidate.name} ${candidate.totalText ?? ''} ${candidate.url}${candidate.error ? `（${candidate.error}）` : ''}`)
        }
      }
      if (!lines.length) return truncateMiddle(JSON.stringify(value, null, 2), 7000)
      return lines.join('\n')
    }),
    timeoutMs: 120000,
    async execute(args) {
      try {
        if (args.action === 'list') {
          return {
            ok: true,
            ...jsonSafe({
              stats: store.stats(),
              sources: store.listSources(args.query ?? '', 80),
              resources: store.listResources(args.query ?? '', 20),
              proxies: store.listProxies(),
            }),
          }
        }
        if (args.action === 'search') {
          return {
            ok: true,
            ...jsonSafe({
              query: args.query ?? '',
              sources: store.listSources(args.query ?? '', 12),
              resources: store.listResources(args.query ?? '', 12),
            }),
          }
        }
        if (args.action === 'proxies') return { ok: true, proxies: jsonSafe(store.listProxies()) }
        if (args.action === 'addSite') {
          if (!args.baseUrl) throw new Error('addSite 需要 baseUrl')
          const record = await store.adoptSource({
            name: args.name || args.baseUrl,
            baseUrl: args.baseUrl,
            kind: 'learned',
            note: args.note || '',
            origin: 'manual',
          })
          return { ok: true, site: jsonSafe(record) }
        }
        if (args.action === 'add') {
          if (!args.url) throw new Error('add 需要 url')
          const candidates = await verifyCandidates(
            [{ name: args.name || args.query || args.url, url: args.url, note: args.note, confidence: 1 }],
            {
              config,
              store: args.adopt === false ? undefined : store,
              query: args.query || args.name || args.url,
              limit: 3,
            },
          )
          return { ok: true, candidates: jsonSafe(candidates), adopted: candidates.filter((c) => c.adopted).length }
        }
        if (args.action === 'remove') {
          if (!args.id) throw new Error('remove 需要 id')
          const removed = await store.removeLearned(args.id)
          return { ok: true, removed, stats: jsonSafe(store.stats()) }
        }
        throw new Error(`未知操作: ${args.action}`)
      } catch (error) {
        return jsonSafe(errorPayload(error))
      }
    },
  }

  const discover = {
    name: 'downloader_discover',
    description:
      'Ask the configured DeepSeek model for direct download URLs, then probe and verify them. Verified candidates are adopted into the persisted resource directory by default. Use when downloader_download(query=...) cannot find a direct URL, or when the user asks to find a download source.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'What to download, including version/platform/architecture when known.' },
        platform: { type: 'string', description: 'e.g. windows-x64, linux-arm64, macOS.' },
        format: { type: 'string', description: 'Preferred format, e.g. msi, zip, tar.gz, safetensors.' },
        adopt: { type: 'boolean', description: 'Persist verified candidates into the resource directory. Default true.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum candidates returned. Default 6.' },
      },
    },
    output: outputFor((value) => {
      if (value.ok === false) return summaryOfDownload(value)
      const lines = [`DeepSeek（${value.model}）返回 ${value.candidates?.length ?? 0} 个候选，采纳 ${value.adopted ?? 0} 个。`]
      for (const candidate of value.candidates ?? []) {
        lines.push(`- ${candidate.verified ? '✓' : '✗'} ${candidate.name} ${candidate.totalText ?? ''} ${candidate.url}`)
      }
      return lines.join('\n')
    }),
    timeoutMs: 180000,
    async execute(args) {
      try {
        if (!args.query) throw new Error('需要 query')
        const result = await discoverWithDeepSeek({
          query: args.query,
          context: { platform: args.platform, format: args.format },
          config,
          store: args.adopt === false ? undefined : store,
          adopt: args.adopt !== false,
          limit: Math.max(1, Math.min(10, Number(args.limit) || 6)),
        })
        return { ok: true, ...jsonSafe(result) }
      } catch (error) {
        return jsonSafe(errorPayload(error))
      }
    },
  }

  const report = {
    name: 'downloader_report',
    description:
      'Record a download problem or a solution in the plugin issue log. The same log receives automatic retry/timeout/mirror failures and feeds the lessons shown by downloader_status. Use it when a download fails in a way the user should not have to rediscover.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'What happened, including the observable error.' },
        downloadId: { type: 'string', description: 'Related download id, if any.' },
        severity: { type: 'string', enum: ['info', 'warn', 'error'], description: 'Severity. Default warn.' },
        solution: { type: 'string', description: 'What worked or what should be tried next.' },
      },
    },
    output: outputFor((value) => `已记录问题。\n${value.lessons?.map((l) => `- ${l.message}（${l.count} 次）`).join('\n') ?? ''}`),
    timeoutMs: 15000,
    async execute(args) {
      try {
        if (!args?.message) throw new Error('需要 message')
        await store.report({
          kind: 'manual',
          severity: args.severity || 'warn',
          message: args.message,
          downloadId: args.downloadId,
          solution: args.solution,
        })
        return { ok: true, lessons: jsonSafe(await store.lessons(5)) }
      } catch (error) {
        return jsonSafe(errorPayload(error))
      }
    },
  }

  return [download, status, control, sources, discover, report]
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, statusCode, value) {
  if (res.headersSent) return
  const body = JSON.stringify(value)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(body)
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function registerWebRoutes(ctx, webServer, manager) {
  const stateRoute = {
    kind: 'exact',
    path: '/dshdownloader/state',
    async handler(req, res) {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      try {
        return sendJson(res, 200, { ok: true, ...(await manager.state()) })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const actionRoute = {
    kind: 'exact',
    path: '/dshdownloader/action',
    async handler(req, res) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin request rejected' })
      try {
        const raw = await readBody(req)
        const body = raw ? JSON.parse(raw) : {}
        let snapshot
        if (body.action === 'pause') snapshot = await manager.pause(body.id)
        else if (body.action === 'resume') snapshot = await manager.resume(body.id)
        else if (body.action === 'cancel') snapshot = await manager.cancel(body.id, { removePartial: Boolean(body.removePartial) })
        else return sendJson(res, 400, { ok: false, error: `unknown action: ${body.action}` })
        return sendJson(res, 200, { ok: true, download: jsonSafe(snapshot) })
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: errorText(error) })
      }
    },
  }
  return [
    ctx.effect(() => webServer.register(stateRoute)),
    ctx.effect(() => webServer.register(actionRoute)),
  ]
}

export const inject = ['tools']

export async function apply(ctx, rawConfig = {}) {
  const config = deepMerge(DEFAULTS, isPlainObject(rawConfig) ? rawConfig : {})
  const configuredDataDir = String(config.dataDir || '').trim()
  const dataDir = configuredDataDir || defaultDataDir()
  const store = new Store({ dataDir, logger: ctx.logger })
  await store.init()
  const manager = new DownloadManager({ ctx, config, store, logger: ctx.logger })
  await manager.init()

  ctx.effect(() => () => manager.shutdown().catch(() => {}))

  for (const definition of buildToolDefinitions(manager, store, config)) {
    ctx.effect(() => ctx.tools.register(definition))
  }

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    ctx.effect(() =>
      systemPrompt.section({
        name: 'dshdownloader',
        order: 935,
        text: [
          '## Downloads and large files',
          'When the user asks to download software, a model, a dataset or any file, prefer the downloader tools over shell curl/wget.',
          'Use downloader_download with a direct url when known; otherwise pass query so the built-in China mirrors, proxy presets and DeepSeek discovery are used.',
          'download start is asynchronous: poll downloader_status with waitSeconds (15-30) and report progress periodically until status is completed. Never claim success before completion, and include the final destPath and byte count.',
          'On a non-obvious failure, call downloader_report with the observable error and any workaround; do not invent URLs or hashes.',
        ].join('\n'),
      }),
    )
  }

  const webServer = ctx.get('webServer')
  if (webServer) {
    try {
      registerWebRoutes(ctx, webServer, manager)
    } catch (error) {
      ctx.logger?.warn?.(`[dshdownloader] Web 面板路由注册失败: ${errorText(error)}`)
    }
  }

  ctx.logger?.info?.(
    `[dshdownloader] 已启用：${BUILTIN_SOURCES.length} 个镜像站点、${BUILTIN_PROXIES.length} 个代理预置；数据目录 ${store.dataDir}；DeepSeek ${deepseekConfig(config).apiKey ? '已配置' : '未配置'}。`,
  )
}

// Re-exported for tests and for a future non-tool entry point.
export { Store, DownloadManager, verifyCandidates, discoverWithDeepSeek }
