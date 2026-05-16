/**
 * Pricing invariants — guards the single-Pro-plan model from drift.
 *
 * The model: ONE plan (InkPal Pro), THREE durations (monthly / 6mo / annual),
 * TWO currencies (USD globally, INR for India). 24h email-required trial.
 * No refunds. No Studio. No Free tier.
 *
 * If any of these assumptions break, fix the test AFTER updating ALL surfaces
 * (README, INSTALL, website, server, emails) — not just to make the test pass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(PKG_ROOT));

// The website lives only in the monorepo. When this package is mirrored
// to the standalone public repo (InkPalAI/inkpal_npm), website-coupled
// invariants don't apply — skip rather than fail.
const TIERS_PATH = join(REPO_ROOT, 'website/lib/tiers.ts');
const IS_MONOREPO = existsSync(TIERS_PATH);

describe('Pricing invariants — single Pro plan', () => {
  const readme = readFileSync(join(PKG_ROOT, 'README.md'), 'utf8');
  const installMd = readFileSync(join(PKG_ROOT, 'INSTALL.md'), 'utf8');
  const startSrc = readFileSync(join(PKG_ROOT, 'src/start.ts'), 'utf8');

  it('README does NOT lead with payment amounts (dev-friendly first-touch)', () => {
    // 2026-05-12 marketing pivot: pub.dev / npm visitors are evaluating,
    // not buying. Prices belong on /pricing — first-touch surfaces should
    // urge "start free, full power" and let value sell the upgrade.
    expect(readme).not.toMatch(/\$\d{2,3}\/?(mo|yr|year|month|6mo)/i);
    expect(readme).not.toMatch(/₹\d{1,2},?\d{3}/);
  });

  it('README does NOT mention deprecated tier prices', () => {
    // Old Free/Pro/Studio at $0/$12/$29 (pre-pivot) and $19/$49 (memory's
    // mistaken value) must never reappear in marketing copy.
    expect(readme).not.toMatch(/\$19\/mo/);
    expect(readme).not.toMatch(/\$49\/mo/);
    expect(readme).not.toMatch(/\$12\/mo/);
    expect(readme).not.toMatch(/\$29\/mo/);
    expect(readme).not.toMatch(/Studio.*\$\d+/);
  });

  it('README leads with the trial CTA', () => {
    expect(readme).toMatch(/npx inkpal trial/);
    expect(readme).toMatch(/24[- ]?hour/i);
    expect(readme).toMatch(/no card/i);
  });

  it('README documents the 24h trial requires email', () => {
    expect(readme).toMatch(/24[- ]?hour|24h/i);
    expect(readme).toMatch(/email/i);
    expect(readme).toMatch(/inkpal trial/);
  });

  // No-refund policy: stays on /pricing + /refund; not first-touch material.

  it('README documents the goodwill paths (students, OSS, team)', () => {
    expect(readme).toMatch(/[Ss]tudents?/);
    expect(readme).toMatch(/\.edu/);
    expect(readme).toMatch(/OSS|open.?source/i);
    expect(readme).toMatch(/[Tt]eam/);
  });

  it('start.ts no longer auto-claims silent free-tier keys', () => {
    // The old auto-provision flow silently issued perpetual free keys per
    // device. The new flow prompts for an email and claims a 24h trial.
    expect(startSrc).not.toMatch(/api\/license\/auto-provision/);
    expect(startSrc).toMatch(/api\/trial\/claim/);
    expect(startSrc).toMatch(/promptAndClaimTrial/);
  });

  it('start.ts trial flow asks for an email', () => {
    expect(startSrc).toMatch(/Email:/);
    expect(startSrc).toMatch(/trial/i);
  });

  it('INSTALL.md failure catalog covers trial expiration', () => {
    expect(installMd).toMatch(/[Tt]rial.*expired/);
    expect(installMd).toMatch(/inkpal\.ai\/pricing/);
  });
});

describe.skipIf(!IS_MONOREPO)('Website tiers.ts — single Pro plan, 6 SKUs', () => {
  const tiersSrc = IS_MONOREPO ? readFileSync(TIERS_PATH, 'utf8') : '';

  it('exports PLANS structure with usd + inr currencies', () => {
    expect(tiersSrc).toMatch(/PLANS.*Currency.*PlanDuration/);
    expect(tiersSrc).toMatch(/usd:\s*\{/);
    expect(tiersSrc).toMatch(/inr:\s*\{/);
  });

  it('declares all 6 plan SKU IDs', () => {
    expect(tiersSrc).toMatch(/pro_monthly_usd/);
    expect(tiersSrc).toMatch(/pro_six_months_usd/);
    expect(tiersSrc).toMatch(/pro_annual_usd/);
    expect(tiersSrc).toMatch(/pro_monthly_inr/);
    expect(tiersSrc).toMatch(/pro_six_months_inr/);
    expect(tiersSrc).toMatch(/pro_annual_inr/);
  });

  it('USD prices match agreed ($39 / $179 / $299)', () => {
    expect(tiersSrc).toMatch(/priceUnits:\s*3900/);
    expect(tiersSrc).toMatch(/priceUnits:\s*17900/);
    expect(tiersSrc).toMatch(/priceUnits:\s*29900/);
  });

  it('INR prices match agreed (₹1,499 / ₹6,499 / ₹9,999)', () => {
    expect(tiersSrc).toMatch(/priceUnits:\s*149900/);
    expect(tiersSrc).toMatch(/priceUnits:\s*649900/);
    expect(tiersSrc).toMatch(/priceUnits:\s*999900/);
  });

  it('exports detectCurrency helper that picks INR for India', () => {
    expect(tiersSrc).toMatch(/detectCurrency/);
    expect(tiersSrc).toMatch(/IN.*inr|inr.*IN/);
  });
});
