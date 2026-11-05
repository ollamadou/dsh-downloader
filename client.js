window.__ModuleLoader__.load({
  id: 'dshdownloader',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const DICT = {
      zh: {
        'panel.title': '下载器',
        'panel.subtitle': '断点续传 · 多路加速 · 国内镜像 · DeepSeek 资源发现',
        'panel.empty': '还没有下载任务。让 Agent 说“用下载器下载 …”，或提供直链开始下载。',
        'panel.active': '进行中',
        'panel.recent': '最近任务',
        'panel.sources': '资源与代理预置',
        'panel.issues': '问题与经验',
        'panel.noIssues': '暂无记录。',
        'panel.totalSpeed': '总速度',
        'panel.learned': '已学习',
        'panel.mirrors': '镜像站点',
        'panel.proxies': '代理预置',
        'panel.resources': '资源',
        'panel.hosts': '主机画像',
        'panel.refresh': '刷新',
        'panel.error': '无法读取下载状态',
        'panel.loading': '正在读取…',
        'panel.dest': '保存到',
        'panel.speed': '速度',
        'panel.eta': '剩余',
        'panel.connections': '连接',
        'panel.segments': '分段',
        'panel.attempts': '重试',
        'panel.done': '完成',
        'panel.failed': '失败',
        'panel.paused': '暂停',
        'panel.canceled': '取消',
        'panel.downloading': '下载中',
        'panel.merging': '合并中',
        'panel.queued': '排队中',
        'panel.pausing': '暂停中',
        'panel.pause': '暂停',
        'panel.resume': '继续',
        'panel.cancel': '取消',
        'panel.openFolder': '打开目录',
        'panel.overall': '总进度',
        'panel.deepseek': 'DeepSeek',
        'panel.configured': '已配置',
        'panel.notConfigured': '未配置',
        'panel.unknown': '未知',
      },
      en: {
        'panel.title': 'Downloader',
        'panel.subtitle': 'Resume · Multi-connection · China mirrors · DeepSeek discovery',
        'panel.empty': 'No downloads yet. Ask the agent to download something, or start with a direct URL.',
        'panel.active': 'Active',
        'panel.recent': 'Recent',
        'panel.sources': 'Resource & proxy presets',
        'panel.issues': 'Problems & lessons',
        'panel.noIssues': 'Nothing recorded yet.',
        'panel.totalSpeed': 'Total speed',
        'panel.learned': 'Learned',
        'panel.mirrors': 'Mirror sites',
        'panel.proxies': 'Proxy presets',
        'panel.resources': 'Resources',
        'panel.hosts': 'Host profiles',
        'panel.refresh': 'Refresh',
        'panel.error': 'Could not read downloader state',
        'panel.loading': 'Loading…',
        'panel.dest': 'Saved to',
        'panel.speed': 'Speed',
        'panel.eta': 'ETA',
        'panel.connections': 'Connections',
        'panel.segments': 'Segments',
        'panel.attempts': 'Retries',
        'panel.done': 'Done',
        'panel.failed': 'Failed',
        'panel.paused': 'Paused',
        'panel.canceled': 'Canceled',
        'panel.downloading': 'Downloading',
        'panel.merging': 'Merging',
        'panel.queued': 'Queued',
        'panel.pausing': 'Pausing',
        'panel.pause': 'Pause',
        'panel.resume': 'Resume',
        'panel.cancel': 'Cancel',
        'panel.openFolder': 'Open folder',
        'panel.overall': 'Overall',
        'panel.deepseek': 'DeepSeek',
        'panel.configured': 'Configured',
        'panel.notConfigured': 'Not configured',
        'panel.unknown': 'Unknown',
      },
    }

    function bytes(n) {
      const value = Number(n)
      if (!Number.isFinite(value) || value < 0) return '—'
      if (value < 1024) return `${value} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let v = value / 1024
      let i = 0
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i += 1
      }
      return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
    }

    function speed(n) {
      return `${bytes(n)}/s`
    }

    function duration(seconds) {
      const value = Number(seconds)
      if (!Number.isFinite(value) || value < 0) return '—'
      if (value < 60) return `${Math.ceil(value)}s`
      const m = Math.floor(value / 60)
      const s = Math.round(value % 60)
      if (m < 60) return `${m}m ${s}s`
      return `${Math.floor(m / 60)}h ${m % 60}m`
    }

    function statusKey(status) {
      return {
        completed: 'panel.done',
        failed: 'panel.failed',
        paused: 'panel.paused',
        canceled: 'panel.canceled',
        downloading: 'panel.downloading',
        merging: 'panel.merging',
        queued: 'panel.queued',
        pausing: 'panel.pausing',
      }[status] ?? 'panel.unknown'
    }

    function ErrorBanner({ text, onRetry }) {
      return h(
        'div',
        { className: 'dshdl-error', role: 'alert' },
        h('span', null, text),
        onRetry ? h('button', { type: 'button', className: 'dshdl-btn dshdl-btn-ghost', onClick: onRetry }, '↻') : null,
      )
    }

    function JobCard({ job, t, onAction, busy }) {
      const percent = Number.isFinite(job.progress) ? Math.max(0, Math.min(1, job.progress)) : 0
      const pct = job.totalBytes ? `${(percent * 100).toFixed(1)}%` : job.downloadedBytes ? bytes(job.downloadedBytes) : '—'
      return h(
        'article',
        { className: `dshdl-card dshdl-${job.status}` },
        h(
          'div',
          { className: 'dshdl-card-head' },
          h('div', { className: 'dshdl-name', title: job.fileName }, job.fileName || job.url),
          h('span', { className: `dshdl-badge dshdl-badge-${job.status}` }, t(statusKey(job.status))),
        ),
        h(
          'div',
          { className: 'dshdl-meta' },
          h('span', { title: job.url }, job.host),
          h('span', null, `${bytes(job.downloadedBytes)} / ${bytes(job.totalBytes)}`),
          h('span', null, `${t('panel.speed')} ${speed(job.speedBps)}`),
          h('span', null, `${t('panel.eta')} ${duration(job.etaSeconds)}`),
          h('span', null, `${t('panel.connections')} ${job.connections ?? 1} · ${t('panel.segments')} ${job.segments?.done ?? 0}/${job.segments?.total ?? 1}`),
        ),
        h(
          'div',
          { className: 'dshdl-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(percent * 100) },
          h('div', { className: 'dshdl-bar-fill', style: { width: `${Math.max(2, percent * 100)}%` } }),
        ),
        h(
          'div',
          { className: 'dshdl-foot' },
          h('div', { className: 'dshdl-path', title: job.destPath }, job.destPath),
          h(
            'div',
            { className: 'dshdl-actions' },
            job.status === 'downloading' || job.status === 'queued'
              ? h('button', { type: 'button', className: 'dshdl-btn', disabled: busy, onClick: () => onAction('pause', job.id) }, t('panel.pause'))
              : job.status === 'paused' || job.status === 'failed'
                ? h('button', { type: 'button', className: 'dshdl-btn dshdl-btn-primary', disabled: busy, onClick: () => onAction('resume', job.id) }, t('panel.resume'))
                : null,
            job.status !== 'completed' && job.status !== 'canceled'
              ? h('button', { type: 'button', className: 'dshdl-btn dshdl-btn-ghost', disabled: busy, onClick: () => onAction('cancel', job.id) }, t('panel.cancel'))
              : null,
          ),
        ),
        job.error ? h('div', { className: 'dshdl-job-error' }, job.error) : null,
      )
    }

    function DownloaderIcon({ size = 20, active = false }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2.2 : 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.82 },
        },
        h('path', { d: 'M12 3v11m0 0 4-4m-4 4-4-4' }),
        h('path', { d: 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
      )
    }

    function DownloaderPanel() {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [lastUpdated, setLastUpdated] = useState(0)

      // The closure below is replaced by apply() with a locale-bound translator.
      const translate = (key) => (DownloaderPanel.__t ? DownloaderPanel.__t(key) : (DICT.zh[key] ?? key))

      useEffect(() => {
        let alive = true
        let timer
        const load = async () => {
          try {
            const response = await fetch('/dshdownloader/state', { cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const value = await response.json()
            if (!alive) return
            setState(value)
            setError('')
            setLastUpdated(Date.now())
          } catch (err) {
            if (alive) setError(err?.message ?? String(err))
          } finally {
            if (alive) timer = setTimeout(load, 1200)
          }
        }
        load()
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [])

      const refresh = async () => {
        try {
          const response = await fetch('/dshdownloader/state', { cache: 'no-store' })
          if (response.ok) setState(await response.json())
        } catch {
          // keep the last known state
        }
      }

      const act = async (action, id) => {
        setBusy(`${action}:${id}`)
        try {
          const response = await fetch('/dshdownloader/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, id }),
          })
          const value = await response.json()
          if (!value.ok) setError(value.error ?? '操作失败')
          await refresh()
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setBusy('')
        }
      }

      const active = state?.active ?? []
      const recent = state?.recent ?? []
      const stats = state?.stats ?? {}
      const issues = state?.issues ?? []
      const lessons = state?.lessons ?? []
      const totalSpeed = active.reduce((sum, job) => sum + (job.speedBps || 0), 0)

      return h(
        'div',
        { className: 'dshdl-root' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'dshdl-header' },
          h(
            'div',
            { className: 'dshdl-title-wrap' },
            h('div', { className: 'dshdl-logo' }, h(DownloaderIcon, { size: 26, active: true })),
            h(
              'div',
              null,
              h('h1', { className: 'dshdl-title' }, translate('panel.title')),
              h('p', { className: 'dshdl-subtitle' }, translate('panel.subtitle')),
            ),
          ),
          h(
            'div',
            { className: 'dshdl-header-stats' },
            h('span', { className: 'dshdl-stat' }, `${translate('panel.totalSpeed')} ${speed(totalSpeed)}`),
            h('span', { className: 'dshdl-stat' }, `${translate('panel.active')} ${active.length}`),
            h(
              'button',
              { type: 'button', className: 'dshdl-btn dshdl-btn-ghost', onClick: refresh, title: translate('panel.refresh') },
              '↻',
            ),
          ),
        ),
        error ? h(ErrorBanner, { text: `${translate('panel.error')}: ${error}`, onRetry: refresh }) : null,
        !state && !error ? h('div', { className: 'dshdl-empty' }, translate('panel.loading')) : null,
        h(
          'section',
          { className: 'dshdl-section' },
          h('h2', { className: 'dshdl-h2' }, translate('panel.active')),
          active.length
            ? active.map((job) => h(JobCard, { key: job.id, job, t: translate, onAction: act, busy: busy.endsWith(job.id) }))
            : h('div', { className: 'dshdl-empty' }, translate('panel.empty')),
        ),
        recent.length
          ? h(
              'section',
              { className: 'dshdl-section' },
              h('h2', { className: 'dshdl-h2' }, translate('panel.recent')),
              h(
                'div',
                { className: 'dshdl-recent' },
                recent.slice(0, 8).map((job) =>
                  h(
                    'div',
                    { key: job.id, className: 'dshdl-recent-row' },
                    h('span', { className: `dshdl-dot dshdl-dot-${job.status}`, 'aria-hidden': true }),
                    h('span', { className: 'dshdl-recent-name', title: job.fileName }, job.fileName),
                    h('span', { className: 'dshdl-recent-size' }, bytes(job.totalBytes)),
                    h('span', { className: 'dshdl-recent-status' }, translate(statusKey(job.status))),
                    h('span', { className: 'dshdl-recent-path', title: job.destPath }, job.destPath),
                  ),
                ),
              ),
            )
          : null,
        h(
          'section',
          { className: 'dshdl-section' },
          h('h2', { className: 'dshdl-h2' }, translate('panel.sources')),
          h(
            'div',
            { className: 'dshdl-source-grid' },
            h('div', { className: 'dshdl-source-card' }, h('strong', null, stats.learnedResources ?? 0), h('span', null, translate('panel.learned')), h('small', null, `${translate('panel.resources')} / ${translate('panel.mirrors')} ${stats.learnedSources ?? 0}`)),
            h('div', { className: 'dshdl-source-card' }, h('strong', null, stats.builtinSources ?? 0), h('span', null, translate('panel.mirrors')), h('small', null, 'TUNA · USTC · Aliyun · Huawei · Tencent · npmmirror …')),
            h('div', { className: 'dshdl-source-card' }, h('strong', null, stats.proxies ?? 0), h('span', null, translate('panel.proxies')), h('small', null, 'Clash · V2RayN · Privoxy · auto')),
            h('div', { className: 'dshdl-source-card' }, h('strong', null, stats.knownHosts ?? 0), h('span', null, translate('panel.hosts')), h('small', null, `${translate('panel.deepseek')} ${state?.config?.deepseekConfigured ? translate('panel.configured') : translate('panel.notConfigured')}`)),
          ),
        ),
        h(
          'section',
          { className: 'dshdl-section' },
          h('h2', { className: 'dshdl-h2' }, translate('panel.issues')),
          issues.length
            ? h(
                'ul',
                { className: 'dshdl-issues' },
                issues.slice(0, 6).map((issue, index) =>
                  h('li', { key: `${issue.at}-${index}`, className: `dshdl-issue dshdl-issue-${issue.severity ?? 'warn'}` }, issue.message),
                ),
              )
            : h('div', { className: 'dshdl-empty' }, translate('panel.noIssues')),
          lessons.length
            ? h(
                'div',
                { className: 'dshdl-lessons' },
                lessons.slice(0, 4).map((lesson, index) =>
                  h(
                    'div',
                    { key: `lesson-${index}`, className: 'dshdl-lesson' },
                    h('span', { className: 'dshdl-lesson-count' }, `×${lesson.count}`),
                    h('span', null, lesson.message),
                    lesson.suggestion ? h('small', null, lesson.suggestion) : null,
                  ),
                ),
              )
            : null,
        ),
        h('footer', { className: 'dshdl-footer' }, lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''),
      )
    }

    const CSS = `
      .dshdl-root { height: 100%; overflow: auto; padding: 22px 26px 40px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); box-sizing: border-box; font-size: 13px; }
      .dshdl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
      .dshdl-title-wrap { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .dshdl-logo { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); flex: none; }
      .dshdl-title { font-size: 20px; font-weight: 650; margin: 0; line-height: 1.25; }
      .dshdl-subtitle { color: var(--dsw-alias-label-secondary); margin: 3px 0 0; font-size: 12px; }
      .dshdl-header-stats { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
      .dshdl-stat { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 5px 10px; white-space: nowrap; }
      .dshdl-section { margin-top: 18px; }
      .dshdl-h2 { font-size: 12px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); margin: 0 0 8px; }
      .dshdl-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px; margin-bottom: 10px; }
      .dshdl-card-head { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
      .dshdl-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dshdl-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .dshdl-badge-downloading, .dshdl-badge-merging { color: var(--dsw-alias-brand-primary); }
      .dshdl-badge-completed { color: var(--dsw-alias-state-success-primary); }
      .dshdl-badge-failed { color: var(--dsw-alias-state-error-primary); }
      .dshdl-badge-paused { color: var(--dsw-alias-state-warn-primary); }
      .dshdl-meta { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; margin: 9px 0; }
      .dshdl-bar { height: 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
      .dshdl-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--dsw-alias-brand-primary), var(--dsw-alias-state-success-primary)); transition: width .35s ease; }
      .dshdl-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
      .dshdl-path { color: var(--dsw-alias-label-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .dshdl-actions { display: flex; gap: 6px; flex: none; }
      .dshdl-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 10px; font: inherit; cursor: pointer; }
      .dshdl-btn:hover { border-color: var(--dsw-alias-brand-primary); }
      .dshdl-btn:disabled { opacity: .5; cursor: default; }
      .dshdl-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
      .dshdl-btn-ghost { background: transparent; }
      .dshdl-job-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin-top: 8px; }
      .dshdl-empty { color: var(--dsw-alias-label-secondary); border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; padding: 16px; }
      .dshdl-error { color: var(--dsw-alias-state-error-primary); border: 1px solid var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
      .dshdl-recent { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
      .dshdl-recent-row { display: grid; grid-template-columns: 10px minmax(120px, 1.2fr) auto auto minmax(120px, 1.3fr); gap: 10px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; }
      .dshdl-recent-row:first-child { border-top: none; }
      .dshdl-recent-name, .dshdl-recent-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dshdl-recent-size, .dshdl-recent-status, .dshdl-recent-path { color: var(--dsw-alias-label-secondary); }
      .dshdl-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
      .dshdl-dot-completed { background: var(--dsw-alias-state-success-primary); }
      .dshdl-dot-failed { background: var(--dsw-alias-state-error-primary); }
      .dshdl-dot-paused { background: var(--dsw-alias-state-warn-primary); }
      .dshdl-source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
      .dshdl-source-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 2px; }
      .dshdl-source-card strong { font-size: 18px; font-weight: 650; }
      .dshdl-source-card span { font-weight: 550; }
      .dshdl-source-card small { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dshdl-issues { list-style: none; padding: 0; margin: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
      .dshdl-issue { padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; }
      .dshdl-issue:first-child { border-top: none; }
      .dshdl-issue-error { color: var(--dsw-alias-state-error-primary); }
      .dshdl-issue-warn { color: var(--dsw-alias-state-warn-primary); }
      .dshdl-lessons { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
      .dshdl-lesson { display: flex; align-items: baseline; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dshdl-lesson-count { color: var(--dsw-alias-brand-primary); font-variant-numeric: tabular-nums; }
      .dshdl-lesson small { color: var(--dsw-alias-label-secondary); opacity: .85; }
      .dshdl-footer { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 22px; }
      @media (max-width: 720px) { .dshdl-root { padding: 16px; } .dshdl-header { flex-direction: column; } .dshdl-recent-row { grid-template-columns: 10px 1fr auto; } .dshdl-recent-path, .dshdl-recent-size { display: none; } }
    `

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = (key) => (DownloaderPanel.__t ? DownloaderPanel.__t(key) : (DICT.zh[key] ?? key))
        if (ctx.get('locale')) {
          ctx.effect(() => ctx.locale.register('dshdownloader', 'zh', DICT.zh))
          ctx.effect(() => ctx.locale.register('dshdownloader', 'en', DICT.en))
          const bound = ctx.locale.bind('dshdownloader')
          DownloaderPanel.__t = bound
        } else {
          DownloaderPanel.__t = (key) => DICT.zh[key] ?? key
        }
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'dshdownloader',
              order: 20,
              label: () => t('panel.title'),
            },
            DownloaderIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'dshdownloader',
            },
            DownloaderPanel,
          ),
        )
      },
    }
  },
})
