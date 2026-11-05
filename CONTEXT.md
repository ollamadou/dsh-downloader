# 上下文与工作记录

> 记录 dshdownloader（原 dsh-downloader）插件的改名、发布、插件市场上架状态，供后续接手时快速对齐。
> 最近更新：2026-11-05 23:00（Asia/Shanghai）

## 1. 插件身份

| 项 | 值 |
|---|---|
| npm 包名 / loader id | `dshdownloader`（原 `dsh-downloader`） |
| 版本 | `0.1.1` |
| GitHub 仓库 | https://github.com/ollamadou/dsh-downloader（仓库名未改，链接保持可用） |
| Gitee 镜像 | https://gitee.com/zhongkai-exploration_0/dshdownloader（私有） |
| 数据目录 | `~/.dsh/data/dshdownloader`（原 `dsh-downloader`，不自动迁移） |
| 面板路由 | `/dshdownloader/state`、`/dshdownloader/action` |
| 市场分类 | `tools` |
| 作者 | ollamadou <173069520@qq.com> |

改名原因：避免与社区已有的 `@having5548/dsh-downloader`（另一个作者的下载代理插件）重名混淆；新名字在 npm 上未被占用。

## 2. 改名改动（提交 `682a359`）

10 个文件、52 行：`package.json`（name）、`cordis.patch.yml`（id/name）、`index.js` + `client.js`（路由、locale 命名空间、面板 id）、`lib/util.js`（数据目录、UA）、`lib/store.js` + `lib/downloader.js`（日志前缀）、`README.md` + `PUBLISHING.md` + `SECURITY.md`（文案与安装命令）。

未改：GitHub 仓库 URL；目录条目文件名 `ollamadou__dsh-downloader.yml`（按仓库路径生成）。

## 3. 已完成

| 时间 | 事项 |
|---|---|
| 2026-11-05 22:4x | 改名提交 `682a359`、上下文提交 `1d5a220` 推送到 GitHub `main` |
| 2026-11-05 22:5x | 版本提到 `0.1.1`，提交 `0e77fea`，打标签 `v0.1.1` 并推送 |
| 2026-11-05 22:5x | 创建 GitHub Release `v0.1.1 — dshdownloader`，附资产 `dshdownloader-0.1.1.tgz`（60,442 字节），HTTP 200 校验通过 |
| 2026-11-05 22:3x | Gitee 私有镜像仓库建立并首次推送（提交邮箱改写为 `zhongkai-exploration_0@users.noreply.gitee.com`，规避 Gitee 隐藏邮箱拦截） |
| 2026-11-05 22:3x | 本机 `desktop` profile 以 `file:E:\harness\dshdownloader` 安装并已运行（六个 `downloader_*` 工具可用） |

## 4. 待办

1. **npm 发布**（阻塞：缺 token）
   ```powershell
   npm login            # 或提供 Granular Access Token
   cd <repo>
   npm publish --access public
   ```
   包名 `dshdownloader@0.1.1`，`npm pack` 已校验过内容（60,442 字节）。

2. **目录条目 tarball 更新**（PR #11886）
   条目里当前是旧资产：
   `tarball: .../releases/download/v0.1.0/dsh-downloader-0.1.0.tgz`
   应改为：
   `tarball: https://github.com/ollamadou/dsh-downloader/releases/download/v0.1.1/dshdownloader-0.1.1.tgz`
   PR 分支在 `ollamadou/awesome-dsh-plugin`（fork），现有 GitHub token 对该 fork 是 403，需要在 token 里加上该仓库或手工改。

3. **市场收录**：条目合并后，`dsh-plugin-catalog` 每日重建，市场搜 `dshdownloader` 即可命中（索引 `name` 取仓库 package.json 的包名）。

4. **本机插件版本**：`desktop` profile 里装的是 0.1.0 的 `file:` 副本，功能与 0.1.1 相同；如需刷新执行
   `dsh plugin --profile desktop add file:E:\harness\dshdownloader`。

## 5. 插件市场收录机制（备忘）

- 列表来源：目录仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/*.yml`，一插件一个条目、一个 PR。
- 合并门禁：仓库公开且创建满 24 小时、真实可运行代码、`package.json` 有 `dsh.bundle`、条目格式正确，人工过一遍代码。
- 合并后 `dsh-plugin-catalog` 每日重建并发布 npm 包；市场优先读 jsdelivr 的 `index.json`（15 秒超时内），`dshmarket.com` / `awesome-dsh-plugin.com` 为备份源。
- 索引字段：`name` = 仓库 `package.json` 的包名，`title` = `owner/repo`。

## 6. 安装方式

```powershell
# GitHub Release 预构建包（推荐，免构建）
dsh plugin --profile desktop add https://github.com/ollamadou/dsh-downloader/releases/download/v0.1.1/dshdownloader-0.1.1.tgz

# 从 Gitee 镜像（私有库，需要凭据）
dsh plugin --profile desktop add https://gitee.com/zhongkai-exploration_0/dshdownloader.git

# 从 GitHub 源码（会触发 pnpm 构建授权）
dsh plugin --profile desktop add github:ollamadou/dsh-downloader

# 本机开发：从本地目录（file: 依赖，改完需重新 add 才生效）
dsh plugin --profile desktop add file:E:\harness\dshdownloader
```

装完重启 DSH；首次打开若侧栏没有“下载器”图标，刷新一次页面。
