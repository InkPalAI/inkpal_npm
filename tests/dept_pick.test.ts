import { describe, it, expect } from 'vitest';
import { handleLocal } from '../dist/local.js';
const HAS_LICENSE = !!process.env.INKPAL_LICENSE_KEY && !!process.env.INKPAL_API_URL;
describe.runIf(HAS_LICENSE)('dept_pick — confidence + ranking', () => {
    it('inspect_pick returns sub-100ms', async () => {
        const r = await handleLocal('inkpal_dept_inspect_pick', { intent: 'screenshot the home screen' }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(r.latency_ms as number).toBeLessThan(100);
    });
    it('intent="errors" ranks T-INS-005 (get_runtime_errors) at top', async () => {
        const r = await handleLocal('inkpal_dept_inspect_pick', { intent: 'find runtime errors and exceptions' }) as Record<string, unknown>;
        expect(r.tool).toBe('T-INS-005');
    });
    it('intent="screenshot" ranks T-INS-001 at top', async () => {
        const r = await handleLocal('inkpal_dept_inspect_pick', { intent: 'screenshot the home screen' }) as Record<string, unknown>;
        expect(r.tool).toBe('T-INS-001');
    });
    it('verify_pick: "pixel diff against baseline" → T-VER-002', async () => {
        const r = await handleLocal('inkpal_dept_verify_pick', { intent: 'pixel diff against baseline' }) as Record<string, unknown>;
        expect(r.tool).toBe('T-VER-002');
    });
    it('confidence is between 0 and 1', async () => {
        const r = await handleLocal('inkpal_dept_inspect_pick', { intent: 'anything' }) as {
            confidence: number;
        };
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
    });
});
