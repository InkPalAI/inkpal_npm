/**
 * Registry contract tests — runs against the LIVE Railway registry.
 * Skipped if INKPAL_API_URL/INKPAL_LICENSE_KEY are not set (so CI without
 * those secrets passes); runs full when they are.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { handleLocal, getRegistry, isRegistered, LOCAL_TOOLS, type RegistryResponse } from '../dist/local.js';

const HAS_LICENSE = !!process.env.INKPAL_LICENSE_KEY && !!process.env.INKPAL_API_URL;

describe.runIf(HAS_LICENSE)('Registry — execution baseline', () => {
  let reg: RegistryResponse | null;

  beforeAll(async () => {
    reg = await getRegistry();
  });

  it('fetches a non-empty registry from Railway', () => {
    expect(reg).not.toBeNull();
    expect(reg!.tools.length).toBeGreaterThan(0);
  });

  it('every registered tool has at least one example', () => {
    const missing = reg!.tools.filter(t => !t.examples?.length).map(t => t.id);
    expect(missing).toEqual([]);
  });

  it('every registered tool has WORKING or EXPERIMENTAL status', () => {
    const bad = reg!.tools.filter(t => !['WORKING', 'EXPERIMENTAL', 'OFFLINE_ONLY', 'CLOUD_ONLY'].includes(t.status));
    expect(bad.map(t => `${t.id}:${t.status}`)).toEqual([]);
  });

  it('every non-device-required local tool returns success on its example', async () => {
    const failures: string[] = [];
    for (const t of reg!.tools) {
      // Skip tools that require external state we don't set up here
      // (live device/sim, saved baseline, an already-started log session,
      // Figma token, cloud reachability, gh CLI auth, clean project, etc.)
      if (t.deps?.required?.some(d =>
        d.includes('alive') || d.includes('baseline') || d.includes('token')
        || d.includes('reachable') || d.includes('authenticated') || d.includes('clean_project'))) continue;
      if (!LOCAL_TOOLS.has(t.name)) continue;
      const ex = t.examples?.[0];
      if (!ex) continue;
      try {
        const r = await handleLocal(t.name, ex.args) as Record<string, unknown>;
        const ok = r && r.success !== false && !r.error;
        if (!ok) failures.push(`${t.id} ${t.name}: ${r?.error ?? 'no success flag'}`);
      } catch (e) {
        failures.push(`${t.id} ${t.name}: threw ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('isRegistered() agrees with registry contents', () => {
    for (const t of reg!.tools) {
      expect(isRegistered(t.name, reg)).toBe(true);
    }
    expect(isRegistered('definitely_not_a_tool', reg)).toBe(false);
  });
});
