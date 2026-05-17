import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { sweepProjectEphemeral, finalizeSession, runManualCleanup } from '../dist/cleanup.js';
const TMP_PROJ = join(tmpdir(), `inkpal-cleanup-test-${Date.now()}`);
beforeEach(() => {
    mkdirSync(join(TMP_PROJ, '.inkpal', 'screenshots'), { recursive: true });
    mkdirSync(join(TMP_PROJ, '.inkpal', 'visual-tests', 'baselines'), { recursive: true });
    mkdirSync(join(TMP_PROJ, '.inkpal', 'visual-tests', 'current'), { recursive: true });
    writeFileSync(join(TMP_PROJ, '.inkpal', 'screenshots', 'old.png'), 'x');
    const oldFile = join(TMP_PROJ, '.inkpal', 'visual-tests', 'current', 'old.png');
    writeFileSync(oldFile, 'x');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    require('fs').utimesSync(join(TMP_PROJ, '.inkpal', 'screenshots', 'old.png'), old, old);
    require('fs').utimesSync(oldFile, old, old);
    writeFileSync(join(TMP_PROJ, '.inkpal', 'visual-tests', 'baselines', 'root.png'), 'baseline');
    writeFileSync(join(TMP_PROJ, '.inkpal', 'constitution.yaml'), 'rules:');
    writeFileSync(join(TMP_PROJ, '.inkpal', 'run-state.json'), '{}');
});
afterEach(() => {
    try {
        rmSync(TMP_PROJ, { recursive: true, force: true });
    }
    catch { }
});
describe('Cleanup — preserves user value, deletes ephemeral', () => {
    it('sweepProjectEphemeral deletes old ephemeral, keeps preserved files', () => {
        sweepProjectEphemeral(TMP_PROJ, Date.now());
        expect(existsSync(join(TMP_PROJ, '.inkpal', 'screenshots', 'old.png'))).toBe(false);
        expect(existsSync(join(TMP_PROJ, '.inkpal', 'visual-tests', 'baselines', 'root.png'))).toBe(true);
        expect(existsSync(join(TMP_PROJ, '.inkpal', 'constitution.yaml'))).toBe(true);
        expect(existsSync(join(TMP_PROJ, '.inkpal', 'run-state.json'))).toBe(true);
    });
    it('finalizeSession writes summary.json and deletes intermediate', () => {
        const sessionId = `cleanup-test-${Date.now()}`;
        const dir = join(homedir(), '.inkpal', 'sessions', sessionId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'temp-screenshot.png'), 'x');
        writeFileSync(join(dir, 'failures.jsonl'), '');
        finalizeSession(sessionId, {
            session_id: sessionId, ok: true, total_duration_ms: 100,
            steps: [{ tool_name: 'inkpal_screenshot', ok: true, duration_ms: 100 }],
        });
        expect(existsSync(join(dir, 'summary.json'))).toBe(true);
        expect(existsSync(join(dir, 'temp-screenshot.png'))).toBe(false);
        expect(existsSync(join(dir, 'failures.jsonl'))).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });
    it('runManualCleanup with retention_hours=0 force-purges ephemeral', () => {
        const r = runManualCleanup({ project_path: TMP_PROJ, retention_hours: 0 });
        expect(r.success).toBe(true);
        expect(r.project!.ephemeral.deleted).toBeGreaterThanOrEqual(2);
        expect(existsSync(join(TMP_PROJ, '.inkpal', 'visual-tests', 'baselines', 'root.png'))).toBe(true);
    });
});
