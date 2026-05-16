#!/usr/bin/env node
/**
 * inkpal CLI — setup and installation helper
 *
 * Commands:
 *   inkpal claude install    — Add InkPal MCP to Claude Code (~/.claude/settings.json)
 *   inkpal cursor install    — Add InkPal MCP to Cursor (.cursor/mcp.json)
 *   inkpal windsurf install  — Add InkPal MCP to Windsurf (~/.codeium/windsurf/mcp_config.json)
 *   inkpal install           — Auto-detect editor and install
 *   inkpal status            — Show current installation status
 *   inkpal doctor            — Check InkPal environment
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { claimTrial, validateKeyRemote } from './remote.js';
import { start as startCommand } from './start.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '';

// ── Editor config paths ──────────────────────────────────────────────────────

// Claude Code v2.x reads MCP servers from ~/.claude.json (NOT ~/.claude/settings.json
// which holds permissions only). This was a real bug that broke every install
// before 0.8.5 — the install wrote to the wrong file and Claude Code never
// loaded the entry. RUN1+RUN2 of the battle-test surfaced this first.
const EDITORS = {
  claude: {
    name: 'Claude Code',
    configPath: join(HOME, '.claude.json'),
    configDir: HOME,
    mcpKey: 'mcpServers',
  },
  cursor: {
    name: 'Cursor',
    configPath: join(process.cwd(), '.cursor', 'mcp.json'),
    configDir: join(process.cwd(), '.cursor'),
    mcpKey: 'mcpServers',
  },
  windsurf: {
    name: 'Windsurf',
    configPath: join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
    configDir: join(HOME, '.codeium', 'windsurf'),
    mcpKey: 'mcpServers',
  },
  copilot: {
    name: 'GitHub Copilot (VS Code)',
    configPath: join(process.cwd(), '.vscode', 'mcp.json'),
    configDir: join(process.cwd(), '.vscode'),
    mcpKey: 'servers',
  },
  codex: {
    name: 'OpenAI Codex CLI',
    configPath: join(HOME, '.codex', 'mcp.json'),
    configDir: join(HOME, '.codex'),
    mcpKey: 'mcpServers',
  },
} as const;

type EditorKey = keyof typeof EDITORS;

// ── MCP server config entry ──────────────────────────────────────────────────

function makeServerConfig(editor: EditorKey, licenseKey = '') {
  // CRITICAL: must spawn the inkpal-mcp BINARY explicitly, not just `inkpal`.
  // The bare `inkpal` binary is the CLI which prints help and exits, NOT the
  // MCP server. Pre-0.8.5 installs wrote `args: ['-y', 'inkpal@latest']` which
  // ran the CLI → Claude Code marked the MCP as failed every time.
  // Correct invocation: `npx -y -p inkpal@latest inkpal-mcp`.
  const base = {
    command: 'npx',
    args: ['-y', '-p', 'inkpal@latest', 'inkpal-mcp'],
    env: {
      INKPAL_LICENSE_KEY: licenseKey,
      INKPAL_PERMISSION_MODE: 'FULL_ACCESS',
    },
  };

  if (editor === 'copilot') {
    return { type: 'stdio', ...base };
  }
  if (editor === 'claude') {
    return { type: 'stdio', ...base };
  }
  return base;
}

// ── Orphan-cleanup (THE fix that prevents stale binaries shadowing npm) ────

/**
 * Detect and rename stale standalone binaries / configs from prior `inkpal install`
 * runs. These compete with the npm-managed entry and silently break upgrades.
 *
 * Renames (preserves user data) instead of deleting. Files end up as `<name>.OLD-DATE`.
 *
 * Returns a summary of what was found/cleaned.
 */
function cleanupOrphans(opts: { dryRun?: boolean } = {}): { found: string[]; cleaned: string[]; skipped: string[] } {
  const found: string[] = [];
  const cleaned: string[] = [];
  const skipped: string[] = [];
  const ts = new Date().toISOString().slice(0, 10);

  const candidates = [
    {
      path: join(HOME, '.inkpal', 'bin', 'inkpal-mcp'),
      reason: 'standalone Mach-O/ELF binary from prior `inkpal install`',
    },
    {
      path: join(HOME, '.inkpal', 'mcp-config.json'),
      reason: 'orphan MCP config that competes with ~/.claude.json',
      validate: (file: string): boolean => {
        try {
          const cfg = JSON.parse(readFileSync(file, 'utf8'));
          const cmd = cfg?.mcpServers?.inkpal?.command || '';
          // Only consider it stale if it points at the standalone binary OR a retired URL
          return /\.inkpal\/bin\/inkpal-mcp/i.test(cmd)
            || /production-3826|production-a41b/.test(JSON.stringify(cfg));
        } catch { return true; /* unparseable = stale */ }
      },
    },
  ];

  for (const c of candidates) {
    if (!existsSync(c.path)) continue;
    if (c.validate && !c.validate(c.path)) {
      skipped.push(`${c.path} (not detected as stale)`);
      continue;
    }
    found.push(c.path);
    if (opts.dryRun) continue;
    const dest = `${c.path}.OLD-${ts}`;
    try {
      execSync(`mv "${c.path}" "${dest}"`);
      cleaned.push(`${c.path} → ${dest}`);
    } catch (e) {
      skipped.push(`${c.path} (rename failed: ${(e as Error).message})`);
    }
  }
  return { found, cleaned, skipped };
}

/** Best-effort npm-version probe; returns latest published or null on failure. */
function fetchLatestVersion(timeoutMs = 3000): string | null {
  try {
    const out = execSync('npm view inkpal version --silent', {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Read the installed proxy version from package.json. ESM-safe (no __dirname). */
function getInstalledVersion(): string {
  try {
    // ESM context — derive dist/ directory from import.meta.url
    const url = new URL(import.meta.url);
    const pkgPath = join(dirname(url.pathname), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version as string;
  } catch { return 'unknown'; }
}

// ── Install ──────────────────────────────────────────────────────────────────

function install(editor: EditorKey, opts: { key?: string; clean?: boolean } = {}): void {
  const cfg = EDITORS[editor];
  console.log(`\nInstalling InkPal for ${cfg.name}...`);

  // STEP 1 (NEW in 0.8.5): cleanup orphan binaries / configs from prior installs.
  // This is THE fix that prevents stale ~/.inkpal/bin/inkpal-mcp shadowing the
  // npm-managed entry. Without this, every upgrade silently fails because the
  // OS-resident standalone binary keeps serving outdated MCP responses.
  console.log('\n  Checking for stale install artifacts...');
  const cleanup = cleanupOrphans({ dryRun: false });
  if (cleanup.cleaned.length === 0 && cleanup.found.length === 0) {
    console.log('  ✓ No stale artifacts found.');
  } else {
    for (const c of cleanup.cleaned) console.log(`  ✓ Renamed: ${c}`);
    for (const s of cleanup.skipped) console.log(`  - Skipped: ${s}`);
  }

  // STEP 2: ensure config dir exists.
  if (cfg.configDir !== HOME && !existsSync(cfg.configDir)) {
    mkdirSync(cfg.configDir, { recursive: true });
  }

  // STEP 3: read existing config so we don't clobber other servers.
  let config: Record<string, unknown> = {};
  if (existsSync(cfg.configPath)) {
    try {
      config = JSON.parse(readFileSync(cfg.configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      console.warn(`  Warning: could not parse existing config at ${cfg.configPath}, creating new.`);
    }
  }

  // STEP 4 (NEW in 0.8.5): preserve the existing license key when re-installing.
  // Pre-0.8.5 install always blanked INKPAL_LICENSE_KEY → users had to re-paste
  // their key after every upgrade.
  let preservedKey = opts.key || '';
  if (!preservedKey) {
    const existingServers = config[cfg.mcpKey] as Record<string, unknown> | undefined;
    const existingInkpal = existingServers?.['inkpal'] as { env?: { INKPAL_LICENSE_KEY?: string } } | undefined;
    preservedKey = existingInkpal?.env?.INKPAL_LICENSE_KEY || '';
    if (preservedKey) console.log(`  ✓ Preserved existing license key (ink_${preservedKey.slice(4, 8)}…).`);
  }

  // STEP 5: write the corrected MCP entry (correct binary name + correct path).
  const servers = (config[cfg.mcpKey] as Record<string, unknown>) || {};
  servers['inkpal'] = makeServerConfig(editor, preservedKey);
  config[cfg.mcpKey] = servers;
  writeFileSync(cfg.configPath, JSON.stringify(config, null, 2));
  console.log(`  ✓ Config written to: ${cfg.configPath}`);

  // STEP 6: surface what to do next.
  if (!preservedKey) {
    console.log('\n  Next step — add your license key:');
    console.log(`    1. Get your key:  https://inkpal.ai/pricing  (free tier: no card)`);
    console.log(`    2. Re-run install:  npx inkpal ${editor} install --key ink_your_key_here`);
    console.log('    3. Restart your editor to activate InkPal\n');
  } else {
    console.log(`\n  ✓ Done. Restart ${cfg.name} to activate InkPal.\n`);
  }

  // STEP 7 (NEW in 0.8.5): self-update warning.
  const installed = getInstalledVersion();
  const latest = fetchLatestVersion(2000);
  if (latest && installed !== 'unknown' && installed !== latest) {
    console.log(`  ⚠ You ran installer v${installed} but v${latest} is on npm.`);
    console.log(`    Recommend: npm install -g inkpal@${latest}  then re-run install.\n`);
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

function status(): void {
  console.log('\nInkPal Installation Status\n');

  for (const [key, cfg] of Object.entries(EDITORS)) {
    const installed = existsSync(cfg.configPath);
    let hasInkPal = false;
    let hasKey = false;

    if (installed) {
      try {
        const raw = readFileSync(cfg.configPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const servers = parsed[cfg.mcpKey] as Record<string, unknown> | undefined;
        hasInkPal = !!servers?.['inkpal'];
        if (hasInkPal) {
          const srv = servers!['inkpal'] as Record<string, unknown>;
          const env = (srv.env || {}) as Record<string, string>;
          hasKey = !!(env.INKPAL_LICENSE_KEY && env.INKPAL_LICENSE_KEY.startsWith('ink_'));
        }
      } catch { /* unreadable */ }
    }

    const mark = hasInkPal && hasKey ? '✓' : hasInkPal ? '~' : ' ';
    const label = hasInkPal && hasKey
      ? 'installed + key set'
      : hasInkPal
        ? 'installed — license key missing'
        : installed
          ? 'config exists — InkPal not added'
          : 'not detected';

    console.log(`  [${mark}] ${cfg.name.padEnd(25)} ${label}`);
    if (hasInkPal && !hasKey) {
      console.log(`      Run: inkpal ${key} install  (then add your key)`);
    }
  }

  console.log('\n  Get a license key at: https://inkpal.ai/pricing');
}

// ── Doctor ───────────────────────────────────────────────────────────────────

async function doctor(): Promise<void> {
  console.log('\nInkPal Doctor\n');

  const checks: Array<{ label: string; pass: boolean; hint?: string }> = [];
  const apiBase = process.env.INKPAL_API_URL || 'https://mcp.inkpal.ai';

  // Flutter SDK
  try {
    const v = execSync('flutter --version --machine 2>/dev/null || flutter --version', { encoding: 'utf8', timeout: 10_000 });
    const match = v.match(/Flutter (\S+)/);
    checks.push({ label: `Flutter SDK  ${match ? match[1] : '(found)'}`, pass: true });
  } catch {
    checks.push({ label: 'Flutter SDK', pass: false, hint: 'Install from https://flutter.dev/docs/get-started/install' });
  }

  // ADB
  try {
    execSync('adb version', { encoding: 'utf8', timeout: 5_000 });
    checks.push({ label: 'ADB (Android Bridge)', pass: true });
  } catch {
    checks.push({ label: 'ADB (Android Bridge)', pass: false, hint: 'Install Android SDK platform-tools or use iOS (xcrun)' });
  }

  // License key
  const key = process.env.INKPAL_LICENSE_KEY || '';
  const hasKey = key.startsWith('ink_') && key.length >= 10;
  checks.push({
    label: `License key  ${hasKey ? key.slice(0, 10) + '...' : '(not set)'}`,
    pass: hasKey,
    hint: hasKey ? undefined : 'Set INKPAL_LICENSE_KEY in your editor MCP config. Get key: https://inkpal.ai/pricing',
  });

  // Flutter project
  const hasPubspec = existsSync(join(process.cwd(), 'pubspec.yaml'));
  checks.push({
    label: `Flutter project at ${process.cwd()}`,
    pass: hasPubspec,
    hint: hasPubspec ? undefined : 'Run from your Flutter project root (where pubspec.yaml lives)',
  });

  // inkpal_bridge in pubspec
  if (hasPubspec) {
    const pubspec = readFileSync(join(process.cwd(), 'pubspec.yaml'), 'utf8');
    const hasBridge = pubspec.includes('inkpal_bridge');
    checks.push({
      label: 'inkpal_bridge in pubspec.yaml',
      pass: hasBridge,
      hint: hasBridge ? undefined : 'Run: inkpal init  (adds inkpal_bridge and patches main.dart)',
    });
  }

  // InkPal server reachable. We use fetch (no shell) instead of curl so a
  // pathological INKPAL_API_URL env value can't shell-inject. Validates the
  // URL parses as http(s) before issuing the request.
  try {
    const u = new URL(apiBase);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('non-http URL');
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(`${u.origin}/health`, { signal: ac.signal });
    clearTimeout(t);
    checks.push({ label: `InkPal server  ${u.origin}`, pass: r.ok });
  } catch {
    checks.push({ label: `InkPal server  ${apiBase}`, pass: false, hint: 'Local tools (flutter analyze/test/build, ADB) still work offline' });
  }

  for (const c of checks) {
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.label}`);
    if (!c.pass && c.hint) console.log(`    → ${c.hint}`);
  }

  const passed = checks.filter(c => c.pass).length;
  console.log(`\n  ${passed}/${checks.length} checks passed`);

  // License tier + usage (async, non-blocking on failure)
  if (hasKey) {
    try {
      const validation = await validateKeyRemote(key);
      if (validation.valid) {
        console.log(`\n  License tier: ${(validation.tier ?? 'dev').toUpperCase()}`);
      } else if (validation.error) {
        console.log(`\n  License: ${validation.error}`);
      }
    } catch { /* ignore — already shown server reachability above */ }
  }
}

// ── Bridge auto-install ───────────────────────────────────────────────────────

function initProject(): void {
  const cwd = process.cwd();
  const pubspecPath = join(cwd, 'pubspec.yaml');

  if (!existsSync(pubspecPath)) {
    console.error('\n  Not a Flutter project (no pubspec.yaml found).');
    console.error(`  Run from your project root. Current dir: ${cwd}`);
    process.exit(1);
  }

  console.log('\nInkPal Init\n');

  let pubspec = readFileSync(pubspecPath, 'utf8');
  const mainPath = join(cwd, 'lib', 'main.dart');

  // 1. Check/add inkpal_bridge to pubspec.yaml
  if (pubspec.includes('inkpal_bridge')) {
    console.log('  [✓] inkpal_bridge already in pubspec.yaml');
  } else {
    // Insert under dependencies:
    if (pubspec.includes('\ndependencies:')) {
      pubspec = pubspec.replace(
        /(\ndependencies:\n)/,
        '$1  inkpal_bridge: ^1.0.1\n',
      );
      writeFileSync(pubspecPath, pubspec);
      console.log('  [+] Added inkpal_bridge: ^1.0.1 to pubspec.yaml');
    } else {
      console.log('  [!] Could not find dependencies: section. Add manually:');
      console.log('      inkpal_bridge: ^1.0.1');
    }
  }

  // 2. Check/patch main.dart
  if (existsSync(mainPath)) {
    let main = readFileSync(mainPath, 'utf8');

    if (main.includes('InkPalBridge.init') || main.includes('inkpal_bridge')) {
      console.log('  [✓] inkpal_bridge already initialized in main.dart');
    } else {
      // Add import at top (after existing imports)
      const importLine = "import 'package:inkpal_bridge/inkpal_bridge.dart';";
      if (!main.includes(importLine)) {
        // Insert after last existing import
        main = main.replace(/(import '[^']+';)\n(?!import)/, `$1\n${importLine}\n`);
      }

      // Wrap runApp with InkPalBridge.init
      main = main.replace(
        /runApp\(/,
        'InkPalBridge.init(\n    appRunner: () => runApp(',
      ).replace(
        /(InkPalBridge\.init\(\n    appRunner: () => runApp\([^)]+\))/,
        "$1,\n    serverUrl: 'ws://localhost:8765',\n  )",
      );

      writeFileSync(mainPath, main);
      console.log('  [+] Patched lib/main.dart with InkPalBridge.init()');
    }
  } else {
    console.log('  [!] lib/main.dart not found — patch manually:');
    console.log("      import 'package:inkpal_bridge/inkpal_bridge.dart';");
    console.log('      InkPalBridge.init(appRunner: () => runApp(MyApp()), serverUrl: \'ws://localhost:8765\');');
  }

  // 3. Run flutter pub get
  console.log('\n  Running flutter pub get...');
  try {
    const out = execSync('flutter pub get', { cwd, encoding: 'utf8', timeout: 60_000 });
    const lines = out.split('\n').filter(l => l.trim()).slice(-3);
    for (const l of lines) console.log(`  ${l}`);
    console.log('  [✓] Dependencies installed');
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    console.error(`  [!] flutter pub get failed: ${err.stderr || err.message}`);
  }

  // 4. Create .inkpal/ directory for local data
  const inkpalDir = join(cwd, '.inkpal');
  if (!existsSync(inkpalDir)) {
    mkdirSync(inkpalDir, { recursive: true });
    console.log('  [+] Created .inkpal/ directory');
  }

  // 5. Add .inkpal/ to .gitignore if not already there
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gi = readFileSync(gitignorePath, 'utf8');
    if (!gi.includes('.inkpal/')) {
      writeFileSync(gitignorePath, gi + '\n# InkPal local data\n.inkpal/\n');
      console.log('  [+] Added .inkpal/ to .gitignore');
    }
  }

  console.log('\n  Done! InkPal Bridge installed. Next steps:');
  console.log('  1. Run your app: flutter run');
  console.log('  2. Ask Claude: "analyze my Flutter project"');
  console.log('  3. Run inkpal doctor to verify everything is connected');
}

// ── Auto-detect and install ──────────────────────────────────────────────────

function autoInstall(): void {
  const detected: EditorKey[] = [];

  // Claude Code: check if running inside it
  if (process.env.CLAUDE_CODE || existsSync(join(HOME, '.claude'))) detected.push('claude');
  if (existsSync(join(HOME, '.cursor')) || existsSync(join(process.cwd(), '.cursor'))) detected.push('cursor');
  if (existsSync(join(HOME, '.codeium', 'windsurf'))) detected.push('windsurf');
  if (existsSync(join(HOME, '.codex'))) detected.push('codex');
  if (existsSync(join(process.cwd(), '.vscode'))) detected.push('copilot');

  if (detected.length === 0) {
    console.log('\nNo editor detected. Specify one:');
    console.log('  inkpal claude install');
    console.log('  inkpal cursor install');
    console.log('  inkpal windsurf install');
    return;
  }

  console.log(`\nDetected: ${detected.map(e => EDITORS[e].name).join(', ')}`);
  for (const editor of detected) {
    install(editor);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    console.log('\ninkpal — AI-powered Flutter development tools');
    console.log('\nUsage:');
    console.log('  inkpal start                 Zero-config setup: bridge, MCP host, license, doctor, first-success loop');
    console.log('  inkpal init                  Add inkpal_bridge to this Flutter project (legacy)');
    console.log('  inkpal trial <email>         Start a free 24h Pro trial (5 screens)');
    console.log('  inkpal claude install [--key X] Add InkPal MCP to Claude Code (auto-cleans stale binaries)');
    console.log('  inkpal upgrade                Re-run install on every detected editor (clean upgrade)');
    console.log('  inkpal clean [--dry-run]      Remove stale binaries / configs from prior installs');
    console.log('  inkpal cursor install        Add InkPal MCP to Cursor');
    console.log('  inkpal windsurf install      Add InkPal MCP to Windsurf');
    console.log('  inkpal codex install         Add InkPal MCP to OpenAI Codex CLI');
    console.log('  inkpal install               Auto-detect editor and install MCP');
    console.log('  inkpal status                Show installation status across all editors');
    console.log('  inkpal doctor                Check environment (Flutter, ADB, license, bridge)');
    console.log('\nGet your license key at: https://inkpal.ai/pricing');
    return;
  }

  if (args[0] === 'start') { startCommand().catch(e => { console.error('start failed:', e?.message ?? e); process.exit(1); }); return; }
  if (args[0] === 'init') { initProject(); return; }
  if (args[0] === 'install' && args.length === 1) { autoInstall(); return; }
  if (args[0] === 'status') { status(); return; }
  if (args[0] === 'doctor') { doctor().catch(() => {}); return; }

  if (args[0] === 'trial') {
    const email = args[1];
    if (!email || !email.includes('@')) {
      console.error('Usage: inkpal trial <your@email.com>');
      process.exit(1);
    }
    console.log(`\nClaiming 24h Pro trial for ${email}...`);
    claimTrial(email).then(result => {
      if (result.error) {
        console.error(`\n✗ Trial failed: ${result.error}`);
        if (result.error.includes('already')) {
          console.error('  One trial per email. Upgrade at: https://inkpal.ai/pro');
        }
        process.exit(1);
      }
      console.log('\n✓ Trial activated!');
      console.log(`  License key: ${result.license_key}`);
      console.log(`  Plan: ${result.tier} (${result.screens_included} screens included)`);
      console.log(`  Expires: ${result.expires_at ? new Date(result.expires_at).toLocaleString() : '24h from now'}`);
      console.log('\nAdd to your MCP config:');
      console.log(`  "env": { "INKPAL_LICENSE_KEY": "${result.license_key}" }`);
      console.log('\nUpgrade before it expires: https://inkpal.ai/pro');
    }).catch(err => {
      console.error('Network error:', err.message);
      process.exit(1);
    });
    return;
  }

  // ── New in 0.8.5: standalone `inkpal clean` to scrub orphans without re-installing
  if (args[0] === 'clean') {
    const dryRun = args.includes('--dry-run');
    console.log(dryRun ? '\nInkPal clean (dry-run) — would rename:\n' : '\nInkPal clean — renaming stale install artifacts:\n');
    const result = cleanupOrphans({ dryRun });
    if (result.found.length === 0) {
      console.log('  ✓ No stale artifacts found. Your install is clean.');
    } else {
      for (const c of result.cleaned) console.log(`  ✓ ${c}`);
      for (const f of dryRun ? result.found : []) console.log(`  - would rename: ${f}`);
      for (const s of result.skipped) console.log(`  - skipped: ${s}`);
    }
    return;
  }

  // ── New in 0.8.5: `inkpal upgrade` shortcut for `<editor> install --clean`
  if (args[0] === 'upgrade') {
    autoInstall();
    return;
  }

  // Editor-specific install with flag parsing
  const editor = args[0] as EditorKey;
  const action = args[1];

  if (!EDITORS[editor]) {
    console.error(`Unknown editor: ${editor}`);
    console.error('Supported: claude, cursor, windsurf, copilot');
    console.error('Or: inkpal install (auto-detect) | inkpal clean | inkpal upgrade | inkpal doctor | inkpal status');
    process.exit(1);
  }

  if (action === 'install') {
    // Parse --key <value> and --clean flags
    const keyIdx = args.indexOf('--key');
    const key = keyIdx > -1 && args[keyIdx + 1] ? args[keyIdx + 1] : undefined;
    const clean = args.includes('--clean');
    install(editor, { key, clean });
    return;
  }

  console.error(`Unknown command: ${args.join(' ')}`);
  console.error('Run: inkpal --help');
  process.exit(1);
}

main();
