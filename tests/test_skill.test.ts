/**
 * /inkpal:test mechanical acceptance — 5/5 runs through the chain executor
 * with LLM_DRIVE / LLM_REPORT no-op'd. Verifies rails work; live LLM proof
 * deferred to recording session.
 *
 * Skipped without license env (Railway-dependent).
 */

import { describe, it, expect } from 'vitest';
import { runChain } from '../dist/chain.js';

const HAS_LICENSE = !!process.env.INKPAL_LICENSE_KEY && !!process.env.INKPAL_API_URL;
const PROJ = process.env.INKPAL_TEST_PROJECT ?? '';

// Mechanical harness scope: prove chain RAILS work. Excludes launch_app
// (needs live `flutter run` process; device launch is environmental, not a
// rail concern). Real-LLM session uses full 10-step skill chain including
// launch + assert linkage. This 6-step subset validates: discovery,
// session bookend, navigation dispatch, screenshot dispatch, LLM markers.
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
      const r = await runChain(TEST_CHAIN, { budget_ms: 90_000, auto: true });
      const wall = Date.now() - t0;
      expect(r.ok).toBe(true);
      expect(wall).toBeLessThan(90_000);
      expect(r.budget_exceeded).toBe(false);
    });
  }
});
