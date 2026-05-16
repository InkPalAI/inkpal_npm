/**
 * Chain executor tests — bounded fallback, failure logging, budget enforcement.
 */

import { describe, it, expect } from 'vitest';
import { runChain, readFailuresLog } from '../dist/chain.js';

const HAS_LICENSE = !!process.env.INKPAL_LICENSE_KEY && !!process.env.INKPAL_API_URL;
const PROJ = process.env.INKPAL_TEST_PROJECT ?? '';

describe.runIf(HAS_LICENSE && !!PROJ)('Chain executor — discipline contract Rules 2/3/4', () => {
  it('all-registered chain succeeds with fb_used=0', async () => {
    const r = await runChain([
      { tool: 'T-UND-002', args: { project_path: PROJ } },
      { tool: 'T-CMP-001', args: { project_path: PROJ } },
    ], { budget_ms: 30_000 });
    expect(r.ok).toBe(true);
    expect(r.steps.every(s => !s.fallback_used)).toBe(true);
    expect(r.budget_exceeded).toBe(false);
  });

  it('unregistered tool logs fallback_used:true (Rule 4)', async () => {
    const r = await runChain([
      { tool: 'T-UND-002', args: { project_path: PROJ } },
      { tool: 'inkpal_get_design_system', args: { project_path: PROJ } },
    ], { budget_ms: 30_000, auto: true });
    const failures = readFailuresLog(r.session_id) as Array<{ kind: string; fallback_used?: boolean }>;
    const hasFallbackLog = failures.some(f => f.kind === 'unregistered_tool_invoked' && f.fallback_used);
    expect(hasFallbackLog).toBe(true);
  });

  it('forced failure stops at next step boundary, no infinite loop (Rule 2)', async () => {
    const r = await runChain([
      { tool: 'T-UND-002', args: { project_path: PROJ } },
      { tool: 'inkpal_get_blast_radius', args: { project_path: PROJ /* missing file arg → fail */ } },
    ], { budget_ms: 30_000 });
    expect(r.ok).toBe(false);
    const failedStep = r.steps.find(s => !s.ok);
    expect(failedStep!.attempts).toBeLessThanOrEqual(3);  // bounded retry
    const failures = readFailuresLog(r.session_id) as Array<{ kind: string }>;
    expect(failures.some(f => f.kind === 'step_failed_final')).toBe(true);
  });

  it('budget enforcement aborts overlong chains (Rule 3)', async () => {
    const r = await runChain([
      { tool: 'T-UND-002', args: { project_path: PROJ } },
      { tool: 'T-CMP-001', args: { project_path: PROJ } },
    ], { budget_ms: 1 });  // 1ms budget — guaranteed exceed
    expect(r.budget_exceeded).toBe(true);
  });
});
