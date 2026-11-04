# 健壮下载器 · DSH 插件

`dsh-downloader` 是一个面向 DeepSeek Harness（DSH）的下载插件：断点续传、多路合并、超时重试、国内镜像/代理预置、DeepSeek 资源发现、定时进度反馈，以及可沉淀的问题日志与主机调优。

- GitHub：`https://github.com/ollamadou/dsh-downloader`
- npm：`dsh-downloader`（包名预留；未发布 npm 时使用 GitHub Release 的 `.tgz`）
- 插件目录：`E:\harness\downloader`
- 本地开发环境已安装到 desktop profile，并默认启用
- 数据目录：`C:\Users\<你>\.dsh\data\dsh-downloader`（默认；可用配置覆盖）
- 默认下载目录：当前会话工作目录下的 `downloads\`
- 面板：左侧栏下载图标 → 中央“下载器”页面；每 1.2 秒刷新进度

安装方式：

```text
# 插件市场：搜索 dsh-downloader
# 普通 dsh web profile：
dsh plugin --profile web add dsh-downloader

# 直接从 GitHub（未发布 npm 时）：
dsh plugin --profile web add github:ollamadou/dsh-downloader
```

> DeepSeek API Key 不随包发布。插件只在需要资源发现时读取配置 `deepseek.apiKey` 或环境变量 `DEEPSEEK_API_KEY`；没有 Key 不影响直链下载、镜像、代理、续传和面板。

> 如果是刚安装完第一次打开页面，侧栏没有出现下载图标，请刷新一次页面或重启 DSH；Host 工具即时生效，Client 面板需要页面重新加载。

---

## 1. 快速使用

### 让 Agent 下载

直接对 Agent 说：

> 用下载器下载 Node.js 22 LTS 的 Windows x64 安装包到 `E:\andriod\downloads`。

或给它一个直链：

> 用下载器下载 `https://npmmirror.com/mirrors/node/v22.14.0/node-v22.14.0-x64.msi`。

Agent 会调用：

1. `downloader_download` 启动后台任务，立即返回 `id`；
2. `downloader_status(id, waitSeconds=15~30)` 定时查看进度；
3. 完成后报告文件名、大小和保存路径。

### 自己操作面板

左侧栏点击“下载器”图标：

- 查看进行中/最近任务、实时速度、连接数、分段进度、ETA；
- 暂停 / 继续 / 取消；
- 查看已学习资源、镜像/代理预置、问题与经验。

暂停后 `.part` 和 `.dshdl.json` 会保留；继续时从已完成的分段偏移继续，不会从 0 开始。

### 只查资源、不下载

```text
downloader_sources(action=search, query="node")
downloader_sources(action=add, url="直链", name="名称")
downloader_sources(action=addSite, baseUrl="https://mirror.example.com/")
downloader_sources(action=list)
downloader_sources(action=proxies)
```

`action=add` 会先实际发起 HEAD/GET Range 探测，只有验证通过的文件才会被采纳；采纳后的条目保存在 `sources.json`，后续 `downloader_download(query=...)` 会优先复用。

---

## 2. 工具一览

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `downloader_download` | 启动后台下载；支持直链或自然语言查询 | `url` / `query`、`dest`、`connections`、`retries`、`proxy`、`overwrite`、`useLlm`、`waitSeconds` |
| `downloader_status` | 查询一个任务或全局状态 | `id`、`waitSeconds`、`verbose` |
| `downloader_control` | 暂停 / 继续 / 取消 | `action`、`id`、`removePartial` |
| `downloader_sources` | 浏览/搜索/采纳资源与镜像、查看代理、删除已学习条目 | `action`、`query`、`url`、`baseUrl`、`name`、`id` |
| `downloader_discover` | 让 DeepSeek 返回候选直链，再逐个探测验证 | `query`、`platform`、`format`、`adopt`、`limit` |
| `downloader_report` | 手工记录问题/解决办法，进入问题日志 | `message`、`downloadId`、`severity`、`solution` |

`downloader_download` 是异步的：它返回 `downloading` 和 `id`，不要在这时就宣布下载成功；必须 `downloader_status` 到 `completed`。

---

## 3. 预置资源与代理

### 镜像/资源站点（27 个）

按类别摘要：

| 类别 | 预置 |
|---|---|
| 综合镜像 | 清华 TUNA、中科大 USTC、阿里云、华为云、腾讯云、网易、北外、南大、上交、浙大 |
| 包管理器 | npmmirror（npm）、npmmirror 二进制目录、PyPI 清华/阿里、Go goproxy.cn、Rust rsproxy、Maven 阿里云 |
| SDK/平台 | Flutter 中国镜像、Gradle 腾讯云、Android SDK 腾讯云、DaoCloud Docker |
| 模型/数据 | Hugging Face hf-mirror、魔搭 ModelScope |
| GitHub 加速 | ghfast、gh-proxy、ghproxy.net（第三方，可用性会变化，下载前会探测） |
| 大模型 API | DeepSeek API（用于资源发现） |

完整清单在 `lib/presets.js`，可用 `downloader_sources(action=list)` 查看。

### 代理预置（7 个）

- `auto`：优先 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`，其次探测本机 `7890`、`7897`、`10809`、`1080`、`8118`
- `off`：强制直连
- Clash / Mihomo：`http://127.0.0.1:7890`、`http://127.0.0.1:7897`
- V2RayN HTTP：`http://127.0.0.1:10809`
- Shadowsocks / Privoxy：`1080` / `8118`

注意：

- 只支持 **HTTP/HTTPS 代理**。纯 SOCKS5 代理暂不支持，请先用工具转成 HTTP 代理。
- 本地/内网目标会自动绕过代理，避免把 `127.0.0.1` 请求发给远端代理。
- 代理地址中的账号密码会保存在任务索引里（`jobs.json`），共享机器上请留意。

---

## 4. 配置

配置写在当前 profile 的 `cordis.patch.yml` 中；插件行 id 为 `dsh-downloader`。修改后重启 DSH（或让插件重新加载）生效。

最小示例：

```yaml
- id: dsh-downloader
  name: 'dsh-downloader'
  config:
    downloadDir: 'E:\Downloads'
    maxConnections: 8
    proxyMode: auto
    deepseek:
      apiKey: ''          # 建议改用环境变量 DEEPSEEK_API_KEY
      baseUrl: 'https://api.deepseek.com'
      model: 'deepseek-chat'
```

完整字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `downloadDir` | `''` | 默认下载目录；空表示 `<会话工作目录>\downloads` |
| `dataDir` | `''` | 插件数据目录；空表示 `%USERPROFILE%\.dsh\data\dsh-downloader` |
| `maxConnections` | `8` | 单任务最大并发连接数（1–16） |
| `initialConnections` | `2` | 初始连接数；下载过程中按速度自适应增加 |
| `minSegmentBytes` | `2097152` | 小于该大小或服务端不支持 Range 时用单连接 |
| `timeoutMs` | `30000` | 建连/响应头超时 |
| `idleTimeoutMs` | `45000` | 连接无数据超时 |
| `maxRetries` | `4` | 每个分段/单流的重试次数 |
| `retryBaseDelayMs` | `800` | 退避起始值 |
| `retryMaxDelayMs` | `15000` | 退避上限 |
| `stallTimeoutMs` | `90000` | 全局停滞看门狗 |
| `proxyMode` | `auto` | `auto` / `off` / `custom` |
| `proxyUrl` | `''` | `custom` 时使用，如 `http://127.0.0.1:7890` |
| `useLlmDiscovery` | `true` | 查询无直链时是否调用 DeepSeek |
| `learnConnections` | `true` | 按主机历史速度/失败调整下次连接数；显式传 `connections` 时以参数为准 |
| `agentProgressIntervalMs` | `20000` | 向 Agent 注入进度摘要的间隔；设为 `0` 关闭自动注入（面板仍实时刷新） |
| `notifyOnComplete` | `false` | 完成后是否用 `followup` 唤醒会话；面板始终显示 |
| `deepseek.apiKey` | `''` | DeepSeek API Key；也读 `DEEPSEEK_API_KEY` |
| `deepseek.baseUrl` | `https://api.deepseek.com` | 可换成兼容端点 |
| `deepseek.model` | `deepseek-chat` | 资源发现模型 |
| `deepseek.timeoutMs` | `120000` | 发现请求超时 |

### 配置 DeepSeek

```powershell
$env:DEEPSEEK_API_KEY = 'sk-...'
```

或写进插件配置。未配置 Key 时：

- 直链下载、镜像/代理预置、断点续传、面板都正常工作；
- `query` 模式找不到已学习直链时，会返回 `NO_DEEPSEEK_KEY`，并列出可用镜像；
- 你仍可让 Agent 用 `web_search` 找到直链，再用 `downloader_sources(action=add, url=...)` 采纳。

---

## 5. 断点续传与重启恢复

- 下载中：目标文件旁有 `<文件名>.part` 和 `<文件名>.dshdl.json`。
- `.dshdl.json` 记录分段边界、每段已写偏移、ETag/Last-Modified、总大小。
- 暂停/取消/失败/DSH 重启后，`jobs.json` 保存任务元数据；重启后任务会恢复为 `paused`。
- 继续：`downloader_control(action=resume, id=...)` 或面板“继续”。
- 服务端 ETag/总大小变化时会放弃旧分段，重新开始，避免拼接出坏文件。
- 服务端忽略 `Range` 时自动回退单连接；如果探测阶段就发现不支持，直接单连接。
- 所有写入按偏移落盘，最终 `fsync` 后重命名；大小校验通过才标记 `completed`。
- 下载完成后 `.part` 与 `.dshdl.json` 自动删除。

常见选择：

```text
dest = "E:\Downloads\foo.zip"          # 具体文件
dest = "E:\Downloads"  fileName="foo.zip"  # 目录 + 文件名
overwrite = true                        # 覆盖已存在目标
connections = 1                         # 服务器限速/易 403 时
```

---

## 6. 下载问题记录与“越用越会下”

插件自动记录：

- 分段/单流失败、超时、HTTP 状态、镜像回退、Agent 推送失败；
- 每个主机的成功次数、失败次数、平均速度、最佳速度、推荐连接数；
- 最近问题的聚合“经验”（`downloader_status` 返回 `lessons`）。

手工补充：

```text
downloader_report(
  message="某镜像 403，但官方源可用",
  solution="该资源优先用官方源；国内镜像仅作备选",
  severity="warn"
)
```

这些数据只写本地，不会上传。下次同主机下载会参考历史连接数和失败情况；显式 `connections` 参数优先。

数据文件：

| 文件 | 内容 |
|---|---|
| `sources.json` | 已学习的直链资源和站点（采纳后永久保留） |
| `hosts.json` | 主机速度/连接/失败画像 |
| `history.json` | 最近 100 条任务摘要 |
| `jobs.json` | 未完成任务，用于重启恢复 |
| `issues.jsonl` | 追加式问题日志 |

---

## 7. 面板说明

- 左侧栏图标：下载箭头；位置在插件/计划之后。
- 中央面板：总速度、进行中任务、最近任务、资源预置统计、最近问题/经验。
- 操作：暂停、继续、取消；不提供“删除文件”，避免误删。
- 面板通过同源 `GET /dsh-downloader/state` 拉取状态，通过 `POST /dsh-downloader/action` 执行暂停/继续/取消；跨源请求会被拒绝。
- 若页面提示“无法读取下载状态”，先确认当前页面与 DSH 同源，再刷新。

---

## 8. 故障排查

| 现象 | 处理 |
|---|---|
| `NO_DIRECT_URL` | 预置里只有镜像根地址；给出具体文件 URL，或配置 DeepSeek Key |
| `NO_DEEPSEEK_KEY` | 设置 `DEEPSEEK_API_KEY` 或 `deepseek.apiKey` |
| `HTTP 403/401` | 可能有防盗链/鉴权；换官方或镜像直链，或让 Agent 找可用直链后 `sources add` |
| `HTTP 416` | 续传位置异常；删除 `.part` 和 `.dshdl.json` 后重下 |
| 下载停滞 | 检查代理/镜像；降低 `connections`，增大 `timeoutMs`/`idleTimeoutMs` |
| 代理不生效 | `proxyMode=custom` + `proxyUrl`；确认是 HTTP 代理，不是 SOCKS5 |
| 连接数一直是 1 | 服务端不支持 Range、文件太小，或 `connections=1` |
| 重启后找不到任务 | 用 `downloader_status` 查看；任务应恢复为 `paused`，再用 `resume` |
| 面板不出现 | 首次安装后刷新页面/重启 DSH |

### 安全提示

- 只接受 `http(s)` URL；DeepSeek 候选会拒绝内网/本机地址，避免 SSRF。
- 第三方 GitHub 加速、镜像站的可用性和内容不由本项目控制；安装包请尽量用官方 SHA256/签名再核对。
- 本版本不做自动哈希校验；对安全敏感的软件，请自行用官方校验值核对下载结果。
- DeepSeek API Key 不要提交到仓库；优先用环境变量。

---

## 9. 已验证与限制

已在当前环境验证：

- 4 路分段下载 + 合并，10 MiB 本地夹具的 SHA-256 内容校验通过；16 MiB 慢速夹具实测大小与完成状态通过；
- 暂停后继续、暂停后重启 DSH 再继续，内容校验通过；
- 服务端先返回 503，自动重试后成功；
- 服务端假称支持 Range、实际忽略 Range，自动回退单连接；
- 通过 UI 同源接口暂停任务；暂停/继续/取消接口返回 200；
- `sources add` 实际探测并采纳 `https://cdn.npmmirror.com/binaries/node/index.json`，随后 `query` 模式复用该已学习资源完成下载；
- DeepSeek 发现用本地 mock 端点验证过 JSON 解析、候选探测、采纳落盘；
- 本地 HTTP 代理路径在加入“内网绕过”之前完成过实测；HTTPS CONNECT 代码已实现，但当前环境未做真实公网代理回归。

限制：

- 不支持 SOCKS5/Shadowsocks 原生代理；
- 不自动校验哈希/签名；
- 第三方镜像/加速地址可能失效，依赖运行时探测；
- 面板视觉仍未做截图级验证（当前会话没有浏览器控制）；Slot 注册与状态接口已验证。

---

## 10. 开发与测试

```powershell
cd E:\harness\downloader
node --check index.js
node --check client.js
node test/manual-test.mjs      # 分段、暂停/续传、重试、回退、重启恢复
node test/discovery-test.mjs   # DeepSeek mock 发现与采纳
```

安装/更新：

```text
plugin_manager action=install_bundle target=E:\harness\downloader
```

Host 代码更新后需要重启 DSH 或重新启用插件；Client 代码更新后刷新页面。
