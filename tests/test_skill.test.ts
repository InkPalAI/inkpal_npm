import { describe, it, expect } from 'vitest';
import { runChain } from '../dist/chain.js';
const HAS_LICENSE = !!process.env.INKPAL_LICENSE_KEY && !!process.env.INKPAL_API_URL;
const PROJ = process.env.INKPAL_TEST_PROJECT ?? '';
const TEST_CHAIN = [
    { tool: 'T-RUN-003', args: {}, label: 'pre-flight devices' },
    { tool: 'T-INS-007', args: { project_path: PROJ }, label: 'start log session' },
    { tool: 'T-DRV-005', args: { project_path: PROJ, route: '/' }, label: 'navigate' },
    { llm_only: true, label: 'DRIVE' },
    { tool: 'T-INS-001', args: { project_path: PROJ, method: 'adb' }, label: 'screenshot' },
    { llm_only: true, label: 'end_log_session+assert (needs session_id thread; live LLM does it)' },
    { llm_only: true, label: 'REPORT' },
];
describe.runIf(HAS_LICENSE && !!PROJ)('/inkpal:test — mechanical 5/5', () => {
    for (let i = 1; i <= 5; i++) {
        it(`run ${i} succeeds in <90s`, async () => {
            const t0 = Date.now();
            const r = await runChain(TEST_CHAIN, { budget_ms: 90000, auto: true });
            const wall = Date.now() - t0;
            expect(r.ok).toBe(true);
            expect(wall).toBeLessThan(90000);
            expect(r.budget_exceeded).toBe(false);
        });
    }
});
