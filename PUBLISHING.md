# Publishing to the DSH plugin market

This file is for the repository owner. It is not shipped in the npm package.

## Identity

- GitHub: `ollamadou`
- Repository: `https://github.com/ollamadou/dsh-downloader`
- npm package: `dsh-downloader`
- Market category: `tools`
- Market entry file: `data/plugins/ollamadou__dsh-downloader.yml`
- Submitted PR: `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11886`
- Release: `https://github.com/ollamadou/dsh-downloader/releases/tag/v0.1.0`

## 1. Create the GitHub repository

```powershell
cd E:\harness\downloader
git init
git add .
git commit -m "feat: initial dsh-downloader"
git branch -M main
git remote add origin https://github.com/ollamadou/dsh-downloader.git
git push -u origin main
gh repo edit ollamadou/dsh-downloader --add-topic dsh-plugin
```

The repository must be public, contain real working code, and be at least one day old before the market PR is reviewed.

## 2. Publish npm (optional, recommended)

```powershell
npm pack --dry-run
npm login
npm publish
```

The published package's `repository` field already points to the GitHub repository, so the market can link them.

## 3. Add the awesome-dsh-plugin entry

Fork `awesome-dsh-plugin/awesome-dsh-plugin`, then add exactly one file:

`data/plugins/ollamadou__dsh-downloader.yml`

```yaml
url: https://github.com/ollamadou/dsh-downloader
name: ollamadou/dsh-downloader
category: tools
description:
  en: Resumable multi-connection downloader with China mirror and proxy presets, plus DeepSeek-assisted resource discovery.
  zh: 支持断点续传、多连接加速、国内镜像/代理预置与 DeepSeek 资源发现的下载器。
icon: https://raw.githubusercontent.com/ollamadou/dsh-downloader/main/assets/icon-180.png
```

Do not edit the generated READMEs or any other entry.

## 4. Open the PR

```powershell
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
cd awesome-dsh-plugin
git checkout -b add-dsh-downloader
# create data/plugins/ollamadou__dsh-downloader.yml
git add data/plugins/ollamadou__dsh-downloader.yml
git commit -m "Add dsh-downloader"
git push origin add-dsh-downloader
```

Then open a pull request against `awesome-dsh-plugin/awesome-dsh-plugin`. CI checks `dsh.bundle`, repository age, entry count and formatting; a maintainer then reads the code.

## 5. DeepSeek API key

The repository must never contain an API key. `deepseek.apiKey` is empty by default and the plugin also reads `DEEPSEEK_API_KEY` at runtime. The key is only used when the user asks for resource discovery or calls `downloader_discover`; direct URL downloads do not need it.

## 6. Before submitting

- [ ] `package.json` has `dsh.bundle` (yes) and no `private: true` (yes).
- [ ] `dsh.plugin` topic added on GitHub.
- [ ] `assets/icon-180.png` is a real 180×180 PNG.
- [ ] `npm pack --dry-run` contains no `.part`, `.dshdl.json`, data directory or API key.
- [ ] Test install from a clean profile with `dsh plugin --profile web add github:ollamadou/dsh-downloader`.
- [ ] Confirm the panel appears after a page refresh.
- [ ] Review the security notes in `README.md` and the market's "not a security audit" disclaimer.
