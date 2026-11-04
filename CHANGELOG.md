# Changelog

## 0.1.0 — 2026-11-04

- Initial release.
- Resumable downloads with `.part` and `.dshdl.json`, including recovery after a DSH restart.
- Multi-connection segmented downloads with adaptive connection ramp-up.
- Timeouts, exponential backoff, mirror failover and Range-unsupported fallback.
- 27 built-in China mirror/resource presets and 7 HTTP proxy presets.
- DeepSeek-assisted resource discovery with probing and persisted learned resources.
- Local download panel in the DSH Web UI, plus agent tools for download/status/control/sources/discovery/reporting.
- Automatic issue log, per-host speed/connection profiles and lessons.
