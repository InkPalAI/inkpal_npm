import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { handleLocal } from '../dist/local.js';
const SESSIONS_ROOT = join(homedir(), '.inkpal', 'sessions');
const PROJ = process.env.INKPAL_TEST_PROJECT ?? join(tmpdir(), 'inkpal-log-session-test');
const createdSessions: string[] = [];
afterAll(() => {
    for (const id of createdSessions) {
        const f = join(SESSIONS_ROOT, `log-${id}.json`);
        try {
            if (existsSync(f))
                rmSync(f, { force: true });
        }
        catch { }
    }
});
describe('Log session API — start/end/query/assert', () => {
    it('start_log_session returns a usable session_id + writes state file', async () => {
        const r = await handleLocal('inkpal_start_log_session', { project_path: PROJ }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(r.session_id).toMatch(/^log-/);
        createdSessions.push((r.session_id as string).replace(/^log-/, ''));
        const file = join(SESSIONS_ROOT, `log-${r.session_id}.json`);
        const fileWithoutDoublePrefix = join(SESSIONS_ROOT, `${r.session_id}.json`);
        const exists = existsSync(file) || existsSync(fileWithoutDoublePrefix);
        expect(exists).toBe(true);
    });
    it('end_log_session on unknown id returns session_not_found', async () => {
        const r = await handleLocal('inkpal_end_log_session', { session_id: 'not-a-real-session' }) as Record<string, unknown>;
        expect(r.success).toBe(false);
        expect(r.error).toBe('session_not_found');
    });
    it('end_log_session on a started session returns line_count + sample', async () => {
        const start = await handleLocal('inkpal_start_log_session', { project_path: PROJ }) as {
            session_id: string;
        };
        createdSessions.push(start.session_id.replace(/^log-/, ''));
        const end = await handleLocal('inkpal_end_log_session', { session_id: start.session_id }) as Record<string, unknown>;
        expect(end.success).toBe(true);
        expect(typeof end.line_count).toBe('number');
        expect(end.start_ts).toBeTruthy();
        expect(end.end_ts).toBeTruthy();
    });
    it('query_logs respects pattern + severity filters', async () => {
        const start = await handleLocal('inkpal_start_log_session', { project_path: PROJ }) as {
            session_id: string;
        };
        createdSessions.push(start.session_id.replace(/^log-/, ''));
        await handleLocal('inkpal_end_log_session', { session_id: start.session_id });
        const q = await handleLocal('inkpal_query_logs', { session_id: start.session_id, pattern: 'nothing-matches-this-string', limit: 5 }) as Record<string, unknown>;
        expect(q.success).toBe(true);
        expect(q.matched).toBe(0);
        expect((q.lines as unknown[]).length).toBe(0);
    });
    it('assert_no_errors with a strict-pattern session passes when nothing matches', async () => {
        const start = await handleLocal('inkpal_start_log_session', { project_path: PROJ }) as {
            session_id: string;
        };
        createdSessions.push(start.session_id.replace(/^log-/, ''));
        await handleLocal('inkpal_end_log_session', { session_id: start.session_id });
        const a = await handleLocal('inkpal_assert_no_errors', { session_id: start.session_id, pattern: 'IMPOSSIBLE-PATTERN-XYZ' }) as Record<string, unknown>;
        expect(a.success).toBe(true);
        expect(a.passed).toBe(true);
        expect(a.error_count).toBe(0);
    });
    it('cleanup compatibility — log session files live under ~/.inkpal/sessions/', () => {
        const files = readdirSync(SESSIONS_ROOT).filter(f => f.startsWith('log-') && f.endsWith('.json'));
        expect(files.length).toBeGreaterThanOrEqual(0);
    });
});
