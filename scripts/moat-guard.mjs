#!/usr/bin/env node
/**
 * Moat Guard — fails npm publish if any moat-protected pattern leaks
 * into the compiled tarball.
 *
 * Runs in prepublishOnly (after `tsc`, before `npm publish` actually ships).
 * Scans dist/**\/*.js for forbidden identifiers, taxonomies, and
 * intelligence patterns. Exits non-zero (and prints what + where) on any
 * hit, so the publish never goes out.
 *
 * Update FORBIDDEN_PATTERNS only when the doctrine changes — not when a
 * pattern false-positives. False positives mean the moat doctrine is
 * being violated and the code needs to move server-side.
 *
 * See: feedback_inkpal_moat_protection.md
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PKG_DIR = new URL('..', import.meta.url).pathname;
const DIST_DIR = join(PKG_DIR, 'dist');
const BIN_DIR = join(PKG_DIR, 'bin');

// Binaries we'd refuse to publish if present. Bundled binaries can't be
// scanned reliably for forbidden identifiers (the bundler may rename or
// compress them), so the only safe policy is to refuse to publish any
// prebuilt binary at all. Source-of-truth distribution is the npm
// tarball + provenance-attested workflow build, not local binaries.
const BIN_EXTS = new Set(['', '.exe']);  // Unix has no extension, Windows uses .exe

// ─────────────────────────────────────────────────────────────────────
// Forbidden patterns — anything matching here is an InkPal-internal
// taxonomy, orchestration identifier, or starter-rule literal that
// must live on Railway, not in the public tarball.
// ─────────────────────────────────────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  // Orchestration engine identifiers
  { name: 'PACK_REGISTRY (rulepack-engine)', re: /\bPACK_REGISTRY\b/ },
  { name: 'resolveRulepacks (server-only)', re: /\bresolveRulepacks\s*\(/ },
  { name: 'detectContext (server-only)', re: /\bdetectContext\s*\(/ },
  { name: 'mergeRulepackRules (server-only)', re: /\bmergeRulepackRules\s*\(/ },
  { name: 'describeResolution (server-only)', re: /\bdescribeResolution\s*\(/ },

  // Spec-to-plan taxonomies
  { name: 'KNOWN_PACKAGES taxonomy', re: /\bKNOWN_PACKAGES\b/ },
  { name: 'STATE_MGMT_KEYWORDS', re: /\bSTATE_MGMT_KEYWORDS\b/ },
  { name: 'DESIGN_KEYWORDS', re: /\bDESIGN_KEYWORDS\b/ },
  { name: 'SCREEN_HINTS', re: /\bSCREEN_HINTS\b/ },
  { name: 'STATE_PKGS taxonomy', re: /\bSTATE_PKGS\b/ },
  { name: 'NAV_PKGS taxonomy', re: /\bNAV_PKGS\b/ },
  { name: 'L10N_PKGS taxonomy', re: /\bL10N_PKGS\b/ },
  { name: 'NETWORK_PKGS taxonomy', re: /\bNETWORK_PKGS\b/ },

  // Scoring formulas
  { name: 'computeConfidence scoring', re: /\bcomputeConfidence\s*\(/ },
  { name: 'score += 0.x weight literal', re: /score\s*\+=\s*0\.\d/ },

  // Starter-rule arrays
  { name: 'STARTER_AUDIT_UI rule pack', re: /\bSTARTER_AUDIT_UI\b/ },
  { name: 'STARTER_A11Y rule pack', re: /\bSTARTER_A11Y\b/ },
  // Catch-all for the generic STARTER variable used by the older starter
  // patterns — but only when it's an array of rule objects (avoid false
  // positives on words like "starter" in plain prose).
  { name: 'STARTER rule array', re: /const\s+STARTER\s*[:=]\s*\[/ },
];

// File-level allowlist exemptions are intentionally NOT supported. Every
// .js in dist/ must pass. If you need to ship a pattern legitimately,
// rename the variable.

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

function scan() {
  const files = walk(DIST_DIR);
  const hits = [];
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.re.test(lines[i])) {
          hits.push({
            file: file.replace(DIST_DIR + '/', 'dist/'),
            line: i + 1,
            pattern: pattern.name,
            snippet: lines[i].slice(0, 120).trim(),
          });
        }
      }
    }
  }
  // Defense in depth: prebuilt binaries in bin/ can contain pre-lockdown
  // intelligence in a form moat-guard can't scan reliably. Refuse to
  // publish if any are present in the package directory.
  if (existsSync(BIN_DIR)) {
    for (const entry of readdirSync(BIN_DIR)) {
      const full = join(BIN_DIR, entry);
      const st = statSync(full);
      if (st.isFile() && st.size > 1_000_000) {
        hits.push({
          file: `bin/${entry}`,
          line: 0,
          pattern: 'prebuilt binary in bin/ (cannot be moat-scanned)',
          snippet: `${(st.size / 1024 / 1024).toFixed(1)} MB binary — remove from package dir before publish`,
        });
      }
    }
  }
  return { files: files.length, hits };
}

const { files, hits } = scan();

if (hits.length > 0) {
  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  MOAT GUARD: PUBLISH BLOCKED');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(`  Scanned ${files} file(s) in dist/.`);
  console.error(`  Found ${hits.length} forbidden pattern hit(s):`);
  console.error('');
  for (const hit of hits) {
    console.error(`  ✗ ${hit.file}:${hit.line}`);
    console.error(`    pattern : ${hit.pattern}`);
    console.error(`    line    : ${hit.snippet}`);
    console.error('');
  }
  console.error('  This pattern represents InkPal orchestration intelligence');
  console.error('  that must live on Railway, not in the public npm tarball.');
  console.error('  See: feedback_inkpal_moat_protection.md');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  process.exit(1);
}

console.log(`✓ moat-guard: scanned ${files} dist file(s), 0 forbidden patterns. Safe to publish.`);
