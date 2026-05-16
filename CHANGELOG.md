# Changelog

## 1.0.2

- Internal cleanup pass: stripped narrative comments from the bundled
  source. No functional changes.
- Sanitized `tool-schemas-bundled.json` metadata.
- Dropped the unused `build:binary` script and the `bin/` distribution
  path. The npm tarball is the only distribution channel.
- Tightened `.gitignore` and pre-publish guard rules.

## 1.0.1

First signed release published with Sigstore provenance attestation via
GitHub Actions OIDC. Identical functional surface to 1.0.0.

## 1.0.0

Initial public release of the `inkpal` MCP server.

- Connects Claude Code, Cursor, Windsurf, Codex, and Copilot to the
  InkPal cloud for Flutter-aware tooling.
- Local SDK and device commands (Flutter CLI, ADB, screenshots,
  taps/scrolls, visual snapshots) run offline; intelligence-heavy tools
  require an InkPal license.
- See `SECURITY.md` for the disclosure policy and `PUBLISHING.md` for
  the release workflow.
