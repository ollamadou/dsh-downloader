# 上下文与工作记录（2026-11-05）

> 本文件记录 dshdownloader（原 dsh-downloader）插件的改名、发布与插件市场收录状态，供后续接手时快速对齐。

## 1. 插件身份

| 项 | 值 |
|---|---|
| npm 包名 / loader id | `dshdownloader`（原 `dsh-downloader`） |
| GitHub 仓库 | `https://github.com/ollamadou/dsh-downloader`（未改名，链接保持可用） |
| 数据目录 | `~/.dsh/data/dshdownloader`（原 `~/.dsh/data/dsh-downloader`） |
| 市场分类 | `tools` |
| 版本 | `0.1.0` |
| 作者 | ollamadou \<173069520@qq.com\> |

改名原因：避免与社区已有的 `@having5548/dsh-downloader`（另一个作者的下载代理插件）重名混淆。

## 2. 本次改名改动（提交 `682a359`）

共 10 个文件、52 行：

- `package.json`：`name` → `dshdownloader`
- `cordis.patch.yml`：`id` / `name` → `dshdownloader`（loader 按包名解析，必须一致）
- `index.js`：路由 `/dsh-downloader/state`、`/dsh-downloader/action` → `/dshdownloader/*`
- `client.js`：同路由 + locale 命名空间 + 面板 id
- `lib/util.js`：数据目录、下载 UA 标识
- `lib/store.js`、`lib/downloader.js`：日志前缀
- `README.md` / `PUBLISHING.md` / `SECURITY.md`：文案与安装命令

未改：GitHub 仓库 URL、`ollamadou__dsh-downloader.yml` 这个目录条目文件名（它按仓库路径生成）。

## 3. 插件市场收录状态

市场的插件列表来自目录仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/*.yml`，一插件一个条目、一个 PR，合并后由 `dsh-plugin-catalog` 每日重建并发布 npm 包，市场从 jsdelivr 的 `index.json` 读取（15 秒超时内）。

当前状态（2026-11-05 23:00 前后实测）：

- 已开 PR：`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11886`
- 主干文件 `data/plugins/ollamadou__dsh-downloader.yml` 仍是 **404**，即**尚未合并**，所以市场暂时搜不到
- 市场索引 4569 条中无 `dsh-downloader` / `ollamadou`；下载类插件只有 `@ethanyoq/dsh-invoice-downloader`、`dsh-gopeed-downloader`、`@leisureyu/dsh-smart-dl`
- npm `dsh-downloader` 未发布（404）；`dshdownloader` 未占用（404，可用）
- 仓库创建于 2026-11-04，市场要求的“仓库满 24 小时”门禁已过，上游 `regate.yml` 每 6 小时重跑

索引里的 `name` 取仓库 `package.json` 的包名，因此改成 `dshdownloader` 后，市场搜索 `dshdownloader` 即可命中（`title` 仍显示 `ollamadou/dsh-downloader`）。

## 4. 待办（需要 GitHub / npm 凭据，本机没有）

```powershell
# 1) 推送改名提交到 GitHub
cd <仓库>
git am 0001-refactor-rename-package-to-dshdownloader.patch   # 若尚未应用
git push

# 2) 发布 npm（包名 dshdownloader）
npm login
npm publish

# 3) 更新 PR #11886 说明；条目 url 不用变
```

可选：若希望市场标题也不与旧名重复，需把 GitHub 仓库改名为 `dshdownloader`，并把目录条目改成 `ollamadou__dshdownloader.yml`、`url` 换新地址。

注意：数据目录已改名，旧目录 `~/.dsh/data/dsh-downloader` 不会自动迁移，需要手工复制。

## 5. 安装方式

```powershell
# 从 Gitee（本仓库）
dsh plugin --profile desktop add https://gitee.com/zhongkai-exploration_0/dshdownloader.git
# 从 GitHub 源码
dsh plugin --profile desktop add github:ollamadou/dsh-downloader
# 从 Release 预构建包
dsh plugin --profile desktop add https://github.com/ollamadou/dsh-downloader/releases/download/v0.1.0/dsh-downloader-0.1.0.tgz
```

装完需重启 DSH；首次打开若侧栏没有“下载器”图标，刷新一次页面。
