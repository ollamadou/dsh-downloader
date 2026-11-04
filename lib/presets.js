/**
 * Built-in China-friendly mirror sites, binary registries and local proxy
 * presets. These are *starting points*: the downloader probes the real URL
 * before use, and any verified resource learned from DeepSeek is appended to
 * the persistent resource list instead of modifying this file.
 */

export const BUILTIN_SOURCES = Object.freeze([
  {
    id: 'tuna',
    name: '清华大学 TUNA 镜像',
    kind: 'mirror',
    baseUrl: 'https://mirrors.tuna.tsinghua.edu.cn/',
    aliases: ['tuna', 'tsinghua', '清华', '清华源'],
    keywords: ['ubuntu', 'debian', 'centos', 'arch', 'pypi', 'anaconda', 'node', 'docker', 'git'],
    note: '国内高校综合镜像，覆盖 Linux 发行版、Python、Anaconda、Node、Docker 等。',
  },
  {
    id: 'ustc',
    name: '中国科学技术大学 USTC 镜像',
    kind: 'mirror',
    baseUrl: 'https://mirrors.ustc.edu.cn/',
    aliases: ['ustc', '中科大', '科大源'],
    keywords: ['ubuntu', 'debian', 'centos', 'pypi', 'anaconda', 'docker'],
    note: '中科大综合镜像，教育网内速度通常较好。',
  },
  {
    id: 'aliyun',
    name: '阿里云镜像站',
    kind: 'mirror',
    baseUrl: 'https://mirrors.aliyun.com/',
    aliases: ['aliyun', '阿里', '阿里云'],
    keywords: ['ubuntu', 'centos', 'pypi', 'maven', 'npm', 'docker', 'node', 'anaconda'],
    note: '阿里云公共镜像，公网可达性与稳定性较好。',
  },
  {
    id: 'huawei',
    name: '华为云镜像站',
    kind: 'mirror',
    baseUrl: 'https://mirrors.huaweicloud.com/',
    aliases: ['huawei', '华为', '华为云'],
    keywords: ['ubuntu', 'centos', 'pypi', 'node', 'maven', 'docker'],
    note: '华为云开源镜像，适合公网下载。',
  },
  {
    id: 'tencent',
    name: '腾讯云镜像站',
    kind: 'mirror',
    baseUrl: 'https://mirrors.cloud.tencent.com/',
    aliases: ['tencent', '腾讯', '腾讯云'],
    keywords: ['ubuntu', 'centos', 'pypi', 'gradle', 'android', 'docker', 'npm'],
    note: '腾讯云软件源，含 Gradle、Android SDK 等目录镜像。',
  },
  {
    id: 'netease',
    name: '网易开源镜像',
    kind: 'mirror',
    baseUrl: 'https://mirrors.163.com/',
    aliases: ['163', '网易'],
    keywords: ['ubuntu', 'debian', 'centos', 'pypi'],
    note: '网易老牌开源镜像站。',
  },
  {
    id: 'bfsu',
    name: '北京外国语大学镜像',
    kind: 'mirror',
    baseUrl: 'https://mirrors.bfsu.edu.cn/',
    aliases: ['bfsu', '北外'],
    keywords: ['ubuntu', 'debian', 'centos', 'pypi', 'anaconda'],
    note: '北外开源镜像，教育网与公网均有覆盖。',
  },
  {
    id: 'nju',
    name: '南京大学镜像',
    kind: 'mirror',
    baseUrl: 'https://mirrors.nju.edu.cn/',
    aliases: ['nju', '南大', '南京大学'],
    keywords: ['ubuntu', 'debian', 'pypi', 'docker'],
    note: '南京大学开源镜像。',
  },
  {
    id: 'sjtu',
    name: '上海交通大学镜像',
    kind: 'mirror',
    baseUrl: 'https://mirror.sjtu.edu.cn/',
    aliases: ['sjtu', '上交', '上海交大'],
    keywords: ['ubuntu', 'debian', 'pypi', 'docker', 'node'],
    note: '上海交大开源镜像。',
  },
  {
    id: 'zju',
    name: '浙江大学镜像',
    kind: 'mirror',
    baseUrl: 'https://mirrors.zju.edu.cn/',
    aliases: ['zju', '浙大', '浙江大学'],
    keywords: ['ubuntu', 'debian', 'centos', 'pypi'],
    note: '浙江大学开源镜像。',
  },
  {
    id: 'npmmirror',
    name: 'npmmirror（淘宝 NPM 镜像）',
    kind: 'registry',
    baseUrl: 'https://registry.npmmirror.com/',
    aliases: ['npmmirror', 'taobao', '淘宝', 'npm', 'cnpm'],
    keywords: ['npm', 'node', 'pnpm', 'yarn', 'electron', 'node-sass'],
    note: 'npm 包与常见二进制（Node、Electron、Chromium 等）镜像。',
  },
  {
    id: 'npmmirror-binary',
    name: 'npmmirror 二进制目录',
    kind: 'mirror',
    baseUrl: 'https://npmmirror.com/mirrors/',
    aliases: ['npmmirror-binary', '淘宝二进制', 'node mirror'],
    keywords: ['node', 'electron', 'chromium', 'python', 'sass', 'canvas'],
    note: 'Node、Electron、Python 等安装包的国内二进制镜像根目录。',
  },
  {
    id: 'pypi-tuna',
    name: 'PyPI 清华源',
    kind: 'registry',
    baseUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
    aliases: ['pypi-tuna', 'pypi', 'pip', '清华pypi'],
    keywords: ['pypi', 'pip', 'python', 'wheel'],
    note: 'pip 安装源；下载 wheel/sdist 时可用。',
  },
  {
    id: 'pypi-aliyun',
    name: 'PyPI 阿里云源',
    kind: 'registry',
    baseUrl: 'https://mirrors.aliyun.com/pypi/simple/',
    aliases: ['pypi-aliyun', '阿里pypi'],
    keywords: ['pypi', 'pip', 'python'],
    note: 'pip 阿里云安装源。',
  },
  {
    id: 'goproxy',
    name: 'Go 模块代理（goproxy.cn）',
    kind: 'registry',
    baseUrl: 'https://goproxy.cn/',
    aliases: ['goproxy', 'go', 'golang'],
    keywords: ['go', 'golang', 'module'],
    note: 'Go modules 国内代理。',
  },
  {
    id: 'rsproxy',
    name: 'Rust crates 镜像（rsproxy）',
    kind: 'registry',
    baseUrl: 'https://rsproxy.cn/',
    aliases: ['rsproxy', 'rust', 'crates', 'cargo'],
    keywords: ['rust', 'cargo', 'crates'],
    note: 'Rust crates.io 与 rustup 国内镜像。',
  },
  {
    id: 'flutter-cn',
    name: 'Flutter 中国镜像',
    kind: 'sdk',
    baseUrl: 'https://storage.flutter-io.cn/',
    aliases: ['flutter', 'flutter-cn', 'dart'],
    keywords: ['flutter', 'dart', 'sdk', 'engine'],
    note: 'Flutter SDK/引擎下载的中国官方镜像。',
  },
  {
    id: 'gradle-tencent',
    name: 'Gradle 腾讯云镜像',
    kind: 'sdk',
    baseUrl: 'https://mirrors.cloud.tencent.com/gradle/',
    aliases: ['gradle', 'gradle-tencent'],
    keywords: ['gradle', 'android', 'java'],
    note: 'Gradle 发行包镜像。',
  },
  {
    id: 'android-sdk-tencent',
    name: 'Android SDK 腾讯云镜像',
    kind: 'sdk',
    baseUrl: 'https://mirrors.cloud.tencent.com/AndroidSDK/',
    aliases: ['android', 'android-sdk', 'sdkmanager'],
    keywords: ['android', 'sdk', 'platform-tools', 'build-tools'],
    note: 'Android SDK 组件镜像，适合 sdkmanager 替换源。',
  },
  {
    id: 'maven-aliyun',
    name: 'Maven 阿里云仓库',
    kind: 'registry',
    baseUrl: 'https://maven.aliyun.com/repository/public',
    aliases: ['maven', 'aliyun-maven', 'java'],
    keywords: ['maven', 'java', 'jar', 'gradle'],
    note: 'Maven Central 的阿里云代理仓库。',
  },
  {
    id: 'docker-daocloud',
    name: 'DaoCloud Docker 镜像',
    kind: 'registry',
    baseUrl: 'https://docker.m.daocloud.io/',
    aliases: ['docker', 'daocloud', 'dockerhub'],
    keywords: ['docker', 'image', 'container'],
    note: 'Docker Hub 国内加速地址，通常配置为 registry mirror 而不是直接下载 URL。',
  },
  {
    id: 'hf-mirror',
    name: 'Hugging Face 国内镜像',
    kind: 'model',
    baseUrl: 'https://hf-mirror.com/',
    aliases: ['hf', 'huggingface', 'hf-mirror', '模型'],
    keywords: ['huggingface', 'model', 'dataset', 'safetensors', 'gguf'],
    note: 'Hugging Face 模型与数据集的国内镜像。',
  },
  {
    id: 'modelscope',
    name: '魔搭 ModelScope',
    kind: 'model',
    baseUrl: 'https://modelscope.cn/',
    aliases: ['modelscope', '魔搭', 'aliyun-model'],
    keywords: ['model', 'dataset', 'llm', 'qwen'],
    note: '阿里系模型与数据集社区，国内下载速度较好。',
  },
  {
    id: 'ghfast',
    name: 'GitHub 加速（ghfast）',
    kind: 'github',
    baseUrl: 'https://ghfast.top/',
    aliases: ['ghfast', 'github', 'github-proxy', '加速'],
    keywords: ['github', 'release', 'raw'],
    note: '第三方 GitHub 文件加速前缀；用法为 https://ghfast.top/https://github.com/... 。可用性会变化，下载前会实际探测。',
  },
  {
    id: 'ghproxy',
    name: 'GitHub 加速（gh-proxy）',
    kind: 'github',
    baseUrl: 'https://gh-proxy.com/',
    aliases: ['ghproxy', 'github', 'github-proxy'],
    keywords: ['github', 'release', 'raw'],
    note: '第三方 GitHub 文件加速前缀，使用前需探测。',
  },
  {
    id: 'ghproxy-net',
    name: 'GitHub 加速（ghproxy.net）',
    kind: 'github',
    baseUrl: 'https://ghproxy.net/',
    aliases: ['ghproxy-net', 'github', 'github-proxy'],
    keywords: ['github', 'release', 'raw'],
    note: '第三方 GitHub 文件加速前缀，使用前需探测。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API',
    kind: 'api',
    baseUrl: 'https://api.deepseek.com',
    aliases: ['deepseek', '大模型', 'llm'],
    keywords: ['deepseek', 'api', 'chat', 'model'],
    note: '用于在本地预置清单找不到资源时，查询可验证的下载地址。',
  },
])

export const BUILTIN_PROXIES = Object.freeze([
  {
    id: 'proxy-auto',
    name: '自动（环境变量 + 本机常用端口）',
    url: '',
    mode: 'auto',
    aliases: ['auto', '自动', 'system'],
    note: '优先读取 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY，其次探测 127.0.0.1 的 7890/7897/10809/1080/8118。',
  },
  {
    id: 'proxy-off',
    name: '直连（不使用代理）',
    url: '',
    mode: 'off',
    aliases: ['off', 'none', 'direct', '直连'],
    note: '强制直连，适合国内镜像。',
  },
  {
    id: 'proxy-clash',
    name: 'Clash / Mihomo（7890）',
    url: 'http://127.0.0.1:7890',
    mode: 'custom',
    aliases: ['clash', 'mihomo', '7890'],
    note: 'Clash Verge / Mihomo 默认混合端口。',
  },
  {
    id: 'proxy-clash-7897',
    name: 'Clash Verge（7897）',
    url: 'http://127.0.0.1:7897',
    mode: 'custom',
    aliases: ['clash-verge', '7897'],
    note: '新版 Clash Verge 常见混合端口。',
  },
  {
    id: 'proxy-v2ray',
    name: 'V2RayN HTTP（10809）',
    url: 'http://127.0.0.1:10809',
    mode: 'custom',
    aliases: ['v2ray', 'v2rayn', '10809'],
    note: 'V2RayN 默认 HTTP 入站端口；SOCKS 端口需转成 HTTP 代理使用。',
  },
  {
    id: 'proxy-ss',
    name: 'Shadowsocks（1080）',
    url: 'http://127.0.0.1:1080',
    mode: 'custom',
    aliases: ['ss', 'shadowsocks', '1080'],
    note: '仅当该端口提供 HTTP 代理时可用；纯 SOCKS5 代理不支持。',
  },
  {
    id: 'proxy-privoxy',
    name: 'Privoxy（8118）',
    url: 'http://127.0.0.1:8118',
    mode: 'custom',
    aliases: ['privoxy', '8118'],
    note: 'Privoxy 默认 HTTP 代理端口。',
  },
])

export const COMMON_PROXY_PORTS = Object.freeze([7890, 7897, 10809, 1080, 8118])

/** Crude but predictable local search over the preset directory. */
export function scoreSource(source, query) {
  const q = String(query ?? '').toLowerCase().trim()
  if (!q) return 0
  const name = String(source.name ?? '').toLowerCase()
  const id = String(source.id ?? '').toLowerCase()
  const base = String(source.baseUrl ?? '').toLowerCase()
  const aliases = (source.aliases ?? []).map((v) => String(v).toLowerCase())
  const keywords = (source.keywords ?? []).map((v) => String(v).toLowerCase())
  let score = 0
  if (id === q || aliases.includes(q)) score += 100
  if (name.includes(q)) score += 60
  if (base.includes(q)) score += 40
  if (aliases.some((a) => a.includes(q) || q.includes(a))) score += 30
  if (keywords.some((k) => k === q)) score += 35
  if (keywords.some((k) => q.includes(k))) score += 15
  const tokens = q.split(/[\s,;/\\|]+/).filter((t) => t.length >= 2)
  for (const token of tokens) {
    if (name.includes(token)) score += 12
    if (id.includes(token)) score += 10
    if (aliases.some((a) => a.includes(token))) score += 8
    if (keywords.some((k) => k.includes(token))) score += 5
  }
  return score
}

export function searchBuiltin(query, limit = 12) {
  return BUILTIN_SOURCES
    .map((source) => ({ ...source, score: scoreSource(source, query) }))
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
