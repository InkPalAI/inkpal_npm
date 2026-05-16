# inkpal — npm proxy changelog

## 1.0.0 — Lockdown + security hardening

The proxy is now strictly a router. Orchestration intelligence (rule
resolution, spec parsing, project taxonomy, scoring formulas) lives on
the InkPal cloud behind license validation. Tools that need
orchestration return a clear `cloud_required` envelope when offline
instead of fake degraded output.

### Architecture

- Removed `rulepack-engine` from the tarball entirely.
- `spec_to_plan` reduced to a thin proxy of `POST /api/spec/parse`.
- `inkpal_audit_ui` / `inkpal_accessibility_audit` now call
  `POST /api/rules/resolve` and run the returned flat rule list.
- `inkpal_lookup_error` / `inkpal_check_safety` require the cloud rule
  pack — no local STARTER rules.
- `inkpal_get_design_system` requires `inkpal_bridge` in the project.
- `inkpal_analyze_project` / `inkpal_get_context` proxy to the
  taxonomy-aware `POST /api/project/analyze` (open to free tier).
- Local SDK tools (`doctor`, `launch_app`, `screenshot`, `tap`/`scroll`/
  `enter_text`, `visual_*`) unchanged — still work offline.

### Response metadata

Every orchestration response now carries `orchestration_version`,
`engine_version`, and `policy_version` for drift traceability.

### Security hardening

- Replaced 7 `execSync` shell-out call sites with native `fs` operations
  to eliminate command-injection risk if a caller passes a path
  containing shell metacharacters.
- Added `scripts/moat-guard.mjs` wired into `prepublishOnly` — the
  publish is mechanically blocked if any orchestration identifier or
  taxonomy literal appears in the compiled output.
- All outbound `fetch` URLs are templated against a fixed base; user
  input is always `encodeURIComponent`'d into URL paths.
- Zero install-time scripts. Zero hidden files in tarball.
- See SECURITY.md for the disclosure policy.

## 0.8.2

Battle-test fixes — 14 of 16 v1.0 bugs closed across this and the prior
Railway commits. Pass rate expected to jump 17.5% → ~75% once published.

### Honest error handling (was: silent success)

- **B-001** P0 — `inkpal_screenshot` validates the captured PNG (file
  exists, ≥67 bytes, starts with PNG signature) before reporting
  success. Was silently returning 0-byte files.
- **B-006** P1 — `inkpal_navigate_to_route` requires an explicit `route`
  arg; refuses to invent `/` default that produced fake-success deep-link
  fallback responses.
- **B-009** P1 — `inkpal_get_interactive_elements` distinguishes "no
  elements visible" from "no device / adb missing" (was empty list
  for both).
- **B-010** P1 — `inkpal_scroll`, `inkpal_enter_text` verify adb
  succeeded before claiming success. Require text arg for enter_text.
- **B-011** P2 — `inkpal_list_devices` only reports
  `bridge_port_forwarded:true` when the `adb forward` actually executed.

### Discoverability + attach paths

- **B-002** P0 — proxy now sends `X-Inkpal-Client:proxy` +
  `?include_local=1` to Railway's `/api/tools` so it receives the FULL
  rich schemas of local-only tools (tap, scroll, navigate, visual_*).
  Previously the proxy stubbed every local tool with a flat
  `{project_path}` schema, breaking every interaction tool from any
  MCP client.
- **B-003** P0 — `inkpal_hot_reload` accepts `vm_service_uri` arg so
  users can attach to an externally-launched `flutter run`. Three
  discovery paths: arg → `.inkpal/run-state.json` → localhost scan.
- **B-004** P0 — `inkpal_launch_app` detects existing alive PID before
  spawning. Returns existing URI so caller can attach. `force:true`
  kills the stale process first.
- **B-005** P1 — `inkpal_inspect_widget_tree` accepts `vm_service_uri`
  arg so external runs can be inspected.
- **B-014** P0 — every tool descriptor now includes `execMode` and a
  `[local]` / `[cloud]` description prefix so MCP clients see
  tier/dispatch info upfront, not after a failing call.

### Diagnostics

- **B-007** P1 — `inkpal_get_runtime_errors` filters out shell-failure
  leak lines (`/bin/sh: adb: command not found`) so they don't
  masquerade as Flutter runtime errors in the result.
- **B-008** P1 — `inkpal_flutter_test` JSON parser. Old code matched
  the FIRST `+1` progress line (count of 1) instead of the final tally.
  Now prefers `+N: All tests passed!` / `+N -M: Some tests failed.`
  patterns.

### New helpers (internal)

- `runChecked()` — like `run()` but returns `{ok, stdout, stderr, code,
  error}` so callers can branch on actual success.
- `ensureAdb()` — quick adb-presence probe with actionable install
  instructions if missing.

### Discovery + storage

- **B-012** P3 — `inkpal_devices_discover` no longer dupes
  `list_devices`. Now combines `flutter devices`, `adb devices -l`,
  `xcrun simctl list booted`, and `xcrun xctrace list devices`. Returns
  unique device count + per-source breakdown.
- **B-013** P2 — `inkpal_storage_config` implements local read for
  `action="get"` (was always a stub error). Mutating actions still
  require the full server.

### Known still-pending

- **B-016** — `inkpal_bridge` `serverUrl` hardcoded `ws://localhost:8765`
  with no port-conflict detection. Requires a bridge republish (1.4.3)
  with port-fallback + bridge-state.json. Not blocked by this release.

## 0.8.0

- Initial public proxy with stdio MCP server forwarding to Railway.
