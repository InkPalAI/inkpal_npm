import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { callOrchestrationEndpoint } from './remote.js';

/**
 * Local-only tools — these require Flutter SDK, ADB, or device access
 * that can only exist on the user's machine. Everything else runs remotely.
 *
 * This set MUST match LOCAL_ONLY_TOOLS in packages/core/src/remote/server.ts
 * so that tools are correctly routed (local) vs forwarded (Railway).
 */
export const LOCAL_TOOLS = new Set([
  // D6/RUN4/RUN5: cloud-resilient gateway tools.
  // EVERY tool here MUST work without Railway. Cloud is enrichment only.
  'inkpal_lookup_error',
  'inkpal_analyze_project',
  'inkpal_check_safety',
  // RUN5: subprocess DNS to Railway flaky → these moved local-first too.
  'inkpal_doctor',
  'inkpal_project_doctor',  // alias used by next_tool hints
  'inkpal_get_context',
  'inkpal_get_design_system',
  'inkpal_check_package',   // direct pub.dev API call — no Railway proxy
  'inkpal_pub_dev_search',  // direct pub.dev search — no Railway proxy
  'inkpal_get_blast_radius',
  // RUN6 B-018/B-020: cloud_unreachable killed these — port static rule packs.
  'inkpal_audit_ui',
  'inkpal_accessibility_audit',
  // 1.0.0 v1: registry meta-tool — LLM queries the tool registry.
  'inkpal_registry',
  // 1.0.0 v1: department picks (Day 3). Pure registry queries, <100ms.
  // INSPECT + VERIFY only at launch. Other 9 depts deferred per Rule 1.
  'inkpal_dept_inspect_pick',
  'inkpal_dept_verify_pick',
  // 1.0.0 v1: storage cleanup (Day 5+). Auto-runs on chain start; this is
  // the manual entry point.
  'inkpal_cleanup_storage',
  // Week 2 Day 12: batch interactions. The only new tool of v1. Justified
  // by ROI: /build was projected to need 5+ min for a 5-screen demo because
  // of MCP round-trip overhead per tap/scroll/enter_text. Batching halves
  // wall-clock for any multi-step interaction sequence.
  'inkpal_batch_actions',
  // Week 2 Day 13: track dispatcher. Single entry-point that loads a track
  // markdown file and tells the LLM which skill chain to run. Discipline
  // contract Rule 1 hard cap: only 3 tracks (Quick / Standard / Enterprise).
  'inkpal_run_track',
  // System validation harness: 8-layer interaction validator
  // (cross-tool consistency, fallback audit, determinism, dep graph,
  // failure simulation, latency composition, output quality, registry truth).
  // Run on demand or by Railway cron alongside contract tests.
  'inkpal_validate_system',
  // Block 5 Option C (2026-05-04): log session API. Bookend a window of
  // testing/interaction work; assert + query the logs that fired during it.
  'inkpal_start_log_session',
  'inkpal_end_log_session',
  'inkpal_query_logs',
  'inkpal_assert_no_errors',
  // Phase 2 Block 2.1 (2026-05-05): progress tracking — per-project
  // .inkpal/progress.json. Single dispatcher tool with action arg.
  'inkpal_progress',
  // Phase 2 Block 2.2 (2026-05-05): spec input — free-text → structured plan
  // with confidence + blockers + clarification questions.
  'inkpal_spec_to_plan',
  // Phase 3 Skill #5 (2026-05-05): SHIP family — auto_commit, create_pr,
  // pre_merge_gate. All have real handlers now (legacy stubs replaced).
  'inkpal_auto_commit', 'inkpal_create_pr', 'inkpal_pre_merge_gate',
  // Flutter SDK commands
  'inkpal_flutter_analyze', 'inkpal_flutter_test', 'inkpal_flutter_build',
  'inkpal_create_project', 'inkpal_dart_fix',
  'inkpal_coverage_report', 'inkpal_coverage_gaps',
  // Device management
  'inkpal_list_devices', 'inkpal_device_info',
  // App lifecycle (need local Flutter SDK + device)
  'inkpal_launch_app', 'inkpal_hot_reload', 'inkpal_hot_restart',
  'inkpal_screenshot',
  'inkpal_get_runtime_errors', 'inkpal_get_app_logs',
  'inkpal_navigate_to_route', 'inkpal_evaluate',
  'inkpal_inspect_widget_tree', 'inkpal_analyze_visual',
  // ADB interaction (need physical device connection)
  'inkpal_tap', 'inkpal_smart_tap', 'inkpal_scroll', 'inkpal_enter_text',
  'inkpal_get_interactive_elements', 'inkpal_get_elements',
  'inkpal_double_tap', 'inkpal_drag', 'inkpal_swipe', 'inkpal_press_key',
  'inkpal_scroll_to', 'inkpal_set_slider', 'inkpal_set_checkbox',
  'inkpal_page_summary', 'inkpal_find_element',
  'inkpal_deep_link',
  // Smart wait & assertions
  'inkpal_wait_for', 'inkpal_assert_element', 'inkpal_wait_for_idle',
  'inkpal_assert_ui', 'inkpal_test_flow',
  // Widget inspector
  'inkpal_get_widget_details', 'inkpal_select_widget', 'inkpal_driver_command',
  // Visual Testing (require device screenshots)
  'inkpal_visual_test', 'inkpal_visual_test_all',
  'inkpal_visual_baseline_save', 'inkpal_visual_baseline_compare',
  'inkpal_visual_report', 'inkpal_profile_performance',
  // LSP (require local filesystem)
  'inkpal_hover', 'inkpal_go_to_definition', 'inkpal_find_references',
  'inkpal_read_package_source', 'inkpal_search_package_source',
  // Sessions (require local state)
  'inkpal_save_session', 'inkpal_restore_session', 'inkpal_list_sessions',
  'inkpal_start_log_session', 'inkpal_end_log_session',
  'inkpal_assert_no_errors', 'inkpal_query_logs',
  // Screen recording (ADB)
  'inkpal_video_start', 'inkpal_video_stop',
  'inkpal_recording_start', 'inkpal_recording_stop',
  'inkpal_recording_status', 'inkpal_recording_export',
  'inkpal_screen_snapshot', 'inkpal_screen_diff',
  'inkpal_state_capture', 'inkpal_state_list', 'inkpal_state_get', 'inkpal_state_diff',
  // Network / Stability (require device)
  'inkpal_mock_network', 'inkpal_clear_network_mocks',
  'inkpal_go_offline', 'inkpal_go_online', 'inkpal_network_conditions',
  'inkpal_network_record', 'inkpal_network_replay',
  'inkpal_stability_check', 'inkpal_set_locale',
  // Multi-Device (require local devices)
  'inkpal_devices_discover', 'inkpal_launch_all', 'inkpal_execute_all',
  'inkpal_screenshot_all', 'inkpal_compare_all', 'inkpal_test_cross_device',
  // ORCHESTRATE (require local app connections)
  'inkpal_register_app', 'inkpal_orchestrate',
  'inkpal_orchestrate_status', 'inkpal_cross_app_test',
  // HEAL (require running app)
  'inkpal_auto_repair', 'inkpal_heal_watch', 'inkpal_heal_stop', 'inkpal_heal_verify',
  // SHIP (require local git + Flutter SDK)
  'inkpal_auto_commit', 'inkpal_create_pr', 'inkpal_pre_merge_gate',
  'inkpal_deploy', 'inkpal_ship',
  // Storage (require local .inkpal/ directory)
  'inkpal_storage_status', 'inkpal_storage_cleanup', 'inkpal_storage_config',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string, cwd?: string, timeout = 60_000): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...flutterEnv() } });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return err.stdout || err.stderr || err.message || String(e);
  }
}

/**
 * Like `run()` but returns whether the command actually succeeded.
 *
 * The plain `run()` returns stderr/message as if it were stdout when a
 * subprocess exits non-zero — callers ended up reporting success:true on
 * commands that never executed (B-009/B-010/B-011: scroll/enter_text/
 * list_devices all lied when adb was missing). Use `runChecked()` for any
 * tool whose success bit must be honest.
 */
function runChecked(cmd: string, cwd?: string, timeout = 60_000): { ok: boolean; stdout: string; stderr: string; code: number | null; error?: string } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...flutterEnv() }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number; message?: string };
    const stdoutText = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? '';
    const stderrText = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '';
    const msg = err.message ?? String(e);
    let hint: string | undefined;
    if (/command not found|ENOENT/i.test(msg) || /command not found/i.test(stderrText)) {
      const tool = cmd.split(/\s+/)[0];
      hint = `${tool} is not on PATH. Install it or add its directory to PATH.`;
    } else if (/timed out|ETIMEDOUT/i.test(msg)) {
      hint = `command timed out after ${timeout}ms`;
    }
    return { ok: false, stdout: stdoutText, stderr: stderrText, code: err.status ?? null, error: hint ?? msg };
  }
}

/**
 * Recursively walk a directory and return file paths matching a predicate.
 * Native Node fs only — no shell involvement, so user-controlled paths
 * cannot inject shell metacharacters. Replaces `find ... -name '*.dart'`
 * shell calls. Best-effort: ignores per-entry stat/read errors.
 *
 * @param dir       absolute starting directory
 * @param match     return true to include the file
 * @param maxFiles  cap on returned results (early exit for large trees)
 * @param maxDepth  cap on recursion depth
 */
function walkDir(
  dir: string,
  match: (filename: string) => boolean,
  maxFiles = 500,
  maxDepth = 8,
): string[] {
  const out: string[] = [];
  const stack: Array<{ path: string; depth: number }> = [{ path: dir, depth: 0 }];
  while (stack.length > 0 && out.length < maxFiles) {
    const { path, depth } = stack.pop()!;
    if (depth > maxDepth) continue;
    let entries: string[];
    try { entries = readdirSync(path); } catch { continue; }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      // Skip hidden + common build dirs to keep walks fast
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'build' || entry === '.dart_tool') continue;
      const full = join(path, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push({ path: full, depth: depth + 1 });
      else if (st.isFile() && match(entry)) out.push(full);
    }
  }
  return out;
}

/** Safe file deletion — never shells out. */
function safeUnlink(filePath: string): void {
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* best-effort */ }
}

/**
 * D3 cluster-3: detect target platform from args / environment.
 *
 * Order of precedence:
 *   1. args.platform = 'ios' | 'android' | 'web' | 'macos'  (explicit)
 *   2. args.device  string id matched against patterns
 *   3. .inkpal/run-state.json `device` field (set by launchAppProperly)
 *   4. fall back to 'unknown' — caller decides
 */
function detectPlatform(args: Record<string, unknown>, projectPath?: string): 'ios' | 'android' | 'web' | 'macos' | 'unknown' {
  const explicit = (args.platform as string)?.toLowerCase();
  if (explicit === 'ios' || explicit === 'android' || explicit === 'web' || explicit === 'macos') return explicit;

  const device = ((args.device || args.device_id) as string)?.toLowerCase() || '';
  if (device) {
    if (/iphone|ipad|simulator|com\.apple\.coresimulator/.test(device)) return 'ios';
    // iOS sim UDIDs are uppercase hex with hyphens, ~36 chars
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device)) return 'ios';
    if (/emulator-|android|sdk_gphone/.test(device)) return 'android';
    if (device === 'chrome' || device === 'web-server') return 'web';
    if (device === 'macos') return 'macos';
  }

  if (projectPath) {
    try {
      const stateFile = join(projectPath, '.inkpal', 'run-state.json');
      if (existsSync(stateFile)) {
        const state = JSON.parse(readFileSync(stateFile, 'utf8'));
        if (state.device) return detectPlatform({ device: state.device }, undefined);
      }
    } catch { /* skip */ }
  }
  return 'unknown';
}

/**
 * D3 cluster-3: check if InkPal Bridge WS is listening locally.
 * Bridge defaults to ws://127.0.0.1:8765 — when present, all interaction
 * tools should prefer it over adb/simctl.
 */
function isBridgeListening(port = 8765): boolean {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | grep -i 'flutter\\|dart\\|node' | head -1`, { encoding: 'utf8', timeout: 2000 });
    return out.trim().length > 0;
  } catch { return false; }
}

/** Standard "iOS needs the bridge for interaction" error envelope. */
function iosNeedsBridge(toolName: string, projectPath: string): Record<string, unknown> {
  return {
    success: false,
    error: 'ios_requires_bridge',
    platform: 'ios',
    tool: toolName,
    message: 'iOS Simulator does not expose UI input via xcrun directly. Install inkpal_bridge in pubspec.yaml + add inkpalRunApp() to enable interaction tools on iOS.',
    next_tool: 'inkpal_project_doctor',
    next_tool_args_hint: { project_path: projectPath },
    hint: 'Install: `flutter pub add inkpal_bridge`. Then in lib/main.dart wrap your runApp(MyApp()) as inkpalRunApp(MyApp()) — this brings up a WebSocket on 127.0.0.1:8765 that the proxy can drive.',
    install_command: 'flutter pub add inkpal_bridge',
    docs_url: 'https://inkpal.ai/docs/bridge-setup',
  };
}

/** Process-liveness check used by launchAppProperly and run-state cleanup. */
function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Day-1 rewrite (RUN2 B-102): launch a Flutter app, persist the VM Service
 * URI to .inkpal/run-state.json BEFORE returning, so every dependent tool
 * (hot_reload, inspect_widget_tree, navigate_to_route, visual_*) can attach.
 *
 * Critical correctness contract:
 *   • Polls the `flutter run --machine` JSON event stream until either
 *     `app.debugPort` (early VM URI signal) or `app.started` (canonical).
 *   • Buffers stdout properly across chunk boundaries — partial JSON lines
 *     are accumulated, not dropped.
 *   • Watches stderr too — older Flutter versions print VM URI there.
 *   • Detects and surfaces "Waiting for another flutter command to release
 *     the startup lock" as a clean, recoverable error (never just times out).
 *   • Default timeout: 5 min (Xcode + first-build can take 90s on iOS sim).
 *   • Reports build progress via `events_seen` so caller knows app is moving.
 *   • Detaches the child cleanly — process keeps running after we return.
 *   • Honest return shape: `success:true` with vmServiceUri OR `success:false`
 *     with concrete cause + next_tool. Never lies about timeout.
 */
async function launchAppProperly(args: Record<string, unknown>): Promise<unknown> {
  const proj = p(args);
  const device = (args.device as string) || '';
  const flavor = (args.flavor as string) || '';
  const timeoutSec = Math.min(Math.max((args.timeout as number) ?? 300, 30), 600);
  const force = args.force === true;

  const stateDir = join(proj, '.inkpal');
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  const stateFile = runStateFile(proj);

  // Pre-flight: existing alive run? (B-004 fix preserved.)
  if (!force && existsSync(stateFile)) {
    try {
      const prev = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (prev.pid && isProcessAlive(prev.pid) && prev.vmServiceUri) {
        return {
          success: true,
          attached_existing: true,
          pid: prev.pid,
          vmServiceUri: prev.vmServiceUri,
          startedAt: prev.startedAt,
          message: 'Attached to existing flutter run. Use force:true to kill+restart.',
        };
      }
      // Stale state — clean up
      if (prev.pid && !isProcessAlive(prev.pid)) {
        safeUnlink(stateFile);
      }
    } catch { /* corrupt state — overwrite */ }
  } else if (force && existsSync(stateFile)) {
    try {
      const prev = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (prev.pid && isProcessAlive(prev.pid)) {
        try { process.kill(prev.pid, 'SIGTERM'); } catch { /* dying */ }
        await new Promise(r => setTimeout(r, 1000));
        if (isProcessAlive(prev.pid)) {
          try { process.kill(prev.pid, 'SIGKILL'); } catch { /* gone */ }
        }
      }
      safeUnlink(stateFile);
    } catch { /* ignore */ }
  }

  const cmdArgs = ['run', '--machine'];
  if (device) cmdArgs.push('-d', device);
  if (flavor) cmdArgs.push('--flavor', flavor);

  const child = spawn('flutter', cmdArgs, {
    cwd: proj,
    env: { ...process.env, ...flutterEnv() },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  // Buffers + state captured by event handlers
  let stdoutBuf = '';
  let stderrAccum = '';
  let appId: string | null = null;
  let debugPortUri = '';
  let startedUri = '';
  const eventsSeen: string[] = [];
  let buildProgress = 'spawning';

  const stderrLogPath = join(stateDir, 'flutter-stderr.log');
  try { writeFileSync(stderrLogPath, ''); } catch { /* ignore */ }

  // Helper: surface event names + look for canonical signals
  const handleEvent = (evt: Record<string, unknown>): void => {
    if (typeof evt.event === 'string') eventsSeen.push(evt.event as string);
    const params = (evt.params || {}) as Record<string, unknown>;
    if (evt.event === 'app.start' || evt.event === 'app.started') {
      buildProgress = 'started';
      const u = (params.vmServiceUri as string) || (params.observatoryUri as string) || '';
      if (u && !startedUri) startedUri = u;
      if (typeof params.appId === 'string') appId = params.appId;
    }
    if (evt.event === 'app.debugPort') {
      buildProgress = 'debug_port';
      const u = (params.wsUri as string) || (params.uri as string) || '';
      if (u && !debugPortUri) debugPortUri = u;
      if (typeof params.appId === 'string') appId = params.appId;
    }
    if (evt.event === 'daemon.connected') buildProgress = 'daemon_connected';
    if (evt.event === 'app.progress') {
      const msg = (params.message as string) || '';
      if (msg) buildProgress = msg.slice(0, 60);
    }
  };

  child.stdout?.on('data', (data: Buffer) => {
    stdoutBuf += data.toString();
    // Process complete lines; keep partial in buffer.
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // flutter --machine emits both bare objects AND arrays of objects.
      try {
        const parsed = JSON.parse(trimmed);
        const events = Array.isArray(parsed) ? parsed : [parsed];
        for (const e of events) handleEvent(e as Record<string, unknown>);
      } catch {
        // Plain-text fallback: scan for VM URI in case Flutter version
        // emits non-JSON during early build phase.
        const m = trimmed.match(/(?:https?|ws):\/\/127\.0\.0\.1:\d+\/[\w_\-+=\/]+/);
        if (m && !startedUri) startedUri = m[0];
      }
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    stderrAccum += text;
    if (stderrAccum.length > 8000) stderrAccum = stderrAccum.slice(-8000);
    try {
      appendFileSync(stderrLogPath, text);
    } catch { /* best-effort */ }
    // Scan stderr for VM URI fallback
    const m = text.match(/(?:https?|ws):\/\/127\.0\.0\.1:\d+\/[\w_\-+=\/]+/);
    if (m && !startedUri) startedUri = m[0];
  });

  // Detach so the app keeps running after we return.
  child.unref();

  // Wait — async, NOT busy-loop — until we get a URI or timeout or process dies.
  const deadline = Date.now() + timeoutSec * 1000;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  child.on('exit', (code, sig) => { exitCode = code; exitSignal = sig; });

  while (Date.now() < deadline) {
    // Did either canonical event fire?
    if (startedUri || debugPortUri) break;
    // Did the child die? Then we'll never get a URI.
    if (exitCode !== null || exitSignal !== null) break;
    // Did stderr expose the lock-contention case?
    if (/Waiting for another flutter command to release the startup lock/i.test(stderrAccum)) {
      return {
        success: false,
        error: 'startup_lock_held',
        message: 'Another flutter command is holding the startup lock. Wait for it to finish, or kill it.',
        next_tool: 'inkpal_devices_list',
        next_tool_args_hint: {},
        hint: 'Find lock holder: pgrep -fl "flutter_tools" then kill it. Then re-run inkpal_launch_app with force:true.',
        events_seen: [...new Set(eventsSeen)],
        stderr_tail: stderrAccum.slice(-500),
      };
    }
    await new Promise<void>(r => setTimeout(r, 500));
  }

  const vmServiceUri = startedUri || debugPortUri;

  if (vmServiceUri) {
    const state = {
      pid: child.pid,
      vmServiceUri,
      appId,
      device,
      flavor: flavor || undefined,
      startedAt: new Date().toISOString(),
      project_path: proj,
    };
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    return {
      success: true,
      pid: child.pid,
      vmServiceUri,
      appId,
      device,
      events_seen: [...new Set(eventsSeen)],
      message: `App ${startedUri ? 'started' : 'reached debug port'}. Use inkpal_hot_reload after edits, inkpal_screenshot to see UI, inkpal_inspect_widget_tree for live tree.`,
    };
  }

  // Timed out or process died with no URI. Surface the actual reason.
  const elapsed = Math.round((Date.now() - (deadline - timeoutSec * 1000)) / 1000);
  if (exitCode !== null) {
    return {
      success: false,
      error: 'flutter_exited',
      exit_code: exitCode,
      exit_signal: exitSignal,
      message: `flutter run exited (code ${exitCode}, signal ${exitSignal}) before the app started.`,
      events_seen: [...new Set(eventsSeen)],
      stderr_tail: stderrAccum.slice(-1000),
      next_tool: 'inkpal_project_doctor',
      hint: 'Check the stderr_tail for the build error. Common causes: missing platform toolchain (Xcode for iOS, Android SDK for android), syntax error caught at compile, missing dependency.',
    };
  }
  return {
    success: false,
    error: 'timeout_no_vm_uri',
    pid: child.pid,
    elapsed_seconds: elapsed,
    timeout_seconds: timeoutSec,
    build_progress: buildProgress,
    events_seen: [...new Set(eventsSeen)],
    stderr_tail: stderrAccum.slice(-1000),
    message: `flutter run did not surface a VM Service URI within ${timeoutSec}s. The process may still be building.`,
    next_tool: 'inkpal_run_attach',
    next_tool_args_hint: { project_path: proj },
    hint: 'The process is still alive — try inkpal_run_attach in 30s to pick up the URI once Flutter publishes it. Or pass timeout:600 next time for slow first-builds.',
  };
}

/** Quick adb-presence check used by interaction handlers to fail loud. */
function ensureAdb(): { ok: true } | { ok: false; error: string; hint: string; nextSteps: string[] } {
  // Fast path — adb already on PATH (user shell or earlier auto-detect)
  const probe = runChecked('adb version', undefined, 3_000);
  if (probe.ok) return { ok: true };
  // v1 proof-video fix: MCP subprocess inherits the launching shell's env,
  // which on Claude Code does NOT include ~/Library/Android/sdk/platform-tools.
  // Auto-detect common SDK locations and prepend the first that contains
  // adb to process.env.PATH for the rest of this proxy lifetime.
  const home = process.env.HOME || '';
  const candidates = [
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools'),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools'),
    join(home, 'Library', 'Android', 'sdk', 'platform-tools'),                    // macOS
    join(home, 'Android', 'Sdk', 'platform-tools'),                                // Linux
    join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools'),            // Windows
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'adb'))) {
      const current = process.env.PATH || '';
      if (!current.split(':').includes(dir)) {
        process.env.PATH = `${dir}:${current}`;
      }
      // Re-probe with the updated PATH
      const reprobe = runChecked('adb version', undefined, 3_000);
      if (reprobe.ok) return { ok: true };
    }
  }
  return {
    ok: false,
    error: 'adb is not installed or not on PATH',
    hint: 'Tried common Android SDK locations (~/Library/Android/sdk/platform-tools, $ANDROID_SDK_ROOT, etc.) — none contain adb. Install Android SDK platform-tools.',
    nextSteps: [
      'macOS: brew install android-platform-tools',
      'Or: export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" before launching Claude Code',
      'For iOS-only workflows: use inkpal_screenshot with method:"simctl" instead.',
    ],
  };
}

/** Detect Flutter SDK and ensure it's on PATH */
function flutterEnv(): Record<string, string> {
  const extra: Record<string, string> = {};
  // Common Flutter SDK locations
  const candidates = [
    process.env.FLUTTER_ROOT,
    join(process.env.HOME || '', 'flutter/bin'),
    join(process.env.HOME || '', '.flutter/bin'),
    join(process.env.HOME || '', 'development/flutter/bin'),
    join(process.env.HOME || '', 'fvm/default/bin'),
    '/usr/local/flutter/bin',
    join(process.env.HOME || '', 'snap/flutter/common/flutter/bin'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) {
      const current = process.env.PATH || '';
      if (!current.includes(c)) {
        extra.PATH = `${c}:${current}`;
      }
      break;
    }
  }
  return extra;
}

function p(args: Record<string, unknown>): string {
  return resolve((args.project_path as string) || process.cwd());
}

function uiDump(): string {
  return run('adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml');
}

function runStateFile(projectPath: string): string {
  return join(projectPath, '.inkpal', 'run-state.json');
}

function getVmServiceUri(projectPath: string): string | null {
  // 1. Prefer the run-state file written by launchAppProperly.
  const stateFile = runStateFile(projectPath);
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      // Support both new key (vmServiceUri) and legacy snake_case for back-compat.
      const uri = state.vmServiceUri || state.vm_service_uri || null;
      if (uri && state.pid && isProcessAlive(state.pid)) return uri;
      // Stale (PID dead) — fall through to discovery.
    } catch { /* corrupt — fall through */ }
  }
  // 2. Fall back to scraping the stderr log we wrote during launch.
  // Flutter prints "A Dart VM Service on … is available at: http://127.0.0.1:XXXXX/<token>/"
  return discoverVmServiceUri(projectPath);
}

/**
 * Real implementation of VM Service URI discovery (B-110 fix).
 *
 * Strategy in priority order:
 *   1. Scrape .inkpal/flutter-stderr.log for the canonical "A Dart VM Service…
 *      is available at: <URI>" line. We own this file because launchAppProperly
 *      writes to it. Reliable when launch_app was used.
 *   2. Scrape Flutter's own daemon log files in ~/.flutter for an externally-
 *      launched session (covers users who ran `flutter run` themselves).
 *   3. lsof scan of LISTEN ports owned by dart/flutter processes — gives port
 *      but not the auth token. Returned only as a last-resort partial URI
 *      (caller must obtain token separately).
 */
function discoverVmServiceUri(projectPath: string): string | null {
  const VM_URI_RE = /(?:https?|ws):\/\/(?:127\.0\.0\.1|localhost):\d+\/[\w_\-+=\/]+/;

  // Path 1: our own stderr log
  const stderrLog = join(projectPath, '.inkpal', 'flutter-stderr.log');
  if (existsSync(stderrLog)) {
    try {
      const content = readFileSync(stderrLog, 'utf8');
      const lines = content.split('\n').reverse(); // newest matches win
      for (const line of lines) {
        const m = line.match(VM_URI_RE);
        if (m) {
          // Validate the port is actually listening before returning.
          const port = m[0].match(/:(\d+)\//)?.[1];
          if (port && isPortListening(parseInt(port))) return m[0];
        }
      }
    } catch { /* skip */ }
  }

  // Path 2: scan project's .dart_tool/flutter_build/dart_tool.json or similar
  // (Flutter writes a session marker some versions). Skipped for now —
  // path 1 covers ~95% of cases.

  // Path 3: lsof — only useful for diagnostics, can't construct full URI.
  // Returning null here so caller surfaces a clear "pass vm_service_uri" hint.
  return null;
}

/**
 * Capture log lines that fired between a baseline point (line count for
 * Android, ISO timestamp for iOS) and now, filtered by regex.
 *
 * Used by the log session API. Same simctl/logcat plumbing as
 * inkpal_get_runtime_errors but with deterministic windowing.
 */
async function captureSessionLines(
  projectPath: string,
  platform: string,
  filterRe: string,
  baselineLineCount: number,
  startTs: string,
): Promise<string[]> {
  const out: string[] = [];
  if (platform === 'ios' || platform === 'unknown') {
    const sim = runChecked(`xcrun simctl list devices booted -j 2>/dev/null`, undefined, 3_000);
    if (sim.ok && sim.stdout.includes('"state" : "Booted"')) {
      // simctl logs are time-keyed; ask for everything since startTs
      const startDate = startTs.replace('T', ' ').replace(/\..*$/, '');
      const r = runChecked(
        `xcrun simctl spawn booted log show --start "${startDate}" --predicate 'processImagePath contains "Runner" OR senderImagePath contains "Flutter"' 2>/dev/null | grep -iE "${filterRe}" | head -500`,
        undefined, 10_000,
      );
      if (r.ok) out.push(...r.stdout.split('\n').filter(Boolean));
      return out;
    }
  }
  // Android: skip the first baselineLineCount lines, then filter
  const adbProbe = ensureAdb();
  if (!adbProbe.ok) return out;
  const r = runChecked(`adb logcat -d 2>/dev/null | tail -n +${baselineLineCount + 1} | grep -iE "${filterRe}" | head -500`, undefined, 10_000);
  if (r.ok) out.push(...r.stdout.split('\n').filter(Boolean));
  return out;
}

/** Check if a TCP port is actively listening on localhost. */
function isPortListening(port: number): boolean {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8', timeout: 2000 });
    return out.trim().length > 0;
  } catch { return false; }
}

/** Convert a VM Service URI to its HTTP base form (works for ws://…/ws too). */
function toHttpBase(vmUri: string): string {
  return vmUri.replace(/^ws:/, 'http:').replace(/\/ws\/?$/, '/').replace(/\/?$/, '/');
}

/** Call a VM Service RPC method via the HTTP shortcut. Returns parsed JSON-RPC body. */
async function vmServiceCall(
  vmUri: string,
  method: string,
  params: Record<string, string | number> = {},
  timeoutMs = 8000,
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: { code: number; message: string }; raw?: string }> {
  const httpBase = toHttpBase(vmUri);
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const url = `${httpBase}${method}${qs ? '?' + qs : ''}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { return { ok: false, raw: text, error: { code: -1, message: 'non_json_response' } }; }
    const b = body as { result?: Record<string, unknown>; error?: { code: number; message: string } };
    if (b.error) return { ok: false, error: b.error, raw: text };
    return { ok: true, result: b.result, raw: text };
  } catch (e) {
    return { ok: false, error: { code: -1, message: (e as Error)?.message ?? String(e) } };
  }
}

/**
 * Try a bridge VM Service extension locally. Used by D-suite (tap, scroll,
 * enter_text, get_interactive_elements) to bypass the forward_remote stub
 * when the bridge has registered the extension on the live isolate.
 *
 * RUN7 ship-blocker fix: the exact same channel that Category C uses for
 * navigate_to_route + inspect_widget_tree just needs to be applied to the
 * D suite. Per RUN7 audit: "the architectural template for the fix is now
 * sitting right next to it in Category C".
 *
 * Returns:
 *   { handled: true, response }  — extension exists and ran (success/failure)
 *   { handled: false, reason }   — extension not registered or no VM URI; caller
 *                                   should fall through to its existing path
 */
async function tryBridgeExtension(
  projectPath: string,
  args: Record<string, unknown>,
  extensionName: string,
  paramMap: Record<string, string | number | undefined>,
): Promise<{ handled: true; response: Record<string, unknown> } | { handled: false; reason: string }> {
  const vmUri = (args.vm_service_uri as string) || getVmServiceUri(projectPath);
  if (!vmUri) return { handled: false, reason: 'no_vm_service_uri' };
  const isolateId = await getFlutterIsolateId(vmUri);
  if (!isolateId) return { handled: false, reason: 'no_isolate' };
  // Bridge VM extensions take stringified params; coerce + drop undefined.
  const params: Record<string, string | number> = { isolateId };
  for (const [k, v] of Object.entries(paramMap)) {
    if (v !== undefined && v !== null && v !== '') params[k] = String(v);
  }
  const r = await vmServiceCall(vmUri, extensionName, params, 15_000);
  if (r.error?.code === -32601) {
    return { handled: false, reason: 'extension_not_registered' };
  }
  if (!r.ok) {
    return {
      handled: true,
      response: {
        success: false,
        error: 'bridge_extension_failed',
        extension: extensionName,
        jsonrpc_error: r.error,
        vm_service_uri: vmUri,
        isolate_id: isolateId,
      },
    };
  }
  // Bridge extensions return {type, ...} where the actual app-level outcome
  // is on r.result. When that inner object has its own success flag, surface
  // it as the wrapper's success — otherwise the wrapper falsely reports
  // success: true while the bridge says success: false (e.g. "Element X not
  // found on screen"). Honest contract: outer success = the bridge ran AND
  // the requested operation succeeded.
  const inner = (r.result ?? {}) as Record<string, unknown>;
  const innerSuccess = inner.success;
  const bridgeReportedFailure = innerSuccess === false;
  return {
    handled: true,
    response: {
      success: bridgeReportedFailure ? false : true,
      source: 'vm_service_extension',
      extension: extensionName,
      isolate_id: isolateId,
      vm_service_uri: vmUri,
      ...(bridgeReportedFailure ? { error: 'bridge_op_failed', bridge_error: inner.error ?? inner.message } : {}),
      result: r.result,
    },
  };
}

/** Resolve the first Flutter isolate id from a VM Service. */
async function getFlutterIsolateId(vmUri: string): Promise<string | null> {
  const vm = await vmServiceCall(vmUri, 'getVM');
  if (!vm.ok || !vm.result) return null;
  const isolates = (vm.result.isolates as Array<{ id?: string; name?: string }> | undefined) ?? [];
  if (!isolates.length) return null;
  const flutterIso = isolates.find(i => /flutter|main|root/i.test(i.name ?? ''));
  return (flutterIso ?? isolates[0])?.id ?? null;
}

/**
 * Derive a stable, deterministic baseline name from any of the calling
 * conventions agents use (`name`, `route`, `routes[0]`). Used by both
 * inkpal_visual_baseline_save and inkpal_visual_test so that save → test
 * round-trips deterministically (RUN6 B-015/B-016 fix).
 */
function deriveVisualName(args: Record<string, unknown>): string {
  const explicit = (args.name as string)?.trim();
  if (explicit) return explicit.replace(/[^a-z0-9_-]/gi, '_');
  const route = (args.route as string)
    || ((args.routes as unknown[] | undefined)?.[0] as string | undefined)
    || '';
  const trimmed = route.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return 'root';
  return trimmed.replace(/[^a-z0-9_-]/gi, '_');
}

// ────────────────────────────────────────────────────────────────────────────
// 1.0.0 LOCKDOWN — tier-gated rule fetch + per-license cache
// ────────────────────────────────────────────────────────────────────────────
// The proxy ships only minimal "starter" rules locally. Deep rule packs
// (audit_ui full, accessibility_audit full, check_safety full, error DB)
// live on Railway behind license + tier validation. Each license caches its
// own slice locally at ~/.inkpal/cache/rules/<name>-<tier>.json so we make
// at most one Railway call per (rule pack, license, tier) per cache TTL.
//
// THIS IS A MOAT BOUNDARY. Do not move rule data into local.ts. See
// memory: feedback_inkpal_moat_protection.md
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from 'node:os';
import { createHash as _createHash } from 'node:crypto';

const RULE_CACHE_DIR = join(homedir(), '.inkpal', 'cache', 'rules');
const RULE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RAILWAY_BASE = process.env.INKPAL_API_URL || 'https://mcp.inkpal.ai';
const REGISTRY_CACHE_FILE = join(homedir(), '.inkpal', 'cache', 'registry.json');
const REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── Tool Registry cache (1.0.0 v1) ──────────────────────────────────────
// Proxy fetches /api/registry from Railway at boot, caches 24h. Used by:
// - inkpal_registry meta-tool (LLM querying)
// - inkpal_dept_*_pick tools (department dispatch — Day 3)
// - chain executor (alternatives + next_logical lookup)
//
// If Railway unreachable on first boot, registry is null and the chain
// executor falls back to legacy unregistered tool calls (logging
// fallback_used:true per Rule 4).

export interface RegistryToolEntry {
  id: string;
  name: string;
  department: string;
  description: string;
  status: string;
  status_reason: string;
  alternatives?: string[];
  next_logical?: string[];
  consumes_from?: string[];
  produces?: string[];
  deps?: { required?: string[]; preferred?: string[] };
  examples?: Array<{ args: Record<string, unknown>; expected?: string }>;
  known_issues?: Array<{ id: string; summary: string }>;
  // Day 7: contract harness writes these every cycle. dept_pick uses them
  // to weight confidence by real-world reliability, not just keyword match.
  telemetry?: {
    calls_30d?: number;
    success_rate_30d?: number;
    median_latency_ms?: number;
  };
}

export interface RegistryResponse {
  version: string;
  generated_at: string;
  tool_count: number;
  tools: RegistryToolEntry[];
  cached_at?: number;
}

let _registryCache: RegistryResponse | null = null;

export async function getRegistry(): Promise<RegistryResponse | null> {
  if (_registryCache) return _registryCache;
  if (existsSync(REGISTRY_CACHE_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(REGISTRY_CACHE_FILE, 'utf8')) as RegistryResponse;
      if (cached.cached_at && Date.now() - cached.cached_at < REGISTRY_CACHE_TTL_MS) {
        _registryCache = cached;
        return cached;
      }
    } catch { /* corrupt — refetch */ }
  }
  try {
    const r = await fetch(`${RAILWAY_BASE}/api/registry`, {
      headers: { 'Authorization': `Bearer ${process.env.INKPAL_LICENSE_KEY ?? ''}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const body = await r.json() as RegistryResponse;
    body.cached_at = Date.now();
    try {
      mkdirSync(join(homedir(), '.inkpal', 'cache'), { recursive: true });
      writeFileSync(REGISTRY_CACHE_FILE, JSON.stringify(body, null, 2));
    } catch { /* best-effort */ }
    _registryCache = body;
    return body;
  } catch {
    return null;
  }
}

export function isRegistered(toolName: string, registry: RegistryResponse | null): boolean {
  if (!registry) return false;
  return registry.tools.some(t => t.name === toolName);
}

interface RulePackResponse {
  pack_name: string;
  rules: unknown[];
  version: string;
  cached_at?: number;
}

/** Fetch a rule pack from Railway, cached per license-key.
 * 1.0.0 Pro-only: no tier slicing — every valid license gets the full pack. */
async function fetchRulePack(packName: string): Promise<RulePackResponse | null> {
  const licenseKey = process.env.INKPAL_LICENSE_KEY ?? '';
  if (!licenseKey) return null;
  const keyHash = _createHash('sha256').update(licenseKey).digest('hex').slice(0, 12);
  const cacheFile = join(RULE_CACHE_DIR, `${packName}-${keyHash}.json`);

  // Cache hit?
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as RulePackResponse;
      if (cached.cached_at && Date.now() - cached.cached_at < RULE_CACHE_TTL_MS) {
        return cached;
      }
    } catch { /* corrupt cache — refetch */ }
  }

  // Fetch from Railway
  try {
    const r = await fetch(`${RAILWAY_BASE}/api/rules/${encodeURIComponent(packName)}`, {
      headers: {
        'Authorization': `Bearer ${licenseKey}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const body = await r.json() as RulePackResponse;
    body.cached_at = Date.now();
    try {
      mkdirSync(RULE_CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(body, null, 2));
    } catch { /* best-effort */ }
    return body;
  } catch {
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleLocal(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    // ── Registry meta-tool (1.0.0 v1) ─────────────────────────────────────
    case 'inkpal_registry': {
      // Pure registry query. Used by LLM (or department picks) to resolve
      // tool IDs, statuses, dependencies, alternatives. No Railway round-trip
      // beyond the boot-time fetch (24h cache).
      const reg = await getRegistry();
      if (!reg) {
        return {
          success: false,
          error: 'registry_unavailable',
          hint: 'Railway unreachable AND no cached registry at ~/.inkpal/cache/registry.json. Tools still work via legacy path; chain executor will log fallback_used:true.',
        };
      }
      const filter = args.filter as { id?: string; name?: string; department?: string; status?: string } | undefined;
      let tools = reg.tools;
      if (filter?.id) tools = tools.filter(t => t.id === filter.id);
      if (filter?.name) tools = tools.filter(t => t.name === filter.name);
      if (filter?.department) tools = tools.filter(t => t.department === filter.department);
      if (filter?.status) tools = tools.filter(t => t.status === filter.status);
      return {
        success: true,
        version: reg.version,
        generated_at: reg.generated_at,
        tool_count: tools.length,
        tools,
      };
    }

    // ── Track dispatcher (Week 2 Day 13) ──────────────────────────────────
    // 3 tracks: quick / standard / enterprise. Returns the track manifest
    // (skills, budget, preview, gates) so the LLM knows what to dispatch.
    // The actual skill execution still runs through Claude Code's Skill tool
    // — this is just the meta-routing layer.
    case 'inkpal_run_track': {
      const track = (args.track as string)?.toLowerCase().trim();
      const goal = (args.goal as string) ?? '';
      const VALID = new Set(['quick', 'standard', 'enterprise']);
      if (!VALID.has(track)) {
        return {
          success: false,
          error: 'unknown_track',
          tracks_available: ['quick', 'standard', 'enterprise'],
          hint: 'Pick one: quick (debug only, no preview), standard (audit→build→debug), enterprise (standard + gates).',
        };
      }
      const TRACKS: Record<string, Record<string, unknown>> = {
        quick: {
          composes: ['debug'], budget_seconds: 60, preview: false, auto: true,
          dispatch_hint: 'Call /inkpal:debug with auto:true. Single skill, no chain preview.',
        },
        standard: {
          composes: ['audit', 'build', 'debug'], budget_seconds: 600, preview: true, auto: false,
          dispatch_hint: 'Run /inkpal:audit first → review with user → run /inkpal:build → review → /inkpal:debug to verify.',
        },
        enterprise: {
          composes: ['audit', 'build', 'debug'], budget_seconds: 1200, preview: true, auto: false,
          gates: ['audit_pass', 'build_compile', 'debug_resolved', 'pre_merge', 'deploy_verify'],
          dispatch_hint: 'Run /inkpal:audit → REQUIRE explicit y/n → /inkpal:build → REQUIRE y/n → /inkpal:debug → REQUIRE y/n → inkpal_pre_merge_gate → REQUIRE y/n → final visual_test+audit_ui+accessibility_audit → REQUIRE y/n.',
        },
      };
      return {
        success: true,
        track,
        goal,
        manifest: TRACKS[track],
        next: 'Dispatch skills per dispatch_hint. Each skill enforces its own discipline rules + budget.',
      };
    }

    // ── Progress tracking (Phase 2 Block 2.1, 2026-05-05) ─────────────────
    case 'inkpal_progress': {
      const { handleProgress } = await import('./progress.js');
      return handleProgress(args as Record<string, unknown>);
    }

    // ── Spec → Plan (Phase 2 Block 2.2, 2026-05-05) ──────────────────────
    case 'inkpal_spec_to_plan': {
      const { handleSpec } = await import('./spec.js');
      return handleSpec(args as Record<string, unknown>);
    }

    // ── System validation (interaction layers, not component layers) ──────
    case 'inkpal_validate_system': {
      const { runFullValidation } = await import('./validation.js');
      const report = await runFullValidation();
      // Caller may pass {layers:['determinism','fallback']} to limit response size
      const layers = (args.layers as string[] | undefined) ?? null;
      if (!layers) return report;
      const filtered: Record<string, unknown> = {
        generated_at: report.generated_at,
        duration_ms: report.duration_ms,
        registered_tool_count: report.registered_tool_count,
        summary: report.summary,
      };
      const map: Record<string, unknown> = {
        cross_tool: report.cross_tool, fallback_audit: report.fallback_audit,
        determinism: report.determinism, dependency_graph: report.dependency_graph,
        failure_sim: report.failure_sim, latency: report.latency,
        output_quality: report.output_quality, registry_truth: report.registry_truth,
      };
      for (const k of layers) if (map[k] !== undefined) filtered[k] = map[k];
      return filtered;
    }

    // ── Batch actions (1.0.0 v1, Week 2 Day 12) ───────────────────────────
    // T-DRV-099 — execute up to N tap/scroll/enter_text in a single MCP call.
    // Halves /build wall-clock by collapsing per-action round-trips.
    // Stops on first failure unless {continue_on_error: true}.
    case 'inkpal_batch_actions': {
      const actions = (args.actions as Array<{ tool: string; args: Record<string, unknown> }>) ?? [];
      const continueOnError = args.continue_on_error === true;
      const allowed = new Set([
        'inkpal_tap', 'inkpal_smart_tap', 'inkpal_double_tap',
        'inkpal_scroll', 'inkpal_scroll_to', 'inkpal_drag', 'inkpal_swipe',
        'inkpal_enter_text', 'inkpal_press_key',
        'inkpal_navigate_to_route', 'inkpal_screenshot',
      ]);
      if (!Array.isArray(actions) || actions.length === 0) {
        return { success: false, error: 'no_actions', hint: 'Pass {actions: [{tool: "inkpal_tap", args: {text: "Save"}}, ...]}.', recovery_tool: 'inkpal_tap' };
      }
      if (actions.length > 20) {
        return { success: false, error: 'too_many_actions', count: actions.length, hint: 'Max 20 actions per batch. Split into multiple batches.', recovery_tool: 'inkpal_batch_actions' };
      }
      const results: Array<{ idx: number; tool: string; ok: boolean; output?: unknown; error?: string; duration_ms: number }> = [];
      const t0 = Date.now();
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (!allowed.has(a.tool)) {
          results.push({ idx: i, tool: a.tool, ok: false, error: 'tool_not_in_batch_allowlist', duration_ms: 0 });
          if (!continueOnError) break;
          continue;
        }
        const start = Date.now();
        try {
          const r = await handleLocal(a.tool, a.args ?? {}) as Record<string, unknown> | null;
          const ok = r != null && r.success !== false && !r.error;
          results.push({ idx: i, tool: a.tool, ok, output: r, error: !ok ? (r?.error as string) : undefined, duration_ms: Date.now() - start });
          if (!ok && !continueOnError) break;
        } catch (e) {
          results.push({ idx: i, tool: a.tool, ok: false, error: (e as Error).message, duration_ms: Date.now() - start });
          if (!continueOnError) break;
        }
      }
      return {
        success: results.every(r => r.ok),
        total_duration_ms: Date.now() - t0,
        actions_attempted: results.length,
        actions_succeeded: results.filter(r => r.ok).length,
        results,
      };
    }

    // ── Storage cleanup (1.0.0 v1, Day 5+) ────────────────────────────────
    // Three mechanisms: 24h time-based, 300MB size cap, session-end purge.
    // Auto-runs on chain start (throttled to once per 5 min). This is the
    // manual entry point + the cron's call surface.
    case 'inkpal_cleanup_storage': {
      const { runManualCleanup } = await import('./cleanup.js');
      const proj = (args.project_path as string) || (args.project_path === '' ? '' : p(args));
      return runManualCleanup({
        project_path: proj || undefined,
        force_size_cap: (args.force_size_cap as boolean) ?? false,
        retention_hours: (args.retention_hours as number) ?? 24,
      });
    }

    // ── Department picks (1.0.0 v1, Day 3) ────────────────────────────────
    // Returns ranked tools from the requested department for a given intent.
    // Pure registry query — must be <100ms (Rule 3). INSPECT and VERIFY only
    // at launch; other 9 departments use the meta-tool inkpal_registry.
    case 'inkpal_dept_inspect_pick':
    case 'inkpal_dept_verify_pick': {
      const t0 = Date.now();
      const dept = toolName === 'inkpal_dept_inspect_pick' ? 'INSPECT' : 'VERIFY';
      const intent = (args.intent as string) ?? '';
      const reg = await getRegistry();
      if (!reg) {
        return {
          success: false,
          error: 'registry_unavailable',
          department: dept,
          confidence: 0,
          hint: 'Cannot rank tools without the registry. Chain executor will fall back to legacy tools.',
        };
      }
      const tools = reg.tools.filter(t => t.department === dept);
      if (!tools.length) {
        return { success: false, error: 'empty_department', department: dept };
      }
      // Intent-keyword scoring. Cheap and deterministic.
      const intentLower = intent.toLowerCase();
      const KEYWORDS: Record<string, string[]> = {
        'T-INS-001': ['screenshot', 'capture', 'image', 'visual state', 'see', 'show me'],
        'T-INS-003': ['element', 'tap target', 'button', 'interactive', 'find', 'list controls'],
        'T-INS-005': ['error', 'crash', 'log', 'exception', 'runtime'],
        'T-VER-002': ['visual', 'compare', 'pixel', 'regression', 'baseline', 'verify ui'],
      };
      const ranked = tools.map(t => {
        const keywords = KEYWORDS[t.id] ?? [];
        const hits = keywords.filter(k => intentLower.includes(k)).length;
        const keywordScore = (hits / Math.max(1, keywords.length));
        // Status weighting: WORKING > DEGRADED > others (under investigation,
        // experimental, deprecated all heavily penalised).
        const statusWeight = t.status === 'WORKING' ? 1 : t.status === 'DEGRADED' ? 0.6 : 0.2;
        // Day 7: real-world reliability from contract telemetry. Default 1.0
        // when no measurements yet (v1 launch) so we don't penalise unproven
        // tools out of existence — the contract cron will fill this in within
        // hours of any real traffic.
        const reliability = t.telemetry?.success_rate_30d ?? 1.0;
        const confidence = Math.min(
          1,
          keywordScore * 0.4 + statusWeight * 0.3 + reliability * 0.3,
        );
        const reasonParts = [
          hits > 0 ? `kw ${hits}/${keywords.length}` : 'no kw match',
          `status ${t.status}`,
          t.telemetry?.success_rate_30d != null
            ? `success ${(reliability * 100).toFixed(0)}% (n=${t.telemetry?.calls_30d ?? 0})`
            : 'success n/a',
        ];
        return {
          id: t.id, name: t.name, confidence, reason: reasonParts.join(' + '),
          known_issues: t.known_issues,
        };
      }).sort((a, b) => b.confidence - a.confidence);
      const latency = Date.now() - t0;
      // Rule 3 enforcement (soft) — log if budget blown.
      if (latency > 100) {
        try {
          appendFileSync(
            join(homedir(), '.inkpal', 'sessions', 'latency-violations.jsonl'),
            JSON.stringify({ ts: new Date().toISOString(), tool: toolName, latency, budget: 100 }) + '\n',
          );
        } catch { /* best-effort */ }
      }
      const top = ranked[0];
      return {
        success: true,
        department: dept,
        intent,
        tool: top.id,                                      // top pick
        confidence: top.confidence,
        reason: top.reason,
        ranked,                                            // full ranked list
        latency_ms: latency,
        budget_ms: 100,
        ...(top.known_issues?.length ? { known_issues: top.known_issues } : {}),
      };
    }

    // ── Error intelligence (1.0.0 LOCKDOWN: 5 starter patterns + Railway fetch) ─
    case 'inkpal_lookup_error': {
      // 1.0.0 LOCKDOWN: hard-fail when cloud unreachable. No starter patterns,
      // no fake intelligence. The error DB is moat IP and lives on Railway.
      // See feedback_inkpal_moat_protection.md.
      const t0 = Date.now();
      const query = ((args.error_message || args.error || args.error_text || args.message || args.q) as string) || '';
      if (!query.trim()) {
        return { success: false, error: 'query_required', hint: 'Pass {error_message: "your error message or stack trace"}.' };
      }
      const cloudPack = await fetchRulePack('error_db');
      if (!cloudPack) {
        return {
          success: false,
          error: 'cloud_required',
          hint: 'Error lookup requires the InkPal cloud (the curated DB lives on Railway). Check inkpal.ai/status. Local SDK tools (doctor, launch_app, screenshot) still work.',
          elapsed_ms: Date.now() - t0,
        };
      }
      type Pattern = { code: string; regex: string; category: string; message: string; fixes?: string[] };
      const patterns = cloudPack.rules as Pattern[];
      const matches: Array<Record<string, unknown>> = [];
      for (const pattern of patterns) {
        try {
          const re = new RegExp(pattern.regex, 'i');
          const m = query.match(re);
          if (m) matches.push({ code: pattern.code, message: pattern.message, category: pattern.category, fixes: pattern.fixes ?? [], matched_text: m[0] });
        } catch { /* skip */ }
      }
      return {
        success: true,
        source: `railway:${cloudPack.version}`,
        query_length: query.length,
        matches_count: matches.length,
        matches: matches.slice(0, 5),
        elapsed_ms: Date.now() - t0,
        hint: matches.length === 0
          ? 'No match in your tier\'s pattern set. Try inkpal_search_patterns for the wider catalog.'
          : `Found ${matches.length} match(es).`,
      };
    }

    // ── Project intelligence (1.0.0 LOCKDOWN: cloud-resolved taxonomy) ──
    case 'inkpal_analyze_project': {
      // Proxy reads pubspec + counts dart files locally (cheap I/O), then
      // forwards the pubspec contents to /api/project/analyze for taxonomy
      // resolution. The taxonomy (which packages map to which framework,
      // which packs apply, which platforms detected) is moat IP and lives
      // on Railway. See feedback_inkpal_moat_protection.md.
      const proj = p(args);
      const pubspecPath = join(proj, 'pubspec.yaml');
      if (!existsSync(pubspecPath)) {
        return { success: false, error: 'not_a_flutter_project', message: 'No pubspec.yaml found.', hint: `cd to a Flutter project root or pass project_path arg.` };
      }
      const pubspec_yaml = readFileSync(pubspecPath, 'utf8');

      // Local-only signals (cheap, not moat IP)
      const target_platforms: string[] = [];
      if (existsSync(join(proj, 'ios'))) target_platforms.push('ios');
      if (existsSync(join(proj, 'android'))) target_platforms.push('android');
      if (existsSync(join(proj, 'web'))) target_platforms.push('web');
      if (existsSync(join(proj, 'macos')) || existsSync(join(proj, 'linux')) || existsSync(join(proj, 'windows'))) {
        target_platforms.push('desktop');
      }
      const has_tests = existsSync(join(proj, 'test'));
      let dartFileCount = 0;
      let hasMain = false;
      const libDir = join(proj, 'lib');
      if (existsSync(libDir)) {
        const dartFiles = walkDir(libDir, (n) => n.endsWith('.dart'), 5_000, 5);
        dartFileCount = dartFiles.length;
        hasMain = dartFiles.some((f) => f === join(libDir, 'main.dart'));
      }

      const key = process.env.INKPAL_LICENSE_KEY ?? '';
      if (!key) {
        return {
          success: false,
          error: 'license_required',
          hint: 'Set INKPAL_LICENSE_KEY. Get a free key at https://inkpal.ai/signup.',
          local_signals: { dart_files: dartFileCount, entry_point: hasMain ? 'lib/main.dart' : 'unknown', target_platforms, has_tests },
        };
      }

      const cloud = await callOrchestrationEndpoint(key, '/api/project/analyze', {
        pubspec_yaml,
        target_platforms,
        has_tests,
      });

      if (!cloud.success) {
        return {
          success: false,
          error: (cloud.error as string) ?? 'cloud_error',
          hint: (cloud.hint as string) ?? 'Project analysis requires the InkPal cloud.',
          local_signals: { dart_files: dartFileCount, entry_point: hasMain ? 'lib/main.dart' : 'unknown', target_platforms, has_tests },
        };
      }

      return {
        ...cloud,
        source: 'cloud_taxonomy',
        dart_files: dartFileCount,
        entry_point: hasMain ? 'lib/main.dart' : 'unknown',
      };
    }

    case 'inkpal_check_safety': {
      // 1.0.0 LOCKDOWN: hard-fail on offline. The safety pack (regexes, fix
      // wording, severity weighting) is moat IP and lives on Railway.
      // See feedback_inkpal_moat_protection.md.
      const code = (args.code as string) || '';
      const filePath = (args.file_path as string) || '';
      if (!code && !filePath) {
        return { success: false, error: 'no_input', hint: 'Pass {code: "...source..."} or {file_path: "lib/x.dart"}.' };
      }
      const text = code || (filePath && existsSync(filePath) ? readFileSync(filePath, 'utf8') : '');

      const cloudPack = await fetchRulePack('check_safety');
      if (!cloudPack) {
        return {
          success: false,
          error: 'cloud_required',
          hint: 'Safety audit requires the InkPal cloud (rule pack lives on Railway). Check inkpal.ai/status.',
        };
      }
      const rulesRaw = cloudPack.rules as Array<{ rule: string; severity: string; pattern: string; fix: string }>;
      const RULES = rulesRaw.map(r => ({ ...r, pattern: new RegExp(r.pattern, 'g') }));
      const findings: Array<{ severity: string; rule: string; line: number; match: string; fix: string }> = [];
      const lines = text.split('\n');
      for (const r of RULES) {
        for (const line of lines) {
          const m = line.match(r.pattern);
          if (m) {
            findings.push({ severity: r.severity, rule: r.rule, line: lines.indexOf(line) + 1, match: m[0].slice(0, 80), fix: r.fix });
          }
        }
      }
      return {
        success: true,
        source: `railway:${cloudPack.version}`,
        rules_run: RULES.length,
        findings_count: findings.length,
        critical_count: findings.filter(f => f.severity === 'CRITICAL').length,
        findings: findings.slice(0, 20),
        hint: findings.length === 0 ? 'Clean against the full rule pack.' : `${findings.length} issue(s) found.`,
      };
    }

    // ── Doctor (RUN5: 100% local, never cloud) ────────────────────────────
    case 'inkpal_doctor':
    case 'inkpal_project_doctor': {
      const proj = p(args);
      const checks: Array<{ name: string; ok: boolean; detail?: string; fix?: string }> = [];

      // 1. Flutter SDK on PATH
      const flutterProbe = runChecked('flutter --version', undefined, 5_000);
      checks.push({
        name: 'flutter_sdk',
        ok: flutterProbe.ok,
        detail: flutterProbe.ok ? flutterProbe.stdout.split('\n')[0] : flutterProbe.error,
        fix: flutterProbe.ok ? undefined : 'Install Flutter: https://flutter.dev/docs/get-started/install',
      });

      // 2. Project is a Flutter project
      const pubspecPath = join(proj, 'pubspec.yaml');
      const isFlutter = existsSync(pubspecPath);
      let pubspecText = '';
      if (isFlutter) pubspecText = readFileSync(pubspecPath, 'utf8');
      checks.push({
        name: 'flutter_project',
        ok: isFlutter && /^\s*flutter:/m.test(pubspecText),
        detail: isFlutter ? `pubspec.yaml found at ${pubspecPath}` : 'no pubspec.yaml',
        fix: isFlutter ? undefined : 'cd to a Flutter project root or pass project_path arg.',
      });

      // 3. inkpal_bridge in pubspec
      const hasBridge = /^\s*inkpal_bridge:/m.test(pubspecText);
      checks.push({
        name: 'inkpal_bridge_dep',
        ok: hasBridge,
        detail: hasBridge ? 'inkpal_bridge is in pubspec' : 'inkpal_bridge NOT in pubspec',
        fix: hasBridge ? undefined : 'Run: flutter pub add inkpal_bridge',
      });

      // 4. main.dart wired with inkpalRunApp
      const mainPath = join(proj, 'lib', 'main.dart');
      let mainWired = false;
      if (existsSync(mainPath)) {
        const main = readFileSync(mainPath, 'utf8');
        mainWired = /inkpalRunApp\s*\(/.test(main);
      }
      checks.push({
        name: 'main_dart_wired',
        ok: mainWired,
        detail: mainWired ? 'inkpalRunApp() found in main.dart' : 'main.dart does not call inkpalRunApp()',
        fix: mainWired ? undefined : 'Replace `runApp(MyApp())` with `inkpalRunApp(MyApp())` in lib/main.dart.',
      });

      // 5. License key set in env
      const hasLicenseKey = !!process.env.INKPAL_LICENSE_KEY?.startsWith('ink_');
      checks.push({
        name: 'license_key',
        ok: hasLicenseKey,
        detail: hasLicenseKey ? `License key present (ink_${(process.env.INKPAL_LICENSE_KEY ?? '').slice(4, 8)}…)` : 'INKPAL_LICENSE_KEY env not set or invalid format',
        fix: hasLicenseKey ? undefined : 'Add to your MCP config env: { "INKPAL_LICENSE_KEY": "ink_…" }. Get free key at https://inkpal.ai/pricing',
      });

      // 6. .inkpal/ state dir
      const stateDir = join(proj, '.inkpal');
      checks.push({
        name: 'state_dir',
        ok: existsSync(stateDir),
        detail: existsSync(stateDir) ? `${stateDir} exists` : `will be created on first inkpal_launch_app`,
      });

      // 7. Run-state freshness
      const stateFile = join(stateDir, 'run-state.json');
      let runStateOk = false;
      let runStateDetail = 'no active run';
      if (existsSync(stateFile)) {
        try {
          const state = JSON.parse(readFileSync(stateFile, 'utf8'));
          if (state.pid && isProcessAlive(state.pid)) {
            runStateOk = true;
            runStateDetail = `app running PID ${state.pid}, VM at ${state.vmServiceUri}`;
          } else {
            runStateDetail = `STALE: PID ${state.pid} dead`;
          }
        } catch { runStateDetail = 'corrupt run-state.json'; }
      }
      checks.push({ name: 'flutter_run_alive', ok: runStateOk, detail: runStateDetail });

      // 8. ADB on PATH (informational; iOS doesn't need it)
      const adbProbe = ensureAdb();
      checks.push({
        name: 'adb',
        ok: adbProbe.ok,
        detail: adbProbe.ok ? 'adb on PATH' : 'adb missing (only required for Android targets)',
      });

      // 9. xcrun simctl available (informational; Android doesn't need it)
      const xcrunProbe = runChecked('xcrun --version', undefined, 3_000);
      checks.push({
        name: 'xcrun_simctl',
        ok: xcrunProbe.ok,
        detail: xcrunProbe.ok ? 'Xcode tools present' : 'xcrun missing (only required for iOS Simulator)',
      });

      const failures = checks.filter(c => !c.ok && c.fix).length;
      const warnings = checks.filter(c => !c.ok && !c.fix).length;
      const passes = checks.filter(c => c.ok).length;

      return {
        success: true,
        source: 'local_doctor',
        passes,
        warnings,
        failures,
        total: checks.length,
        checks,
        hint: failures > 0
          ? `${failures} blocker(s) found. Fix the rows with a "fix" field above, then re-run inkpal_doctor.`
          : warnings > 0
            ? `Healthy. ${warnings} non-blocking notice(s).`
            : 'All systems green.',
      };
    }

    case 'inkpal_get_context': {
      // 1.0.0 LOCKDOWN: forwards pubspec + class-name scan to /api/project/analyze.
      // Local widget regex (class extends [Stateful|Stateless|...]Widget) is
      // generic Flutter syntax, not InkPal IP — keeps it client-side. Server
      // does the project taxonomy + audit-pack resolution.
      const proj = p(args);
      const pubspecPath = join(proj, 'pubspec.yaml');
      if (!existsSync(pubspecPath)) {
        return { success: false, error: 'not_a_flutter_project', hint: 'No pubspec.yaml found.' };
      }
      const libDir = join(proj, 'lib');
      const widget_classes: string[] = [];
      const screen_candidates: string[] = [];
      try {
        const all = walkDir(libDir, (n) => n.endsWith('.dart'), 200, 8);
        for (const f of all) {
          try {
            const t = readFileSync(f, 'utf8');
            const matches = t.matchAll(/class\s+(\w+)\s+extends\s+(?:Stateful|Stateless|Hook|Consumer|HookConsumer|ConsumerStateful)Widget/g);
            for (const m of matches) {
              widget_classes.push(m[1]);
              if (/Page|Screen|View$/.test(m[1])) screen_candidates.push(m[1]);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      const target_platforms: string[] = [];
      if (existsSync(join(proj, 'ios'))) target_platforms.push('ios');
      if (existsSync(join(proj, 'android'))) target_platforms.push('android');
      if (existsSync(join(proj, 'web'))) target_platforms.push('web');
      if (existsSync(join(proj, 'macos')) || existsSync(join(proj, 'linux')) || existsSync(join(proj, 'windows'))) {
        target_platforms.push('desktop');
      }
      const has_tests = existsSync(join(proj, 'test'));
      const key = process.env.INKPAL_LICENSE_KEY ?? '';
      if (!key) {
        return { success: false, error: 'license_required', hint: 'Set INKPAL_LICENSE_KEY. Get a free key at https://inkpal.ai/signup.' };
      }
      const cloud = await callOrchestrationEndpoint(key, '/api/project/analyze', {
        pubspec_yaml: readFileSync(pubspecPath, 'utf8'),
        target_platforms,
        has_tests,
        widget_surface: { widget_classes, screen_candidates },
      });
      if (!cloud.success) {
        return { success: false, error: cloud.error ?? 'cloud_error', hint: cloud.hint ?? 'Project context requires the InkPal cloud.' };
      }
      return { ...cloud, source: 'cloud_context' };
    }

    case 'inkpal_get_design_system': {
      // 1.0.0 LOCKDOWN: bridge-only. Runtime extraction via inkpal_bridge VM
      // service is stronger and centralizes the intelligence. The previous
      // local file regex scan duplicated the bridge VM extension and shipped
      // design-token taxonomy in the npm tarball. Removed.
      const proj = p(args);
      const pubspecPath = join(proj, 'pubspec.yaml');
      const hasBridge = existsSync(pubspecPath) && /^\s*inkpal_bridge:/m.test(readFileSync(pubspecPath, 'utf8'));
      if (!hasBridge) {
        return {
          success: false,
          error: 'bridge_required',
          hint: 'Design system extraction needs inkpal_bridge in pubspec. Run: flutter pub add inkpal_bridge — get a free key at https://inkpal.ai/signup.',
        };
      }
      if (!isBridgeListening(8765)) {
        return {
          success: false,
          error: 'bridge_not_running',
          hint: 'Bridge is in pubspec but the app is not running. Start it with: inkpal_launch_app',
        };
      }
      // Forward to cloud which talks to the running bridge over WS.
      const key = process.env.INKPAL_LICENSE_KEY ?? '';
      if (!key) {
        return { success: false, error: 'license_required', hint: 'Set INKPAL_LICENSE_KEY.' };
      }
      const cloud = await callOrchestrationEndpoint(key, '/api/project/analyze', {
        pubspec_yaml: readFileSync(pubspecPath, 'utf8'),
        request_design_system: true,
      });
      if (!cloud.success) {
        return { success: false, error: cloud.error ?? 'cloud_error', hint: cloud.hint ?? 'Design system extraction requires the InkPal cloud + a running bridge.' };
      }
      return { ...cloud, source: 'cloud+bridge' };
    }

    case 'inkpal_check_package': {
      // Direct pub.dev API call — never goes through Railway.
      const pkg = ((args.package || args.package_name || args.name) as string)?.trim();
      if (!pkg) return { success: false, error: 'package_required', hint: 'Pass {package: "go_router"}.' };
      try {
        const r = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(pkg)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 404) return { success: false, exists: false, package: pkg, hint: `Package "${pkg}" not found on pub.dev.` };
        if (!r.ok) return { success: false, error: `pub_dev_${r.status}`, package: pkg };
        const data = await r.json() as { latest?: { version?: string; pubspec?: Record<string, unknown> }; name?: string };
        const latest = data.latest;
        return {
          success: true,
          source: 'pub_dev',
          exists: true,
          package: pkg,
          latest_version: latest?.version,
          description: (latest?.pubspec?.description as string)?.slice(0, 200),
          homepage: latest?.pubspec?.homepage,
          repository: latest?.pubspec?.repository,
          dart_sdk: (latest?.pubspec?.environment as Record<string, unknown>)?.sdk,
        };
      } catch (e) {
        return { success: false, error: 'pub_dev_unreachable', package: pkg, detail: (e as Error).message };
      }
    }

    case 'inkpal_pub_dev_search': {
      // Direct pub.dev search — never goes through Railway.
      const query = ((args.query || args.q) as string)?.trim();
      if (!query) return { success: false, error: 'query_required', hint: 'Pass {query: "state management"}.' };
      const limit = Math.min((args.limit as number) || 8, 20);
      const includeMetrics = args.include_metrics !== false; // default on
      try {
        const r = await fetch(`https://pub.dev/api/search?q=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return { success: false, error: `pub_dev_${r.status}` };
        const data = await r.json() as { packages?: Array<{ package: string }>; next?: string };
        const names = (data.packages || []).slice(0, limit).map(p => p.package);
        // RUN7 B-006 fix: docstring promised pub points/likes/popularity. Fetch
        // the per-package score endpoint in parallel so the caller can rank.
        let packages: Array<string | Record<string, unknown>> = names;
        if (includeMetrics && names.length) {
          const metrics = await Promise.allSettled(names.map(async (name) => {
            try {
              const sr = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(name)}/score`, {
                signal: AbortSignal.timeout(4000),
              });
              if (!sr.ok) return { name };
              const s = await sr.json() as { grantedPoints?: number; maxPoints?: number; likeCount?: number; popularityScore?: number };
              return {
                name,
                pub_points: s.grantedPoints != null && s.maxPoints != null ? `${s.grantedPoints}/${s.maxPoints}` : undefined,
                likes: s.likeCount,
                popularity: s.popularityScore != null ? Math.round(s.popularityScore * 100) : undefined,
              };
            } catch { return { name }; }
          }));
          packages = metrics.map(m => m.status === 'fulfilled' ? m.value : { name: 'unknown' });
        }
        return {
          success: true,
          source: 'pub_dev',
          query,
          total_returned: names.length,
          packages,
          hint: names.length === 0
            ? `No packages match "${query}".`
            : `Top ${names.length} ranked by relevance. ${includeMetrics ? 'Score: pub_points/likes/popularity included.' : 'Pass include_metrics:true for scores.'}`,
        };
      } catch (e) {
        return { success: false, error: 'pub_dev_unreachable', detail: (e as Error).message };
      }
    }

    case 'inkpal_get_blast_radius': {
      // Local: parse `import` statements across lib/ to compute reverse dep graph.
      const proj = p(args);
      const targetFile = ((args.file || args.file_path || args.path) as string) || '';
      if (!targetFile) return { success: false, error: 'file_required', hint: 'Pass {file: "lib/main.dart"}.' };
      const target = targetFile.startsWith('/') ? targetFile : join(proj, targetFile);
      if (!existsSync(target)) return { success: false, error: 'file_not_found', file: target };
      // Compute base import name (filename without ext, lowercase)
      const baseName = target.split('/').pop()?.replace(/\.dart$/, '') || '';
      const libDir = join(proj, 'lib');
      const importers: string[] = [];
      try {
        const all = walkDir(libDir, (n) => n.endsWith('.dart'), 5_000, 8);
        for (const f of all) {
          if (f === target) continue;
          try {
            const t = readFileSync(f, 'utf8');
            // Match either `import 'package:...<basename>.dart'` or relative imports
            const re = new RegExp(`import\\s+['"](?:[^'"\\n]*/)?${baseName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\.dart['"]`, 'm');
            if (re.test(t)) importers.push(f.replace(proj + '/', ''));
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return {
        success: true,
        source: 'local_import_graph',
        target_file: targetFile,
        importer_count: importers.length,
        importers: importers.slice(0, 50),
        hint: importers.length === 0
          ? `No other lib/ files import this. Safe to change.`
          : `${importers.length} file(s) import this. Review before breaking-change refactor.`,
      };
    }

    case 'inkpal_audit_ui':
    case 'inkpal_accessibility_audit': {
      // 1.0.0 LOCKDOWN: cloud-resolved orchestration. The proxy:
      //   1) reads pubspec + detects target_platforms (cheap I/O)
      //   2) POSTs context+intent to /api/rules/resolve?include_rules=true
      //   3) gets back a flat MergedRule[] from the server-side engine
      //   4) line-scans local .dart files against that flat list
      // No local rule taxonomy, no STARTER fallbacks. All orchestration cloud-side.
      // See feedback_inkpal_moat_protection.md.
      const auditT0 = Date.now();
      const proj = p(args);
      const targetFile = ((args.file || args.file_path || args.path) as string) || '';
      const isA11y = toolName === 'inkpal_accessibility_audit';

      const files: string[] = [];
      if (targetFile) {
        const t = targetFile.startsWith('/') ? targetFile : join(proj, targetFile);
        if (!existsSync(t)) return { success: false, error: 'file_not_found', file: t };
        files.push(t);
      } else {
        const libDir = join(proj, 'lib');
        if (!existsSync(libDir)) return { success: false, error: 'no_lib_dir', hint: 'Pass {file: "lib/foo.dart"} or run from a Flutter project root.' };
        files.push(...walkDir(libDir, (n) => n.endsWith('.dart'), 200, 8));
      }

      // Build engine context client-side from cheap signals only — no taxonomy.
      // The server enriches missing fields from pubspec if needed.
      const target_platforms: ('ios' | 'android' | 'web' | 'desktop')[] = [];
      if (existsSync(join(proj, 'ios'))) target_platforms.push('ios');
      if (existsSync(join(proj, 'android'))) target_platforms.push('android');
      if (existsSync(join(proj, 'web'))) target_platforms.push('web');
      if (existsSync(join(proj, 'macos')) || existsSync(join(proj, 'linux')) || existsSync(join(proj, 'windows'))) {
        target_platforms.push('desktop');
      }
      const has_tests = existsSync(join(proj, 'test'));

      // Fetch resolution + flat rule list from the server (single round trip).
      const key = process.env.INKPAL_LICENSE_KEY ?? '';
      if (!key) {
        return { success: false, error: 'license_required', hint: 'Set INKPAL_LICENSE_KEY. Free 24h Pro trial at https://inkpal.ai/signup.' };
      }
      const ctxBody = {
        ctx: {
          state_management: 'none', navigation: 'imperative',
          has_localization: false, has_network: false, has_tests,
          target_platforms: target_platforms.length ? target_platforms : ['android'],
        },
        intent: isA11y ? 'accessibility_audit' : 'audit',
        include_rules: true,
      };
      const cloud = await callOrchestrationEndpoint(key, '/api/rules/resolve', ctxBody);
      if (!cloud.success || !Array.isArray(cloud.rules)) {
        return {
          success: false,
          error: cloud.error ?? 'cloud_required',
          hint: cloud.hint ?? `${isA11y ? 'Accessibility' : 'UI'} audit requires the InkPal cloud. Check inkpal.ai/status.`,
          elapsed_ms: Date.now() - auditT0,
        };
      }

      const RULES = (cloud.rules as Array<{ rule: string; severity: string; pattern: string; message: string; source_pack: string; file_target?: string }>)
        .filter(r => r.pattern && !r.file_target)
        .map(r => ({ rule: r.rule, severity: r.severity, message: r.message, source_pack: r.source_pack, re: new RegExp(r.pattern, 'm') }));

      const findings: Array<{ file: string; line: number; severity: string; rule: string; message: string; source_pack: string }> = [];
      for (const f of files) {
        let src: string;
        try { src = readFileSync(f, 'utf8'); } catch { continue; }
        const lines = src.split('\n');
        const rel = f.replace(proj + '/', '');
        for (let i = 0; i < lines.length; i++) {
          for (const r of RULES) {
            if (r.re.test(lines[i])) {
              findings.push({ file: rel, line: i + 1, severity: r.severity, rule: r.rule, message: r.message, source_pack: r.source_pack });
            }
          }
        }
      }

      const sev = (s: string) => s === 'serious' || s === 'error' ? 10 : s === 'moderate' || s === 'warning' ? 5 : 1;
      const score = Math.max(0, 100 - findings.reduce((acc, f) => acc + sev(f.severity), 0));
      const resolution = cloud.resolution as { loaded: string[]; excluded: { pack: string; reason: string }[] } | undefined;
      return {
        success: true,
        source: `railway:engine`,
        engine_version: cloud.engine_version,
        policy_version: cloud.policy_version,
        scope: targetFile || 'lib/',
        files_scanned: files.length,
        rules_run: RULES.length,
        findings_count: findings.length,
        score,
        findings: findings.slice(0, 100),
        engine: resolution ? {
          packs_loaded: resolution.loaded,
          packs_excluded: resolution.excluded,
          context_summary: cloud.context_summary,
        } : null,
        elapsed_ms: Date.now() - auditT0,
        hint: findings.length === 0 ? 'Clean against the resolved rule packs.' : `${findings.length} finding(s).`,
      };
    }

    // ── Flutter CLI ──────────────────────────────────────────────────────
    case 'inkpal_flutter_analyze': {
      const out = run('dart analyze', p(args));
      const errs = out.split('\n').filter(l => l.includes('error •') || l.includes('warning •'));
      return { output: out, errorCount: errs.length, errors: errs };
    }

    case 'inkpal_flutter_test': {
      const proj = p(args);
      const parts: string[] = ['flutter', 'test'];
      if (args.test_file) parts.push(args.test_file as string);
      if (args.name_filter) parts.push(`--name "${args.name_filter}"`);
      if (args.coverage) parts.push('--coverage');

      const out = run(parts.join(' '), proj, 300_000); // 5min timeout for tests

      // B-008 fix: Flutter test output is "00:01 +5 -1: Some tests failed."
      // or "00:01 +5: All tests passed!". The previous parser used non-global
      // \+(\d+) which matched the FIRST progress line ("+1") not the final
      // tally, so 5 passing tests reported as total:1 (or worse: total:0 when
      // "X tests passed" wording wasn't used). Now: prefer the canonical
      // "All tests passed!" / "Some tests failed." lines, fall back to the
      // LAST \+N in the stream which is the final count.
      const allPassMatch = out.match(/\+(\d+)\s*:\s*All tests passed/i);
      const someFailedMatch = out.match(/\+(\d+)\s+-(\d+)\s*:\s*Some tests failed/i);
      let passed = 0;
      let failed = 0;
      if (allPassMatch) {
        passed = parseInt(allPassMatch[1]);
      } else if (someFailedMatch) {
        passed = parseInt(someFailedMatch[1]);
        failed = parseInt(someFailedMatch[2]);
      } else {
        // Fallback: explicit "N tests passed" / "N tests failed" wording.
        const passWord = out.match(/(\d+) tests? passed/i);
        const failWord = out.match(/(\d+) tests? failed/i);
        if (passWord) passed = parseInt(passWord[1]);
        if (failWord) failed = parseInt(failWord[1]);
        // Final fallback: last \+N \-N pair in the stream (final progress line).
        if (passed === 0 && failed === 0) {
          const allPlus = [...out.matchAll(/\+(\d+)/g)];
          const allMinus = [...out.matchAll(/-(\d+)/g)];
          if (allPlus.length) passed = parseInt(allPlus[allPlus.length - 1][1]);
          if (allMinus.length) failed = parseInt(allMinus[allMinus.length - 1][1]);
        }
      }

      // Extract failure blocks
      const failures = [...out.matchAll(/(?:FAILED|EXCEPTION)[\s\S]*?(?=\n\n|\n[+\-]|$)/gi)]
        .map(m => m[0].trim()).slice(0, 10);

      // 1.0.0 LOCKDOWN: test-quality enrichment is cloud-resolved.
      // Best-effort; failures here don't block the test run.
      let test_quality: Record<string, unknown> | null = null;
      try {
        const testDir = join(proj, 'test');
        const key = process.env.INKPAL_LICENSE_KEY ?? '';
        if (existsSync(testDir) && key) {
          const cloud = await callOrchestrationEndpoint(key, '/api/rules/resolve', {
            ctx: {
              state_management: 'none', navigation: 'imperative',
              has_localization: false, has_network: false, has_tests: true,
              target_platforms: ['android'],
            },
            intent: 'test',
            include_rules: true,
          });
          if (cloud.success && Array.isArray(cloud.rules) && cloud.rules.length > 0) {
            const RULES = (cloud.rules as Array<{ rule: string; severity: string; pattern: string; message: string; source_pack: string; file_target?: string }>)
              .filter(r => r.pattern && !r.file_target)
              .map(r => ({ rule: r.rule, severity: r.severity, message: r.message, source_pack: r.source_pack, re: new RegExp(r.pattern, 'm') }));
            const findings: Array<{ file: string; line: number; severity: string; rule: string; message: string; source_pack: string }> = [];
            const testFiles = walkDir(testDir, (n) => n.endsWith('_test.dart'), 100, 8);
            for (const f of testFiles) {
              let src = '';
              try { src = readFileSync(f, 'utf8'); } catch { continue; }
              const lines = src.split('\n');
              const rel = f.replace(proj + '/', '');
              for (let i = 0; i < lines.length; i++) {
                for (const r of RULES) if (r.re.test(lines[i])) {
                  findings.push({ file: rel, line: i + 1, severity: r.severity, rule: r.rule, message: r.message, source_pack: r.source_pack });
                }
              }
            }
            const resolution = cloud.resolution as { loaded: string[] } | undefined;
            test_quality = {
              packs_loaded: resolution?.loaded ?? [],
              files_scanned: testFiles.length,
              findings_count: findings.length,
              findings: findings.slice(0, 50),
            };
          }
        }
      } catch { /* enrichment best-effort, never blocks the test run */ }

      return { passed, failed, total: passed + failed, failures, output: out, ...(test_quality ? { test_quality } : {}) };
    }

    case 'inkpal_flutter_build': {
      // RUN6 B-009 fix: detect missing platform scaffolding before invoking
      // flutter, return a structured envelope so callers can recover instead
      // of getting raw stdout like "Missing index.html.\n".
      const proj = p(args);
      const platform = (args.platform as string) || (args.target as string) || 'apk';
      const mode = (args.mode as string) || 'release';
      const platformDir: Record<string, string> = {
        apk: 'android', appbundle: 'android', aab: 'android',
        ios: 'ios', ipa: 'ios',
        web: 'web',
        macos: 'macos', windows: 'windows', linux: 'linux',
      };
      const dir = platformDir[platform];
      if (dir && !existsSync(join(proj, dir))) {
        return {
          success: false,
          error: 'no_platform_scaffolding',
          platform,
          missing_dir: dir,
          hint: `Project has no ${dir}/ directory. Add the platform: \`flutter create . --platforms=${dir.replace('android','android').replace('ios','ios').replace('web','web')}\``,
          recovery_command: `flutter create . --platforms=${dir === 'android' ? 'android' : dir === 'ios' ? 'ios' : dir}`,
          next_tool: 'inkpal_flutter_build',
        };
      }
      const r = runChecked(`flutter build ${platform} --${mode}`, proj, 600_000);
      if (r.ok) {
        return { success: true, platform, mode, output: r.stdout.trim() };
      }
      const stderr = (r.stderr || '').trim();
      const stdout = (r.stdout || '').trim();
      const combined = `${stdout}\n${stderr}`;
      let hint = `Run \`flutter build ${platform} --${mode}\` manually for the full diagnostic output.`;
      if (/Missing index\.html/i.test(combined)) hint = `Missing web/ scaffold. Run: flutter create . --platforms=web`;
      else if (/Xcode|CocoaPods/i.test(combined)) hint = 'iOS build failed — open ios/Runner.xcworkspace in Xcode for the full error.';
      else if (/Gradle/i.test(combined)) hint = 'Android Gradle build failed — check android/app/build.gradle and SDK versions.';
      return {
        success: false,
        error: 'build_failed',
        platform,
        mode,
        stdout,
        stderr: stderr || r.error,
        hint,
      };
    }

    case 'inkpal_create_project': {
      const name = (args.name as string) || (args.project_name as string) || 'my_app';
      const org = (args.org as string) || 'com.example';
      const template = (args.template as string) || 'app';
      return { output: run(`flutter create --template ${template} --org ${org} ${name}`, p(args)) };
    }

    case 'inkpal_dart_fix': {
      // Validation harness Layer 7 finding: was returning {output: "..."} only
      // (1 field, "likely raw stdout"). Now structured: success bit, modeflag,
      // parsed counts so chain executors + LLM can branch.
      const dryRun = args.dry_run === true;
      const out = run(`dart fix ${dryRun ? '--dry-run' : '--apply'}`, p(args));
      const nothing = /Nothing to fix!/i.test(out);
      const fixedMatch = out.match(/(\d+)\s+fix(?:es)?\s+made/i);
      const fixCount = fixedMatch ? parseInt(fixedMatch[1], 10) : 0;
      return {
        success: true,
        mode: dryRun ? 'dry_run' : 'apply',
        nothing_to_fix: nothing,
        fixes_applied: dryRun ? 0 : fixCount,
        output: out,
        hint: nothing
          ? 'Already clean.'
          : (dryRun ? `${fixCount || 'unknown'} fixes available — re-run with dry_run:false to apply.` : `${fixCount} fix(es) applied.`),
      };
    }

    case 'inkpal_coverage_report': {
      const proj = p(args);
      const out = run('flutter test --coverage', proj, 300_000);
      const lcovPath = join(proj, 'coverage', 'lcov.info');
      if (!existsSync(lcovPath)) return { output: out, error: 'No coverage/lcov.info generated' };
      const lcov = readFileSync(lcovPath, 'utf8');
      const files: Array<{ file: string; lines: number; hit: number; pct: string }> = [];
      let currentFile = '';
      let lines = 0, hit = 0;
      for (const line of lcov.split('\n')) {
        if (line.startsWith('SF:')) { currentFile = line.slice(3); lines = 0; hit = 0; }
        else if (line.startsWith('LF:')) lines = parseInt(line.slice(3));
        else if (line.startsWith('LH:')) hit = parseInt(line.slice(3));
        else if (line === 'end_of_record' && currentFile) {
          files.push({ file: currentFile, lines, hit, pct: lines ? `${((hit/lines)*100).toFixed(1)}%` : '0%' });
        }
      }
      const totalLines = files.reduce((s, f) => s + f.lines, 0);
      const totalHit = files.reduce((s, f) => s + f.hit, 0);
      return { coverage: totalLines ? `${((totalHit/totalLines)*100).toFixed(1)}%` : '0%', files, output: out };
    }

    case 'inkpal_coverage_gaps': {
      const proj = p(args);
      const lcovPath = join(proj, 'coverage', 'lcov.info');
      if (!existsSync(lcovPath)) return { error: 'Run inkpal_coverage_report first to generate coverage data' };
      const lcov = readFileSync(lcovPath, 'utf8');
      const gaps: Array<{ file: string; uncoveredLines: number[] }> = [];
      let currentFile = '';
      let uncovered: number[] = [];
      for (const line of lcov.split('\n')) {
        if (line.startsWith('SF:')) { currentFile = line.slice(3); uncovered = []; }
        else if (line.startsWith('DA:')) {
          const [ln, cnt] = line.slice(3).split(',').map(Number);
          if (cnt === 0) uncovered.push(ln);
        }
        else if (line === 'end_of_record' && uncovered.length) {
          gaps.push({ file: currentFile, uncoveredLines: uncovered });
        }
      }
      return { gaps, totalUncoveredFiles: gaps.length };
    }

    // ── Device ───────────────────────────────────────────────────────────
    case 'inkpal_list_devices': {
      const out = run('flutter devices --machine');
      let devices: unknown[] = [];
      try { devices = JSON.parse(out); } catch { return { output: out }; }

      // B-011 fix: only claim bridge_port_forwarded:true when adb actually
      // succeeded. Previous code reported true even when adb was missing
      // because run() returned the shell error string in place of stdout.
      const hasEmulator = Array.isArray(devices) && devices.some(
        (d: unknown) => (d as Record<string, unknown>)?.emulator === true
          || String((d as Record<string, unknown>)?.id ?? '').startsWith('emulator-')
      );
      let bridgePortInfo: Record<string, unknown> = {};
      if (hasEmulator) {
        const adbProbe = ensureAdb();
        if (adbProbe.ok) {
          const fwd = runChecked('adb forward tcp:8765 tcp:8765', undefined, 5_000);
          bridgePortInfo = fwd.ok
            ? { bridge_port_forwarded: true, port_forward_output: fwd.stdout.trim() }
            : { bridge_port_forwarded: false, port_forward_error: fwd.error ?? fwd.stderr.trim() };
        } else {
          bridgePortInfo = { bridge_port_forwarded: false, port_forward_error: adbProbe.error };
        }
      }

      return { devices, ...bridgePortInfo };
    }

    case 'inkpal_devices_discover': {
      // B-012 fix: discover should reach further than list. Combines:
      //   - flutter devices --machine (same as list)
      //   - adb devices -l (raw adb view, includes USB devices flutter may miss)
      //   - xcrun simctl list devices booted (booted iOS simulators)
      //   - xcrun xctrace list devices (physical iOS devices via Xcode)
      const flutterRaw = run('flutter devices --machine');
      let flutterDevices: unknown[] = [];
      try { flutterDevices = JSON.parse(flutterRaw); } catch { /* parse fail */ }

      const sources: Record<string, unknown> = { flutter: flutterDevices };

      const adbProbe = ensureAdb();
      if (adbProbe.ok) {
        const adb = runChecked('adb devices -l', undefined, 5_000);
        if (adb.ok) {
          const adbDevices = adb.stdout.split('\n')
            .filter(l => l.trim() && !l.startsWith('List of'))
            .map(l => {
              const parts = l.trim().split(/\s+/);
              return { id: parts[0], state: parts[1], descriptor: parts.slice(2).join(' ') };
            });
          sources.adb = adbDevices;
        } else {
          sources.adb_error = adb.error ?? adb.stderr.trim();
        }
      } else {
        sources.adb_error = adbProbe.error;
      }

      const simBooted = runChecked(`xcrun simctl list devices booted -j`, undefined, 5_000);
      if (simBooted.ok) {
        try { sources.ios_simulators_booted = JSON.parse(simBooted.stdout); }
        catch { sources.ios_simulators_booted_raw = simBooted.stdout.trim(); }
      }
      const xcDevices = runChecked('xcrun xctrace list devices 2>&1', undefined, 5_000);
      if (xcDevices.ok) {
        const physical = xcDevices.stdout.split('\n')
          .filter(l => /\([\dA-F-]+\)\s+\([\dA-F-]+\)/i.test(l))
          .slice(0, 10);
        if (physical.length) sources.ios_physical = physical;
      }

      // De-dupe across sources by id for the convenience field
      const allIds = new Set<string>();
      for (const d of flutterDevices) {
        const id = (d as Record<string, unknown>)?.id;
        if (typeof id === 'string') allIds.add(id);
      }
      if (Array.isArray(sources.adb)) {
        for (const d of sources.adb as Array<{id: string}>) allIds.add(d.id);
      }

      return {
        success: true,
        unique_device_count: allIds.size,
        unique_ids: [...allIds],
        sources,
        hint: Object.keys(sources).length > 1
          ? 'Discovered via flutter, adb, and xcrun simctl/xctrace.'
          : 'Only flutter devices reachable. Install adb / xcode-select for fuller discovery.',
      };
    }

    case 'inkpal_device_info':
      return { output: run(`flutter devices ${((args.device_id as string) || '').trim()}`) };

    // ── App lifecycle ────────────────────────────────────────────────────
    case 'inkpal_launch_app': {
      // B-102 / RUN2 root cause: previous impl had 5 bugs piled together —
      //   1. execSync('sleep 1') busy-loop blocked Node event loop, so the
      //      stdout 'data' handler couldn't update vmUri while we slept.
      //   2. Only watched app.debugPort, missed canonical app.started event.
      //   3. text.split('\n').map(JSON.parse) discarded entire chunk on any
      //      partial-line parse fail (real Flutter --machine output buffers).
      //   4. 30s loop vs 120s timeout — declared failure 90s early.
      //   5. Stderr never scanned for VM URI fallback.
      // This rewrite is fully async, buffers stdout properly, watches both
      // canonical events, scans stderr too, and times out at the requested
      // duration (default 300s = 5 min — Xcode + first-build can take 90s).
      return await launchAppProperly(args);
    }

    case 'inkpal_hot_reload':
    case 'inkpal_hot_restart': {
      const proj = p(args);
      // Three discovery paths (B-110 cascade fix): explicit arg → run-state → log scrape
      const vmUri = (args.vm_service_uri as string) || getVmServiceUri(proj);
      if (!vmUri) {
        return {
          success: false,
          error: 'no_vm_service_uri',
          message: 'No running app found and no VM Service URI provided.',
          next_tool: 'inkpal_launch_app',
          next_tool_args_hint: { project_path: proj },
          hint: 'Either: (a) call inkpal_launch_app first, OR (b) pass vm_service_uri explicitly (copy from `flutter run` output line "A Dart VM Service ... is available at: ...").',
        };
      }
      const method = toolName === 'inkpal_hot_restart' ? 'hotRestart' : 'hotReload';
      // RUN6 B-012 fix: resolve isolate id, call _flutter.<method> with isolateId,
      // parse the JSON-RPC envelope. Previous code called the method with no
      // isolateId and reported success=true while the VM returned -32601.
      try {
        const isolateId = await getFlutterIsolateId(vmUri);
        if (!isolateId) {
          return {
            success: false,
            error: 'no_isolate',
            method,
            vm_service_uri: vmUri,
            hint: 'getVM returned no isolates — the app may not have started or the VM is shutting down.',
            next_tool: 'inkpal_launch_app',
          };
        }
        const r = await vmServiceCall(vmUri, `_flutter.${method}`, { isolateId }, 30_000);
        if (!r.ok) {
          return {
            success: false,
            error: 'reload_failed',
            method,
            vm_service_uri: vmUri,
            isolate_id: isolateId,
            jsonrpc_error: r.error,
            hint: r.error?.code === -32601
              ? 'Hot reload extension not registered. App was likely launched without `flutter run` (e.g. raw Xcode/Android Studio launch). Use inkpal_launch_app to relaunch.'
              : 'VM service rejected the reload. App may have crashed or the isolate was paused.',
            next_tool: 'inkpal_launch_app',
          };
        }
        const result = r.result as { type?: string; success?: boolean; notices?: unknown[] } | undefined;
        if (result?.success === false) {
          return {
            success: false,
            error: 'reload_rejected',
            method,
            vm_service_uri: vmUri,
            isolate_id: isolateId,
            details: result,
            hint: 'Reload completed but the runtime rejected the new sources (compile or shape error). Check `notices` for specifics.',
          };
        }
        return {
          success: true,
          method,
          vm_service_uri: vmUri,
          isolate_id: isolateId,
          result,
        };
      } catch (e) {
        return { success: false, error: String((e as Error)?.message ?? e), method };
      }
    }

    case 'inkpal_screenshot': {
      // D3 cluster-3: was hard-coded to adb default. Now: detect platform,
      // pick the right tool, validate the captured PNG (B-001 contract).
      const proj = p(args);
      const out = (args.output_path as string) || '/tmp/inkpal_screenshot.png';
      const dev = (args.device_id as string) || '';
      let method = (args.method as string) || '';

      if (!method) {
        const platform = detectPlatform({ ...args, device: dev || (args as Record<string, unknown>).device }, proj);
        if (platform === 'ios') method = 'simctl';
        else if (platform === 'android') method = 'adb';
        else {
          // Auto-probe: prefer iOS sim if booted, otherwise adb
          const simBooted = runChecked(`xcrun simctl list devices booted -j 2>/dev/null`, undefined, 3_000);
          if (simBooted.ok && simBooted.stdout.includes('"state" : "Booted"')) method = 'simctl';
          else method = 'adb';
        }
      }

      let r: { ok: boolean; stdout: string; stderr: string; error?: string };
      if (method === 'simctl') {
        r = runChecked(`xcrun simctl io "${dev || 'booted'}" screenshot "${out}"`, undefined, 30_000);
      } else if (method === 'adb') {
        const adbProbe = ensureAdb();
        if (!adbProbe.ok) return adbProbe;
        r = runChecked(`adb exec-out screencap -p > "${out}"`, undefined, 30_000);
      } else if (method === 'flutter') {
        r = runChecked(`flutter screenshot --out "${out}"`, proj, 30_000);
      } else {
        return { success: false, error: 'unknown_method', method, hint: 'Use method:"simctl"|"adb"|"flutter".' };
      }

      if (!r.ok) {
        return {
          success: false,
          method,
          path: out,
          error: r.error ?? r.stderr.trim(),
          hint: method === 'adb' ? 'Verify a device is connected with `adb devices`.' :
                method === 'simctl' ? 'Verify the iOS Simulator is booted: `xcrun simctl list devices booted`.' :
                'Verify a `flutter run` session is active in another terminal.',
        };
      }

      // PNG validation (B-001 contract)
      if (!existsSync(out)) return { success: false, method, path: out, error: 'no_file_written' };
      const stats = statSync(out);
      if (stats.size === 0) {
        return {
          success: false,
          method,
          path: out,
          bytes: 0,
          error: 'screenshot_zero_bytes',
          hint: method === 'adb' ? 'ADB returned 0 bytes — device locked or secure-screen overlay.' :
                method === 'simctl' ? 'simctl returned empty file — try shutting down + booting the simulator.' :
                'flutter screenshot returned empty — verify the running app is in the foreground.',
        };
      }
      try {
        const head = readFileSync(out, { flag: 'r' }).subarray(0, 8);
        const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (!head.equals(PNG_SIG)) {
          return { success: false, method, path: out, bytes: stats.size, error: 'not_a_png', hint: 'File written but missing PNG signature. Capture command may have piped error text.' };
        }
      } catch { /* skip — file readable check already passed */ }
      return { success: true, method, path: out, bytes: stats.size };
    }

    case 'inkpal_get_runtime_errors':
    case 'inkpal_get_app_logs': {
      // D3 cluster-3 fix: was hard-coded to `adb logcat`. iOS-only hosts hit
      // "adb: command not found" with no fallback. Now branches by platform.
      const proj = p(args);
      const platform = detectPlatform(args, proj);
      const lines = (args.lines as number) || (args.last_n as number) || 100;
      const filter = (args.filter as string) || 'flutter|dart|error|exception|crash';

      if (platform === 'ios' || platform === 'unknown') {
        // Try iOS path first when platform is unknown (cheap probe).
        const sim = runChecked(`xcrun simctl list devices booted -j 2>/dev/null`, undefined, 3_000);
        if (sim.ok && sim.stdout.includes('"state" : "Booted"')) {
          const udid = ((args.device || args.device_id) as string) || 'booted';
          const r = runChecked(
            `xcrun simctl spawn ${udid} log show --last 5m --predicate 'processImagePath contains "Runner" OR senderImagePath contains "Flutter"' 2>/dev/null | grep -iE "${filter}" | tail -${lines}`,
            undefined, 10_000,
          );
          if (r.ok || r.stdout.length > 0) {
            const logLines = r.stdout.split('\n').filter(Boolean);
            return { lines: logLines, count: logLines.length, source: 'ios_simctl_log', platform: 'ios' };
          }
        }
        if (platform === 'ios') {
          return {
            success: false,
            error: 'no_ios_simulator_booted',
            platform: 'ios',
            hint: 'Boot the iOS Simulator: `xcrun simctl boot <UDID>` or open Simulator.app, then retry.',
            next_tool: 'inkpal_devices_list',
          };
        }
      }

      // Android (or unknown that fell through iOS check)
      const adbProbe = ensureAdb();
      if (!adbProbe.ok) {
        return {
          success: false,
          error: 'no_log_source_available',
          message: 'No iOS Simulator booted and adb not installed for Android logs.',
          hint: 'Either boot an iOS Simulator OR install Android platform-tools.',
          install_command: 'brew install android-platform-tools',
          platform_attempted: ['ios', 'android'],
        };
      }
      const r = runChecked(`adb logcat -d -t ${lines} | grep -iE "${filter}"`, undefined, 10_000);
      const logLines = r.stdout.split('\n').filter(Boolean);
      return { lines: logLines, count: logLines.length, source: 'android_logcat', platform: 'android', ...(r.ok ? {} : { warning: r.error }) };
    }

    case 'inkpal_navigate_to_route': {
      const proj = p(args);
      const route = (args.route as string) || '';
      if (!route.trim()) {
        return {
          success: false,
          error: 'route_required',
          hint: 'Pass {route: "/home"} or any route registered in your router.',
          next_tool: 'inkpal_get_design_system',
          nextSteps: ['Use inkpal_get_design_system to list available routes', 'Then call again with the route arg'],
        };
      }
      const platform = detectPlatform(args, proj);

      // D3 cluster-3 fix: bridge-first dispatch. When the bridge is reachable,
      // navigate via VM Service `ext.flutter.inkpal.navigate` regardless of
      // platform — it's faster and more reliable than the OS-level deep link.
      if (isBridgeListening()) {
        return {
          forward_remote: true,
          tool: 'inkpal_navigate_to_route',
          args: { ...args, project_path: proj, _via: 'bridge' },
          note: 'Routing through Railway → bridge VM extension (preferred path).',
        };
      }

      // RUN6 B-011 fix: try VM Service first BEFORE OS-level deep link. The
      // bridge extension `ext.flutter.inkpal.navigate` works even when the
      // bridge WS is not connected — it's registered on the isolate by the
      // host app's inkpalRunApp() call. Only fall back to simctl openurl
      // (which requires Info.plist URL scheme) when no VM URI is available.
      const vmUri = (args.vm_service_uri as string) || getVmServiceUri(proj);
      if (vmUri) {
        const isolateId = await getFlutterIsolateId(vmUri);
        if (isolateId) {
          const ext = await vmServiceCall(vmUri, 'ext.flutter.inkpal.navigate', { isolateId, route }, 8_000);
          if (ext.ok) {
            return { success: true, route, method: 'vm_service_extension', source: 'ext.flutter.inkpal.navigate', isolate_id: isolateId, result: ext.result };
          }
          if (ext.error?.code === -32601) {
            // Extension not registered — try a generic Navigator evaluate as last in-VM attempt.
            // We rely on inkpalNavigatorKey being in scope via inkpalRunApp.
            const evalRes = await vmServiceCall(vmUri, 'evaluateInFrame', {
              isolateId,
              frameIndex: 0,
              expression: `inkpalNavigatorKey.currentState?.pushNamed("${route.replace(/"/g, '\\"')}")`,
            }, 8_000);
            if (evalRes.ok) {
              return { success: true, route, method: 'vm_service_evaluate', source: 'inkpalNavigatorKey.pushNamed', isolate_id: isolateId };
            }
          }
        }
      }

      // No bridge AND VM-Service path failed — platform-specific OS-level fallback.
      if (platform === 'ios') {
        // iOS Simulator deep links via xcrun simctl openurl
        const udid = ((args.device || args.device_id) as string) || 'booted';
        const r = runChecked(`xcrun simctl openurl ${udid} "inkpal://navigate${route}"`, undefined, 10_000);
        if (!r.ok) {
          return {
            success: false,
            error: 'simctl_openurl_failed',
            route,
            platform: 'ios',
            method: 'simctl_openurl',
            stderr: r.stderr.trim() || r.error,
            hint: 'Verify the iOS Simulator is booted AND your app registers the inkpal:// URL scheme in Info.plist.',
            next_tool: 'inkpal_devices_list',
          };
        }
        return { success: true, route, method: 'simctl_openurl', platform: 'ios', stdout: r.stdout.trim() };
      }

      // Android (or unknown defaulting to adb)
      const adbProbe = ensureAdb();
      if (!adbProbe.ok) {
        return {
          ...adbProbe,
          note: 'No bridge listening AND adb missing AND not detected as iOS. Either install adb, boot iOS sim, or install inkpal_bridge in your app.',
        };
      }
      const r = runChecked(`adb shell am start -a android.intent.action.VIEW -d "inkpal://navigate${route}"`, undefined, 10_000);
      if (!r.ok) {
        return { success: false, route, platform: 'android', method: 'adb_deep_link', error: r.error ?? r.stderr.trim(), hint: 'Verify a device is connected and the app handles the inkpal:// scheme.' };
      }
      return { success: true, route, platform: 'android', method: 'adb_deep_link', stdout: r.stdout.trim() };
    }

    case 'inkpal_evaluate': {
      // D1-cascade fix: now actually attempts the call instead of stub-erroring.
      const proj = p(args);
      const vmUri = (args.vm_service_uri as string) || getVmServiceUri(proj);
      if (!vmUri) {
        return {
          success: false,
          error: 'no_vm_service_uri',
          message: 'evaluate requires a live VM Service URI.',
          next_tool: 'inkpal_launch_app',
          hint: 'Call inkpal_launch_app first, OR pass vm_service_uri explicitly.',
        };
      }
      const expr = (args.expression as string) || '';
      if (!expr.trim()) return { success: false, error: 'expression_required', hint: 'Pass {expression: "Get.find<MyController>().value"}.' };
      // Forward to Railway for the actual VM-service ws call (it has the WS client + isolate resolution).
      return { forward_remote: true, tool: 'inkpal_evaluate', args: { ...args, vm_service_uri: vmUri, project_path: proj } };
    }

    case 'inkpal_inspect_widget_tree': {
      // RUN6 B-010 fix: call ext.flutter.inspector.getRootWidgetSummaryTree
      // locally via VM Service HTTP. Previous code returned a proxy stub even
      // though the URI was right there.
      const proj = p(args);
      const vmUri = (args.vm_service_uri as string) || getVmServiceUri(proj);
      if (!vmUri) {
        return {
          success: false,
          error: 'no_vm_service_uri',
          message: 'Widget tree inspection requires a live VM Service URI.',
          next_tool: 'inkpal_launch_app',
          next_tool_args_hint: { project_path: proj },
          hint: 'Either: (a) call inkpal_launch_app first so the proxy tracks the URI, or (b) pass vm_service_uri arg explicitly (copy from `flutter run` output).',
        };
      }
      const isolateId = await getFlutterIsolateId(vmUri);
      if (!isolateId) {
        return { success: false, error: 'no_isolate', vm_service_uri: vmUri, hint: 'getVM returned no isolates.' };
      }
      const inspectorMethod = (args.method as string) || 'ext.flutter.inspector.getRootWidgetSummaryTree';
      const objectGroup = (args.object_group as string) || 'inkpal-inspect';
      const r = await vmServiceCall(vmUri, inspectorMethod, { isolateId, objectGroup }, 15_000);
      if (!r.ok) {
        return {
          success: false,
          error: 'inspector_call_failed',
          jsonrpc_error: r.error,
          method: inspectorMethod,
          vm_service_uri: vmUri,
          hint: r.error?.code === -32601
            ? 'Inspector extension not registered. Build the app in debug or profile mode (release strips it).'
            : 'VM service rejected the inspector call.',
        };
      }
      const tree = r.result as Record<string, unknown> | undefined;
      let summary: Record<string, unknown> = {};
      // RUN7 B-025 fix: previous walker started at the JSON-RPC wrapper which
      // counts as 1 node with no children. The actual tree is at .result.
      // Unwrap Flutter's nested {type, result: {description, children: [...]}}
      // envelope to get to the real root.
      const rootCandidate = (tree?.result && typeof tree.result === 'object')
        ? tree.result as Record<string, unknown>
        : tree;
      if (rootCandidate && typeof rootCandidate === 'object') {
        let nodeCount = 0;
        const types: Record<string, number> = {};
        const walk = (n: unknown) => {
          if (!n || typeof n !== 'object') return;
          nodeCount++;
          const desc = (n as Record<string, unknown>).description as string | undefined;
          if (desc) {
            // "RepaintBoundary-[GlobalKey#4f021 inkpal_root_repaint]" → "RepaintBoundary"
            const widgetType = desc.split(/[-\s\[]/)[0];
            if (widgetType) types[widgetType] = (types[widgetType] ?? 0) + 1;
          }
          const children = (n as Record<string, unknown>).children as unknown[] | undefined;
          if (Array.isArray(children)) for (const c of children) walk(c);
        };
        walk(rootCandidate);
        const top = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 10);
        summary = { node_count: nodeCount, top_widget_types: Object.fromEntries(top) };
      }
      return {
        success: true,
        source: 'vm_service_inspector',
        method: inspectorMethod,
        isolate_id: isolateId,
        vm_service_uri: vmUri,
        summary,
        tree,
      };
    }

    case 'inkpal_analyze_visual':
      // RUN7 B-019 fix: previous recovery_tool pointed back at inkpal_screenshot
      // (which the caller already ran to produce the input — infinite loop).
      // Now points at inkpal_doctor for connectivity diagnostics + audit_ui as
      // the local-only alternative.
      return {
        success: false,
        error: 'feature_requires_connectivity',
        message: 'Visual analysis pipeline runs on Railway and the proxy could not reach it.',
        hint: 'Run inkpal_doctor to verify your network + license. For an offline alternative, inkpal_audit_ui + inkpal_accessibility_audit cover most static checks.',
        recovery_tool: 'inkpal_doctor',
        offline_alternatives: ['inkpal_audit_ui', 'inkpal_accessibility_audit'],
      };

    // ── Interaction (bridge-first, then platform-aware fallback) ─────────
    case 'inkpal_tap':
    case 'inkpal_smart_tap': {
      // D3 cluster-3 fix: was hard-coded to adb. Now: prefer bridge VM ext,
      // fall back to xcrun simctl on iOS, adb on Android, fail loud otherwise.
      const proj = p(args);
      const x = args.x as number | undefined;
      const y = args.y as number | undefined;
      const text = (args.text || args.key || args.label) as string | undefined;

      if (x == null && y == null && !text) {
        return {
          success: false,
          error: 'no_target',
          hint: 'Provide one of: {x, y} coords, {text: "..."}, {key: "..."}, or {label: "..."}.',
          examples: [{ x: 100, y: 200 }, { text: 'Sign In' }, { key: 'login_button' }],
        };
      }

      // RUN7 B-014 fix: try the bridge VM Service extension locally FIRST.
      // The bridge registers ext.flutter.inkpal.tap on the isolate so we can
      // call it without the WS socket or Railway round-trip. Same pattern as
      // navigate_to_route which landed in 0.8.9.
      const tapExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.tap', {
        x, y, label: text, parentContext: args.parent_context as string | undefined,
        skipHitCheck: args.skip_hit_check as string | undefined,
      });
      if (tapExt.handled) return { ...tapExt.response, tool: toolName, healed: toolName === 'inkpal_smart_tap' };

      // BRIDGE-FIRST: If bridge listening, route through Railway → bridge.
      // Bridge handles fuzzy match (smart_tap), key resolution, hit-test all properly.
      if (isBridgeListening()) {
        return {
          forward_remote: true,
          tool: toolName,
          args: { ...args, project_path: proj, _via: 'bridge' },
          note: 'Bridge handles hit-test + fuzzy match + smart_tap heal natively.',
        };
      }

      const platform = detectPlatform(args, proj);
      // RUN4 fix: don't preemptively reject iOS — the proxy can't actually
      // detect bridge presence (the bridge is a CLIENT, nothing listens on
      // 8765). Forward to Railway which has the VM-Service-direct path.
      // Railway responds with the real, structured error if bridge truly
      // unreachable.
      if (platform === 'ios') {
        return {
          forward_remote: true,
          tool: toolName,
          args: { ...args, project_path: proj, _via: 'railway_vm_service' },
          note: 'iOS interaction routed via Railway VM-Service path.',
        };
      }

      // Android adb path (existing behavior, with honest checks).
      const adbProbe = ensureAdb();
      if (!adbProbe.ok) return adbProbe;
      if (x != null && y != null) {
        const r = runChecked(`adb shell input tap ${x} ${y}`, undefined, 5_000);
        if (!r.ok) return { success: false, x, y, error: r.error ?? r.stderr.trim() };
        return { success: true, x, y, platform: 'android', method: 'adb_tap' };
      }
      if (text) {
        const dump = uiDump();
        const patterns = [
          new RegExp(`text="${text}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i'),
          new RegExp(`content-desc="${text}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i'),
        ];
        for (const re of patterns) {
          const m = dump.match(re);
          if (m) {
            const cx = (+m[1] + +m[3]) >> 1, cy = (+m[2] + +m[4]) >> 1;
            const r = runChecked(`adb shell input tap ${cx} ${cy}`, undefined, 5_000);
            if (!r.ok) return { success: false, error: r.error ?? r.stderr.trim() };
            return { success: true, tapped: text, x: cx, y: cy, healed: toolName === 'inkpal_smart_tap', platform: 'android' };
          }
        }
        if (toolName === 'inkpal_smart_tap') {
          const allTexts = [...dump.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map(m => m[1]);
          const lower = text.toLowerCase();
          const match = allTexts.find(t => t.toLowerCase().includes(lower));
          if (match) {
            const m2 = dump.match(new RegExp(`(?:text|content-desc)="${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i'));
            if (m2) {
              const cx = (+m2[1] + +m2[3]) >> 1, cy = (+m2[2] + +m2[4]) >> 1;
              const r = runChecked(`adb shell input tap ${cx} ${cy}`, undefined, 5_000);
              if (!r.ok) return { success: false, error: r.error ?? r.stderr.trim() };
              return { success: true, healed: true, original: text, matched: match, x: cx, y: cy, platform: 'android' };
            }
          }
        }
        return {
          success: false,
          error: 'target_not_found',
          message: `"${text}" not found in current UI dump.`,
          dump_size: dump.length,
          hint: dump.length === 0
            ? 'UI dump is empty — likely no app in foreground or device locked. Run inkpal_inspect_screen to verify.'
            : 'Element label not in dump. Try inkpal_get_interactive_elements to see what IS visible, then call again with the exact label.',
          next_tool: 'inkpal_get_interactive_elements',
        };
      }
      return { success: false, error: 'unreachable' };
    }

    case 'inkpal_double_tap': {
      // RUN7: try bridge VM ext first (works on iOS without adb).
      const proj = p(args);
      const dt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.doubleTap', {
        label: (args.label || args.text) as string | undefined,
        parentContext: args.parent_context as string | undefined,
      });
      if (dt.handled) return dt.response;
      const x = args.x as number ?? 540, y = args.y as number ?? 960;
      run(`adb shell input tap ${x} ${y} && sleep 0.1 && adb shell input tap ${x} ${y}`);
      return { success: true, x, y };
    }

    case 'inkpal_scroll': {
      // D3 cluster-3: bridge-first, iOS-aware fallback.
      const proj = p(args);
      const dir = (args.direction as string) || 'down';
      const px = (args.pixels as number) || 300;

      // RUN7 B-014 fix: try bridge VM extension locally first.
      const scrollExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.scroll', { direction: dir });
      if (scrollExt.handled) return { ...scrollExt.response, direction: dir, pixels: px };

      if (isBridgeListening()) {
        return {
          forward_remote: true,
          tool: 'inkpal_scroll',
          args: { ...args, project_path: proj, _via: 'bridge' },
          note: 'Bridge dispatches scroll via PointerGestureDriver (works on iOS + Android).',
        };
      }
      const platform = detectPlatform(args, proj);
      if (platform === 'ios') {
        // RUN4 fix: forward to Railway instead of preemptive reject.
        return {
          forward_remote: true,
          tool: 'inkpal_scroll',
          args: { ...args, project_path: proj, _via: 'railway_vm_service' },
          note: 'iOS interaction routed via Railway VM-Service path.',
        };
      }

      const adbProbe = ensureAdb();
      if (!adbProbe.ok) return adbProbe;
      const coords: Record<string, number[]> = {
        down: [540, 1000, 540, 1000 - px], up: [540, 700, 540, 700 + px],
        left: [800, 900, 800 - px, 900], right: [200, 900, 200 + px, 900],
      };
      const [x1, y1, x2, y2] = coords[dir] || coords['down'];
      const r = runChecked(`adb shell input swipe ${x1} ${y1} ${x2} ${y2} 300`, undefined, 5_000);
      if (!r.ok) return { success: false, direction: dir, pixels: px, platform: 'android', error: r.error ?? r.stderr.trim() };
      return { success: true, direction: dir, pixels: px, platform: 'android', method: 'adb_swipe' };
    }

    case 'inkpal_scroll_to': {
      const label = (args.label as string) || '';
      const dir = (args.direction as string) || 'down';
      const maxSwipes = (args.max_swipes as number) || 10;
      for (let i = 0; i < maxSwipes; i++) {
        const dump = uiDump();
        if (dump.includes(label)) return { success: true, found: true, swipes: i };
        const coords: Record<string, string> = {
          down: '540 1000 540 700', up: '540 700 540 1000',
          left: '800 900 200 900', right: '200 900 800 900',
        };
        run(`adb shell input swipe ${coords[dir] || coords['down']} 300`);
      }
      return { success: false, error: `"${label}" not found after ${maxSwipes} swipes` };
    }

    case 'inkpal_enter_text': {
      // D3 cluster-3: bridge-first, iOS-aware fallback.
      const proj = p(args);
      const text = (args.text as string) || '';
      if (!text) {
        return { success: false, error: 'text_required', hint: 'Pass {text: "your input"}.' };
      }
      // RUN7 B-014 fix: bridge ext.flutter.inkpal.setText takes label+text.
      // The label can be the field's hintText/labelText for fuzzy match.
      const setTextExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.setText', {
        label: (args.label || args.field || args.target) as string | undefined,
        text,
        parentContext: args.parent_context as string | undefined,
      });
      if (setTextExt.handled) return { ...setTextExt.response, text };

      if (isBridgeListening()) {
        return {
          forward_remote: true,
          tool: 'inkpal_enter_text',
          args: { ...args, project_path: proj, _via: 'bridge' },
          note: 'Bridge updates EditableTextState directly (works on iOS + Android).',
        };
      }
      const platform = detectPlatform(args, proj);
      if (platform === 'ios') {
        // RUN4 fix: forward to Railway instead of preemptive reject.
        return {
          forward_remote: true,
          tool: 'inkpal_enter_text',
          args: { ...args, project_path: proj, _via: 'railway_vm_service' },
          note: 'iOS interaction routed via Railway VM-Service path.',
        };
      }

      const adbProbe = ensureAdb();
      if (!adbProbe.ok) return adbProbe;
      const r = runChecked(`adb shell input text "${text.replace(/ /g, '%s')}"`, undefined, 5_000);
      if (!r.ok) return { success: false, text, platform: 'android', error: r.error ?? r.stderr.trim() };
      return { success: true, text, platform: 'android', method: 'adb_input_text' };
    }

    case 'inkpal_drag':
    case 'inkpal_swipe': {
      const x1 = (args.from_x ?? args.start_x ?? args.x ?? 540) as number;
      const y1 = (args.from_y ?? args.start_y ?? args.y ?? 800) as number;
      const x2 = (args.to_x ?? args.end_x ?? 540) as number;
      const y2 = (args.to_y ?? args.end_y ?? 400) as number;
      const d = (args.duration_ms ?? args.duration ?? 300) as number;
      run(`adb shell input swipe ${x1} ${y1} ${x2} ${y2} ${d}`);
      return { success: true, from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
    }

    case 'inkpal_press_key': {
      const km: Record<string, number> = {
        back: 4, home: 3, menu: 82, app_switch: 187,
        enter: 66, backspace: 67, tab: 61, escape: 111, delete: 67, space: 62,
        volume_up: 24, volume_down: 25,
        up: 19, down: 20, left: 21, right: 22,
        page_up: 92, page_down: 93, dpad_center: 23,
      };
      const k = (args.key as string) || 'back';
      run(`adb shell input keyevent ${km[k] ?? 4}`);
      return { success: true, key: k };
    }

    case 'inkpal_set_slider':
      return { error: 'set_slider requires InkPal Bridge.', hint: 'Add inkpal_bridge to pubspec.yaml. Fallback: use inkpal_drag to simulate slider movement.', recovery_tool: 'inkpal_drag' };

    case 'inkpal_set_checkbox':
      return { error: 'set_checkbox requires InkPal Bridge.', hint: 'Add inkpal_bridge to pubspec.yaml. Fallback: use inkpal_tap on the checkbox element.', recovery_tool: 'inkpal_tap' };

    case 'inkpal_get_interactive_elements':
    case 'inkpal_get_elements': {
      // D3 cluster-3: bridge-first dispatch (returns rich Flutter element tree),
      // iOS-aware fallback. Was hard adb-only.
      const proj = p(args);

      // Day 11 (week 2 sprint): a11y-tree-first interaction. The bridge's
      // ext.flutter.inkpal.getScreenContent returns a structured prompt
      // representation of the screen via the semantics tree — ~10× cheaper
      // in tokens than the full widget tree (per flutter-skill's benchmark).
      // Try a11y first; fall through to widget tree if extension missing or
      // if caller explicitly asked for the heavier output via {format:'tree'}.
      const wantsTree = (args.format as string) === 'tree';
      if (!wantsTree) {
        const a11y = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.getScreenContent', {});
        if (a11y.handled) {
          const inner = (a11y.response.result as { result?: { content?: string; elementCount?: number } } | undefined)?.result;
          return {
            success: true,
            source: 'vm_service_extension',
            extension: 'ext.flutter.inkpal.getScreenContent',
            mode: 'a11y_tree',
            isolate_id: a11y.response.isolate_id,
            content: inner?.content ?? '',
            count: inner?.elementCount ?? 0,
            // Hint to the LLM: prefer this over re-fetching with format:'tree'
            // unless it specifically needs widget bounds / keys for tap coords.
            hint: 'a11y tree mode (10× cheaper). Pass format:"tree" for full widget tree with bounds/keys.',
          };
        }
      }

      // RUN7 B-013 fix: ext.flutter.inkpal.getWidgetTree returns the rich
      // element list ({label, type, x, y, w, h, key, ...}). Same VM Service
      // path the C suite tools use. Bypasses the WS + Railway hop.
      const treeExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.getWidgetTree', {});
      if (treeExt.handled) {
        const inner = (treeExt.response.result as { result?: { elements?: unknown[] } } | undefined)?.result;
        const elements = (inner?.elements as unknown[]) ?? [];
        return {
          success: true,
          source: 'vm_service_extension',
          extension: 'ext.flutter.inkpal.getWidgetTree',
          mode: 'widget_tree',
          isolate_id: treeExt.response.isolate_id,
          elements: elements.slice(0, 100),
          count: elements.length,
        };
      }

      if (isBridgeListening()) {
        return {
          forward_remote: true,
          tool: toolName,
          args: { ...args, project_path: proj, _via: 'bridge' },
          note: 'Bridge returns Flutter element tree (semantic + ValueKey + visible text + interactive flags).',
        };
      }
      const platform = detectPlatform(args, proj);
      if (platform === 'ios') {
        // RUN4 fix: forward to Railway instead of preemptive reject.
        return {
          forward_remote: true,
          tool: toolName,
          args: { ...args, project_path: proj, _via: 'railway_vm_service' },
          note: 'iOS interaction routed via Railway VM-Service path.',
        };
      }

      const adbProbe = ensureAdb();
      if (!adbProbe.ok) return adbProbe;
      const dumpProbe = runChecked('adb shell uiautomator dump /sdcard/window_dump.xml', undefined, 8_000);
      if (!dumpProbe.ok) {
        return {
          success: false,
          elements: [],
          count: 0,
          platform: 'android',
          error: dumpProbe.error ?? dumpProbe.stderr.trim() ?? 'uiautomator dump failed',
          hint: 'Likely no Android device connected, or the device screen is locked. Run `adb devices` and unlock the screen.',
        };
      }
      const dump = uiDump();
      const els = [...dump.matchAll(/(?:text|content-desc)="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
        .map(m => ({ label: m[1], x: (+m[2] + +m[4]) >> 1, y: (+m[3] + +m[5]) >> 1 }));
      return {
        success: true,
        platform: 'android',
        elements: els.slice(0, 50),
        count: els.length,
        ...(els.length === 0 ? { hint: 'Device dump succeeded but no labelled elements visible. Check the app is in foreground.' } : {}),
      };
    }

    case 'inkpal_page_summary': {
      const dump = uiDump();
      // BUG-030: Build semantic refs like the full MCP handler
      const refs: string[] = [];
      const counts = new Map<string, number>();
      const allEls = [...dump.matchAll(/<node[^>]*(?:text|content-desc)="([^"]+)"[^>]*class="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*(?:clickable="(true|false)")?/gi)];
      for (const m of allEls) {
        const label = m[1], cls = m[2] || '', clickable = m[7] === 'true';
        const type = clickable ? 'button' : cls.includes('Text') ? 'text' : cls.includes('Image') ? 'image' : 'view';
        const key = `${type}:${label}`;
        const idx = (counts.get(key) || 0) + 1;
        counts.set(key, idx);
        refs.push(idx > 1 ? `${key}[${idx}]` : key);
      }
      // Fallback: simple text/desc extraction if XML parsing yields nothing
      const texts = [...dump.matchAll(/text="([^"]+)"/g)].map(m => m[1]).filter(Boolean);
      const descs = [...dump.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      return {
        semantic_refs: refs.length > 0 ? refs.slice(0, 50) : undefined,
        texts, descs,
        interactable_count: allEls.filter(m => m[7] === 'true').length,
        total_elements: allEls.length || texts.length + descs.length,
      };
    }

    case 'inkpal_find_element': {
      const q = (args.text || args.query || args.label) as string || '';
      const dump = uiDump();
      const re = new RegExp(`(text|content-desc)="${q}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'gi');
      return { query: q, elements: [...dump.matchAll(re)].map(m => ({ x: (+m[2] + +m[4]) >> 1, y: (+m[3] + +m[5]) >> 1 })) };
    }

    case 'inkpal_deep_link':
      run(`adb shell am start -a android.intent.action.VIEW -d "${(args.url as string) || ''}"`);
      return { success: true };

    // ── Smart Wait & Assertions ──────────────────────────────────────────
    case 'inkpal_wait_for': {
      const label = (args.label as string) || '';
      const condition = (args.condition as string) || 'visible';
      const timeoutMs = (args.timeout_ms as number) || 10_000;
      const pollMs = (args.poll_ms as number) || 500;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const dump = uiDump();
        const found = dump.includes(label);
        if ((condition === 'visible' && found) || (condition === 'gone' && !found) || condition === 'idle') {
          return { success: true, condition, elapsed_ms: Date.now() - start };
        }
        run(`sleep ${pollMs / 1000}`);
      }
      return { success: false, error: `Timeout waiting for "${label}" to be ${condition}` };
    }

    case 'inkpal_assert_element': {
      const label = (args.label as string) || '';
      const assertion = (args.assertion as string) || 'visible';
      const dump = uiDump();
      const found = dump.includes(label);
      if (assertion === 'visible') return { passed: found, message: found ? 'Element found' : 'Element not found' };
      if (assertion === 'not_visible') return { passed: !found, message: !found ? 'Element absent' : 'Element still visible' };
      return { passed: false, message: `Unsupported assertion: ${assertion}` };
    }

    case 'inkpal_wait_for_idle':
      run(`sleep ${((args.timeout_ms as number) || 3000) / 1000}`);
      return { success: true, message: 'Waited for idle' };

    case 'inkpal_assert_ui':
    case 'inkpal_test_flow':
      return { error: `${toolName} requires full MCP server.`, hint: 'Use inkpal_assert_element for basic visibility checks, or inkpal_wait_for to poll.', recovery_tool: 'inkpal_assert_element' };

    // ── Widget Inspector ─────────────────────────────────────────────────
    case 'inkpal_get_widget_details':
    case 'inkpal_select_widget':
    case 'inkpal_driver_command':
      return { error: `${toolName} requires VM Service.`, hint: 'Launch app with inkpal_launch_app first. Fallback: use inkpal_get_elements for ADB-based discovery.', recovery_tool: 'inkpal_get_elements' };

    // ── Visual Testing (D5 cluster-4: local-first via bundled pixelmatch) ─
    case 'inkpal_visual_baseline_save': {
      // Capture current screen + save as the named baseline. No cloud needed.
      // RUN6 B-015 fix: accept name|route|routes[0] via deriveVisualName so
      // save+test round-trip with whatever calling convention the agent uses.
      const proj = p(args);
      const name = deriveVisualName(args);
      const baselineDir = join(proj, '.inkpal', 'visual-tests', 'baselines');
      mkdirSync(baselineDir, { recursive: true });
      const baselinePath = join(baselineDir, `${name}.png`);

      // Reuse the screenshot handler logic — pass output_path explicitly.
      const shotResult = await handleLocal('inkpal_screenshot', { ...args, output_path: baselinePath });
      const sr = shotResult as { success?: boolean; error?: string; method?: string; bytes?: number };
      if (!sr.success) {
        return { ...sr, action: 'baseline_save_failed', baseline_path: baselinePath };
      }
      return {
        success: true,
        action: 'baseline_saved',
        name,
        baseline_path: baselinePath,
        bytes: sr.bytes,
        method: sr.method,
        hint: `Baseline "${name}" saved. Run inkpal_visual_test with name:"${name}" after code changes to detect regressions.`,
      };
    }

    case 'inkpal_visual_test': {
      // Capture current screen, compare to named baseline, write diff PNG.
      // RUN6 B-016 fix: same deriveVisualName helper as baseline_save so
      // the recovery loop (save → test) is mathematically satisfiable.
      const proj = p(args);
      const name = deriveVisualName(args);
      const passThreshold = (args.pass_threshold as number) ?? 0.95;
      const baselineDir = join(proj, '.inkpal', 'visual-tests', 'baselines');
      const currentDir = join(proj, '.inkpal', 'visual-tests', 'current');
      const diffDir = join(proj, '.inkpal', 'visual-tests', 'diffs');
      const baselinePath = join(baselineDir, `${name}.png`);
      const currentPath = join(currentDir, `${name}.png`);
      const diffPath = join(diffDir, `${name}.png`);

      if (!existsSync(baselinePath)) {
        return {
          success: false,
          error: 'no_baseline',
          name,
          baseline_path: baselinePath,
          message: `No baseline named "${name}" exists yet.`,
          next_tool: 'inkpal_visual_baseline_save',
          next_tool_args_hint: { name },
          hint: `Save one first: inkpal_visual_baseline_save with name:"${name}".`,
        };
      }

      mkdirSync(currentDir, { recursive: true });
      const shotResult = await handleLocal('inkpal_screenshot', { ...args, output_path: currentPath });
      const sr = shotResult as { success?: boolean; error?: string; bytes?: number };
      if (!sr.success) return { ...sr, action: 'visual_test_capture_failed' };

      mkdirSync(diffDir, { recursive: true });
      const { compare } = await import('./visual-comparator.js');
      const result = await compare(baselinePath, currentPath, {
        threshold: (args.comparison_threshold as number) ?? 0.1,
        outputDiffPath: diffPath,
      });

      const passed = result.similarity >= passThreshold;
      const summary = {
        success: true,
        passed,
        name,
        similarity: Math.round(result.similarity * 10000) / 10000,
        pass_threshold: passThreshold,
        differing_pixels: result.differingPixels,
        total_pixels: result.totalPixels,
        baseline_path: baselinePath,
        current_path: currentPath,
        diff_path: diffPath,
        dimensions: {
          baseline: result.baselineDimensions,
          current: result.currentDimensions,
          match: result.dimensionsMatch,
        },
        ...(result.hiDpiMismatch ? { hiDpiMismatch: true, hint: result.hiDpiHint } : {}),
        message: passed
          ? `Visual test PASSED — similarity ${(result.similarity * 100).toFixed(2)}% (threshold ${(passThreshold * 100).toFixed(0)}%).`
          : `Visual test FAILED — similarity ${(result.similarity * 100).toFixed(2)}% below threshold ${(passThreshold * 100).toFixed(0)}%.`,
      };

      // Append to last-report.json for inkpal_visual_report
      try {
        const reportFile = join(proj, '.inkpal', 'visual-tests', 'last-report.json');
        let report: { results: unknown[]; timestamp?: string } = { results: [], timestamp: new Date().toISOString() };
        if (existsSync(reportFile)) {
          try { report = JSON.parse(readFileSync(reportFile, 'utf8')); } catch { /* reset */ }
          report.results = report.results || [];
        }
        report.results.push({ ...summary, ts: new Date().toISOString() });
        report.timestamp = new Date().toISOString();
        writeFileSync(reportFile, JSON.stringify(report, null, 2));
      } catch { /* best-effort */ }

      return summary;
    }

    case 'inkpal_visual_baseline_compare': {
      // Lower-level: compare two arbitrary PNGs. No screenshot capture.
      const baseline = (args.baseline_path as string) || (args.a as string);
      const current = (args.current_path as string) || (args.b as string);
      if (!baseline || !current) {
        return { success: false, error: 'missing_paths', hint: 'Pass {baseline_path, current_path} or {a, b}.' };
      }
      if (!existsSync(baseline)) return { success: false, error: 'baseline_missing', baseline_path: baseline };
      if (!existsSync(current)) return { success: false, error: 'current_missing', current_path: current };
      const diffPath = (args.diff_path as string) || baseline.replace(/\.png$/i, '.diff.png');
      const { compare } = await import('./visual-comparator.js');
      const result = await compare(baseline, current, {
        threshold: (args.threshold as number) ?? 0.1,
        outputDiffPath: diffPath,
      });
      return {
        success: true,
        similarity: Math.round(result.similarity * 10000) / 10000,
        differing_pixels: result.differingPixels,
        total_pixels: result.totalPixels,
        diff_path: result.diffImagePath,
        dimensions: {
          baseline: result.baselineDimensions,
          current: result.currentDimensions,
          match: result.dimensionsMatch,
        },
        ...(result.hiDpiMismatch ? { hiDpiMismatch: true, hint: result.hiDpiHint } : {}),
      };
    }

    case 'inkpal_visual_report': {
      // Render the last-report.json as JSON / HTML / JUnit.
      const proj = p(args);
      const format = (args.format as string) || 'json';
      const reportFile = join(proj, '.inkpal', 'visual-tests', 'last-report.json');
      if (!existsSync(reportFile)) {
        return {
          success: false,
          error: 'no_report',
          message: 'No visual test runs yet for this project.',
          next_tool: 'inkpal_visual_test',
          hint: 'Run inkpal_visual_test on at least one route to generate a report.',
        };
      }
      let report: { results: Array<{ name?: string; passed?: boolean; similarity?: number }>; timestamp?: string };
      try { report = JSON.parse(readFileSync(reportFile, 'utf8')); }
      catch (e) { return { success: false, error: 'corrupt_report', detail: String((e as Error).message) }; }

      const results = report.results || [];
      const passed = results.filter(r => r.passed).length;
      const failed = results.length - passed;

      if (format === 'json') {
        return { success: true, format, total: results.length, passed, failed, timestamp: report.timestamp, results };
      }
      if (format === 'junit') {
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          `<testsuite name="inkpal-visual" tests="${results.length}" failures="${failed}" timestamp="${report.timestamp || ''}">`,
          ...results.map(r => r.passed
            ? `  <testcase classname="visual" name="${r.name}" />`
            : `  <testcase classname="visual" name="${r.name}"><failure message="similarity ${r.similarity}"/></testcase>`),
          '</testsuite>',
        ].join('\n');
        const outPath = (args.output_path as string) || join(proj, '.inkpal', 'visual-tests', 'report.xml');
        writeFileSync(outPath, xml);
        return { success: true, format, path: outPath, total: results.length, passed, failed };
      }
      if (format === 'html') {
        const rows = results.map(r => {
          const cls = r.passed ? 'pass' : 'fail';
          const sim = ((r.similarity ?? 0) * 100).toFixed(2);
          return `<tr class="${cls}"><td>${r.name}</td><td>${r.passed ? '✅' : '❌'}</td><td>${sim}%</td></tr>`;
        }).join('\n    ');
        const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>InkPal Visual Report</title>
<style>body{font:14px system-ui;padding:24px;background:#0b0d12;color:#f5f7fa}
table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #232a38;text-align:left}
.pass{color:#4ade80}.fail{color:#f87171}h1{color:#7fa9ff}</style></head>
<body><h1>InkPal Visual Report</h1>
<p>${results.length} tests · ${passed} passed · ${failed} failed · ${report.timestamp ?? ''}</p>
<table><thead><tr><th>Route/Name</th><th>Result</th><th>Similarity</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
        const outPath = (args.output_path as string) || join(proj, '.inkpal', 'visual-tests', 'report.html');
        writeFileSync(outPath, html);
        return { success: true, format, path: outPath, total: results.length, passed, failed };
      }
      return { success: false, error: 'unknown_format', format, supported: ['json', 'html', 'junit'] };
    }

    case 'inkpal_visual_test_all':
    case 'inkpal_profile_performance':
      // These need the full route-extraction + multi-device engine — defer to Railway.
      return {
        forward_remote: true,
        tool: toolName,
        args: { ...args },
        note: 'Multi-route visual sweep + perf profiling use the Railway engine. Single-route inkpal_visual_test is local.',
      };

    // ── LSP Intelligence ─────────────────────────────────────────────────
    case 'inkpal_hover':
    case 'inkpal_go_to_definition':
    case 'inkpal_find_references':
    case 'inkpal_read_package_source':
    case 'inkpal_search_package_source':
      return { error: `${toolName} requires the full InkPal MCP server with Dart LSP.` };

    // ── Sessions ─────────────────────────────────────────────────────────
    case 'inkpal_save_session':
    case 'inkpal_restore_session':
    case 'inkpal_list_sessions':
    // ── Log session API (Block 5 Option C, 2026-05-04) ─────────────────────
    // Bookend a chunk of test/interaction work; later assert + query the
    // logs that fired during that window. Used by /build's verify phase
    // and any LLM-driven testing flow that needs "during the last action,
    // did anything throw?" semantics. Stays compatible with 24h cleanup
    // (session files live under ~/.inkpal/sessions/log-<id>.json).
    case 'inkpal_start_log_session': {
      const proj = p(args);
      const sessionId = (args.session_id as string) || `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const filter = (args.filter as string) || 'flutter|dart|error|exception|crash';
      const platform = detectPlatform(args, proj);
      const startTs = new Date().toISOString();
      // Snapshot current end of log so query_logs can compute the new lines later.
      // For iOS we use the wall clock; for Android we capture line count of `adb logcat -d`.
      let baselineLineCount = 0;
      if (platform === 'android' || platform === 'unknown') {
        const adbProbe = ensureAdb();
        if (adbProbe.ok) {
          const r = runChecked('adb logcat -d 2>/dev/null | wc -l', undefined, 5_000);
          if (r.ok) baselineLineCount = parseInt(r.stdout.trim(), 10) || 0;
        }
      }
      const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
      mkdirSync(join(homedir(), '.inkpal', 'sessions'), { recursive: true });
      writeFileSync(stateFile, JSON.stringify({
        session_id: sessionId, project_path: proj, platform, filter, start_ts: startTs,
        baseline_line_count: baselineLineCount,
      }, null, 2));
      return {
        success: true,
        session_id: sessionId,
        start_ts: startTs,
        platform,
        filter,
        hint: `Session started. Drive your test then call inkpal_end_log_session({session_id:"${sessionId}"}). Or call inkpal_query_logs / inkpal_assert_no_errors with the same session_id to inspect/gate.`,
      };
    }

    case 'inkpal_end_log_session': {
      const sessionId = (args.session_id as string) || '';
      if (!sessionId) return { success: false, error: 'session_id_required' };
      const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
      if (!existsSync(stateFile)) return { success: false, error: 'session_not_found', session_id: sessionId };
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { project_path: string; platform: string; filter: string; start_ts: string; baseline_line_count: number; end_ts?: string; captured_lines?: string[] };
      state.end_ts = new Date().toISOString();
      // Capture lines between baseline and now
      const captured = await captureSessionLines(state.project_path, state.platform, state.filter, state.baseline_line_count, state.start_ts);
      state.captured_lines = captured;
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return {
        success: true,
        session_id: sessionId,
        start_ts: state.start_ts,
        end_ts: state.end_ts,
        line_count: captured.length,
        sample: captured.slice(0, 5),
        hint: `Session ended. Use inkpal_query_logs or inkpal_assert_no_errors with session_id:"${sessionId}".`,
      };
    }

    case 'inkpal_query_logs': {
      const sessionId = (args.session_id as string) || '';
      if (!sessionId) return { success: false, error: 'session_id_required' };
      const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
      if (!existsSync(stateFile)) return { success: false, error: 'session_not_found', session_id: sessionId };
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { captured_lines?: string[]; start_ts: string; end_ts?: string };
      let lines = state.captured_lines ?? [];
      if (!state.end_ts) {
        // Session still open — capture live
        const fullState = JSON.parse(readFileSync(stateFile, 'utf8'));
        lines = await captureSessionLines(fullState.project_path, fullState.platform, fullState.filter, fullState.baseline_line_count, fullState.start_ts);
      }
      const pattern = (args.pattern as string) || '';
      const severity = (args.severity as string) || ''; // 'error'|'warning'|'info'
      const limit = (args.limit as number) || 100;
      let filtered = lines;
      if (pattern) {
        const re = new RegExp(pattern, 'i');
        filtered = filtered.filter(l => re.test(l));
      }
      if (severity) filtered = filtered.filter(l => l.toLowerCase().includes(severity.toLowerCase()));
      return {
        success: true, session_id: sessionId,
        total_in_session: lines.length, matched: filtered.length,
        lines: filtered.slice(0, limit),
        ...(filtered.length > limit ? { truncated: true, limit } : {}),
      };
    }

    case 'inkpal_assert_no_errors': {
      const sessionId = (args.session_id as string) || '';
      if (!sessionId) return { success: false, error: 'session_id_required' };
      const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
      if (!existsSync(stateFile)) return { success: false, error: 'session_not_found', session_id: sessionId };
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { captured_lines?: string[]; project_path: string; platform: string; filter: string; baseline_line_count: number; start_ts: string };
      const lines = state.captured_lines ?? await captureSessionLines(state.project_path, state.platform, state.filter, state.baseline_line_count, state.start_ts);
      const errorPattern = (args.pattern as string) || '\\b(error|exception|crash|fatal|RenderFlex overflowed|Failed assertion|setState\\(\\) called)\\b';
      const re = new RegExp(errorPattern, 'i');
      const errors = lines.filter(l => re.test(l));
      const ok = errors.length === 0;
      return {
        success: ok,
        session_id: sessionId,
        assertion: 'no_errors',
        passed: ok,
        error_count: errors.length,
        errors: errors.slice(0, 10),
        hint: ok
          ? 'No errors detected during session window.'
          : `${errors.length} error-like log line(s) fired during session. Inspect via inkpal_query_logs.`,
        ...(ok ? {} : { next_tool: 'inkpal_lookup_error', next_tool_args_hint: { error_message: errors[0] } }),
      };
    }

    case 'inkpal_save_session':
    case 'inkpal_restore_session':
    case 'inkpal_list_sessions':
      return { error: `${toolName} requires the full InkPal MCP server.` };

    // ── Screen recording ─────────────────────────────────────────────────
    case 'inkpal_video_start':
      run('adb shell screenrecord /sdcard/inkpal_rec.mp4 &');
      return { success: true, message: 'Recording started' };
    case 'inkpal_video_stop': {
      run('adb shell pkill -SIGINT screenrecord || true');
      const out = (args.output_path as string) || '/tmp/inkpal_recording.mp4';
      run(`adb pull /sdcard/inkpal_rec.mp4 "${out}"`);
      return { path: out, exists: existsSync(out) };
    }
    case 'inkpal_recording_start':
    case 'inkpal_recording_stop':
    case 'inkpal_recording_status':
    case 'inkpal_recording_export':
    case 'inkpal_screen_snapshot':
    case 'inkpal_screen_diff':
    case 'inkpal_state_capture':
    case 'inkpal_state_list':
    case 'inkpal_state_get':
    case 'inkpal_state_diff':
      return { error: `${toolName} requires the full InkPal MCP server.` };

    // ── Network / Stability ──────────────────────────────────────────────
    case 'inkpal_stability_check': {
      const out = run('adb logcat -d -t 500 | grep -iE "crash|anr|fatal|exception|SIGABRT|SIGKILL|OOM|gc.*alloc|jank"', undefined, 15_000);
      const lines = out.split('\n').filter(Boolean);
      const crashes = lines.filter(l => /crash|fatal|SIGABRT|SIGKILL/i.test(l));
      const anrs = lines.filter(l => /anr|not responding/i.test(l));
      const oom = lines.filter(l => /OOM|out of memory|gc.*alloc/i.test(l));
      const jank = lines.filter(l => /jank|skipped.*frames/i.test(l));
      return {
        stable: crashes.length === 0 && anrs.length === 0,
        crashes: crashes.slice(0, 10),
        anrs: anrs.slice(0, 5),
        oom_warnings: oom.slice(0, 5),
        jank_frames: jank.slice(0, 5),
        summary: `${crashes.length} crashes, ${anrs.length} ANRs, ${oom.length} OOM, ${jank.length} jank`,
        total_issues: lines.length,
        hint: crashes.length > 0 ? 'Use inkpal_get_app_logs for full crash details, then inkpal_lookup_error to find fixes.' : undefined,
        recovery_tool: crashes.length > 0 ? 'inkpal_lookup_error' : undefined,
      };
    }
    case 'inkpal_mock_network':
    case 'inkpal_clear_network_mocks':
    case 'inkpal_go_offline':
    case 'inkpal_go_online':
    case 'inkpal_network_conditions':
    case 'inkpal_network_record':
    case 'inkpal_network_replay':
    case 'inkpal_set_locale':
      return { error: `${toolName} requires the full InkPal MCP server.` };

    // ── Multi-Device ─────────────────────────────────────────────────────
    case 'inkpal_launch_all':
    case 'inkpal_execute_all':
    case 'inkpal_screenshot_all':
    case 'inkpal_compare_all':
    case 'inkpal_test_cross_device':
      return { error: `${toolName} requires the full InkPal MCP server.` };

    // ── ORCHESTRATE ──────────────────────────────────────────────────────
    case 'inkpal_register_app':
    case 'inkpal_orchestrate':
    case 'inkpal_orchestrate_status':
    case 'inkpal_cross_app_test':
      return { error: `${toolName} requires the full InkPal MCP server.` };

    // ── HEAL ─────────────────────────────────────────────────────────────
    case 'inkpal_auto_repair':
    case 'inkpal_heal_watch':
    case 'inkpal_heal_stop':
    case 'inkpal_heal_verify':
      return { error: `${toolName} requires the full InkPal MCP server.` };

    // ── SHIP (Phase 3 / Skill #5, 2026-05-05): real handlers ────────────
    case 'inkpal_auto_commit': {
      const proj = p(args);
      const message = (args.message as string) || 'chore: auto-commit via inkpal';
      const include = (args.include as string) || '-A';
      // Status check first — empty diff = nothing to commit (treat as success)
      const status = runChecked(`git status --porcelain`, proj, 5_000);
      if (!status.ok) return { success: false, error: 'not_a_git_repo', hint: 'Run `git init` first.', recovery_tool: 'inkpal_doctor' };
      if (status.stdout.trim().length === 0) {
        return { success: true, action: 'no_changes', hint: 'Working tree clean; nothing to commit.', message };
      }
      const add = runChecked(`git add ${include}`, proj, 10_000);
      if (!add.ok) return { success: false, error: 'git_add_failed', stderr: add.stderr.trim(), hint: 'Check file permissions or .gitignore patterns.' };
      // Use heredoc for safe multiline message
      const safeMsg = message.replace(/'/g, "'\\''");
      const commit = runChecked(`git commit -m '${safeMsg}'`, proj, 15_000);
      if (!commit.ok) {
        return { success: false, error: 'git_commit_failed', stderr: commit.stderr.trim() || commit.error, hint: 'Likely pre-commit hook failure. Check stderr.' };
      }
      // Capture commit hash
      const hash = runChecked(`git rev-parse HEAD`, proj, 3_000);
      return {
        success: true, action: 'committed',
        commit_hash: hash.ok ? hash.stdout.trim() : undefined,
        message,
        files_changed: status.stdout.split('\n').filter(Boolean).length,
        hint: `Commit ${hash.ok ? hash.stdout.trim().slice(0, 8) : 'created'}: "${message.slice(0, 60)}"`,
      };
    }

    case 'inkpal_create_pr': {
      const proj = p(args);
      const title = (args.title as string) || '';
      const body = (args.body as string) || '';
      const base = (args.base as string) || 'main';
      // Pre-flight: gh CLI installed?
      const ghProbe = runChecked('gh --version', undefined, 3_000);
      if (!ghProbe.ok) {
        return {
          success: false, error: 'gh_cli_not_installed',
          hint: 'GitHub CLI not found. Install: brew install gh && gh auth login. Fallback: open PR via web at https://github.com/<repo>/compare',
          install_command: 'brew install gh',
        };
      }
      // Auth check
      const authProbe = runChecked('gh auth status', undefined, 5_000);
      if (!authProbe.ok) {
        return { success: false, error: 'gh_not_authenticated', hint: 'Run: gh auth login', stderr: authProbe.stderr.trim() };
      }
      if (!title.trim()) return { success: false, error: 'title_required', hint: 'Pass {title: "feat: add settings screen"}.' };
      // Push current branch first (gh pr create needs the remote branch to exist)
      const branch = runChecked('git rev-parse --abbrev-ref HEAD', proj, 3_000);
      if (!branch.ok || branch.stdout.trim() === base || branch.stdout.trim() === 'HEAD') {
        return { success: false, error: 'cannot_pr_from_base_or_detached', branch: branch.stdout.trim(), hint: `Switch to a feature branch first: git checkout -b feature/<name>` };
      }
      const push = runChecked(`git push -u origin ${branch.stdout.trim()}`, proj, 30_000);
      if (!push.ok) return { success: false, error: 'git_push_failed', stderr: push.stderr.trim(), hint: 'Check network + remote + auth.' };
      // Create PR (heredoc body via stdin to avoid shell escaping issues)
      const safeBody = body.replace(/'/g, "'\\''");
      const cmd = `gh pr create --base ${base} --title '${title.replace(/'/g, "'\\''")}' --body '${safeBody}'`;
      const create = runChecked(cmd, proj, 30_000);
      if (!create.ok) return { success: false, error: 'gh_pr_create_failed', stderr: create.stderr.trim(), hint: 'Likely PR already exists or branch protection rule.' };
      const url = create.stdout.trim().split('\n').find(l => l.startsWith('http')) ?? create.stdout.trim();
      return { success: true, action: 'pr_created', pr_url: url, base, head: branch.stdout.trim(), title };
    }

    case 'inkpal_pre_merge_gate': {
      // Sequential gates — each must pass before the next runs.
      // Caller can override thresholds.
      const proj = p(args);
      const maxAnalyzeErrors = (args.max_analyze_errors as number) ?? 0;
      const maxAuditWarnings = (args.max_audit_warnings as number) ?? 5;
      const maxA11ySerious = (args.max_a11y_serious as number) ?? 3;
      const maxSafetyCritical = (args.max_safety_critical as number) ?? 0;
      const gates: Array<{ name: string; passed: boolean; detail: string }> = [];

      // Gate 1: flutter_analyze
      const analyze = await handleLocal('inkpal_flutter_analyze', { project_path: proj }) as Record<string, unknown>;
      const errCount = (analyze.errorCount as number) ?? 0;
      gates.push({ name: 'flutter_analyze', passed: errCount <= maxAnalyzeErrors, detail: `${errCount} errors (max: ${maxAnalyzeErrors})` });

      // Gate 2: check_safety on lib/main.dart (sample; full project too slow for gate)
      const safety = await handleLocal('inkpal_check_safety', { project_path: proj, file_path: `${proj}/lib/main.dart` }) as Record<string, unknown>;
      const critCount = (safety.critical_count as number) ?? 0;
      gates.push({ name: 'check_safety', passed: critCount <= maxSafetyCritical, detail: `${critCount} critical (max: ${maxSafetyCritical})` });

      // Gate 3: audit_ui
      const audit = await handleLocal('inkpal_audit_ui', { project_path: proj, file: `lib/main.dart` }) as Record<string, unknown>;
      const auditFindings = (audit.findings as Array<Record<string, unknown>> | undefined) ?? [];
      const auditWarn = auditFindings.filter(f => f.severity === 'warning' || f.severity === 'error').length;
      gates.push({ name: 'audit_ui', passed: auditWarn <= maxAuditWarnings, detail: `${auditWarn} warnings (max: ${maxAuditWarnings})` });

      // Gate 4: accessibility_audit
      const a11y = await handleLocal('inkpal_accessibility_audit', { project_path: proj }) as Record<string, unknown>;
      const a11yFindings = (a11y.findings as Array<Record<string, unknown>> | undefined) ?? [];
      const seriousCount = a11yFindings.filter(f => f.severity === 'serious').length;
      gates.push({ name: 'accessibility_audit', passed: seriousCount <= maxA11ySerious, detail: `${seriousCount} serious (max: ${maxA11ySerious})` });

      const allPassed = gates.every(g => g.passed);
      return {
        success: allPassed,
        action: 'pre_merge_gate',
        gates,
        passed: gates.filter(g => g.passed).length,
        failed: gates.filter(g => !g.passed).length,
        hint: allPassed
          ? 'All gates passed — safe to inkpal_create_pr.'
          : `${gates.filter(g => !g.passed).length} gate(s) failed. Fix before creating PR.`,
        ...(allPassed ? { next_tool: 'inkpal_create_pr' } : { next_tool: 'inkpal_audit_ui' }),
      };
    }
    case 'inkpal_deploy': {
      const platform = (args.platform as string) || 'apk';
      const buildOut = run(`flutter build ${platform} --release`, p(args), 600_000);
      return {
        output: buildOut,
        hint: 'Build complete. To upload:\n'
          + '  Android: fastlane supply --aab build/app/outputs/bundle/release/app-release.aab\n'
          + '  iOS: xcrun altool --upload-app -f build/ios/ipa/*.ipa --apiKey YOUR_KEY\n'
          + '  Firebase: firebase appdistribution:distribute build/app/outputs/apk/release/app-release.apk --app YOUR_APP_ID',
        credentials_needed: {
          android: 'GOOGLE_PLAY_API_JSON or fastlane supply credentials',
          ios: 'FASTLANE_USER + FASTLANE_PASSWORD or App Store Connect API key',
          firebase: 'FIREBASE_TOKEN or service account JSON',
        },
      };
    }
    case 'inkpal_ship':
      return { error: `${toolName} requires the full InkPal MCP server.`, hint: 'Fallback: inkpal_auto_commit → inkpal_flutter_test → inkpal_deploy manually.' };

    // ── Storage ──────────────────────────────────────────────────────────
    case 'inkpal_storage_status': {
      const dir = resolve(p(args), '.inkpal');
      if (!existsSync(dir)) return { exists: false };
      return { exists: true, path: dir, size: run(`du -sh "${dir}" 2>/dev/null`).trim() };
    }
    case 'inkpal_storage_cleanup': {
      const dir = resolve(p(args), '.inkpal');
      if (!existsSync(dir)) return { message: 'No .inkpal directory' };
      run(`find "${dir}" -name "*.png" -mtime +30 -delete 2>/dev/null`);
      return { message: 'Cleaned old files' };
    }
    case 'inkpal_storage_config': {
      // B-013 fix: implement read-only locally so users can at least inspect
      // current storage settings without hitting the Railway server.
      // Mutating writes still require the full MCP server (Supabase-backed).
      const dir = resolve(p(args), '.inkpal');
      const configFile = resolve(dir, 'storage-config.json');
      const action = (args.action as string) || 'get';
      if (action !== 'get' && action !== 'read') {
        return {
          error: `storage_config action="${action}" requires the full InkPal MCP server.`,
          hint: 'Local proxy supports action="get" only. Use the full server for set/update/delete.',
          available_actions_local: ['get', 'read'],
          recovery_tool: null,
        };
      }
      if (!existsSync(configFile)) {
        return {
          exists: false,
          path: configFile,
          defaults: {
            screenshot_retention_days: 30,
            log_retention_days: 7,
            max_baseline_images: 200,
          },
          hint: 'No local config — defaults shown. The full server can persist overrides.',
        };
      }
      try {
        const cfg = JSON.parse(readFileSync(configFile, 'utf-8'));
        return { exists: true, path: configFile, config: cfg };
      } catch (e) {
        return { exists: true, path: configFile, error: `failed to parse: ${(e as Error).message}` };
      }
    }

    default:
      return { error: `${toolName} is not handled locally. It may need to run on Railway.` };
  }
}
