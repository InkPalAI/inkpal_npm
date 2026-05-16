# inkpal

> **AI-powered Flutter development tools for Claude Code, Cursor, Windsurf & Codex.**

InkPal is an MCP (Model Context Protocol) server that gives AI coding agents deep capabilities for Flutter development: layered architecture audits, accessibility checks, layout-issue detection, navigation pattern enforcement, runtime error reproduction, widget tree inspection, design-system pulls, and more — all behind a context-aware rulepack engine that loads only what your project needs.

## Install

```bash
# One command — auto-detects your editor and sets everything up
npx inkpal start
```

That's it. `inkpal start` will:
- Detect your Flutter project + MCP host (Claude Code / Cursor / Windsurf / Codex)
- Add `inkpal_bridge` to `pubspec.yaml` and patch `lib/main.dart` (AST-safe, idempotent)
- Auto-claim a free-tier license (no signup, no card)
- Configure the MCP server for your editor
- Run a structured health check
- Trigger a first-success loop

Set up time: under 3 minutes.

## What you get

| Skill | What it does |
|---|---|
| `/inkpal:debug` | Reproduce runtime error → root cause → fix → verify (visual + log) |
| `/inkpal:audit` | Static + accessibility + architecture + layout audit, context-aware |
| `/inkpal:build` | Spec → plan → code generation, policy-aware |
| `/inkpal:test` | Test execution + test-quality scan |
| `/inkpal:ship` | Pre-merge gate + auto-commit + PR |

Plus 170+ MCP tools for direct invocation (analyze_project, lookup_error, screenshot, tap/scroll/text, generate_widget, fabricate, css_to_flutter, visual_test, and more).

## Try it free

**24-hour full-access trial. Every tool, every check, every workflow.
Email only — no card, no auto-charge.**

```bash
npx inkpal trial your@email.com
```

Or `npx inkpal start` does both in one step (claims the trial, wires
your editor).

Take it for a real spin: debug a runtime error, generate a screen from
a sentence, audit a project, ship a PR through the pre-merge gate.
After 24 hours your trial expires — that's the end. No payment dialog,
no marketing emails, no follow-up. If it earned its keep, see your
options at [inkpal.ai/pricing](https://inkpal.ai/pricing).

### Free for students + OSS contributors

- Verified `.edu` email → 12 months free, renewable: [inkpal.ai/students](https://inkpal.ai/students)
- Active contributors to Flutter, Dart, or top-100 pub.dev packages → free indefinitely: [inkpal.ai/oss](https://inkpal.ai/oss)
- Teams (5+ seats) → [inkpal.ai/team](https://inkpal.ai/team)

## Doctor + status

```bash
npx inkpal status     # Per-editor install status
npx inkpal doctor     # Environment health (Flutter, ADB, license, server)
npx inkpal upgrade    # Re-run install on every detected editor
npx inkpal clean      # Scrub stale install artifacts
```

## Compatibility

| Editor | Status | Config path |
|---|---|---|
| Claude Code | ✅ supported | `~/.claude.json` |
| Cursor | ✅ supported | `.cursor/mcp.json` |
| Windsurf | ✅ supported | `~/.codeium/windsurf/mcp_config.json` |
| GitHub Copilot (VS Code) | ✅ supported | `.vscode/mcp.json` |
| OpenAI Codex CLI | ✅ supported | `~/.codex/mcp.json` |

| OS | Status |
|---|---|
| macOS | ✅ tested |
| Linux | ✅ supported |
| Windows | 🟡 v1.1 target (use WSL for now) |

## Privacy + telemetry

InkPal sends **anonymized, aggregated** telemetry by default to help us prioritize fixes:
- Tool invocations (name, success/failure, latency) — never the args or response content
- Client version + platform
- A device hash (SHA256 of hostname, never reversible)

**To opt out**, set in your MCP server env:

```json
"env": {
  "INKPAL_LICENSE_KEY": "ink_…",
  "INKPAL_TELEMETRY": "off"
}
```

Telemetry never includes:
- Your code
- Your file contents
- Your license key
- Your prompts
- Anything detected by local checks (stays on your machine)

The endpoint that receives events is documented at [inkpal.ai/privacy](https://inkpal.ai/privacy).

## Architecture

```
Your AI assistant   ⇄   inkpal   ⇄   your running Flutter app
```

The npm package is the local connector your editor talks to. It runs on
your machine, validates your license, and routes work between your
editor and the InkPal backend (and, if you're driving a running app,
the in-app `inkpal_bridge` package).

## Links

- Website: [inkpal.ai](https://inkpal.ai)
- Pricing: [inkpal.ai/pricing](https://inkpal.ai/pricing)
- Bridge package: [pub.dev/packages/inkpal_bridge](https://pub.dev/packages/inkpal_bridge)
- Docs: [inkpal.ai/docs](https://inkpal.ai/docs)
- Issues: [github.com/InkPalAI/inkpal_npm/issues](https://github.com/InkPalAI/inkpal_npm/issues)

## License

MIT — see [LICENSE](./LICENSE).
