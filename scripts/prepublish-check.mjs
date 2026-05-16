#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PKG_DIR = new URL('..', import.meta.url).pathname;
const DIST_DIR = join(PKG_DIR, 'dist');
const BIN_DIR = join(PKG_DIR, 'bin');

const FORBIDDEN_PATTERNS = [
  { name: 'PACK_REGISTRY', re: /\bPACK_REGISTRY\b/ },
  { name: 'resolveRulepacks', re: /\bresolveRulepacks\s*\(/ },
  { name: 'detectContext', re: /\bdetectContext\s*\(/ },
  { name: 'mergeRulepackRules', re: /\bmergeRulepackRules\s*\(/ },
  { name: 'describeResolution', re: /\bdescribeResolution\s*\(/ },
  { name: 'KNOWN_PACKAGES', re: /\bKNOWN_PACKAGES\b/ },
  { name: 'STATE_MGMT_KEYWORDS', re: /\bSTATE_MGMT_KEYWORDS\b/ },
  { name: 'DESIGN_KEYWORDS', re: /\bDESIGN_KEYWORDS\b/ },
  { name: 'SCREEN_HINTS', re: /\bSCREEN_HINTS\b/ },
  { name: 'STATE_PKGS', re: /\bSTATE_PKGS\b/ },
  { name: 'NAV_PKGS', re: /\bNAV_PKGS\b/ },
  { name: 'L10N_PKGS', re: /\bL10N_PKGS\b/ },
  { name: 'NETWORK_PKGS', re: /\bNETWORK_PKGS\b/ },
  { name: 'computeConfidence', re: /\bcomputeConfidence\s*\(/ },
  { name: 'score weight literal', re: /score\s*\+=\s*0\.\d/ },
  { name: 'STARTER_AUDIT_UI', re: /\bSTARTER_AUDIT_UI\b/ },
  { name: 'STARTER_A11Y', re: /\bSTARTER_A11Y\b/ },
  { name: 'STARTER rule array', re: /const\s+STARTER\s*[:=]\s*\[/ },
];

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
  if (existsSync(BIN_DIR)) {
    for (const entry of readdirSync(BIN_DIR)) {
      const full = join(BIN_DIR, entry);
      const st = statSync(full);
      if (st.isFile() && st.size > 1_000_000) {
        hits.push({
          file: `bin/${entry}`,
          line: 0,
          pattern: 'prebuilt binary in bin/',
          snippet: `${(st.size / 1024 / 1024).toFixed(1)} MB binary — remove before publish`,
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
  console.error('  prepublish-check: PUBLISH BLOCKED');
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
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  process.exit(1);
}

console.log(`prepublish-check: scanned ${files} dist file(s), 0 forbidden patterns. OK to publish.`);
