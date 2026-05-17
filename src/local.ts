import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { callOrchestrationEndpoint } from './remote.js';
export const LOCAL_TOOLS = new Set([
    'inkpal_lookup_error',
    'inkpal_analyze_project',
    'inkpal_check_safety',
    'inkpal_doctor',
    'inkpal_project_doctor',
    'inkpal_get_context',
    'inkpal_get_design_system',
    'inkpal_check_package',
    'inkpal_pub_dev_search',
    'inkpal_get_blast_radius',
    'inkpal_audit_ui',
    'inkpal_accessibility_audit',
    'inkpal_registry',
    'inkpal_dept_inspect_pick',
    'inkpal_dept_verify_pick',
    'inkpal_cleanup_storage',
    'inkpal_batch_actions',
    'inkpal_run_track',
    'inkpal_validate_system',
    'inkpal_start_log_session',
    'inkpal_end_log_session',
    'inkpal_query_logs',
    'inkpal_assert_no_errors',
    'inkpal_progress',
    'inkpal_spec_to_plan',
    'inkpal_auto_commit', 'inkpal_create_pr', 'inkpal_pre_merge_gate',
    'inkpal_flutter_analyze', 'inkpal_flutter_test', 'inkpal_flutter_build',
    'inkpal_create_project', 'inkpal_dart_fix',
    'inkpal_coverage_report', 'inkpal_coverage_gaps',
    'inkpal_list_devices', 'inkpal_device_info',
    'inkpal_launch_app', 'inkpal_hot_reload', 'inkpal_hot_restart',
    'inkpal_screenshot',
    'inkpal_get_runtime_errors', 'inkpal_get_app_logs',
    'inkpal_navigate_to_route', 'inkpal_evaluate',
    'inkpal_inspect_widget_tree', 'inkpal_analyze_visual',
    'inkpal_tap', 'inkpal_smart_tap', 'inkpal_scroll', 'inkpal_enter_text',
    'inkpal_get_interactive_elements', 'inkpal_get_elements',
    'inkpal_double_tap', 'inkpal_drag', 'inkpal_swipe', 'inkpal_press_key',
    'inkpal_scroll_to', 'inkpal_set_slider', 'inkpal_set_checkbox',
    'inkpal_page_summary', 'inkpal_find_element',
    'inkpal_deep_link',
    'inkpal_wait_for', 'inkpal_assert_element', 'inkpal_wait_for_idle',
    'inkpal_assert_ui', 'inkpal_test_flow',
    'inkpal_get_widget_details', 'inkpal_select_widget', 'inkpal_driver_command',
    'inkpal_visual_test', 'inkpal_visual_test_all',
    'inkpal_visual_baseline_save', 'inkpal_visual_baseline_compare',
    'inkpal_visual_report', 'inkpal_profile_performance',
    'inkpal_hover', 'inkpal_go_to_definition', 'inkpal_find_references',
    'inkpal_read_package_source', 'inkpal_search_package_source',
    'inkpal_save_session', 'inkpal_restore_session', 'inkpal_list_sessions',
    'inkpal_start_log_session', 'inkpal_end_log_session',
    'inkpal_assert_no_errors', 'inkpal_query_logs',
    'inkpal_video_start', 'inkpal_video_stop',
    'inkpal_recording_start', 'inkpal_recording_stop',
    'inkpal_recording_status', 'inkpal_recording_export',
    'inkpal_screen_snapshot', 'inkpal_screen_diff',
    'inkpal_state_capture', 'inkpal_state_list', 'inkpal_state_get', 'inkpal_state_diff',
    'inkpal_mock_network', 'inkpal_clear_network_mocks',
    'inkpal_go_offline', 'inkpal_go_online', 'inkpal_network_conditions',
    'inkpal_network_record', 'inkpal_network_replay',
    'inkpal_stability_check', 'inkpal_set_locale',
    'inkpal_devices_discover', 'inkpal_launch_all', 'inkpal_execute_all',
    'inkpal_screenshot_all', 'inkpal_compare_all', 'inkpal_test_cross_device',
    'inkpal_register_app', 'inkpal_orchestrate',
    'inkpal_orchestrate_status', 'inkpal_cross_app_test',
    'inkpal_auto_repair', 'inkpal_heal_watch', 'inkpal_heal_stop', 'inkpal_heal_verify',
    'inkpal_auto_commit', 'inkpal_create_pr', 'inkpal_pre_merge_gate',
    'inkpal_deploy', 'inkpal_ship',
    'inkpal_storage_status', 'inkpal_storage_cleanup', 'inkpal_storage_config',
]);
function run(cmd: string, cwd?: string, timeout = 60000): string {
    try {
        return execSync(cmd, { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...flutterEnv() } });
    }
    catch (e: unknown) {
        const err = e as {
            stdout?: string;
            stderr?: string;
            message?: string;
        };
        return err.stdout || err.stderr || err.message || String(e);
    }
}
function runChecked(cmd: string, cwd?: string, timeout = 60000): {
    ok: boolean;
    stdout: string;
    stderr: string;
    code: number | null;
    error?: string;
} {
    try {
        const stdout = execSync(cmd, { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...flutterEnv() }, stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, stdout, stderr: '', code: 0 };
    }
    catch (e: unknown) {
        const err = e as {
            stdout?: Buffer | string;
            stderr?: Buffer | string;
            status?: number;
            message?: string;
        };
        const stdoutText = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? '';
        const stderrText = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '';
        const msg = err.message ?? String(e);
        let hint: string | undefined;
        if (/command not found|ENOENT/i.test(msg) || /command not found/i.test(stderrText)) {
            const tool = cmd.split(/\s+/)[0];
            hint = `${tool} is not on PATH. Install it or add its directory to PATH.`;
        }
        else if (/timed out|ETIMEDOUT/i.test(msg)) {
            hint = `command timed out after ${timeout}ms`;
        }
        return { ok: false, stdout: stdoutText, stderr: stderrText, code: err.status ?? null, error: hint ?? msg };
    }
}
function walkDir(dir: string, match: (filename: string) => boolean, maxFiles = 500, maxDepth = 8): string[] {
    const out: string[] = [];
    const stack: Array<{
        path: string;
        depth: number;
    }> = [{ path: dir, depth: 0 }];
    while (stack.length > 0 && out.length < maxFiles) {
        const { path, depth } = stack.pop()!;
        if (depth > maxDepth)
            continue;
        let entries: string[];
        try {
            entries = readdirSync(path);
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (out.length >= maxFiles)
                break;
            if (entry.startsWith('.') || entry === 'node_modules' || entry === 'build' || entry === '.dart_tool')
                continue;
            const full = join(path, entry);
            let st;
            try {
                st = statSync(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory())
                stack.push({ path: full, depth: depth + 1 });
            else if (st.isFile() && match(entry))
                out.push(full);
        }
    }
    return out;
}
function safeUnlink(filePath: string): void {
    try {
        if (existsSync(filePath))
            unlinkSync(filePath);
    }
    catch { }
}
function detectPlatform(args: Record<string, unknown>, projectPath?: string): 'ios' | 'android' | 'web' | 'macos' | 'unknown' {
    const explicit = (args.platform as string)?.toLowerCase();
    if (explicit === 'ios' || explicit === 'android' || explicit === 'web' || explicit === 'macos')
        return explicit;
    const device = ((args.device || args.device_id) as string)?.toLowerCase() || '';
    if (device) {
        if (/iphone|ipad|simulator|com\.apple\.coresimulator/.test(device))
            return 'ios';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device))
            return 'ios';
        if (/emulator-|android|sdk_gphone/.test(device))
            return 'android';
        if (device === 'chrome' || device === 'web-server')
            return 'web';
        if (device === 'macos')
            return 'macos';
    }
    if (projectPath) {
        try {
            const stateFile = join(projectPath, '.inkpal', 'run-state.json');
            if (existsSync(stateFile)) {
                const state = JSON.parse(readFileSync(stateFile, 'utf8'));
                if (state.device)
                    return detectPlatform({ device: state.device }, undefined);
            }
        }
        catch { }
    }
    return 'unknown';
}
function isBridgeListening(port = 8765): boolean {
    try {
        const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | grep -i 'flutter\\|dart\\|node' | head -1`, { encoding: 'utf8', timeout: 2000 });
        return out.trim().length > 0;
    }
    catch {
        return false;
    }
}
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
function isProcessAlive(pid: number): boolean {
    if (!pid || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function launchAppProperly(args: Record<string, unknown>): Promise<unknown> {
    const proj = p(args);
    const device = (args.device as string) || '';
    const flavor = (args.flavor as string) || '';
    const timeoutSec = Math.min(Math.max((args.timeout as number) ?? 300, 30), 600);
    const force = args.force === true;
    const stateDir = join(proj, '.inkpal');
    if (!existsSync(stateDir))
        mkdirSync(stateDir, { recursive: true });
    const stateFile = runStateFile(proj);
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
            if (prev.pid && !isProcessAlive(prev.pid)) {
                safeUnlink(stateFile);
            }
        }
        catch { }
    }
    else if (force && existsSync(stateFile)) {
        try {
            const prev = JSON.parse(readFileSync(stateFile, 'utf8'));
            if (prev.pid && isProcessAlive(prev.pid)) {
                try {
                    process.kill(prev.pid, 'SIGTERM');
                }
                catch { }
                await new Promise(r => setTimeout(r, 1000));
                if (isProcessAlive(prev.pid)) {
                    try {
                        process.kill(prev.pid, 'SIGKILL');
                    }
                    catch { }
                }
            }
            safeUnlink(stateFile);
        }
        catch { }
    }
    const cmdArgs = ['run', '--machine'];
    if (device)
        cmdArgs.push('-d', device);
    if (flavor)
        cmdArgs.push('--flavor', flavor);
    const child = spawn('flutter', cmdArgs, {
        cwd: proj,
        env: { ...process.env, ...flutterEnv() },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    });
    let stdoutBuf = '';
    let stderrAccum = '';
    let appId: string | null = null;
    let debugPortUri = '';
    let startedUri = '';
    const eventsSeen: string[] = [];
    let buildProgress = 'spawning';
    const stderrLogPath = join(stateDir, 'flutter-stderr.log');
    try {
        writeFileSync(stderrLogPath, '');
    }
    catch { }
    const handleEvent = (evt: Record<string, unknown>): void => {
        if (typeof evt.event === 'string')
            eventsSeen.push(evt.event as string);
        const params = (evt.params || {}) as Record<string, unknown>;
        if (evt.event === 'app.start' || evt.event === 'app.started') {
            buildProgress = 'started';
            const u = (params.vmServiceUri as string) || (params.observatoryUri as string) || '';
            if (u && !startedUri)
                startedUri = u;
            if (typeof params.appId === 'string')
                appId = params.appId;
        }
        if (evt.event === 'app.debugPort') {
            buildProgress = 'debug_port';
            const u = (params.wsUri as string) || (params.uri as string) || '';
            if (u && !debugPortUri)
                debugPortUri = u;
            if (typeof params.appId === 'string')
                appId = params.appId;
        }
        if (evt.event === 'daemon.connected')
            buildProgress = 'daemon_connected';
        if (evt.event === 'app.progress') {
            const msg = (params.message as string) || '';
            if (msg)
                buildProgress = msg.slice(0, 60);
        }
    };
    child.stdout?.on('data', (data: Buffer) => {
        stdoutBuf += data.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const parsed = JSON.parse(trimmed);
                const events = Array.isArray(parsed) ? parsed : [parsed];
                for (const e of events)
                    handleEvent(e as Record<string, unknown>);
            }
            catch {
                const m = trimmed.match(/(?:https?|ws):\/\/127\.0\.0\.1:\d+\/[\w_\-+=\/]+/);
                if (m && !startedUri)
                    startedUri = m[0];
            }
        }
    });
    child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderrAccum += text;
        if (stderrAccum.length > 8000)
            stderrAccum = stderrAccum.slice(-8000);
        try {
            appendFileSync(stderrLogPath, text);
        }
        catch { }
        const m = text.match(/(?:https?|ws):\/\/127\.0\.0\.1:\d+\/[\w_\-+=\/]+/);
        if (m && !startedUri)
            startedUri = m[0];
    });
    child.unref();
    const deadline = Date.now() + timeoutSec * 1000;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    child.on('exit', (code, sig) => { exitCode = code; exitSignal = sig; });
    while (Date.now() < deadline) {
        if (startedUri || debugPortUri)
            break;
        if (exitCode !== null || exitSignal !== null)
            break;
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
function ensureAdb(): {
    ok: true;
} | {
    ok: false;
    error: string;
    hint: string;
    nextSteps: string[];
} {
    const probe = runChecked('adb version', undefined, 3000);
    if (probe.ok)
        return { ok: true };
    const home = process.env.HOME || '';
    const candidates = [
        process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools'),
        process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools'),
        join(home, 'Library', 'Android', 'sdk', 'platform-tools'),
        join(home, 'Android', 'Sdk', 'platform-tools'),
        join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
    ].filter(Boolean) as string[];
    for (const dir of candidates) {
        if (existsSync(join(dir, 'adb'))) {
            const current = process.env.PATH || '';
            if (!current.split(':').includes(dir)) {
                process.env.PATH = `${dir}:${current}`;
            }
            const reprobe = runChecked('adb version', undefined, 3000);
            if (reprobe.ok)
                return { ok: true };
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
function flutterEnv(): Record<string, string> {
    const extra: Record<string, string> = {};
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
    const stateFile = runStateFile(projectPath);
    if (existsSync(stateFile)) {
        try {
            const state = JSON.parse(readFileSync(stateFile, 'utf8'));
            const uri = state.vmServiceUri || state.vm_service_uri || null;
            if (uri && state.pid && isProcessAlive(state.pid))
                return uri;
        }
        catch { }
    }
    return discoverVmServiceUri(projectPath);
}
function discoverVmServiceUri(projectPath: string): string | null {
    const VM_URI_RE = /(?:https?|ws):\/\/(?:127\.0\.0\.1|localhost):\d+\/[\w_\-+=\/]+/;
    const stderrLog = join(projectPath, '.inkpal', 'flutter-stderr.log');
    if (existsSync(stderrLog)) {
        try {
            const content = readFileSync(stderrLog, 'utf8');
            const lines = content.split('\n').reverse();
            for (const line of lines) {
                const m = line.match(VM_URI_RE);
                if (m) {
                    const port = m[0].match(/:(\d+)\//)?.[1];
                    if (port && isPortListening(parseInt(port)))
                        return m[0];
                }
            }
        }
        catch { }
    }
    return null;
}
async function captureSessionLines(projectPath: string, platform: string, filterRe: string, baselineLineCount: number, startTs: string): Promise<string[]> {
    const out: string[] = [];
    if (platform === 'ios' || platform === 'unknown') {
        const sim = runChecked(`xcrun simctl list devices booted -j 2>/dev/null`, undefined, 3000);
        if (sim.ok && sim.stdout.includes('"state" : "Booted"')) {
            const startDate = startTs.replace('T', ' ').replace(/\..*$/, '');
            const r = runChecked(`xcrun simctl spawn booted log show --start "${startDate}" --predicate 'processImagePath contains "Runner" OR senderImagePath contains "Flutter"' 2>/dev/null | grep -iE "${filterRe}" | head -500`, undefined, 10000);
            if (r.ok)
                out.push(...r.stdout.split('\n').filter(Boolean));
            return out;
        }
    }
    const adbProbe = ensureAdb();
    if (!adbProbe.ok)
        return out;
    const r = runChecked(`adb logcat -d 2>/dev/null | tail -n +${baselineLineCount + 1} | grep -iE "${filterRe}" | head -500`, undefined, 10000);
    if (r.ok)
        out.push(...r.stdout.split('\n').filter(Boolean));
    return out;
}
function isPortListening(port: number): boolean {
    try {
        const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8', timeout: 2000 });
        return out.trim().length > 0;
    }
    catch {
        return false;
    }
}
function toHttpBase(vmUri: string): string {
    return vmUri.replace(/^ws:/, 'http:').replace(/\/ws\/?$/, '/').replace(/\/?$/, '/');
}
async function vmServiceCall(vmUri: string, method: string, params: Record<string, string | number> = {}, timeoutMs = 8000): Promise<{
    ok: boolean;
    result?: Record<string, unknown>;
    error?: {
        code: number;
        message: string;
    };
    raw?: string;
}> {
    const httpBase = toHttpBase(vmUri);
    const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const url = `${httpBase}${method}${qs ? '?' + qs : ''}`;
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        const text = await r.text();
        let body: unknown;
        try {
            body = JSON.parse(text);
        }
        catch {
            return { ok: false, raw: text, error: { code: -1, message: 'non_json_response' } };
        }
        const b = body as {
            result?: Record<string, unknown>;
            error?: {
                code: number;
                message: string;
            };
        };
        if (b.error)
            return { ok: false, error: b.error, raw: text };
        return { ok: true, result: b.result, raw: text };
    }
    catch (e) {
        return { ok: false, error: { code: -1, message: (e as Error)?.message ?? String(e) } };
    }
}
async function tryBridgeExtension(projectPath: string, args: Record<string, unknown>, extensionName: string, paramMap: Record<string, string | number | undefined>): Promise<{
    handled: true;
    response: Record<string, unknown>;
} | {
    handled: false;
    reason: string;
}> {
    const vmUri = (args.vm_service_uri as string) || getVmServiceUri(projectPath);
    if (!vmUri)
        return { handled: false, reason: 'no_vm_service_uri' };
    const isolateId = await getFlutterIsolateId(vmUri);
    if (!isolateId)
        return { handled: false, reason: 'no_isolate' };
    const params: Record<string, string | number> = { isolateId };
    for (const [k, v] of Object.entries(paramMap)) {
        if (v !== undefined && v !== null && v !== '')
            params[k] = String(v);
    }
    const r = await vmServiceCall(vmUri, extensionName, params, 15000);
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
async function getFlutterIsolateId(vmUri: string): Promise<string | null> {
    const vm = await vmServiceCall(vmUri, 'getVM');
    if (!vm.ok || !vm.result)
        return null;
    const isolates = (vm.result.isolates as Array<{
        id?: string;
        name?: string;
    }> | undefined) ?? [];
    if (!isolates.length)
        return null;
    const flutterIso = isolates.find(i => /flutter|main|root/i.test(i.name ?? ''));
    return (flutterIso ?? isolates[0])?.id ?? null;
}
function deriveVisualName(args: Record<string, unknown>): string {
    const explicit = (args.name as string)?.trim();
    if (explicit)
        return explicit.replace(/[^a-z0-9_-]/gi, '_');
    const route = (args.route as string)
        || ((args.routes as unknown[] | undefined)?.[0] as string | undefined)
        || '';
    const trimmed = route.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed)
        return 'root';
    return trimmed.replace(/[^a-z0-9_-]/gi, '_');
}
import { homedir } from 'node:os';
import { createHash as _createHash } from 'node:crypto';
const RULE_CACHE_DIR = join(homedir(), '.inkpal', 'cache', 'rules');
const RULE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RAILWAY_BASE = process.env.INKPAL_API_URL || 'https://mcp.inkpal.ai';
const REGISTRY_CACHE_FILE = join(homedir(), '.inkpal', 'cache', 'registry.json');
const REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
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
    deps?: {
        required?: string[];
        preferred?: string[];
    };
    examples?: Array<{
        args: Record<string, unknown>;
        expected?: string;
    }>;
    known_issues?: Array<{
        id: string;
        summary: string;
    }>;
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
    if (_registryCache)
        return _registryCache;
    if (existsSync(REGISTRY_CACHE_FILE)) {
        try {
            const cached = JSON.parse(readFileSync(REGISTRY_CACHE_FILE, 'utf8')) as RegistryResponse;
            if (cached.cached_at && Date.now() - cached.cached_at < REGISTRY_CACHE_TTL_MS) {
                _registryCache = cached;
                return cached;
            }
        }
        catch { }
    }
    try {
        const r = await fetch(`${RAILWAY_BASE}/api/registry`, {
            headers: { 'Authorization': `Bearer ${process.env.INKPAL_LICENSE_KEY ?? ''}` },
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok)
            return null;
        const body = await r.json() as RegistryResponse;
        body.cached_at = Date.now();
        try {
            mkdirSync(join(homedir(), '.inkpal', 'cache'), { recursive: true });
            writeFileSync(REGISTRY_CACHE_FILE, JSON.stringify(body, null, 2));
        }
        catch { }
        _registryCache = body;
        return body;
    }
    catch {
        return null;
    }
}
export function isRegistered(toolName: string, registry: RegistryResponse | null): boolean {
    if (!registry)
        return false;
    return registry.tools.some(t => t.name === toolName);
}
interface RulePackResponse {
    pack_name: string;
    rules: unknown[];
    version: string;
    cached_at?: number;
}
async function fetchRulePack(packName: string): Promise<RulePackResponse | null> {
    const licenseKey = process.env.INKPAL_LICENSE_KEY ?? '';
    if (!licenseKey)
        return null;
    const keyHash = _createHash('sha256').update(licenseKey).digest('hex').slice(0, 12);
    const cacheFile = join(RULE_CACHE_DIR, `${packName}-${keyHash}.json`);
    if (existsSync(cacheFile)) {
        try {
            const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as RulePackResponse;
            if (cached.cached_at && Date.now() - cached.cached_at < RULE_CACHE_TTL_MS) {
                return cached;
            }
        }
        catch { }
    }
    try {
        const r = await fetch(`${RAILWAY_BASE}/api/rules/${encodeURIComponent(packName)}`, {
            headers: {
                'Authorization': `Bearer ${licenseKey}`,
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok)
            return null;
        const body = await r.json() as RulePackResponse;
        body.cached_at = Date.now();
        try {
            mkdirSync(RULE_CACHE_DIR, { recursive: true });
            writeFileSync(cacheFile, JSON.stringify(body, null, 2));
        }
        catch { }
        return body;
    }
    catch {
        return null;
    }
}
export async function handleLocal(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
        case 'inkpal_registry': {
            const reg = await getRegistry();
            if (!reg) {
                return {
                    success: false,
                    error: 'registry_unavailable',
                    hint: 'Railway unreachable AND no cached registry at ~/.inkpal/cache/registry.json. Tools still work via legacy path; chain executor will log fallback_used:true.',
                };
            }
            const filter = args.filter as {
                id?: string;
                name?: string;
                department?: string;
                status?: string;
            } | undefined;
            let tools = reg.tools;
            if (filter?.id)
                tools = tools.filter(t => t.id === filter.id);
            if (filter?.name)
                tools = tools.filter(t => t.name === filter.name);
            if (filter?.department)
                tools = tools.filter(t => t.department === filter.department);
            if (filter?.status)
                tools = tools.filter(t => t.status === filter.status);
            return {
                success: true,
                version: reg.version,
                generated_at: reg.generated_at,
                tool_count: tools.length,
                tools,
            };
        }
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
        case 'inkpal_progress': {
            const { handleProgress } = await import('./progress.js');
            return handleProgress(args as Record<string, unknown>);
        }
        case 'inkpal_spec_to_plan': {
            const { handleSpec } = await import('./spec.js');
            return handleSpec(args as Record<string, unknown>);
        }
        case 'inkpal_validate_system': {
            const { runFullValidation } = await import('./validation.js');
            const report = await runFullValidation();
            const layers = (args.layers as string[] | undefined) ?? null;
            if (!layers)
                return report;
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
            for (const k of layers)
                if (map[k] !== undefined)
                    filtered[k] = map[k];
            return filtered;
        }
        case 'inkpal_batch_actions': {
            const actions = (args.actions as Array<{
                tool: string;
                args: Record<string, unknown>;
            }>) ?? [];
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
            const results: Array<{
                idx: number;
                tool: string;
                ok: boolean;
                output?: unknown;
                error?: string;
                duration_ms: number;
            }> = [];
            const t0 = Date.now();
            for (let i = 0; i < actions.length; i++) {
                const a = actions[i];
                if (!allowed.has(a.tool)) {
                    results.push({ idx: i, tool: a.tool, ok: false, error: 'tool_not_in_batch_allowlist', duration_ms: 0 });
                    if (!continueOnError)
                        break;
                    continue;
                }
                const start = Date.now();
                try {
                    const r = await handleLocal(a.tool, a.args ?? {}) as Record<string, unknown> | null;
                    const ok = r != null && r.success !== false && !r.error;
                    results.push({ idx: i, tool: a.tool, ok, output: r, error: !ok ? (r?.error as string) : undefined, duration_ms: Date.now() - start });
                    if (!ok && !continueOnError)
                        break;
                }
                catch (e) {
                    results.push({ idx: i, tool: a.tool, ok: false, error: (e as Error).message, duration_ms: Date.now() - start });
                    if (!continueOnError)
                        break;
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
        case 'inkpal_cleanup_storage': {
            const { runManualCleanup } = await import('./cleanup.js');
            const proj = (args.project_path as string) || (args.project_path === '' ? '' : p(args));
            return runManualCleanup({
                project_path: proj || undefined,
                force_size_cap: (args.force_size_cap as boolean) ?? false,
                retention_hours: (args.retention_hours as number) ?? 24,
            });
        }
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
                const statusWeight = t.status === 'WORKING' ? 1 : t.status === 'DEGRADED' ? 0.6 : 0.2;
                const reliability = t.telemetry?.success_rate_30d ?? 1.0;
                const confidence = Math.min(1, keywordScore * 0.4 + statusWeight * 0.3 + reliability * 0.3);
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
            if (latency > 100) {
                try {
                    appendFileSync(join(homedir(), '.inkpal', 'sessions', 'latency-violations.jsonl'), JSON.stringify({ ts: new Date().toISOString(), tool: toolName, latency, budget: 100 }) + '\n');
                }
                catch { }
            }
            const top = ranked[0];
            return {
                success: true,
                department: dept,
                intent,
                tool: top.id,
                confidence: top.confidence,
                reason: top.reason,
                ranked,
                latency_ms: latency,
                budget_ms: 100,
                ...(top.known_issues?.length ? { known_issues: top.known_issues } : {}),
            };
        }
        case 'inkpal_lookup_error': {
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
            type Pattern = {
                code: string;
                regex: string;
                category: string;
                message: string;
                fixes?: string[];
            };
            const patterns = cloudPack.rules as Pattern[];
            const matches: Array<Record<string, unknown>> = [];
            for (const pattern of patterns) {
                try {
                    const re = new RegExp(pattern.regex, 'i');
                    const m = query.match(re);
                    if (m)
                        matches.push({ code: pattern.code, message: pattern.message, category: pattern.category, fixes: pattern.fixes ?? [], matched_text: m[0] });
                }
                catch { }
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
        case 'inkpal_analyze_project': {
            const proj = p(args);
            const pubspecPath = join(proj, 'pubspec.yaml');
            if (!existsSync(pubspecPath)) {
                return { success: false, error: 'not_a_flutter_project', message: 'No pubspec.yaml found.', hint: `cd to a Flutter project root or pass project_path arg.` };
            }
            const pubspec_yaml = readFileSync(pubspecPath, 'utf8');
            const target_platforms: string[] = [];
            if (existsSync(join(proj, 'ios')))
                target_platforms.push('ios');
            if (existsSync(join(proj, 'android')))
                target_platforms.push('android');
            if (existsSync(join(proj, 'web')))
                target_platforms.push('web');
            if (existsSync(join(proj, 'macos')) || existsSync(join(proj, 'linux')) || existsSync(join(proj, 'windows'))) {
                target_platforms.push('desktop');
            }
            const has_tests = existsSync(join(proj, 'test'));
            let dartFileCount = 0;
            let hasMain = false;
            const libDir = join(proj, 'lib');
            if (existsSync(libDir)) {
                const dartFiles = walkDir(libDir, (n) => n.endsWith('.dart'), 5000, 5);
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
            const rulesRaw = cloudPack.rules as Array<{
                rule: string;
                severity: string;
                pattern: string;
                fix: string;
            }>;
            const RULES = rulesRaw.map(r => ({ ...r, pattern: new RegExp(r.pattern, 'g') }));
            const findings: Array<{
                severity: string;
                rule: string;
                line: number;
                match: string;
                fix: string;
            }> = [];
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
        case 'inkpal_doctor':
        case 'inkpal_project_doctor': {
            const proj = p(args);
            const checks: Array<{
                name: string;
                ok: boolean;
                detail?: string;
                fix?: string;
            }> = [];
            const flutterProbe = runChecked('flutter --version', undefined, 5000);
            checks.push({
                name: 'flutter_sdk',
                ok: flutterProbe.ok,
                detail: flutterProbe.ok ? flutterProbe.stdout.split('\n')[0] : flutterProbe.error,
                fix: flutterProbe.ok ? undefined : 'Install Flutter: https://flutter.dev/docs/get-started/install',
            });
            const pubspecPath = join(proj, 'pubspec.yaml');
            const isFlutter = existsSync(pubspecPath);
            let pubspecText = '';
            if (isFlutter)
                pubspecText = readFileSync(pubspecPath, 'utf8');
            checks.push({
                name: 'flutter_project',
                ok: isFlutter && /^\s*flutter:/m.test(pubspecText),
                detail: isFlutter ? `pubspec.yaml found at ${pubspecPath}` : 'no pubspec.yaml',
                fix: isFlutter ? undefined : 'cd to a Flutter project root or pass project_path arg.',
            });
            const hasBridge = /^\s*inkpal_bridge:/m.test(pubspecText);
            checks.push({
                name: 'inkpal_bridge_dep',
                ok: hasBridge,
                detail: hasBridge ? 'inkpal_bridge is in pubspec' : 'inkpal_bridge NOT in pubspec',
                fix: hasBridge ? undefined : 'Run: flutter pub add inkpal_bridge',
            });
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
            const hasLicenseKey = !!process.env.INKPAL_LICENSE_KEY?.startsWith('ink_');
            checks.push({
                name: 'license_key',
                ok: hasLicenseKey,
                detail: hasLicenseKey ? `License key present (ink_${(process.env.INKPAL_LICENSE_KEY ?? '').slice(4, 8)}…)` : 'INKPAL_LICENSE_KEY env not set or invalid format',
                fix: hasLicenseKey ? undefined : 'Add to your MCP config env: { "INKPAL_LICENSE_KEY": "ink_…" }. Get free key at https://inkpal.ai/pricing',
            });
            const stateDir = join(proj, '.inkpal');
            checks.push({
                name: 'state_dir',
                ok: existsSync(stateDir),
                detail: existsSync(stateDir) ? `${stateDir} exists` : `will be created on first inkpal_launch_app`,
            });
            const stateFile = join(stateDir, 'run-state.json');
            let runStateOk = false;
            let runStateDetail = 'no active run';
            if (existsSync(stateFile)) {
                try {
                    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
                    if (state.pid && isProcessAlive(state.pid)) {
                        runStateOk = true;
                        runStateDetail = `app running PID ${state.pid}, VM at ${state.vmServiceUri}`;
                    }
                    else {
                        runStateDetail = `STALE: PID ${state.pid} dead`;
                    }
                }
                catch {
                    runStateDetail = 'corrupt run-state.json';
                }
            }
            checks.push({ name: 'flutter_run_alive', ok: runStateOk, detail: runStateDetail });
            const adbProbe = ensureAdb();
            checks.push({
                name: 'adb',
                ok: adbProbe.ok,
                detail: adbProbe.ok ? 'adb on PATH' : 'adb missing (only required for Android targets)',
            });
            const xcrunProbe = runChecked('xcrun --version', undefined, 3000);
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
                            if (/Page|Screen|View$/.test(m[1]))
                                screen_candidates.push(m[1]);
                        }
                    }
                    catch { }
                }
            }
            catch { }
            const target_platforms: string[] = [];
            if (existsSync(join(proj, 'ios')))
                target_platforms.push('ios');
            if (existsSync(join(proj, 'android')))
                target_platforms.push('android');
            if (existsSync(join(proj, 'web')))
                target_platforms.push('web');
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
            const pkg = ((args.package || args.package_name || args.name) as string)?.trim();
            if (!pkg)
                return { success: false, error: 'package_required', hint: 'Pass {package: "go_router"}.' };
            try {
                const r = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(pkg)}`, {
                    signal: AbortSignal.timeout(8000),
                });
                if (r.status === 404)
                    return { success: false, exists: false, package: pkg, hint: `Package "${pkg}" not found on pub.dev.` };
                if (!r.ok)
                    return { success: false, error: `pub_dev_${r.status}`, package: pkg };
                const data = await r.json() as {
                    latest?: {
                        version?: string;
                        pubspec?: Record<string, unknown>;
                    };
                    name?: string;
                };
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
            }
            catch (e) {
                return { success: false, error: 'pub_dev_unreachable', package: pkg, detail: (e as Error).message };
            }
        }
        case 'inkpal_pub_dev_search': {
            const query = ((args.query || args.q) as string)?.trim();
            if (!query)
                return { success: false, error: 'query_required', hint: 'Pass {query: "state management"}.' };
            const limit = Math.min((args.limit as number) || 8, 20);
            const includeMetrics = args.include_metrics !== false;
            try {
                const r = await fetch(`https://pub.dev/api/search?q=${encodeURIComponent(query)}`, {
                    signal: AbortSignal.timeout(8000),
                });
                if (!r.ok)
                    return { success: false, error: `pub_dev_${r.status}` };
                const data = await r.json() as {
                    packages?: Array<{
                        package: string;
                    }>;
                    next?: string;
                };
                const names = (data.packages || []).slice(0, limit).map(p => p.package);
                let packages: Array<string | Record<string, unknown>> = names;
                if (includeMetrics && names.length) {
                    const metrics = await Promise.allSettled(names.map(async (name) => {
                        try {
                            const sr = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(name)}/score`, {
                                signal: AbortSignal.timeout(4000),
                            });
                            if (!sr.ok)
                                return { name };
                            const s = await sr.json() as {
                                grantedPoints?: number;
                                maxPoints?: number;
                                likeCount?: number;
                                popularityScore?: number;
                            };
                            return {
                                name,
                                pub_points: s.grantedPoints != null && s.maxPoints != null ? `${s.grantedPoints}/${s.maxPoints}` : undefined,
                                likes: s.likeCount,
                                popularity: s.popularityScore != null ? Math.round(s.popularityScore * 100) : undefined,
                            };
                        }
                        catch {
                            return { name };
                        }
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
            }
            catch (e) {
                return { success: false, error: 'pub_dev_unreachable', detail: (e as Error).message };
            }
        }
        case 'inkpal_get_blast_radius': {
            const proj = p(args);
            const targetFile = ((args.file || args.file_path || args.path) as string) || '';
            if (!targetFile)
                return { success: false, error: 'file_required', hint: 'Pass {file: "lib/main.dart"}.' };
            const target = targetFile.startsWith('/') ? targetFile : join(proj, targetFile);
            if (!existsSync(target))
                return { success: false, error: 'file_not_found', file: target };
            const baseName = target.split('/').pop()?.replace(/\.dart$/, '') || '';
            const libDir = join(proj, 'lib');
            const importers: string[] = [];
            try {
                const all = walkDir(libDir, (n) => n.endsWith('.dart'), 5000, 8);
                for (const f of all) {
                    if (f === target)
                        continue;
                    try {
                        const t = readFileSync(f, 'utf8');
                        const re = new RegExp(`import\\s+['"](?:[^'"\\n]*/)?${baseName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\.dart['"]`, 'm');
                        if (re.test(t))
                            importers.push(f.replace(proj + '/', ''));
                    }
                    catch { }
                }
            }
            catch { }
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
            const auditT0 = Date.now();
            const proj = p(args);
            const targetFile = ((args.file || args.file_path || args.path) as string) || '';
            const isA11y = toolName === 'inkpal_accessibility_audit';
            const files: string[] = [];
            if (targetFile) {
                const t = targetFile.startsWith('/') ? targetFile : join(proj, targetFile);
                if (!existsSync(t))
                    return { success: false, error: 'file_not_found', file: t };
                files.push(t);
            }
            else {
                const libDir = join(proj, 'lib');
                if (!existsSync(libDir))
                    return { success: false, error: 'no_lib_dir', hint: 'Pass {file: "lib/foo.dart"} or run from a Flutter project root.' };
                files.push(...walkDir(libDir, (n) => n.endsWith('.dart'), 200, 8));
            }
            const target_platforms: ('ios' | 'android' | 'web' | 'desktop')[] = [];
            if (existsSync(join(proj, 'ios')))
                target_platforms.push('ios');
            if (existsSync(join(proj, 'android')))
                target_platforms.push('android');
            if (existsSync(join(proj, 'web')))
                target_platforms.push('web');
            if (existsSync(join(proj, 'macos')) || existsSync(join(proj, 'linux')) || existsSync(join(proj, 'windows'))) {
                target_platforms.push('desktop');
            }
            const has_tests = existsSync(join(proj, 'test'));
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
            const RULES = (cloud.rules as Array<{
                rule: string;
                severity: string;
                pattern: string;
                message: string;
                source_pack: string;
                file_target?: string;
            }>)
                .filter(r => r.pattern && !r.file_target)
                .map(r => ({ rule: r.rule, severity: r.severity, message: r.message, source_pack: r.source_pack, re: new RegExp(r.pattern, 'm') }));
            const findings: Array<{
                file: string;
                line: number;
                severity: string;
                rule: string;
                message: string;
                source_pack: string;
            }> = [];
            for (const f of files) {
                let src: string;
                try {
                    src = readFileSync(f, 'utf8');
                }
                catch {
                    continue;
                }
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
            const resolution = cloud.resolution as {
                loaded: string[];
                excluded: {
                    pack: string;
                    reason: string;
                }[];
            } | undefined;
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
        case 'inkpal_flutter_analyze': {
            const out = run('dart analyze', p(args));
            const errs = out.split('\n').filter(l => l.includes('error •') || l.includes('warning •'));
            return { output: out, errorCount: errs.length, errors: errs };
        }
        case 'inkpal_flutter_test': {
            const proj = p(args);
            const parts: string[] = ['flutter', 'test'];
            if (args.test_file)
                parts.push(args.test_file as string);
            if (args.name_filter)
                parts.push(`--name "${args.name_filter}"`);
            if (args.coverage)
                parts.push('--coverage');
            const out = run(parts.join(' '), proj, 300000);
            const allPassMatch = out.match(/\+(\d+)\s*:\s*All tests passed/i);
            const someFailedMatch = out.match(/\+(\d+)\s+-(\d+)\s*:\s*Some tests failed/i);
            let passed = 0;
            let failed = 0;
            if (allPassMatch) {
                passed = parseInt(allPassMatch[1]);
            }
            else if (someFailedMatch) {
                passed = parseInt(someFailedMatch[1]);
                failed = parseInt(someFailedMatch[2]);
            }
            else {
                const passWord = out.match(/(\d+) tests? passed/i);
                const failWord = out.match(/(\d+) tests? failed/i);
                if (passWord)
                    passed = parseInt(passWord[1]);
                if (failWord)
                    failed = parseInt(failWord[1]);
                if (passed === 0 && failed === 0) {
                    const allPlus = [...out.matchAll(/\+(\d+)/g)];
                    const allMinus = [...out.matchAll(/-(\d+)/g)];
                    if (allPlus.length)
                        passed = parseInt(allPlus[allPlus.length - 1][1]);
                    if (allMinus.length)
                        failed = parseInt(allMinus[allMinus.length - 1][1]);
                }
            }
            const failures = [...out.matchAll(/(?:FAILED|EXCEPTION)[\s\S]*?(?=\n\n|\n[+\-]|$)/gi)]
                .map(m => m[0].trim()).slice(0, 10);
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
                        const RULES = (cloud.rules as Array<{
                            rule: string;
                            severity: string;
                            pattern: string;
                            message: string;
                            source_pack: string;
                            file_target?: string;
                        }>)
                            .filter(r => r.pattern && !r.file_target)
                            .map(r => ({ rule: r.rule, severity: r.severity, message: r.message, source_pack: r.source_pack, re: new RegExp(r.pattern, 'm') }));
                        const findings: Array<{
                            file: string;
                            line: number;
                            severity: string;
                            rule: string;
                            message: string;
                            source_pack: string;
                        }> = [];
                        const testFiles = walkDir(testDir, (n) => n.endsWith('_test.dart'), 100, 8);
                        for (const f of testFiles) {
                            let src = '';
                            try {
                                src = readFileSync(f, 'utf8');
                            }
                            catch {
                                continue;
                            }
                            const lines = src.split('\n');
                            const rel = f.replace(proj + '/', '');
                            for (let i = 0; i < lines.length; i++) {
                                for (const r of RULES)
                                    if (r.re.test(lines[i])) {
                                        findings.push({ file: rel, line: i + 1, severity: r.severity, rule: r.rule, message: r.message, source_pack: r.source_pack });
                                    }
                            }
                        }
                        const resolution = cloud.resolution as {
                            loaded: string[];
                        } | undefined;
                        test_quality = {
                            packs_loaded: resolution?.loaded ?? [],
                            files_scanned: testFiles.length,
                            findings_count: findings.length,
                            findings: findings.slice(0, 50),
                        };
                    }
                }
            }
            catch { }
            return { passed, failed, total: passed + failed, failures, output: out, ...(test_quality ? { test_quality } : {}) };
        }
        case 'inkpal_flutter_build': {
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
                    hint: `Project has no ${dir}/ directory. Add the platform: \`flutter create . --platforms=${dir.replace('android', 'android').replace('ios', 'ios').replace('web', 'web')}\``,
                    recovery_command: `flutter create . --platforms=${dir === 'android' ? 'android' : dir === 'ios' ? 'ios' : dir}`,
                    next_tool: 'inkpal_flutter_build',
                };
            }
            const r = runChecked(`flutter build ${platform} --${mode}`, proj, 600000);
            if (r.ok) {
                return { success: true, platform, mode, output: r.stdout.trim() };
            }
            const stderr = (r.stderr || '').trim();
            const stdout = (r.stdout || '').trim();
            const combined = `${stdout}\n${stderr}`;
            let hint = `Run \`flutter build ${platform} --${mode}\` manually for the full diagnostic output.`;
            if (/Missing index\.html/i.test(combined))
                hint = `Missing web/ scaffold. Run: flutter create . --platforms=web`;
            else if (/Xcode|CocoaPods/i.test(combined))
                hint = 'iOS build failed — open ios/Runner.xcworkspace in Xcode for the full error.';
            else if (/Gradle/i.test(combined))
                hint = 'Android Gradle build failed — check android/app/build.gradle and SDK versions.';
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
            const out = run('flutter test --coverage', proj, 300000);
            const lcovPath = join(proj, 'coverage', 'lcov.info');
            if (!existsSync(lcovPath))
                return { output: out, error: 'No coverage/lcov.info generated' };
            const lcov = readFileSync(lcovPath, 'utf8');
            const files: Array<{
                file: string;
                lines: number;
                hit: number;
                pct: string;
            }> = [];
            let currentFile = '';
            let lines = 0, hit = 0;
            for (const line of lcov.split('\n')) {
                if (line.startsWith('SF:')) {
                    currentFile = line.slice(3);
                    lines = 0;
                    hit = 0;
                }
                else if (line.startsWith('LF:'))
                    lines = parseInt(line.slice(3));
                else if (line.startsWith('LH:'))
                    hit = parseInt(line.slice(3));
                else if (line === 'end_of_record' && currentFile) {
                    files.push({ file: currentFile, lines, hit, pct: lines ? `${((hit / lines) * 100).toFixed(1)}%` : '0%' });
                }
            }
            const totalLines = files.reduce((s, f) => s + f.lines, 0);
            const totalHit = files.reduce((s, f) => s + f.hit, 0);
            return { coverage: totalLines ? `${((totalHit / totalLines) * 100).toFixed(1)}%` : '0%', files, output: out };
        }
        case 'inkpal_coverage_gaps': {
            const proj = p(args);
            const lcovPath = join(proj, 'coverage', 'lcov.info');
            if (!existsSync(lcovPath))
                return { error: 'Run inkpal_coverage_report first to generate coverage data' };
            const lcov = readFileSync(lcovPath, 'utf8');
            const gaps: Array<{
                file: string;
                uncoveredLines: number[];
            }> = [];
            let currentFile = '';
            let uncovered: number[] = [];
            for (const line of lcov.split('\n')) {
                if (line.startsWith('SF:')) {
                    currentFile = line.slice(3);
                    uncovered = [];
                }
                else if (line.startsWith('DA:')) {
                    const [ln, cnt] = line.slice(3).split(',').map(Number);
                    if (cnt === 0)
                        uncovered.push(ln);
                }
                else if (line === 'end_of_record' && uncovered.length) {
                    gaps.push({ file: currentFile, uncoveredLines: uncovered });
                }
            }
            return { gaps, totalUncoveredFiles: gaps.length };
        }
        case 'inkpal_list_devices': {
            const out = run('flutter devices --machine');
            let devices: unknown[] = [];
            try {
                devices = JSON.parse(out);
            }
            catch {
                return { output: out };
            }
            const hasEmulator = Array.isArray(devices) && devices.some((d: unknown) => (d as Record<string, unknown>)?.emulator === true
                || String((d as Record<string, unknown>)?.id ?? '').startsWith('emulator-'));
            let bridgePortInfo: Record<string, unknown> = {};
            if (hasEmulator) {
                const adbProbe = ensureAdb();
                if (adbProbe.ok) {
                    const fwd = runChecked('adb forward tcp:8765 tcp:8765', undefined, 5000);
                    bridgePortInfo = fwd.ok
                        ? { bridge_port_forwarded: true, port_forward_output: fwd.stdout.trim() }
                        : { bridge_port_forwarded: false, port_forward_error: fwd.error ?? fwd.stderr.trim() };
                }
                else {
                    bridgePortInfo = { bridge_port_forwarded: false, port_forward_error: adbProbe.error };
                }
            }
            return { devices, ...bridgePortInfo };
        }
        case 'inkpal_devices_discover': {
            const flutterRaw = run('flutter devices --machine');
            let flutterDevices: unknown[] = [];
            try {
                flutterDevices = JSON.parse(flutterRaw);
            }
            catch { }
            const sources: Record<string, unknown> = { flutter: flutterDevices };
            const adbProbe = ensureAdb();
            if (adbProbe.ok) {
                const adb = runChecked('adb devices -l', undefined, 5000);
                if (adb.ok) {
                    const adbDevices = adb.stdout.split('\n')
                        .filter(l => l.trim() && !l.startsWith('List of'))
                        .map(l => {
                        const parts = l.trim().split(/\s+/);
                        return { id: parts[0], state: parts[1], descriptor: parts.slice(2).join(' ') };
                    });
                    sources.adb = adbDevices;
                }
                else {
                    sources.adb_error = adb.error ?? adb.stderr.trim();
                }
            }
            else {
                sources.adb_error = adbProbe.error;
            }
            const simBooted = runChecked(`xcrun simctl list devices booted -j`, undefined, 5000);
            if (simBooted.ok) {
                try {
                    sources.ios_simulators_booted = JSON.parse(simBooted.stdout);
                }
                catch {
                    sources.ios_simulators_booted_raw = simBooted.stdout.trim();
                }
            }
            const xcDevices = runChecked('xcrun xctrace list devices 2>&1', undefined, 5000);
            if (xcDevices.ok) {
                const physical = xcDevices.stdout.split('\n')
                    .filter(l => /\([\dA-F-]+\)\s+\([\dA-F-]+\)/i.test(l))
                    .slice(0, 10);
                if (physical.length)
                    sources.ios_physical = physical;
            }
            const allIds = new Set<string>();
            for (const d of flutterDevices) {
                const id = (d as Record<string, unknown>)?.id;
                if (typeof id === 'string')
                    allIds.add(id);
            }
            if (Array.isArray(sources.adb)) {
                for (const d of sources.adb as Array<{
                    id: string;
                }>)
                    allIds.add(d.id);
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
        case 'inkpal_launch_app': {
            return await launchAppProperly(args);
        }
        case 'inkpal_hot_reload':
        case 'inkpal_hot_restart': {
            const proj = p(args);
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
                const r = await vmServiceCall(vmUri, `_flutter.${method}`, { isolateId }, 30000);
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
                const result = r.result as {
                    type?: string;
                    success?: boolean;
                    notices?: unknown[];
                } | undefined;
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
            }
            catch (e) {
                return { success: false, error: String((e as Error)?.message ?? e), method };
            }
        }
        case 'inkpal_screenshot': {
            const proj = p(args);
            const out = (args.output_path as string) || '/tmp/inkpal_screenshot.png';
            const dev = (args.device_id as string) || '';
            let method = (args.method as string) || '';
            if (!method) {
                const platform = detectPlatform({ ...args, device: dev || (args as Record<string, unknown>).device }, proj);
                if (platform === 'ios')
                    method = 'simctl';
                else if (platform === 'android')
                    method = 'adb';
                else {
                    const simBooted = runChecked(`xcrun simctl list devices booted -j 2>/dev/null`, undefined, 3000);
                    if (simBooted.ok && simBooted.stdout.includes('"state" : "Booted"'))
                        method = 'simctl';
                    else
                        method = 'adb';
                }
            }
            let r: {
                ok: boolean;
                stdout: string;
                stderr: string;
                error?: string;
            };
            if (method === 'simctl') {
                r = runChecked(`xcrun simctl io "${dev || 'booted'}" screenshot "${out}"`, undefined, 30000);
            }
            else if (method === 'adb') {
                const adbProbe = ensureAdb();
                if (!adbProbe.ok)
                    return adbProbe;
                r = runChecked(`adb exec-out screencap -p > "${out}"`, undefined, 30000);
            }
            else if (method === 'flutter') {
                r = runChecked(`flutter screenshot --out "${out}"`, proj, 30000);
            }
            else {
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
            if (!existsSync(out))
                return { success: false, method, path: out, error: 'no_file_written' };
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
            }
            catch { }
            return { success: true, method, path: out, bytes: stats.size };
        }
        case 'inkpal_get_runtime_errors':
        case 'inkpal_get_app_logs': {
            const proj = p(args);
            const platform = detectPlatform(args, proj);
            const lines = (args.lines as number) || (args.last_n as number) || 100;
            const filter = (args.filter as string) || 'flutter|dart|error|exception|crash';
            if (platform === 'ios' || platform === 'unknown') {
                const sim = runChecked(`xcrun simctl list devices booted -j 2>/dev/null`, undefined, 3000);
                if (sim.ok && sim.stdout.includes('"state" : "Booted"')) {
                    const udid = ((args.device || args.device_id) as string) || 'booted';
                    const r = runChecked(`xcrun simctl spawn ${udid} log show --last 5m --predicate 'processImagePath contains "Runner" OR senderImagePath contains "Flutter"' 2>/dev/null | grep -iE "${filter}" | tail -${lines}`, undefined, 10000);
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
            const r = runChecked(`adb logcat -d -t ${lines} | grep -iE "${filter}"`, undefined, 10000);
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
            if (isBridgeListening()) {
                return {
                    forward_remote: true,
                    tool: 'inkpal_navigate_to_route',
                    args: { ...args, project_path: proj, _via: 'bridge' },
                    note: 'Routing through Railway → bridge VM extension (preferred path).',
                };
            }
            const vmUri = (args.vm_service_uri as string) || getVmServiceUri(proj);
            if (vmUri) {
                const isolateId = await getFlutterIsolateId(vmUri);
                if (isolateId) {
                    const ext = await vmServiceCall(vmUri, 'ext.flutter.inkpal.navigate', { isolateId, route }, 8000);
                    if (ext.ok) {
                        return { success: true, route, method: 'vm_service_extension', source: 'ext.flutter.inkpal.navigate', isolate_id: isolateId, result: ext.result };
                    }
                    if (ext.error?.code === -32601) {
                        const evalRes = await vmServiceCall(vmUri, 'evaluateInFrame', {
                            isolateId,
                            frameIndex: 0,
                            expression: `inkpalNavigatorKey.currentState?.pushNamed("${route.replace(/"/g, '\\"')}")`,
                        }, 8000);
                        if (evalRes.ok) {
                            return { success: true, route, method: 'vm_service_evaluate', source: 'inkpalNavigatorKey.pushNamed', isolate_id: isolateId };
                        }
                    }
                }
            }
            if (platform === 'ios') {
                const udid = ((args.device || args.device_id) as string) || 'booted';
                const r = runChecked(`xcrun simctl openurl ${udid} "inkpal://navigate${route}"`, undefined, 10000);
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
            const adbProbe = ensureAdb();
            if (!adbProbe.ok) {
                return {
                    ...adbProbe,
                    note: 'No bridge listening AND adb missing AND not detected as iOS. Either install adb, boot iOS sim, or install inkpal_bridge in your app.',
                };
            }
            const r = runChecked(`adb shell am start -a android.intent.action.VIEW -d "inkpal://navigate${route}"`, undefined, 10000);
            if (!r.ok) {
                return { success: false, route, platform: 'android', method: 'adb_deep_link', error: r.error ?? r.stderr.trim(), hint: 'Verify a device is connected and the app handles the inkpal:// scheme.' };
            }
            return { success: true, route, platform: 'android', method: 'adb_deep_link', stdout: r.stdout.trim() };
        }
        case 'inkpal_evaluate': {
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
            if (!expr.trim())
                return { success: false, error: 'expression_required', hint: 'Pass {expression: "Get.find<MyController>().value"}.' };
            return { forward_remote: true, tool: 'inkpal_evaluate', args: { ...args, vm_service_uri: vmUri, project_path: proj } };
        }
        case 'inkpal_inspect_widget_tree': {
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
            const r = await vmServiceCall(vmUri, inspectorMethod, { isolateId, objectGroup }, 15000);
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
            const rootCandidate = (tree?.result && typeof tree.result === 'object')
                ? tree.result as Record<string, unknown>
                : tree;
            if (rootCandidate && typeof rootCandidate === 'object') {
                let nodeCount = 0;
                const types: Record<string, number> = {};
                const walk = (n: unknown) => {
                    if (!n || typeof n !== 'object')
                        return;
                    nodeCount++;
                    const desc = (n as Record<string, unknown>).description as string | undefined;
                    if (desc) {
                        const widgetType = desc.split(/[-\s\[]/)[0];
                        if (widgetType)
                            types[widgetType] = (types[widgetType] ?? 0) + 1;
                    }
                    const children = (n as Record<string, unknown>).children as unknown[] | undefined;
                    if (Array.isArray(children))
                        for (const c of children)
                            walk(c);
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
            return {
                success: false,
                error: 'feature_requires_connectivity',
                message: 'Visual analysis pipeline runs on Railway and the proxy could not reach it.',
                hint: 'Run inkpal_doctor to verify your network + license. For an offline alternative, inkpal_audit_ui + inkpal_accessibility_audit cover most static checks.',
                recovery_tool: 'inkpal_doctor',
                offline_alternatives: ['inkpal_audit_ui', 'inkpal_accessibility_audit'],
            };
        case 'inkpal_tap':
        case 'inkpal_smart_tap': {
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
            const tapExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.tap', {
                x, y, label: text, parentContext: args.parent_context as string | undefined,
                skipHitCheck: args.skip_hit_check as string | undefined,
            });
            if (tapExt.handled)
                return { ...tapExt.response, tool: toolName, healed: toolName === 'inkpal_smart_tap' };
            if (isBridgeListening()) {
                return {
                    forward_remote: true,
                    tool: toolName,
                    args: { ...args, project_path: proj, _via: 'bridge' },
                    note: 'Bridge handles hit-test + fuzzy match + smart_tap heal natively.',
                };
            }
            const platform = detectPlatform(args, proj);
            if (platform === 'ios') {
                return {
                    forward_remote: true,
                    tool: toolName,
                    args: { ...args, project_path: proj, _via: 'railway_vm_service' },
                    note: 'iOS interaction routed via Railway VM-Service path.',
                };
            }
            const adbProbe = ensureAdb();
            if (!adbProbe.ok)
                return adbProbe;
            if (x != null && y != null) {
                const r = runChecked(`adb shell input tap ${x} ${y}`, undefined, 5000);
                if (!r.ok)
                    return { success: false, x, y, error: r.error ?? r.stderr.trim() };
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
                        const r = runChecked(`adb shell input tap ${cx} ${cy}`, undefined, 5000);
                        if (!r.ok)
                            return { success: false, error: r.error ?? r.stderr.trim() };
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
                            const r = runChecked(`adb shell input tap ${cx} ${cy}`, undefined, 5000);
                            if (!r.ok)
                                return { success: false, error: r.error ?? r.stderr.trim() };
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
            const proj = p(args);
            const dt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.doubleTap', {
                label: (args.label || args.text) as string | undefined,
                parentContext: args.parent_context as string | undefined,
            });
            if (dt.handled)
                return dt.response;
            const x = args.x as number ?? 540, y = args.y as number ?? 960;
            run(`adb shell input tap ${x} ${y} && sleep 0.1 && adb shell input tap ${x} ${y}`);
            return { success: true, x, y };
        }
        case 'inkpal_scroll': {
            const proj = p(args);
            const dir = (args.direction as string) || 'down';
            const px = (args.pixels as number) || 300;
            const scrollExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.scroll', { direction: dir });
            if (scrollExt.handled)
                return { ...scrollExt.response, direction: dir, pixels: px };
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
                return {
                    forward_remote: true,
                    tool: 'inkpal_scroll',
                    args: { ...args, project_path: proj, _via: 'railway_vm_service' },
                    note: 'iOS interaction routed via Railway VM-Service path.',
                };
            }
            const adbProbe = ensureAdb();
            if (!adbProbe.ok)
                return adbProbe;
            const coords: Record<string, number[]> = {
                down: [540, 1000, 540, 1000 - px], up: [540, 700, 540, 700 + px],
                left: [800, 900, 800 - px, 900], right: [200, 900, 200 + px, 900],
            };
            const [x1, y1, x2, y2] = coords[dir] || coords['down'];
            const r = runChecked(`adb shell input swipe ${x1} ${y1} ${x2} ${y2} 300`, undefined, 5000);
            if (!r.ok)
                return { success: false, direction: dir, pixels: px, platform: 'android', error: r.error ?? r.stderr.trim() };
            return { success: true, direction: dir, pixels: px, platform: 'android', method: 'adb_swipe' };
        }
        case 'inkpal_scroll_to': {
            const label = (args.label as string) || '';
            const dir = (args.direction as string) || 'down';
            const maxSwipes = (args.max_swipes as number) || 10;
            for (let i = 0; i < maxSwipes; i++) {
                const dump = uiDump();
                if (dump.includes(label))
                    return { success: true, found: true, swipes: i };
                const coords: Record<string, string> = {
                    down: '540 1000 540 700', up: '540 700 540 1000',
                    left: '800 900 200 900', right: '200 900 800 900',
                };
                run(`adb shell input swipe ${coords[dir] || coords['down']} 300`);
            }
            return { success: false, error: `"${label}" not found after ${maxSwipes} swipes` };
        }
        case 'inkpal_enter_text': {
            const proj = p(args);
            const text = (args.text as string) || '';
            if (!text) {
                return { success: false, error: 'text_required', hint: 'Pass {text: "your input"}.' };
            }
            const setTextExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.setText', {
                label: (args.label || args.field || args.target) as string | undefined,
                text,
                parentContext: args.parent_context as string | undefined,
            });
            if (setTextExt.handled)
                return { ...setTextExt.response, text };
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
                return {
                    forward_remote: true,
                    tool: 'inkpal_enter_text',
                    args: { ...args, project_path: proj, _via: 'railway_vm_service' },
                    note: 'iOS interaction routed via Railway VM-Service path.',
                };
            }
            const adbProbe = ensureAdb();
            if (!adbProbe.ok)
                return adbProbe;
            const r = runChecked(`adb shell input text "${text.replace(/ /g, '%s')}"`, undefined, 5000);
            if (!r.ok)
                return { success: false, text, platform: 'android', error: r.error ?? r.stderr.trim() };
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
            const proj = p(args);
            const wantsTree = (args.format as string) === 'tree';
            if (!wantsTree) {
                const a11y = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.getScreenContent', {});
                if (a11y.handled) {
                    const inner = (a11y.response.result as {
                        result?: {
                            content?: string;
                            elementCount?: number;
                        };
                    } | undefined)?.result;
                    return {
                        success: true,
                        source: 'vm_service_extension',
                        extension: 'ext.flutter.inkpal.getScreenContent',
                        mode: 'a11y_tree',
                        isolate_id: a11y.response.isolate_id,
                        content: inner?.content ?? '',
                        count: inner?.elementCount ?? 0,
                        hint: 'a11y tree mode (10× cheaper). Pass format:"tree" for full widget tree with bounds/keys.',
                    };
                }
            }
            const treeExt = await tryBridgeExtension(proj, args, 'ext.flutter.inkpal.getWidgetTree', {});
            if (treeExt.handled) {
                const inner = (treeExt.response.result as {
                    result?: {
                        elements?: unknown[];
                    };
                } | undefined)?.result;
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
                return {
                    forward_remote: true,
                    tool: toolName,
                    args: { ...args, project_path: proj, _via: 'railway_vm_service' },
                    note: 'iOS interaction routed via Railway VM-Service path.',
                };
            }
            const adbProbe = ensureAdb();
            if (!adbProbe.ok)
                return adbProbe;
            const dumpProbe = runChecked('adb shell uiautomator dump /sdcard/window_dump.xml', undefined, 8000);
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
        case 'inkpal_wait_for': {
            const label = (args.label as string) || '';
            const condition = (args.condition as string) || 'visible';
            const timeoutMs = (args.timeout_ms as number) || 10000;
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
            if (assertion === 'visible')
                return { passed: found, message: found ? 'Element found' : 'Element not found' };
            if (assertion === 'not_visible')
                return { passed: !found, message: !found ? 'Element absent' : 'Element still visible' };
            return { passed: false, message: `Unsupported assertion: ${assertion}` };
        }
        case 'inkpal_wait_for_idle':
            run(`sleep ${((args.timeout_ms as number) || 3000) / 1000}`);
            return { success: true, message: 'Waited for idle' };
        case 'inkpal_assert_ui':
        case 'inkpal_test_flow':
            return { error: `${toolName} requires full MCP server.`, hint: 'Use inkpal_assert_element for basic visibility checks, or inkpal_wait_for to poll.', recovery_tool: 'inkpal_assert_element' };
        case 'inkpal_get_widget_details':
        case 'inkpal_select_widget':
        case 'inkpal_driver_command':
            return { error: `${toolName} requires VM Service.`, hint: 'Launch app with inkpal_launch_app first. Fallback: use inkpal_get_elements for ADB-based discovery.', recovery_tool: 'inkpal_get_elements' };
        case 'inkpal_visual_baseline_save': {
            const proj = p(args);
            const name = deriveVisualName(args);
            const baselineDir = join(proj, '.inkpal', 'visual-tests', 'baselines');
            mkdirSync(baselineDir, { recursive: true });
            const baselinePath = join(baselineDir, `${name}.png`);
            const shotResult = await handleLocal('inkpal_screenshot', { ...args, output_path: baselinePath });
            const sr = shotResult as {
                success?: boolean;
                error?: string;
                method?: string;
                bytes?: number;
            };
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
            const sr = shotResult as {
                success?: boolean;
                error?: string;
                bytes?: number;
            };
            if (!sr.success)
                return { ...sr, action: 'visual_test_capture_failed' };
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
            try {
                const reportFile = join(proj, '.inkpal', 'visual-tests', 'last-report.json');
                let report: {
                    results: unknown[];
                    timestamp?: string;
                } = { results: [], timestamp: new Date().toISOString() };
                if (existsSync(reportFile)) {
                    try {
                        report = JSON.parse(readFileSync(reportFile, 'utf8'));
                    }
                    catch { }
                    report.results = report.results || [];
                }
                report.results.push({ ...summary, ts: new Date().toISOString() });
                report.timestamp = new Date().toISOString();
                writeFileSync(reportFile, JSON.stringify(report, null, 2));
            }
            catch { }
            return summary;
        }
        case 'inkpal_visual_baseline_compare': {
            const baseline = (args.baseline_path as string) || (args.a as string);
            const current = (args.current_path as string) || (args.b as string);
            if (!baseline || !current) {
                return { success: false, error: 'missing_paths', hint: 'Pass {baseline_path, current_path} or {a, b}.' };
            }
            if (!existsSync(baseline))
                return { success: false, error: 'baseline_missing', baseline_path: baseline };
            if (!existsSync(current))
                return { success: false, error: 'current_missing', current_path: current };
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
            let report: {
                results: Array<{
                    name?: string;
                    passed?: boolean;
                    similarity?: number;
                }>;
                timestamp?: string;
            };
            try {
                report = JSON.parse(readFileSync(reportFile, 'utf8'));
            }
            catch (e) {
                return { success: false, error: 'corrupt_report', detail: String((e as Error).message) };
            }
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
            return {
                forward_remote: true,
                tool: toolName,
                args: { ...args },
                note: 'Multi-route visual sweep + perf profiling use the Railway engine. Single-route inkpal_visual_test is local.',
            };
        case 'inkpal_hover':
        case 'inkpal_go_to_definition':
        case 'inkpal_find_references':
        case 'inkpal_read_package_source':
        case 'inkpal_search_package_source':
            return { error: `${toolName} requires the full InkPal MCP server with Dart LSP.` };
        case 'inkpal_save_session':
        case 'inkpal_restore_session':
        case 'inkpal_list_sessions':
        case 'inkpal_start_log_session': {
            const proj = p(args);
            const sessionId = (args.session_id as string) || `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const filter = (args.filter as string) || 'flutter|dart|error|exception|crash';
            const platform = detectPlatform(args, proj);
            const startTs = new Date().toISOString();
            let baselineLineCount = 0;
            if (platform === 'android' || platform === 'unknown') {
                const adbProbe = ensureAdb();
                if (adbProbe.ok) {
                    const r = runChecked('adb logcat -d 2>/dev/null | wc -l', undefined, 5000);
                    if (r.ok)
                        baselineLineCount = parseInt(r.stdout.trim(), 10) || 0;
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
            if (!sessionId)
                return { success: false, error: 'session_id_required' };
            const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
            if (!existsSync(stateFile))
                return { success: false, error: 'session_not_found', session_id: sessionId };
            const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
                project_path: string;
                platform: string;
                filter: string;
                start_ts: string;
                baseline_line_count: number;
                end_ts?: string;
                captured_lines?: string[];
            };
            state.end_ts = new Date().toISOString();
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
            if (!sessionId)
                return { success: false, error: 'session_id_required' };
            const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
            if (!existsSync(stateFile))
                return { success: false, error: 'session_not_found', session_id: sessionId };
            const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
                captured_lines?: string[];
                start_ts: string;
                end_ts?: string;
            };
            let lines = state.captured_lines ?? [];
            if (!state.end_ts) {
                const fullState = JSON.parse(readFileSync(stateFile, 'utf8'));
                lines = await captureSessionLines(fullState.project_path, fullState.platform, fullState.filter, fullState.baseline_line_count, fullState.start_ts);
            }
            const pattern = (args.pattern as string) || '';
            const severity = (args.severity as string) || '';
            const limit = (args.limit as number) || 100;
            let filtered = lines;
            if (pattern) {
                const re = new RegExp(pattern, 'i');
                filtered = filtered.filter(l => re.test(l));
            }
            if (severity)
                filtered = filtered.filter(l => l.toLowerCase().includes(severity.toLowerCase()));
            return {
                success: true, session_id: sessionId,
                total_in_session: lines.length, matched: filtered.length,
                lines: filtered.slice(0, limit),
                ...(filtered.length > limit ? { truncated: true, limit } : {}),
            };
        }
        case 'inkpal_assert_no_errors': {
            const sessionId = (args.session_id as string) || '';
            if (!sessionId)
                return { success: false, error: 'session_id_required' };
            const stateFile = join(homedir(), '.inkpal', 'sessions', `log-${sessionId}.json`);
            if (!existsSync(stateFile))
                return { success: false, error: 'session_not_found', session_id: sessionId };
            const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
                captured_lines?: string[];
                project_path: string;
                platform: string;
                filter: string;
                baseline_line_count: number;
                start_ts: string;
            };
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
        case 'inkpal_stability_check': {
            const out = run('adb logcat -d -t 500 | grep -iE "crash|anr|fatal|exception|SIGABRT|SIGKILL|OOM|gc.*alloc|jank"', undefined, 15000);
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
        case 'inkpal_launch_all':
        case 'inkpal_execute_all':
        case 'inkpal_screenshot_all':
        case 'inkpal_compare_all':
        case 'inkpal_test_cross_device':
            return { error: `${toolName} requires the full InkPal MCP server.` };
        case 'inkpal_register_app':
        case 'inkpal_orchestrate':
        case 'inkpal_orchestrate_status':
        case 'inkpal_cross_app_test':
            return { error: `${toolName} requires the full InkPal MCP server.` };
        case 'inkpal_auto_repair':
        case 'inkpal_heal_watch':
        case 'inkpal_heal_stop':
        case 'inkpal_heal_verify':
            return { error: `${toolName} requires the full InkPal MCP server.` };
        case 'inkpal_auto_commit': {
            const proj = p(args);
            const message = (args.message as string) || 'chore: auto-commit via inkpal';
            const include = (args.include as string) || '-A';
            const status = runChecked(`git status --porcelain`, proj, 5000);
            if (!status.ok)
                return { success: false, error: 'not_a_git_repo', hint: 'Run `git init` first.', recovery_tool: 'inkpal_doctor' };
            if (status.stdout.trim().length === 0) {
                return { success: true, action: 'no_changes', hint: 'Working tree clean; nothing to commit.', message };
            }
            const add = runChecked(`git add ${include}`, proj, 10000);
            if (!add.ok)
                return { success: false, error: 'git_add_failed', stderr: add.stderr.trim(), hint: 'Check file permissions or .gitignore patterns.' };
            const safeMsg = message.replace(/'/g, "'\\''");
            const commit = runChecked(`git commit -m '${safeMsg}'`, proj, 15000);
            if (!commit.ok) {
                return { success: false, error: 'git_commit_failed', stderr: commit.stderr.trim() || commit.error, hint: 'Likely pre-commit hook failure. Check stderr.' };
            }
            const hash = runChecked(`git rev-parse HEAD`, proj, 3000);
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
            const ghProbe = runChecked('gh --version', undefined, 3000);
            if (!ghProbe.ok) {
                return {
                    success: false, error: 'gh_cli_not_installed',
                    hint: 'GitHub CLI not found. Install: brew install gh && gh auth login. Fallback: open PR via web at https://github.com/<repo>/compare',
                    install_command: 'brew install gh',
                };
            }
            const authProbe = runChecked('gh auth status', undefined, 5000);
            if (!authProbe.ok) {
                return { success: false, error: 'gh_not_authenticated', hint: 'Run: gh auth login', stderr: authProbe.stderr.trim() };
            }
            if (!title.trim())
                return { success: false, error: 'title_required', hint: 'Pass {title: "feat: add settings screen"}.' };
            const branch = runChecked('git rev-parse --abbrev-ref HEAD', proj, 3000);
            if (!branch.ok || branch.stdout.trim() === base || branch.stdout.trim() === 'HEAD') {
                return { success: false, error: 'cannot_pr_from_base_or_detached', branch: branch.stdout.trim(), hint: `Switch to a feature branch first: git checkout -b feature/<name>` };
            }
            const push = runChecked(`git push -u origin ${branch.stdout.trim()}`, proj, 30000);
            if (!push.ok)
                return { success: false, error: 'git_push_failed', stderr: push.stderr.trim(), hint: 'Check network + remote + auth.' };
            const safeBody = body.replace(/'/g, "'\\''");
            const cmd = `gh pr create --base ${base} --title '${title.replace(/'/g, "'\\''")}' --body '${safeBody}'`;
            const create = runChecked(cmd, proj, 30000);
            if (!create.ok)
                return { success: false, error: 'gh_pr_create_failed', stderr: create.stderr.trim(), hint: 'Likely PR already exists or branch protection rule.' };
            const url = create.stdout.trim().split('\n').find(l => l.startsWith('http')) ?? create.stdout.trim();
            return { success: true, action: 'pr_created', pr_url: url, base, head: branch.stdout.trim(), title };
        }
        case 'inkpal_pre_merge_gate': {
            const proj = p(args);
            const maxAnalyzeErrors = (args.max_analyze_errors as number) ?? 0;
            const maxAuditWarnings = (args.max_audit_warnings as number) ?? 5;
            const maxA11ySerious = (args.max_a11y_serious as number) ?? 3;
            const maxSafetyCritical = (args.max_safety_critical as number) ?? 0;
            const gates: Array<{
                name: string;
                passed: boolean;
                detail: string;
            }> = [];
            const analyze = await handleLocal('inkpal_flutter_analyze', { project_path: proj }) as Record<string, unknown>;
            const errCount = (analyze.errorCount as number) ?? 0;
            gates.push({ name: 'flutter_analyze', passed: errCount <= maxAnalyzeErrors, detail: `${errCount} errors (max: ${maxAnalyzeErrors})` });
            const safety = await handleLocal('inkpal_check_safety', { project_path: proj, file_path: `${proj}/lib/main.dart` }) as Record<string, unknown>;
            const critCount = (safety.critical_count as number) ?? 0;
            gates.push({ name: 'check_safety', passed: critCount <= maxSafetyCritical, detail: `${critCount} critical (max: ${maxSafetyCritical})` });
            const audit = await handleLocal('inkpal_audit_ui', { project_path: proj, file: `lib/main.dart` }) as Record<string, unknown>;
            const auditFindings = (audit.findings as Array<Record<string, unknown>> | undefined) ?? [];
            const auditWarn = auditFindings.filter(f => f.severity === 'warning' || f.severity === 'error').length;
            gates.push({ name: 'audit_ui', passed: auditWarn <= maxAuditWarnings, detail: `${auditWarn} warnings (max: ${maxAuditWarnings})` });
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
            const buildOut = run(`flutter build ${platform} --release`, p(args), 600000);
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
        case 'inkpal_storage_status': {
            const dir = resolve(p(args), '.inkpal');
            if (!existsSync(dir))
                return { exists: false };
            return { exists: true, path: dir, size: run(`du -sh "${dir}" 2>/dev/null`).trim() };
        }
        case 'inkpal_storage_cleanup': {
            const dir = resolve(p(args), '.inkpal');
            if (!existsSync(dir))
                return { message: 'No .inkpal directory' };
            run(`find "${dir}" -name "*.png" -mtime +30 -delete 2>/dev/null`);
            return { message: 'Cleaned old files' };
        }
        case 'inkpal_storage_config': {
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
            }
            catch (e) {
                return { exists: true, path: configFile, error: `failed to parse: ${(e as Error).message}` };
            }
        }
        default:
            return { error: `${toolName} is not handled locally. It may need to run on Railway.` };
    }
}
