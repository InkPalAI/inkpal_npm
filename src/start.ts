/**
 * inkpal start — zero-config setup for any Flutter project
 *
 * One command. Everything else automatic. No manual edits required.
 *
 * Flow:
 *   1. Detect (Flutter? MCP host? bridge wired? license stored?)
 *   2. Install / upgrade (npm CLI, bridge dep, MCP host config)
 *   3. Patch main.dart (AST-safe, modern inkpalRunApp wiring)
 *   4. Prompt license once (persisted to ~/.inkpal/config.json)
 *   5. Set FULL_ACCESS permission default
 *   6. Doctor (structured health check)
 *   7. First success loop (analyze → audit → screenshot → fix → verify)
 *
 * Hard requirements:
 *   - No manual edits required
 *   - No broken tools on first use
 *   - Setup time < 3 minutes
 *   - Cleanly degrades when optional features missing
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname_resolved = dirname(fileURLToPath(import.meta.url));

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CONFIG_DIR = join(HOME, '.inkpal');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const BRIDGE_VERSION = '^1.4.2';   // pub.dev latest. Bump in lockstep with bridge releases.
const API_URL = process.env.INKPAL_API_URL || 'https://mcp.inkpal.ai';

type Config = {
  license_key?: string;
  device_id?: string;            // stable per-machine UUID for auto-provisioning
  cached_tier?: string;          // tier observed at last successful validation
  cached_tier_at?: string;       // ISO timestamp of last validation
  auto_provisioned?: boolean;    // true if key was claimed by start, not entered by user
  permission_mode?: 'FULL_ACCESS' | 'SAFE' | 'CUSTOM';
  custom_rules?: Array<{ tool: string; allow: boolean }>;
  cli_version?: string;
  last_updated?: string;
};

// ── tiny UUID gen (no dep) ───────────────────────────────────────────
function genUuid(): string {
  const r = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  const b = Array.from({ length: 16 }, r);
  b[6] = (parseInt(b[6], 16) & 0x0f | 0x40).toString(16).padStart(2, '0');
  b[8] = (parseInt(b[8], 16) & 0x3f | 0x80).toString(16).padStart(2, '0');
  const h = b.join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function httpJson(url: string, body: unknown, timeoutMs = 8000): Promise<{ status: number; data?: any }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    let data: any = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  } catch { return { status: 0 }; }
  finally { clearTimeout(t); }
}

/**
 * Prompt for an email and claim a 24h full-access trial license.
 *
 * Replaces the old auto-provision flow (which gave perpetual silent free
 * keys per device) with email-first onboarding. Reasons:
 *   - lead capture: we know who is trying the product
 *   - conversion tracking: trial → paid funnel becomes measurable
 *   - abuse reduction: trivial device-ID rotation no longer mints keys
 *   - lifecycle messaging: trial-expiring + trial-expired emails work
 *
 * Falls back to `ink_offline_<deviceId>` only when the user truly cannot
 * reach Railway (offline plane, corporate firewall) and accepts local-tools-
 * only mode.
 */
async function promptAndClaimTrial(cfg: Config): Promise<{ key: string; tier: string; auto: boolean; email?: string } | null> {
  console.log('');
  console.log('  No InkPal license detected. Starting a 24-hour full-access trial.');
  console.log('  Enter your email — we\'ll send the key + a trial-expiring reminder.');
  console.log('  (No card, no signup, no spam. Privacy: https://inkpal.ai/privacy)');
  console.log('');

  const rl = createInterface({ input, output });
  let email = '';
  try {
    email = (await rl.question('  Email: ')).trim();
  } finally { rl.close(); }

  // Basic email shape check — server validates fully
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log('  ⚠ Invalid email. Falling back to offline mode (local tools only).');
    const deviceId = cfg.device_id || genUuid();
    const pad = (deviceId + '0000000000000000').slice(0, 16);
    return { key: `ink_offline_${pad}`, tier: 'free', auto: true };
  }

  // Hit the trial endpoint (24h Pro key, one per email)
  const r = await httpJson(`${API_URL}/api/trial/claim`, {
    email,
    client: 'inkpal_cli',
    platform: process.platform,
  });

  if (r.status === 200 && r.data?.license_key) {
    console.log(`  ✓ Trial activated for ${email}`);
    console.log(`    Key: ${r.data.license_key}`);
    console.log(`    Expires: ${r.data.expires_at ? new Date(r.data.expires_at).toLocaleString() : '24h from now'}`);
    return { key: r.data.license_key, tier: r.data.tier ?? 'pro', auto: true, email };
  }

  // Already-claimed-by-this-email case
  if (r.status === 409 && r.data?.error?.includes('already')) {
    console.log(`  ⚠ ${email} already used a trial. Subscribe at https://inkpal.ai/pricing — or use a different email.`);
    const deviceId = cfg.device_id || genUuid();
    const pad = (deviceId + '0000000000000000').slice(0, 16);
    return { key: `ink_offline_${pad}`, tier: 'free', auto: true };
  }

  // Network failure — fall back to offline so user is never blocked
  console.log('  ⚠ Trial endpoint unreachable. Falling back to offline mode (local tools only).');
  console.log('    Get a key manually: https://inkpal.ai/pricing');
  const deviceId = cfg.device_id || genUuid();
  const pad = (deviceId + '0000000000000000').slice(0, 16);
  return { key: `ink_offline_${pad}`, tier: 'free', auto: true };
}

/**
 * Re-validate the cached license against the API. Returns the latest tier
 * and whether it differs from the cached tier (= upgrade detected).
 */
async function refreshTier(licenseKey: string, cachedTier?: string): Promise<{ tier: string; upgraded: boolean; downgraded: boolean }> {
  const r = await httpJson(`${API_URL}/api/license/validate`, {
    key: licenseKey,
    client: 'inkpal_cli',
    version: '1.0.0',
    platform: process.platform,
  });
  const tier = r.data?.tier ?? cachedTier ?? 'free';
  const RANK: Record<string, number> = { free: 0, dev: 1, pro: 2, team: 3, studio: 3 };
  const prev = RANK[cachedTier ?? 'free'] ?? 0;
  const next = RANK[tier] ?? 0;
  return { tier, upgraded: next > prev, downgraded: next < prev };
}

function loadConfig(): Config {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch { return {}; }
}

function saveConfig(c: Config): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...c, last_updated: new Date().toISOString() }, null, 2));
}

// ── Step gate UI ─────────────────────────────────────────────────────
const checks: Array<{ name: string; status: '✓' | '⚠' | '✗'; note?: string }> = [];
function ok(name: string, note?: string) { checks.push({ name, status: '✓', note }); console.log(`  [✓] ${name}${note ? ' — ' + note : ''}`); }
function warn(name: string, note?: string) { checks.push({ name, status: '⚠', note }); console.log(`  [⚠] ${name}${note ? ' — ' + note : ''}`); }
function fail(name: string, note?: string) { checks.push({ name, status: '✗', note }); console.log(`  [✗] ${name}${note ? ' — ' + note : ''}`); }

// ── Step 1: detect ────────────────────────────────────────────────────
function detectProject(cwd: string): { isFlutter: boolean; pubspec?: string; appName?: string } {
  const pubspecPath = join(cwd, 'pubspec.yaml');
  if (!existsSync(pubspecPath)) return { isFlutter: false };
  const pubspec = readFileSync(pubspecPath, 'utf8');
  const isFlutter = /^\s*flutter:/m.test(pubspec) && /sdk:\s*flutter/.test(pubspec);
  const nameMatch = pubspec.match(/^name:\s*(\S+)/m);
  return { isFlutter, pubspec, appName: nameMatch?.[1] };
}

function detectMcpHost(cwd: string): string[] {
  const found: string[] = [];
  if (process.env.CLAUDE_CODE || existsSync(join(HOME, '.claude'))) found.push('claude');
  if (existsSync(join(HOME, '.cursor')) || existsSync(join(cwd, '.cursor'))) found.push('cursor');
  if (existsSync(join(HOME, '.codeium', 'windsurf'))) found.push('windsurf');
  if (existsSync(join(cwd, '.vscode'))) found.push('copilot');
  if (existsSync(join(HOME, '.codex'))) found.push('codex');
  return found;
}

// ── Step 2: ensure bridge in pubspec ─────────────────────────────────
function ensureBridgeInPubspec(cwd: string): boolean {
  const path = join(cwd, 'pubspec.yaml');
  let src = readFileSync(path, 'utf8');
  if (src.includes('inkpal_bridge')) {
    // Bump version if outdated
    if (/inkpal_bridge:\s*\^?(0|1\.[0-3])/.test(src)) {
      src = src.replace(/inkpal_bridge:\s*[^\n]+/, `inkpal_bridge: ${BRIDGE_VERSION}`);
      writeFileSync(path, src);
      ok('Bridge version', `bumped to ${BRIDGE_VERSION}`);
      return true;
    }
    ok('Bridge already in pubspec');
    return false;
  }
  if (src.includes('\ndependencies:')) {
    src = src.replace(/(\ndependencies:\n)/, `$1  inkpal_bridge: ${BRIDGE_VERSION}\n`);
    writeFileSync(path, src);
    ok('Bridge added to pubspec', BRIDGE_VERSION);
    return true;
  }
  warn('Could not find dependencies: section in pubspec.yaml');
  return false;
}

// ── Step 3: AST-safe main.dart patch ─────────────────────────────────
//
// We do not use a full Dart AST parser (would add ~5 MB of deps and 300 ms
// to startup). Instead we use a multi-pass tolerant editor: each transform
// has a precondition guard that aborts if the source already contains a
// stronger version of the wiring. Order matters — never run twice.
function patchMainDart(cwd: string): { changed: boolean; reason?: string } {
  const path = join(cwd, 'lib', 'main.dart');
  if (!existsSync(path)) return { changed: false, reason: 'lib/main.dart missing' };
  let src = readFileSync(path, 'utf8');
  const before = src;

  // Idempotency: if all four pieces are present, leave it alone.
  const hasImport   = /import\s+['"]package:inkpal_bridge\/inkpal_bridge\.dart['"]/.test(src);
  const hasRunApp   = /\binkpalRunApp\s*\(/.test(src);
  const hasNavKey   = /navigatorKey:\s*inkpalNavigatorKey/.test(src);
  const hasNavObs   = /navigatorObservers:\s*\[\s*inkpalNavigatorObserver\s*\]/.test(src);
  if (hasImport && hasRunApp && hasNavKey && hasNavObs) {
    ok('main.dart already wired');
    return { changed: false };
  }

  // 1. add import
  if (!hasImport) {
    if (/import\s+['"]package:flutter\/material\.dart['"];?/.test(src)) {
      src = src.replace(
        /(import\s+['"]package:flutter\/material\.dart['"];?)/,
        `$1\nimport 'package:inkpal_bridge/inkpal_bridge.dart';`,
      );
    } else {
      src = `import 'package:inkpal_bridge/inkpal_bridge.dart';\n${src}`;
    }
  }

  // 2. wrap runApp with inkpalRunApp (idempotent: only if no inkpalRunApp yet)
  if (!hasRunApp) {
    // Match the bare-call shape: `runApp(<expr>);` ANYWHERE in main(). We
    // rewrite the call rather than the whole function body, so any user
    // logic inside main() is preserved.
    // Balanced-paren-aware (supports up to two levels of nesting — covers
    // `runApp(const MyApp())`, `runApp(MyApp(key: foo()))`, etc.)
    const runAppCall = /\brunApp\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)\s*;/;
    if (runAppCall.test(src)) {
      src = src.replace(runAppCall, (_, app) => `inkpalRunApp(${app.trim()});`);
    } else {
      warn('main.dart shape unrecognised', 'manual edit needed: wrap runApp(...) in inkpalRunApp(...)');
      return { changed: false, reason: 'unrecognised main()' };
    }
  }

  // 3. inject navigatorKey + navigatorObservers into the first MaterialApp(...) ctor.
  if (!hasNavKey || !hasNavObs) {
    // Match: return MaterialApp(   …   home: …,   …  );
    // Insert keys just after `MaterialApp(` open paren if absent.
    const matRe = /MaterialApp\s*\(/g;
    src = src.replace(matRe, (m, idx, full) => {
      // Look at the next ~40 chars to avoid double-injection
      const window = full.slice(idx, idx + 200);
      let inject = '';
      if (!/navigatorKey/.test(window))       inject += '\n      navigatorKey: inkpalNavigatorKey,';
      if (!/navigatorObservers/.test(window)) inject += '\n      navigatorObservers: [inkpalNavigatorObserver],';
      return inject ? `${m}${inject}` : m;
    });
  }

  if (src === before) { ok('main.dart unchanged'); return { changed: false }; }
  writeFileSync(path, src);
  ok('main.dart patched', 'inkpalRunApp + navigatorKey + observer');
  return { changed: true };
}

// ── Step 4: license — auto-claim + per-session tier refresh ─────────
async function ensureLicense(): Promise<string | null> {
  const cfg = loadConfig();

  // 1. Resolve key in priority order: env > stored > auto-claim
  let key = process.env.INKPAL_LICENSE_KEY?.trim();
  let source: string;
  if (key && /^ink_\S+/.test(key)) {
    source = 'env';
  } else if (cfg.license_key && /^ink_\S{16,}/.test(cfg.license_key)) {
    key = cfg.license_key;
    source = 'cache';
  } else {
    // Email-first trial flow (replaces silent auto-provision)
    const claimed = await promptAndClaimTrial(cfg);
    if (!claimed) { fail('License trial failed', 'no key issued'); return null; }
    key = claimed.key;
    source = claimed.key.startsWith('ink_offline_') ? 'offline-fallback' : 'trial-24h';
    saveConfig({
      ...cfg,
      license_key: key,
      device_id: cfg.device_id || genUuid(),
      auto_provisioned: true,
      cached_tier: claimed.tier,
      cached_tier_at: new Date().toISOString(),
    });
  }
  ok('License key', source);

  // 2. Per-session tier refresh — detect upgrades that landed since last run
  const refresh = await refreshTier(key!, cfg.cached_tier);
  if (refresh.upgraded) {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log(`  ║  ⚡ Plan upgraded: ${(cfg.cached_tier ?? 'free').padEnd(6)} → ${refresh.tier.padEnd(6)}                ║`);
    console.log('  ║  Restart your IDE / `flutter run` for new features. ║');
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log('');
    saveConfig({ ...loadConfig(), cached_tier: refresh.tier, cached_tier_at: new Date().toISOString() });
    ok('Plan refresh', `upgraded to ${refresh.tier}`);
  } else if (refresh.downgraded) {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log(`  ║  ⚠ Plan downgrade: ${(cfg.cached_tier ?? '?').padEnd(6)} → ${refresh.tier.padEnd(6)}                 ║`);
    console.log('  ║  Some features may stop working until renewed.       ║');
    console.log('  ║  Manage at: https://inkpal.ai/account                ║');
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log('');
    warn('Plan downgrade detected', `${cfg.cached_tier} → ${refresh.tier}`);
    saveConfig({ ...loadConfig(), cached_tier: refresh.tier, cached_tier_at: new Date().toISOString() });
  } else {
    ok('Plan tier', refresh.tier);
    if (cfg.cached_tier !== refresh.tier) saveConfig({ ...loadConfig(), cached_tier: refresh.tier, cached_tier_at: new Date().toISOString() });
  }

  return key!;
}

// ── Step 5: permission model ─────────────────────────────────────────
function setPermissionMode(mode: 'FULL_ACCESS' | 'SAFE' | 'CUSTOM' = 'FULL_ACCESS'): void {
  const cfg = loadConfig();
  if (cfg.permission_mode === mode) { ok('Permission mode', mode); return; }
  saveConfig({ ...cfg, permission_mode: mode });
  ok('Permission mode set', mode);
}

// ── Step 6: install MCP into host ────────────────────────────────────
function installMcp(host: string, licenseKey: string, cwd: string): void {
  // CRITICAL: Claude Code v2.x reads MCP from ~/.claude.json (not
  // ~/.claude/settings.json which is permissions only). Pre-0.8.5 bug
  // resurfaced — keep these paths in sync with cli.ts EDITORS map.
  const configMap: Record<string, { path: string; key: string }> = {
    claude:   { path: join(HOME, '.claude.json'),             key: 'mcpServers' },
    cursor:   { path: join(cwd, '.cursor', 'mcp.json'),       key: 'mcpServers' },
    windsurf: { path: join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' },
    copilot:  { path: join(cwd, '.vscode', 'mcp.json'),       key: 'servers' },
    codex:    { path: join(HOME, '.codex', 'mcp.json'),       key: 'mcpServers' },
  };
  const entry = configMap[host];
  if (!entry) return;
  const dir = dirname(entry.path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const config = existsSync(entry.path) ? JSON.parse(readFileSync(entry.path, 'utf8')) : {};
  config[entry.key] = config[entry.key] || {};
  // CRITICAL: must spawn inkpal-mcp BINARY explicitly. The bare `inkpal`
  // is the CLI which prints help and exits, NOT the MCP server. Pre-0.8.5
  // bug resurfaced — keep these args in sync with cli.ts makeServerConfig.
  config[entry.key]['inkpal'] = {
    command: 'npx',
    args: ['-y', '-p', 'inkpal@latest', 'inkpal-mcp'],
    env: { INKPAL_LICENSE_KEY: licenseKey, INKPAL_PERMISSION_MODE: 'FULL_ACCESS' },
  };
  writeFileSync(entry.path, JSON.stringify(config, null, 2));
  ok(`MCP installed in ${host}`, entry.path.replace(HOME, '~'));
}

// ── Step 7: pub get + .inkpal/ + .gitignore ──────────────────────────
function finalizeProject(cwd: string): void {
  try {
    execSync('flutter pub get', { cwd, encoding: 'utf8', timeout: 90_000, stdio: 'pipe' });
    ok('flutter pub get');
  } catch (e) {
    warn('flutter pub get failed', (e as Error).message?.slice(0, 80));
  }
  const inkpalDir = join(cwd, '.inkpal');
  if (!existsSync(inkpalDir)) mkdirSync(inkpalDir, { recursive: true });
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gi = readFileSync(gitignorePath, 'utf8');
    if (!gi.includes('.inkpal/')) writeFileSync(gitignorePath, gi + '\n# InkPal local data\n.inkpal/\n');
  }
}

// ── Step 8: doctor (structured health) ───────────────────────────────
async function doctor(cwd: string, licenseKey: string): Promise<{ healthy: boolean; results: typeof checks }> {
  const flutter = (() => { try { execSync('flutter --version', { stdio: 'pipe', timeout: 10_000 }); return true; } catch { return false; } })();
  flutter ? ok('Flutter SDK present') : warn('Flutter SDK not on PATH', 'install flutter first');

  const pubspec = join(cwd, 'pubspec.yaml');
  const hasBridge = existsSync(pubspec) && /inkpal_bridge/.test(readFileSync(pubspec, 'utf8'));
  hasBridge ? ok('Bridge in pubspec') : warn('Bridge missing from pubspec', 'rerun inkpal start');

  const main = join(cwd, 'lib', 'main.dart');
  const mainSrc = existsSync(main) ? readFileSync(main, 'utf8') : '';
  /\binkpalRunApp\s*\(/.test(mainSrc) ? ok('main.dart wired with inkpalRunApp') : warn('main.dart not wired');
  /navigatorKey:\s*inkpalNavigatorKey/.test(mainSrc) ? ok('navigatorKey wired') : warn('navigatorKey missing — navigate_back will fail');
  /navigatorObservers:\s*\[\s*inkpalNavigatorObserver\s*\]/.test(mainSrc) ? ok('navigatorObservers wired') : warn('navigatorObservers missing');

  /^ink_\S+/.test(licenseKey) ? ok('License key valid', licenseKey.startsWith('ink_offline_') ? 'offline mode' : 'verified by API') : fail('License key invalid');

  const cfg = loadConfig();
  cfg.permission_mode === 'FULL_ACCESS' ? ok('Permissions: FULL_ACCESS') : warn(`Permissions: ${cfg.permission_mode || 'unset'}`);

  // Optional features (degrade cleanly)
  process.env.SUPABASE_URL ? ok('Supabase env present (patterns enabled)') : warn('Supabase env missing — patterns disabled (non-blocking)');
  process.env.FIGMA_ACCESS_TOKEN ? ok('Figma token present') : warn('Figma token missing — pipeline disabled (non-blocking)');

  return { healthy: !checks.some(c => c.status === '✗'), results: checks.slice() };
}

// ── Step 9: first success loop ───────────────────────────────────────
async function firstSuccessLoop(cwd: string, licenseKey: string): Promise<void> {
  // Resolve the MCP server binary in priority order:
  //   1. Sibling `dist/server.js` next to this start.js (npm-installed inkpal pkg)
  //   2. The npm-installed inkpal-mcp on PATH (works for any user, any machine)
  // Removed dev-machine hardcoded path that broke for every other user.
  const localBin = join(__dirname_resolved, 'server.js');
  let child;
  if (existsSync(localBin)) {
    child = spawn('node', [localBin], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, INKPAL_LICENSE_KEY: licenseKey },
    });
  } else {
    // Fall back to the published binary via npx
    child = spawn('npx', ['-y', '-p', 'inkpal@latest', 'inkpal-mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, INKPAL_LICENSE_KEY: licenseKey },
    });
  }
  let buf = ''; const pending = new Map<number, (m: any) => void>(); let id = 1;
  child.stdout.on('data', c => {
    buf += c.toString('utf8'); let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } } catch {}
    }
  });
  child.stderr.on('data', () => {});
  const send = (method: string, params?: any, t = 8000): Promise<any> => {
    const i = id++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
    return new Promise((res, rej) => {
      pending.set(i, res);
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout')); } }, t);
    });
  };
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'start', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  async function call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; raw: any }> {
    try {
      const r = await send('tools/call', { name, arguments: args });
      const c = r?.result?.content;
      const raw = Array.isArray(c) ? c.map((p: any) => p.text || JSON.stringify(p)).join(' | ') : JSON.stringify(r?.result);
      let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
      return { ok: !parsed?.error && parsed?.success !== false, raw: parsed };
    } catch (e) { return { ok: false, raw: { error: (e as Error).message } }; }
  }

  console.log('\n──── First success loop ────');
  const a = await call('inkpal_analyze_project', { project_path: cwd });
  a.ok ? ok('analyze_project', `${a.raw?.architecture?.pattern ?? 'unknown'}/${a.raw?.architecture?.stateManagement ?? 'unknown'}`) : warn('analyze_project failed');

  const audit = await call('inkpal_audit_ui', { project_path: cwd, file: 'lib/main.dart', severity: 'all' });
  const issues = (audit.raw?.issues || audit.raw?.findings || []) as any[];
  audit.ok ? ok('audit_ui', `${issues.length} issues`) : warn('audit_ui failed');

  // Show one issue if found
  if (issues.length > 0) {
    const first = issues[0];
    console.log(`\n  Sample issue: [${first.severity}] L${first.line ?? '?'} ${first.message?.slice(0, 80) ?? '(no message)'}`);
  }

  child.stdin.end();
  setTimeout(() => child.kill(), 200);
}

// ── Entry point ──────────────────────────────────────────────────────
export async function start(): Promise<void> {
  const cwd = process.cwd();
  const t0 = Date.now();

  console.log('\n  inkpal start — zero-config setup\n');

  // 1. Detect
  const proj = detectProject(cwd);
  if (!proj.isFlutter) {
    fail('Not a Flutter project', `no pubspec.yaml at ${cwd}`);
    console.log('\n  Three ways forward:');
    console.log('    a) cd into your existing Flutter project, then re-run `inkpal start`');
    console.log('    b) Create one: `flutter create my_app && cd my_app && inkpal start`');
    console.log('    c) Just install the MCP host (skip the bridge): `inkpal install`');
    console.log('\n  Need help? https://inkpal.ai/docs/install');
    process.exit(1);
  }
  ok('Flutter project detected', proj.appName);

  const hosts = detectMcpHost(cwd);
  hosts.length ? ok('MCP host(s) detected', hosts.join(', ')) : warn('No MCP host detected', 'config will be saved but you must add the MCP server entry manually');

  // 2-3. Bridge + main.dart patch
  ensureBridgeInPubspec(cwd);
  patchMainDart(cwd);

  // 4. License (single prompt)
  const licenseKey = await ensureLicense();
  if (!licenseKey) process.exit(1);

  // 5. Permission mode
  setPermissionMode('FULL_ACCESS');

  // 6. Install into MCP host(s)
  for (const host of hosts) installMcp(host, licenseKey, cwd);

  // 7. Finalize
  finalizeProject(cwd);

  // 8. Doctor
  console.log('\n──── Doctor ────');
  const health = await doctor(cwd, licenseKey);

  // 9. First success loop
  if (health.healthy) {
    await firstSuccessLoop(cwd, licenseKey).catch(() => warn('first-success loop skipped'));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n──── Setup complete in ${elapsed}s ────`);
  console.log(`  Total checks: ${checks.length}, ${checks.filter(c => c.status === '✓').length} ok, ${checks.filter(c => c.status === '⚠').length} warnings, ${checks.filter(c => c.status === '✗').length} failures`);
  console.log('\n  Try in your MCP host:');
  console.log('    "What does this app look like?"');
  console.log('    "Audit my UI"');
  console.log('    "Fix any layout overflows"');
  if (checks.some(c => c.status === '⚠')) {
    console.log('\n  Warnings are non-blocking. Run `inkpal doctor` anytime to re-check.');
  }
}
