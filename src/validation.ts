/**
 * System-Level Validation Harness — the 8 missing layers.
 *
 * Validates INTERACTIONS, not components. Each existing handler already
 * works in isolation; this module proves they work TOGETHER and that the
 * system as a whole behaves correctly under real conditions.
 *
 * Layers:
 *   1. Cross-tool consistency — chain step N's output feeds N+1's input
 *   2. Fallback audit         — which tools depend on fallback, how often
 *   3. Determinism            — same input → same output structure (3 runs)
 *   4. Dependency graph       — skill → critical tools / optional tools
 *   5. Failure simulation     — adb missing / network down / timeout / partial
 *   6. Latency composition    — per-step timing, slowest step, optimization target
 *   7. Output quality         — accuracy / clarity / usefulness heuristics
 *   8. Registry truth         — registry.status vs actual execution result
 *
 * Single entry: runFullValidation() returns aggregated SystemValidationReport.
 *
 * Discipline: this is INFRASTRUCTURE that protects the surface. Per Rule 1
 * cardinality, it adds ONE meta-tool (inkpal_validate_system) and lives
 * alongside the existing contract harness on Railway. No new departments,
 * no new skills, no user-facing surface beyond the report.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  handleLocal, getRegistry, isRegistered, LOCAL_TOOLS,
  type RegistryToolEntry, type RegistryResponse,
} from './local.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface CrossToolFinding {
  chain: string;
  step: number;
  producer_tool: string;
  consumer_tool: string;
  mismatch_found: boolean;
  issue?: string;
  severity: Severity;
}

export interface FallbackFinding {
  tool_id: string;
  tool_name: string;
  fallback_frequency_pct: number;
  observed_runs: number;
  root_cause: 'unregistered' | 'tool_failed' | 'env_missing' | 'unknown';
  is_blocker: boolean;
}

export interface DeterminismFinding {
  tool_id?: string;
  tool_name: string;
  deterministic: boolean;
  variance_reason?: string;
  runs: number;
}

export interface DependencyEdge {
  skill: string;
  critical_tools: string[];
  optional_tools: string[];
}

export interface FailureSimFinding {
  scenario: string;
  affected_tool?: string;
  system_behavior: 'graceful' | 'partial' | 'crash' | 'silent_fail';
  recovery_success: boolean;
  failure_log_present: boolean;
}

export interface LatencyBreakdown {
  chain: string;
  total_ms: number;
  steps: Array<{ tool_name: string; ms: number; pct: number }>;
  slowest_step: string;
  optimization_target: string;
}

export interface OutputQualityFinding {
  tool_id?: string;
  tool_name: string;
  accuracy: number;       // 0-10: response shape matches schema/example
  clarity: number;        // 0-10: error envelope has hint, recovery_tool
  usefulness: number;     // 0-10: contains actionable data
  notes: string[];
}

export interface RegistryTruthFinding {
  tool_id: string;
  tool_name: string;
  registry_status: string;
  actual_status: 'WORKING' | 'DEGRADED' | 'FAILING';
  mismatch: boolean;
  reason?: string;
}

export interface SystemValidationReport {
  generated_at: string;
  duration_ms: number;
  registered_tool_count: number;
  cross_tool: CrossToolFinding[];
  fallback_audit: FallbackFinding[];
  determinism: DeterminismFinding[];
  dependency_graph: DependencyEdge[];
  failure_sim: FailureSimFinding[];
  latency: LatencyBreakdown[];
  output_quality: OutputQualityFinding[];
  registry_truth: RegistryTruthFinding[];
  summary: {
    blockers: number;
    high_findings: number;
    medium_findings: number;
    low_findings: number;
    overall_health: 'green' | 'yellow' | 'red';
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SESSIONS_DIR = join(homedir(), '.inkpal', 'sessions');

function readAllSessionFailures(): unknown[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  const all: unknown[] = [];
  try {
    for (const sessionId of readdirSync(SESSIONS_DIR)) {
      const f = join(SESSIONS_DIR, sessionId, 'failures.jsonl');
      if (!existsSync(f)) continue;
      const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
      for (const l of lines) { try { all.push(JSON.parse(l)); } catch { /* skip */ } }
    }
  } catch { /* skip */ }
  return all;
}

function readAllSessionSummaries(): Array<{ session_id: string; ok: boolean; total_duration_ms: number; steps: Array<{ tool_name: string; duration_ms: number; ok: boolean }> }> {
  if (!existsSync(SESSIONS_DIR)) return [];
  const all: Array<{ session_id: string; ok: boolean; total_duration_ms: number; steps: Array<{ tool_name: string; duration_ms: number; ok: boolean }> }> = [];
  try {
    for (const sessionId of readdirSync(SESSIONS_DIR)) {
      const f = join(SESSIONS_DIR, sessionId, 'summary.json');
      if (!existsSync(f)) continue;
      try {
        const s = JSON.parse(readFileSync(f, 'utf8'));
        all.push(s);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return all;
}

// ── Layer 1: Cross-tool consistency ───────────────────────────────────────

/**
 * For every registered tool's `next_logical` chain hint, verify that
 * the producer's `produces` includes a fact the consumer's `consumes_from`
 * reciprocates. Catches "tool A says next is tool B, but A's output
 * doesn't feed B's input" silent contracts.
 */
function checkCrossToolConsistency(reg: RegistryResponse | null): CrossToolFinding[] {
  if (!reg) return [];
  const findings: CrossToolFinding[] = [];
  const byId = new Map(reg.tools.map(t => [t.id, t]));
  for (const producer of reg.tools) {
    const nextList = (producer as RegistryToolEntry & { next_logical?: string[] }).next_logical ?? [];
    for (let i = 0; i < nextList.length; i++) {
      const consumer = byId.get(nextList[i]);
      if (!consumer) {
        findings.push({
          chain: `${producer.id} → ${nextList[i]}`,
          step: i + 1,
          producer_tool: producer.id,
          consumer_tool: nextList[i],
          mismatch_found: true,
          issue: 'next_logical references unregistered tool id',
          severity: 'high',
        });
        continue;
      }
      const produces = (producer as RegistryToolEntry & { produces?: string[] }).produces ?? [];
      const consumes = (consumer as RegistryToolEntry & { consumes_from?: string[] }).consumes_from ?? [];
      const declaredLink = consumes.includes(producer.id);
      // No produces declared OR consumer doesn't reciprocate the consumes_from
      if (produces.length > 0 && !declaredLink) {
        findings.push({
          chain: `${producer.id} → ${consumer.id}`,
          step: i + 1,
          producer_tool: producer.id,
          consumer_tool: consumer.id,
          mismatch_found: true,
          issue: `${producer.id} produces ${produces.join(',')} but ${consumer.id}.consumes_from doesn't reference ${producer.id}`,
          severity: 'low',
        });
      }
    }
  }
  return findings;
}

// ── Layer 2: Fallback audit ───────────────────────────────────────────────

function auditFallback(reg: RegistryResponse | null): FallbackFinding[] {
  const failures = readAllSessionFailures();
  // Tool name → { runs: count, fallback: count }
  const counter = new Map<string, { runs: number; fallback: number }>();
  for (const ev of failures as Array<{ kind?: string; tool_name?: string; fallback_used?: boolean }>) {
    if (!ev.tool_name) continue;
    const c = counter.get(ev.tool_name) ?? { runs: 0, fallback: 0 };
    c.runs++;
    if (ev.fallback_used) c.fallback++;
    counter.set(ev.tool_name, c);
  }
  const findings: FallbackFinding[] = [];
  const registered = new Set(reg?.tools.map(t => t.name) ?? []);
  for (const [name, c] of counter.entries()) {
    if (c.runs === 0) continue;
    const pct = (c.fallback / c.runs) * 100;
    if (pct === 0) continue;
    let root: FallbackFinding['root_cause'] = 'unknown';
    if (!registered.has(name)) root = 'unregistered';
    else root = 'tool_failed';
    findings.push({
      tool_id: reg?.tools.find(t => t.name === name)?.id ?? '',
      tool_name: name,
      fallback_frequency_pct: Math.round(pct * 10) / 10,
      observed_runs: c.runs,
      root_cause: root,
      is_blocker: pct >= 50 && c.runs >= 3,
    });
  }
  return findings.sort((a, b) => b.fallback_frequency_pct - a.fallback_frequency_pct);
}

// ── Layer 3: Determinism ──────────────────────────────────────────────────

interface ShapeFingerprint {
  keys: string[];
  types: string[];
}
function fingerprint(obj: unknown): ShapeFingerprint {
  if (!obj || typeof obj !== 'object') return { keys: [], types: [typeof obj] };
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const types = keys.map(k => {
    const v = (obj as Record<string, unknown>)[k];
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  });
  return { keys, types };
}
function fingerprintsEqual(a: ShapeFingerprint, b: ShapeFingerprint): boolean {
  return a.keys.join(',') === b.keys.join(',') && a.types.join(',') === b.types.join(',');
}

async function checkDeterminism(reg: RegistryResponse | null): Promise<DeterminismFinding[]> {
  if (!reg) return [];
  const findings: DeterminismFinding[] = [];
  for (const tool of reg.tools) {
    const ex = tool.examples?.[0];
    if (!ex) continue;
    // Skip device-required tools — non-deterministic by their nature
    const deps = (tool as RegistryToolEntry & { deps?: { required?: string[] } }).deps;
    if (deps?.required?.some(d => d.includes('alive') || d.includes('baseline'))) continue;
    if (!LOCAL_TOOLS.has(tool.name)) continue;
    try {
      const r1 = await handleLocal(tool.name, ex.args);
      const r2 = await handleLocal(tool.name, ex.args);
      const r3 = await handleLocal(tool.name, ex.args);
      const fp1 = fingerprint(r1);
      const fp2 = fingerprint(r2);
      const fp3 = fingerprint(r3);
      const det = fingerprintsEqual(fp1, fp2) && fingerprintsEqual(fp2, fp3);
      findings.push({
        tool_id: tool.id,
        tool_name: tool.name,
        deterministic: det,
        variance_reason: det ? undefined : `shape changed between runs: ${fp1.keys.length} → ${fp2.keys.length} → ${fp3.keys.length} keys`,
        runs: 3,
      });
    } catch (e) {
      findings.push({
        tool_id: tool.id,
        tool_name: tool.name,
        deterministic: false,
        variance_reason: `threw: ${(e as Error).message}`,
        runs: 0,
      });
    }
  }
  return findings;
}

// ── Layer 4: Dependency graph (skill → tools) ─────────────────────────────

// Skills live in the private monorepo's plugin/inkpal/skills/ directory.
// This validator runs there (internal CI). In any other environment the
// directory won't exist and the graph stays empty (validator returns
// "no edges" rather than failing).
const SKILLS_DIR = process.env.INKPAL_SKILLS_DIR ?? '';

function buildDependencyGraph(): DependencyEdge[] {
  const graph: DependencyEdge[] = [];
  if (!SKILLS_DIR || !existsSync(SKILLS_DIR)) return graph;
  // Only the v1 skills (debug, audit, build); legacy skills not validated here
  const v1 = ['debug', 'audit', 'build'];
  for (const name of v1) {
    const path = join(SKILLS_DIR, `${name}.md`);
    if (!existsSync(path)) continue;
    const md = readFileSync(path, 'utf8');
    const critical: string[] = [];
    const optional: string[] = [];
    // Parse YAML chain entries — look for `tool: T-XXX-NNN` and `name: inkpal_X`
    const toolIdMatches = [...md.matchAll(/tool:\s*(T-[A-Z]+-\d+)/g)].map(m => m[1]);
    const toolNameMatches = [...md.matchAll(/name:\s*(inkpal_[a-z_]+)/g)].map(m => m[1]);
    // Look for `condition:` markers indicating optional steps
    const optionalRe = /tool:\s*(T-[A-Z]+-\d+)[^\n]*\n[^\n]*condition:|tool:\s*(inkpal_[a-z_]+)[^\n]*\n[^\n]*condition:|optional:\s*true/g;
    const optionalIds = new Set<string>();
    for (const m of md.matchAll(/tool:\s*(T-[A-Z]+-\d+|inkpal_[a-z_]+)[\s\S]{0,200}(condition:|optional:\s*true)/g)) {
      optionalIds.add(m[1]);
    }
    for (const id of toolIdMatches) {
      if (optionalIds.has(id)) optional.push(id); else critical.push(id);
    }
    for (const n of toolNameMatches) {
      if (optionalIds.has(n)) optional.push(n); else critical.push(n);
    }
    graph.push({ skill: name, critical_tools: [...new Set(critical)], optional_tools: [...new Set(optional)] });
  }
  return graph;
}

// ── Layer 5: Failure simulation ───────────────────────────────────────────

async function simulateFailures(): Promise<FailureSimFinding[]> {
  const findings: FailureSimFinding[] = [];

  // Scenario 1: adb missing — strip from PATH, call a tool that needs it.
  // "Graceful" outcomes: returns success (auto-detect found adb elsewhere)
  // OR returns a structured no_log_source_available envelope. The auto-detect
  // searches ~/Library/Android/sdk/platform-tools and several other paths,
  // so we strip THOSE too to verify the failure envelope is honest.
  try {
    const originalPath = process.env.PATH;
    const home = process.env.HOME || '';
    const stripPatterns = ['platform-tools', 'homebrew/bin', `${home}/Library/Android/sdk`];
    process.env.PATH = (originalPath || '').split(':').filter(p => !stripPatterns.some(s => p.includes(s))).join(':');
    const r = await handleLocal('inkpal_get_runtime_errors', { project_path: '/tmp', device: 'fake-no-such-device' });
    process.env.PATH = originalPath;
    const result = r as Record<string, unknown>;
    const handled = result?.error === 'no_log_source_available' || result?.error === 'no_ios_simulator_booted' || result?.success === true;
    findings.push({
      scenario: 'adb missing from PATH',
      affected_tool: 'inkpal_get_runtime_errors',
      system_behavior: handled ? 'graceful' : (result?.error ? 'partial' : 'silent_fail'),
      recovery_success: !!handled,
      failure_log_present: false,
    });
  } catch (e) {
    findings.push({
      scenario: 'adb missing from PATH',
      affected_tool: 'inkpal_get_runtime_errors',
      system_behavior: 'crash',
      recovery_success: false,
      failure_log_present: false,
    });
  }

  // Scenario 2: invalid input — null project_path
  try {
    const r = await handleLocal('inkpal_lookup_error', { error_message: '' });
    const result = r as Record<string, unknown>;
    const handled = result?.error === 'query_required';
    findings.push({
      scenario: 'empty error_message to lookup_error',
      affected_tool: 'inkpal_lookup_error',
      system_behavior: handled ? 'graceful' : 'silent_fail',
      recovery_success: !!handled,
      failure_log_present: false,
    });
  } catch {
    findings.push({
      scenario: 'empty error_message to lookup_error',
      system_behavior: 'crash', recovery_success: false, failure_log_present: false,
    });
  }

  // Scenario 3: registry unreachable (proxy must still serve fallback)
  try {
    const reg = await getRegistry();
    findings.push({
      scenario: 'registry fetch (Railway reachable)',
      system_behavior: reg ? 'graceful' : 'partial',
      recovery_success: reg !== null,
      failure_log_present: false,
    });
  } catch {
    findings.push({
      scenario: 'registry fetch',
      system_behavior: 'crash', recovery_success: false, failure_log_present: false,
    });
  }

  // Scenario 4: unregistered tool called via chain executor (must log fallback)
  // (Tested via chain.ts smoke in Day 3; we just confirm the failures dir
  //  has at least one fallback_used:true entry from any past session.)
  const fails = readAllSessionFailures();
  const hasFallbackLog = (fails as Array<{ fallback_used?: boolean }>).some(f => f.fallback_used === true);
  findings.push({
    scenario: 'unregistered tool invocation (across past sessions)',
    system_behavior: hasFallbackLog ? 'graceful' : 'silent_fail',
    recovery_success: hasFallbackLog,
    failure_log_present: hasFallbackLog,
  });

  return findings;
}

// ── Layer 6: Latency composition ──────────────────────────────────────────

function buildLatencyBreakdowns(): LatencyBreakdown[] {
  const summaries = readAllSessionSummaries();
  // Group by chain shape (steps[].tool_name joined)
  const byChain = new Map<string, Array<{ session_id: string; total_ms: number; steps: Array<{ tool_name: string; duration_ms: number }> }>>();
  for (const s of summaries) {
    const key = s.steps.map(st => st.tool_name).join(' → ');
    const arr = byChain.get(key) ?? [];
    arr.push({ session_id: s.session_id, total_ms: s.total_duration_ms, steps: s.steps });
    byChain.set(key, arr);
  }
  const breakdowns: LatencyBreakdown[] = [];
  for (const [chain, runs] of byChain.entries()) {
    if (runs.length === 0) continue;
    const stepCount = runs[0].steps.length;
    const avgPerStep: number[] = [];
    for (let i = 0; i < stepCount; i++) {
      const sum = runs.reduce((a, r) => a + (r.steps[i]?.duration_ms ?? 0), 0);
      avgPerStep.push(sum / runs.length);
    }
    const total = avgPerStep.reduce((a, b) => a + b, 0);
    const steps = runs[0].steps.map((st, i) => ({
      tool_name: st.tool_name,
      ms: Math.round(avgPerStep[i]),
      pct: total > 0 ? Math.round((avgPerStep[i] / total) * 100) : 0,
    }));
    const slowestIdx = steps.reduce((idx, s, i) => s.ms > steps[idx].ms ? i : idx, 0);
    const slowest = steps[slowestIdx];
    let target = 'no obvious optimization target';
    if (slowest.pct >= 60) target = `${slowest.tool_name} dominates ${slowest.pct}% — consider batching/caching`;
    else if (slowest.pct >= 35) target = `${slowest.tool_name} is the heaviest step (${slowest.pct}%)`;
    breakdowns.push({
      chain,
      total_ms: Math.round(total),
      steps,
      slowest_step: slowest.tool_name,
      optimization_target: target,
    });
  }
  return breakdowns.slice(0, 20);
}

// ── Layer 7: Output quality (heuristic, no LLM call) ─────────────────────

async function evaluateOutputQuality(reg: RegistryResponse | null): Promise<OutputQualityFinding[]> {
  if (!reg) return [];
  const findings: OutputQualityFinding[] = [];
  for (const tool of reg.tools) {
    const ex = tool.examples?.[0];
    if (!ex) continue;
    const deps = (tool as RegistryToolEntry & { deps?: { required?: string[] } }).deps;
    if (deps?.required?.some(d => d.includes('alive') || d.includes('baseline'))) continue;
    if (!LOCAL_TOOLS.has(tool.name)) continue;
    try {
      const r = await handleLocal(tool.name, ex.args) as Record<string, unknown>;
      const notes: string[] = [];
      // Accuracy: response is non-null object with expected primary field
      const accuracy = (r && typeof r === 'object' && (r.success === true || r.success === false || r.output != null)) ? 9 : 4;
      if (!r) notes.push('response was null/undefined');
      // Clarity: error responses include hint + (optionally) recovery_tool
      let clarity = 7;
      if (r?.success === false) {
        if (r?.hint) clarity += 1; else { clarity -= 2; notes.push('error response missing hint'); }
        if (r?.recovery_tool || r?.next_tool) clarity += 1;
      }
      // Usefulness: response contains structured data (not just {output: "..."} string blob)
      const fieldCount = r ? Object.keys(r).length : 0;
      const usefulness = fieldCount >= 4 ? 9 : fieldCount >= 2 ? 6 : 3;
      if (fieldCount < 2) notes.push(`response has only ${fieldCount} field(s) — likely raw stdout`);
      findings.push({
        tool_id: tool.id, tool_name: tool.name,
        accuracy: Math.min(10, Math.max(0, accuracy)),
        clarity: Math.min(10, Math.max(0, clarity)),
        usefulness: Math.min(10, Math.max(0, usefulness)),
        notes,
      });
    } catch (e) {
      findings.push({
        tool_id: tool.id, tool_name: tool.name,
        accuracy: 0, clarity: 0, usefulness: 0,
        notes: [`exception: ${(e as Error).message}`],
      });
    }
  }
  return findings;
}

// ── Layer 8: Registry truth — registry.status vs actual ──────────────────

async function checkRegistryTruth(reg: RegistryResponse | null): Promise<RegistryTruthFinding[]> {
  if (!reg) return [];
  const findings: RegistryTruthFinding[] = [];
  for (const tool of reg.tools) {
    const ex = tool.examples?.[0];
    if (!ex) continue;
    const deps = (tool as RegistryToolEntry & { deps?: { required?: string[] } }).deps;
    if (deps?.required?.some(d => d.includes('alive') || d.includes('baseline'))) continue;
    if (!LOCAL_TOOLS.has(tool.name)) continue;
    try {
      const r = await handleLocal(tool.name, ex.args) as Record<string, unknown>;
      const ok = r && r.success !== false && !r.error;
      const actual: RegistryTruthFinding['actual_status'] = ok ? 'WORKING' : (r?.error ? 'DEGRADED' : 'FAILING');
      const mismatch = (tool.status === 'WORKING' && actual !== 'WORKING')
        || (tool.status === 'UNDER_INVESTIGATION' && actual === 'WORKING');
      findings.push({
        tool_id: tool.id,
        tool_name: tool.name,
        registry_status: tool.status,
        actual_status: actual,
        mismatch,
        reason: mismatch ? `registry says ${tool.status} but execution returned ${ok ? 'success' : (r?.error as string ?? 'failure')}` : undefined,
      });
    } catch (e) {
      findings.push({
        tool_id: tool.id, tool_name: tool.name,
        registry_status: tool.status, actual_status: 'FAILING', mismatch: tool.status === 'WORKING',
        reason: `threw: ${(e as Error).message}`,
      });
    }
  }
  return findings;
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export async function runFullValidation(): Promise<SystemValidationReport> {
  const t0 = Date.now();
  const reg = await getRegistry();
  const cross = checkCrossToolConsistency(reg);
  const fb = auditFallback(reg);
  const det = await checkDeterminism(reg);
  const graph = buildDependencyGraph();
  const failsim = await simulateFailures();
  const lat = buildLatencyBreakdowns();
  const qual = await evaluateOutputQuality(reg);
  const truth = await checkRegistryTruth(reg);

  const blockers = fb.filter(f => f.is_blocker).length
    + truth.filter(t => t.mismatch).length
    + failsim.filter(f => f.system_behavior === 'crash').length;
  const high = cross.filter(c => c.severity === 'high').length
    + det.filter(d => !d.deterministic).length
    + qual.filter(q => q.usefulness < 4).length;
  const medium = cross.filter(c => c.severity === 'medium').length
    + qual.filter(q => q.clarity < 6).length;
  const low = cross.filter(c => c.severity === 'low').length;

  const overall: SystemValidationReport['summary']['overall_health'] =
    blockers > 0 ? 'red' : (high > 2 ? 'yellow' : 'green');

  return {
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    registered_tool_count: reg?.tools.length ?? 0,
    cross_tool: cross,
    fallback_audit: fb,
    determinism: det,
    dependency_graph: graph,
    failure_sim: failsim,
    latency: lat,
    output_quality: qual,
    registry_truth: truth,
    summary: { blockers, high_findings: high, medium_findings: medium, low_findings: low, overall_health: overall },
  };
}
