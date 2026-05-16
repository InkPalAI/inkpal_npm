# Install InkPal — first 5 minutes

A Flutter dev with a working machine should reach a passing `/inkpal:debug`
in under 5 minutes. If you don't, that's a bug — file it at
https://github.com/InkPalAI/inkpal_npm/issues with `[install-friction]` in the
title.

## Prerequisites (1 min)

You already have these if you ship Flutter apps. If not, install first:

```bash
flutter --version              # required ≥ 3.16
adb version                    # for Android (or have Xcode for iOS)
node --version                 # required ≥ 20
```

## Install (60 sec)

```bash
npm install -g inkpal
```

That's the only public command. The rest is configuration.

## Wire to Claude Code (60 sec)

Two layers — the MCP tools and the skills (slash commands). You need both.

### A. MCP tools — `~/.claude.json`

```json
{
  "mcpServers": {
    "inkpal": {
      "command": "npx",
      "args": ["-y", "-p", "inkpal@^1.0.0", "inkpal-mcp"],
      "env": {
        "INKPAL_LICENSE_KEY": "<your_license_key_from_inkpal.ai>"
      }
    }
  }
}
```

Restart Claude Code. Verify with `/mcp`. Expect:
```
[inkpal] v18.4.0 ready — N tools (M cloud + K local)
[inkpal] License OK — Pro tier active.
```

### B. Skills (slash commands like `/inkpal:debug`)

The MCP step above gives you **tool calls** (Claude can invoke
`inkpal_audit_ui` directly). To get the named skills (`/inkpal:debug`,
`/inkpal:audit`, `/inkpal:build`), install the plugin:

```bash
claude plugins add @inkpal/plugin
```

Or, while we're in pre-1.0 publication, install from the public plugin repo:

```bash
git clone https://github.com/tezzRathore/inkpal-plugin.git
claude plugins marketplace add ./inkpal-plugin
claude plugins install inkpal@inkpal-marketplace
```

Verify: in Claude Code, `/help` should list `/inkpal:debug`,
`/inkpal:audit`, `/inkpal:build`.

**If you skip step B**: the MCP tools still work — you just have to
prompt Claude with raw tool names ("call inkpal_audit_ui on lib/main.dart")
instead of `/inkpal:audit`. The slash commands are convenience, not
required.

## Wire to your Flutter project (60 sec)

In your `pubspec.yaml`:

```yaml
dependencies:
  inkpal_bridge: ^1.4.2
```

In `lib/main.dart`, change `runApp(MyApp())` to:

```dart
import 'package:inkpal_bridge/inkpal_bridge.dart';

void main() {
  inkpalRunApp(
    MyApp(),
    licenseKey: '<your_license_key_from_inkpal.ai>',
  );
}
```

Then:

```bash
flutter pub get
flutter run -d emulator-5554       # or any device id
```

## First success — under 60 seconds (90 sec)

In Claude Code, with your project open:

```
/inkpal:debug
The home screen is broken. Find what's wrong and fix it.
```

Claude will:
1. Show the chain plan (9 steps)
2. Ask you to approve
3. Capture errors → classify → screenshot → reason → edit → re-compile → verify

If everything works, you'll see "✅ chain complete in N seconds" with the
fix already applied. Run `git diff` to see what Claude changed.

## If it doesn't work

```
inkpal doctor
```

Returns 9 health checks. The first failing one tells you what to fix.

Common first-time issues (most fixed automatically in 1.0):

| Symptom | Fix |
|---|---|
| `License rejected` | Wrong key or expired. Check inkpal.ai/account |
| `flutter_run_alive: false` | Run `flutter run` in a separate terminal first |
| `inkpal_bridge_dep: missing` | Add to pubspec.yaml + `flutter pub get` |
| `main_dart_wired: false` | Replace `runApp(...)` with `inkpalRunApp(...)` in lib/main.dart |
| `adb missing` | Only required for Android. iOS uses xcrun. |
| `Connection refused` to bridge | Bridge tries WS port 8765; firewall may block. Bridge falls back to VM extensions. |

## What works without anything extra

| Capability | Notes |
|---|---|
| `/inkpal:debug` | Find + fix runtime bugs in <60s on the demo case |
| `/inkpal:audit` | Static UI lint + WCAG checks + secret detection |
| `/inkpal:build` | Generate features from spec, drive emulator to verify |
| Quick / Standard / Enterprise tracks | Compose the 3 skills with different gates |

## What requires connectivity to inkpal.ai

| Capability | Why |
|---|---|
| Full UI audit (vs offline starter checks) | Server-side intelligence |
| Accessibility audit | Same |
| Safety / secret audit | Same |
| Error explanations + remediation | Same |
| AI generation (`generate_test`, `generate_shader`, `ui_plan`) | Server-side AI |
| Pattern search | Server-side index |

If your network is down, the proxy returns `feature_requires_connectivity`
envelopes with offline alternatives. No silent failures.

## Privacy

- Server response cache lives at `~/.inkpal/cache/` (24h TTL, per-license)
- All session artifacts (screenshots, runtime errors) auto-delete after 24h
- No captured user UI persists beyond 24h unless you explicitly preserve
  it (baselines, dna.json, constitution.yaml)

## Uninstall

```bash
# Remove from MCP config (delete the inkpal entry from ~/.claude.json)
# Then:
rm -rf ~/.inkpal      # local cache + sessions
npm uninstall -g inkpal
flutter pub remove inkpal_bridge
```

## Common install failures (read before opening an issue)

| You see | Likely cause | Fix |
|---|---|---|
| `[inkpal] License Key Required` | `INKPAL_LICENSE_KEY` env var missing in your MCP host config | Add `"env": { "INKPAL_LICENSE_KEY": "ink_…" }` to the inkpal block in your editor's MCP config. Or run `npx inkpal trial your@email.com` for a free 24h trial. |
| `[inkpal] Invalid key format` | Key doesn't start with `ink_` or is < 10 chars | Get a fresh key at [inkpal.ai/account](https://inkpal.ai/account) |
| `[inkpal] License rejected` | Key was revoked, expired, or for a different InkPal account | Manage at [inkpal.ai/account](https://inkpal.ai/account) |
| `[inkpal] Trial active — full access for 24 hours` (then nothing works after 24h) | Trial expired | Subscribe: [inkpal.ai/pricing](https://inkpal.ai/pricing) ($39/mo, $179/6mo, $299/yr — INR for India). One trial per email. |
| `inkpal start` prompts for email but you don't want to share it | Falls back to offline mode (local tools only) | Either provide email for full 24h trial, or run with a paid key in env: `INKPAL_LICENSE_KEY=ink_… npx inkpal start` |
| Claude Code shows `inkpal: failed` | Pre-0.8.5 install wrote `args: ['-y', 'inkpal@latest']` (runs the CLI, not the MCP server) | Run `npx inkpal upgrade` — it scrubs old config and rewrites the right `args: ['-y', '-p', 'inkpal@latest', 'inkpal-mcp']`. Then restart Claude Code. |
| `~/.claude/settings.json` exists but Claude Code never sees inkpal | Pre-0.8.5 install wrote to `settings.json` (permissions only). v2.x reads MCP from `~/.claude.json` | `npx inkpal claude install --key <your_key>` writes to the correct file |
| `inkpal_bridge: not found` after `flutter pub get` | Bridge version pin is too high for your Flutter SDK | Either upgrade Flutter (`flutter upgrade`) or pin lower in pubspec: `inkpal_bridge: ^1.4.0` |
| `inkpal_audit_ui` returns only 3 starter findings | License missing or Railway unreachable — falling back to offline starter rules | Check `INKPAL_LICENSE_KEY` is set in your MCP env. Run `npx inkpal doctor` to confirm Railway is reachable. |
| `inkpal_navigate_back` returns "already at root" | `main.dart` not wired with `navigatorKey: inkpalNavigatorKey, navigatorObservers: [inkpalNavigatorObserver]` | Run `npx inkpal start` — it patches main.dart AST-safely. Or call `inkpal_doctor` to see exactly which wiring is missing. |
| `flutter run` fails after `inkpal start` | Bridge version mismatch with installed packages | Run `flutter pub upgrade inkpal_bridge` then re-run `flutter run` |
| `inkpal start` hangs at "Claiming free-tier license" | Network blocking `https://mcp.inkpal.ai` (corporate firewall/VPN) | Set `INKPAL_API_URL` to a proxy that can reach the API, or get a key manually from [inkpal.ai/pricing](https://inkpal.ai/pricing) and skip auto-claim |
| Stale `~/.inkpal/bin/inkpal-mcp` shadowing npm | Pre-0.8.5 install dropped a standalone binary | Run `npx inkpal clean` (renames to `*.OLD-<date>`, never deletes) |

## Questions / bugs

- File at https://github.com/InkPalAI/inkpal_npm/issues
- Discord (link at inkpal.ai)
