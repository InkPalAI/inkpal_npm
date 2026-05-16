import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runChain } from '../dist/chain.js';
import { handleLocal } from '../dist/local.js';
const HAS_LICENSE = !!process.env.INKPAL_LICENSE_KEY && !!process.env.INKPAL_API_URL;
const TMP = join(tmpdir(), `inkpal-ship-test-${Date.now()}`);
beforeEach(() => {
    mkdirSync(join(TMP, 'lib'), { recursive: true });
    writeFileSync(join(TMP, 'pubspec.yaml'), 'name: shiptest\nversion: 0.1.0\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\nflutter:\n');
    writeFileSync(join(TMP, 'lib', 'main.dart'), 'void main() {}\n');
    execSync('git init -q', { cwd: TMP });
    execSync('git config user.email "test@inkpal.local"', { cwd: TMP });
    execSync('git config user.name "InkPal Test"', { cwd: TMP });
    execSync('git add -A && git commit -q -m "initial"', { cwd: TMP });
});
afterEach(() => {
    try {
        rmSync(TMP, { recursive: true, force: true });
    }
    catch { }
});
describe.runIf(HAS_LICENSE)('/inkpal:ship mechanical — auto_commit + pre_merge_gate', () => {
    it('auto_commit: clean tree returns no_changes (success:true)', async () => {
        const r = await handleLocal('inkpal_auto_commit', { project_path: TMP }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(r.action).toBe('no_changes');
    });
    it('auto_commit: dirty tree creates a commit + returns hash', async () => {
        writeFileSync(join(TMP, 'lib', 'foo.dart'), 'class Foo {}\n');
        const r = await handleLocal('inkpal_auto_commit', { project_path: TMP, message: 'feat: add Foo' }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(r.action).toBe('committed');
        expect(r.commit_hash).toBeTruthy();
    });
    it('create_pr without gh installed returns gh_cli_not_installed', async () => {
        const r = await handleLocal('inkpal_create_pr', { project_path: TMP, title: 'test' }) as Record<string, unknown>;
        if (r.error === 'gh_cli_not_installed') {
            expect(r.hint).toContain('Install');
        }
        else {
            expect(typeof r.success).toBe('boolean');
        }
    });
    it('pre_merge_gate runs all 4 gates and returns structured breakdown', async () => {
        const r = await handleLocal('inkpal_pre_merge_gate', { project_path: TMP }) as Record<string, unknown>;
        const gates = r.gates as Array<{
            name: string;
            passed: boolean;
        }>;
        expect(gates.length).toBe(4);
        expect(gates.map(g => g.name)).toEqual(['flutter_analyze', 'check_safety', 'audit_ui', 'accessibility_audit']);
    }, 30000);
    it('/ship chain rails: 5 mechanical runs all complete without crash', async () => {
        for (let i = 0; i < 5; i++) {
            const r = await runChain([
                { tool: 'T-SHIP-003', args: { project_path: TMP } },
                { llm_only: true, label: 'skip commit+PR in mech harness' },
            ], { budget_ms: 60000 });
            expect(r.budget_exceeded).toBe(false);
        }
    }, 180000);
});
