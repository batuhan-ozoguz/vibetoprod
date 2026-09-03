# Changelog

## [0.1.0] — unreleased

First real release.

### Added

- Detection engine: 61 deterministic rules (exact dependency matching, file
  signals, env-key names from `.env.example`-style files, config keys, code
  patterns), scanning every `package.json` in the tree.
- CLI: local path, GitHub URL or `owner/repo` input; `--json`; `--html`.
- Cost model: 17 platforms verified against live pricing pages (2026-09),
  three traffic tiers with published assumptions and min–max ranges;
  unverified platforms are marked as such instead of guessed.
- Self-contained HTML plan report with an SVG architecture diagram —
  zero outbound requests, light/dark.
- Hardening: read-only analysis, symlinks skipped, 200KB per-file read cap,
  shallow clones with symlinks disabled, guaranteed cleanup.

## [0.0.1] — 2026-09-03

Name reservation placeholder.
