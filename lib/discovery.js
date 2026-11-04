import {
  ensureHttpUrl,
  errorText,
  fetchJson,
  formatBytes,
  hostOf,
  isPrivateHost,
  probeUrl,
  resolveProxy,
  speedProbe,
} from './util.js'

const DEFAULT_PROMPT = `你是软件下载资源检索助手。请根据用户要下载的软件/模型/数据集，给出 1-8 个**可直接下载文件**的 http(s) 地址。
要求：
1. 优先官方发布地址与中国大陆可访问的镜像（清华 TUNA、中科大 USTC、阿里云、华为云、腾讯云、npmmirror、ModelScope、hf-mirror 等）。
2. 必须是具体文件或会 302 到具体文件的地址，不要给网页、搜索结果页、登录页。
3. 不确定就不要编造；宁少勿假。
4. 如果只知道镜像根目录，请在 note 说明，不要伪造文件名。
5. 只输出 JSON 对象，结构：
{"resources":[{"name":"简短名称","url":"完整URL","size":数字或null,"kind":"installer|archive|model|dataset|other","note":"版本/平台/来源说明","confidence":0到1}]}
不要输出 Markdown 代码块或额外解释。`

function endpointOf(baseUrl) {
  let base = String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(base)) return base
  return `${base}/chat/completions`
}

export function deepseekConfig(config) {
  const ds = config?.deepseek ?? {}
  return {
    apiKey: String(ds.apiKey || process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || ''),
    baseUrl: String(ds.baseUrl || 'https://api.deepseek.com'),
    model: String(ds.model || 'deepseek-chat'),
    timeoutMs: Number(ds.timeoutMs) || 120000,
  }
}

export async function askDeepSeek(query, context, config, signal) {
  const ds = deepseekConfig(config)
  if (!ds.apiKey) {
    const error = new Error(
      '未配置 DeepSeek API Key。请在插件配置 deepseek.apiKey 中填写，或设置环境变量 DEEPSEEK_API_KEY；也可以直接提供文件 URL，或让 Agent 用 web_search 找到地址后调用 downloader_sources(action=add) 采纳。',
    )
    error.code = 'NO_DEEPSEEK_KEY'
    throw error
  }
  const prompt = [
    `用户想下载：${query}`,
    context?.platform ? `平台/架构：${context.platform}` : '',
    context?.format ? `期望格式：${context.format}` : '',
    context?.notes ? `补充：${context.notes}` : '',
    '',
    DEFAULT_PROMPT,
  ]
    .filter(Boolean)
    .join('\n')
  const proxyUrl = await resolveProxy(config.proxyMode, config.proxyUrl, '')
  const { data } = await fetchJson(endpointOf(ds.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${ds.apiKey}` },
    body: {
      model: ds.model,
      temperature: 0.1,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你只输出可解析的 JSON，不输出 Markdown。' },
        { role: 'user', content: prompt },
      ],
    },
    timeoutMs: ds.timeoutMs,
    idleTimeoutMs: ds.timeoutMs,
    proxyUrl,
    signal,
  })
  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('DeepSeek 返回中没有 choices[0].message.content')
  const parsed = parseJsonLoose(content)
  const items = Array.isArray(parsed) ? parsed : parsed?.resources
  if (!Array.isArray(items)) throw new Error('DeepSeek 返回的 JSON 缺少 resources 数组')
  return items.slice(0, 8)
}

export function parseJsonLoose(text) {
  let value = String(text ?? '').trim()
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(value)
  } catch {
    const start = value.indexOf('{')
    const end = value.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(value.slice(start, end + 1))
      } catch {
        // fall through
      }
    }
    const arrayStart = value.indexOf('[')
    const arrayEnd = value.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(value.slice(arrayStart, arrayEnd + 1))
    throw new Error(`无法解析 DeepSeek 返回的 JSON: ${value.slice(0, 300)}`)
  }
}

function originOf(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}/`
  } catch {
    return ''
  }
}

function isHtmlCandidate(probe) {
  const type = String(probe?.contentType ?? '').toLowerCase()
  const disposition = String(probe?.disposition ?? '').toLowerCase()
  return type.includes('text/html') && !disposition.includes('attachment')
}

export async function verifyCandidates(rawCandidates, { config, store, query, signal, restrictPrivate = true, limit = 6, probeSpeed = true } = {}) {
  const proxyUrl = await resolveProxy(config.proxyMode, config.proxyUrl, '')
  const seen = new Set()
  const candidates = []
  for (const raw of rawCandidates.slice(0, 12)) {
    if (!raw || !raw.url) continue
    try {
      const url = ensureHttpUrl(raw.url)
      if (restrictPrivate && isPrivateHost(url.hostname)) throw new Error('拒绝内网/本机地址')
      if (seen.has(url.href)) continue
      seen.add(url.href)
      candidates.push({
        name: String(raw.name || url.pathname.split('/').filter(Boolean).pop() || url.hostname).slice(0, 160),
        url: url.href,
        size: Number.isFinite(Number(raw.size)) ? Number(raw.size) : undefined,
        kind: String(raw.kind || 'other').slice(0, 30),
        note: String(raw.note || '').slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.5))),
      })
    } catch (error) {
      candidates.push({ name: String(raw.name || raw.url), url: String(raw.url), error: errorText(error), invalid: true })
    }
  }

  const results = []
  const queue = candidates.slice()
  const workerCount = Math.min(3, Math.max(1, queue.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item.invalid) {
        results.push({ ...item, verified: false, score: 0 })
        continue
      }
      try {
        const probe = await probeUrl(item.url, { timeoutMs: 20000, proxyUrl, signal })
        let speed = { speedBps: 0, bytes: 0 }
        if (probe.ok && probeSpeed && probe.total && probe.acceptRanges) {
          speed = await speedProbe(item.url, { proxyUrl, signal, bytes: 128 * 1024 }).catch(() => ({ speedBps: 0, bytes: 0 }))
        }
        const verified = probe.ok && !isHtmlCandidate(probe)
        const score =
          (verified ? 100 : 0) +
          (probe.acceptRanges ? 15 : 0) +
          (probe.total ? 10 : 0) +
          (isHtmlCandidate(probe) ? -60 : 10) +
          Math.round(item.confidence * 20) +
          Math.min(20, speed.speedBps / (128 * 1024)) -
          Math.min(10, probe.latencyMs / 1000)
        const result = {
          ...item,
          verified,
          score,
          statusCode: probe.statusCode,
          total: probe.total ?? item.size,
          totalText: formatBytes(probe.total ?? item.size),
          acceptRanges: probe.acceptRanges,
          contentType: probe.contentType,
          disposition: probe.disposition,
          etag: probe.etag,
          finalUrl: probe.url,
          latencyMs: probe.latencyMs,
          speedBps: speed.speedBps,
          probeErrors: probe.errors,
        }
        results.push(result)
        if (verified && store) {
          try {
            result.adopted = await store.adoptResource({
              name: result.name,
              url: result.finalUrl || result.url,
              query,
              size: result.total,
              contentType: result.contentType,
              etag: result.etag,
              note: result.note,
              origin: 'deepseek',
              score,
            })
            const base = originOf(result.finalUrl || result.url)
            if (base) {
              await store.adoptSource({
                name: `${hostOf(base)}（自动收录）`,
                baseUrl: base,
                kind: 'learned',
                note: `DeepSeek 发现并验证的资源站点；查询：${query}`,
                keywords: [hostOf(base)],
                origin: 'deepseek',
              })
            }
          } catch (error) {
            result.adoptError = errorText(error)
          }
        }
      } catch (error) {
        results.push({ ...item, verified: false, score: 0, error: errorText(error) })
      }
    }
  })
  await Promise.all(workers)
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

export async function discoverWithDeepSeek({ query, context, config, store, signal, adopt = true, limit = 6 }) {
  const raw = await askDeepSeek(query, context, config, signal)
  const verified = await verifyCandidates(raw, { config, store: adopt ? store : undefined, query, signal, limit })
  return {
    query,
    provider: 'deepseek',
    model: deepseekConfig(config).model,
    candidates: verified,
    adopted: verified.filter((item) => item.adopted).length,
  }
}
