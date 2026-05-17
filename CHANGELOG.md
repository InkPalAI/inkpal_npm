# Changelog

## 1.0.3

- Onboarding cleanup. `inkpal start` is now the single recommended entry — it
  wires the bridge into your Flutter project, installs the MCP server into
  every detected editor, validates your license, and runs a first-success
  demo. The legacy `inkpal init` command is now an alias for `inkpal start`
  (the previous implementation patched main.dart incorrectly).
- CLI banner + `--help` restructured to put the recommended path first.
- Doctor hint updated to recommend `npx inkpal start` when bridge is missing.
- INSTALL.md rewritten around the one-line setup. Plugin slash-command gap
  is now documented honestly: MCP tools work today, polished slash commands
  ship via a separate plugin (private beta).

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
