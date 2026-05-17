import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleLocal } from '../dist/local.js';
const PROJ = join(tmpdir(), `inkpal-progress-test-${Date.now()}`);
beforeEach(() => mkdirSync(PROJ, { recursive: true }));
afterEach(() => { try {
    rmSync(PROJ, { recursive: true, force: true });
}
catch { } });
describe('Progress tracking — get/set/list/append', () => {
    it('list on empty project returns 0 features', async () => {
        const r = await handleLocal('inkpal_progress', { action: 'list', project_path: PROJ }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        const data = r.data as {
            feature_count: number;
            summary: unknown[];
        };
        expect(data.feature_count).toBe(0);
        expect(data.summary).toEqual([]);
    });
    it('set creates a feature + writes .inkpal/progress.json', async () => {
        const r = await handleLocal('inkpal_progress', {
            action: 'set', project_path: PROJ, feature: 'Login',
            status: 'in_progress', completed: ['UI'], pending: ['API'],
        }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(existsSync(join(PROJ, '.inkpal', 'progress.json'))).toBe(true);
        const file = JSON.parse(readFileSync(join(PROJ, '.inkpal', 'progress.json'), 'utf8'));
        expect(file.features.Login.status).toBe('in_progress');
        expect(file.features.Login.completed).toEqual(['UI']);
        expect(file.features.Login.pending).toEqual(['API']);
    });
    it('get on a known feature returns its state', async () => {
        await handleLocal('inkpal_progress', {
            action: 'set', project_path: PROJ, feature: 'Login',
            status: 'in_progress', completed: ['UI'], pending: ['API'],
        });
        const r = await handleLocal('inkpal_progress', {
            action: 'get', project_path: PROJ, feature: 'Login',
        }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect((r.data as {
            status: string;
        }).status).toBe('in_progress');
    });
    it('get on unknown feature returns feature_not_found', async () => {
        const r = await handleLocal('inkpal_progress', {
            action: 'get', project_path: PROJ, feature: 'Nonexistent',
        }) as Record<string, unknown>;
        expect(r.success).toBe(false);
        expect(r.error).toBe('feature_not_found');
    });
    it('append_done auto-promotes status: not_started → in_progress', async () => {
        await handleLocal('inkpal_progress', {
            action: 'set', project_path: PROJ, feature: 'Signup',
            status: 'not_started', pending: ['UI', 'API'],
        });
        const r = await handleLocal('inkpal_progress', {
            action: 'append_done', project_path: PROJ, feature: 'Signup', done_item: 'UI',
        }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        const data = r.data as {
            status: string;
            completed: string[];
            pending: string[];
        };
        expect(data.status).toBe('in_progress');
        expect(data.completed).toEqual(['UI']);
        expect(data.pending).toEqual(['API']);
    });
    it('append_done auto-flips to done when pending empties', async () => {
        await handleLocal('inkpal_progress', {
            action: 'set', project_path: PROJ, feature: 'Profile',
            status: 'in_progress', completed: ['UI'], pending: ['API'],
        });
        const r = await handleLocal('inkpal_progress', {
            action: 'append_done', project_path: PROJ, feature: 'Profile', done_item: 'API',
        }) as Record<string, unknown>;
        const data = r.data as {
            status: string;
            pending: string[];
        };
        expect(data.status).toBe('done');
        expect(data.pending).toEqual([]);
    });
    it('append_pending adds to pending list (no dup)', async () => {
        await handleLocal('inkpal_progress', {
            action: 'append_pending', project_path: PROJ, feature: 'Settings', pending_item: 'dark mode toggle',
        });
        const r = await handleLocal('inkpal_progress', {
            action: 'append_pending', project_path: PROJ, feature: 'Settings', pending_item: 'dark mode toggle',
        }) as Record<string, unknown>;
        const data = r.data as {
            pending: string[];
        };
        expect(data.pending).toEqual(['dark mode toggle']);
    });
    it('note appends with timestamp', async () => {
        await handleLocal('inkpal_progress', {
            action: 'note', project_path: PROJ, feature: 'Login', note: 'API team blocked on schema',
        });
        const r = await handleLocal('inkpal_progress', {
            action: 'get', project_path: PROJ, feature: 'Login',
        }) as Record<string, unknown>;
        const data = r.data as {
            notes: string[];
        };
        expect(data.notes.length).toBe(1);
        expect(data.notes[0]).toContain('API team blocked on schema');
        expect(data.notes[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
    it('list summary computes pct_complete correctly', async () => {
        await handleLocal('inkpal_progress', {
            action: 'set', project_path: PROJ, feature: 'Onboarding',
            completed: ['screen 1', 'screen 2'], pending: ['screen 3', 'screen 4'],
        });
        const r = await handleLocal('inkpal_progress', { action: 'list', project_path: PROJ }) as Record<string, unknown>;
        const data = r.data as {
            summary: Array<{
                feature: string;
                pct_complete: number;
            }>;
        };
        expect(data.summary[0].pct_complete).toBe(50);
    });
});
