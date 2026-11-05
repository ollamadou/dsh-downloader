# Security

`dshdownloader` performs network downloads and writes files to the destination chosen by the user.

## What it accesses

- HTTP/HTTPS download sources, selected by the user or discovered through DeepSeek.
- An optional HTTP/HTTPS proxy (`proxyMode` / `proxyUrl` / per-download `proxy`).
- The local plugin data directory: download history, learned resources, host speed profiles and the issue log.
- The configured download directory and the explicit `dest` path.
- The DSH Web UI's same-origin status/action endpoints under `/dshdownloader/`.

## API key handling

- No DeepSeek API key is bundled with this repository or package.
- The key is read only when DeepSeek discovery is needed, from `deepseek.apiKey` or `DEEPSEEK_API_KEY`.
- It is not written to logs, history, learned resources or the issue log.
- Without a key, direct URL downloads, mirrors, proxies, resume and the Web panel still work.
- Proxy credentials in `jobs.json` are persisted so a paused job can resume; do not use this plugin with an untrusted proxy on a shared account.

## Network model

- Direct URLs may point anywhere the user asks, including localhost (useful for local mirrors).
- DeepSeek-discovered candidates and `downloader_sources(action=add)` reject localhost/private/link-local targets.
- Third-party GitHub acceleration prefixes are probed at runtime and may change; they are not operated by this project.
- SOCKS5 proxies are not supported; only HTTP/HTTPS proxies are accepted.

## Verification and reporting

This project does not perform automatic SHA-256/signature verification. For security-sensitive binaries, verify the official checksum or signature after download.

Report a vulnerability privately to `173069520@qq.com` before opening a public issue.
