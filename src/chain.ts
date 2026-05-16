/**
 * Chain Executor — runs a sequence of registered tools with bounded
 * fallback and full failure logging.
 *
 * Discipline:
 *   Rule 2 — bounded fallback: retry once → registry alternative → user
 *   Rule 3 — total wall-clock budget enforced (default 60s for demo skills)
 *   Rule 4 — every step writes to failures.jsonl on error (and fallback_used:true
 *            on registry-missing tool calls), so registry truth never breaks silently
 *
 * See memory: feedback_inkpal_discipline_contract.md
 */

import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { handleLocal, getRegistry, isRegistered, LOCAL_TOOLS } from './local.js';
import { onChainStart, finalizeSession } from './cleanup.js';

export interface ChainStep {
  /** Either a registry id (T-INS-001) or a raw tool name (inkpal_screenshot). */
  tool: string;
  /** Static args, OR a function that derives args from prior step outputs.
   *  Dynamic form lets a chain thread state (e.g., session_id from T-INS-007's
   *  output into T-INS-008's args) without an LLM round-trip. */
  args?: Record<string, unknown> | ((priorResults: unknown[]) => Record<string, unknown>);
  /** Optional callback after the step runs (test/harness side-effects only;
   *  never used to mutate chain state). */
  onResult?: (output: unknown) => void;
  /** Skip if false at runtime (e.g. "only if errors found"). */
  condition?: (priorResults: unknown[]) => boolean;
  /** Marker for LLM-side steps (Edit/Write/reasoning happens outside the chain). */
  llm_only?: boolean;
  label?: string;
}

export interface ChainOptions {
  /** Total wall-clock budget. Default 60s (demo). */
  budget_ms?: number;
  /** Session id for logs. Defaults to a fresh UUID. */
  session_id?: string;
  /** If true, run unattended; if false (default), the executor returns control
   *  to the caller (LLM/user) on failure-after-fallback rather than aborting. */
  auto?: boolean;
}

export interface ChainStepResult {
  step: number;
  tool_id?: string;     // registry id if known
  tool_name: string;
  registered: boolean;
  fallback_used: boolean;        // true when an unregistered tool was invoked
  fallback_tool?: string;        // present when retry chose a registry alternative
  ok: boolean;
  output?: unknown;
  error?: string;
  attempts: number;
  duration_ms: number;
}

export interface ChainResult {
  session_id: string;
  ok: boolean;
  total_duration_ms: number;
  budget_ms: number;
  budget_exceeded: boolean;
  steps: ChainStepResult[];
  failures_log: string;          // path to failures.jsonl
}

function sessionDir(sessionId: string): string {
  const d = join(homedir(), '.inkpal', 'sessions', sessionId);
  mkdirSync(d, { recursive: true });
  return d;
}

function logFailure(
  sessionId: string,
  payload: Record<string, unknown>,
): void {
  try {
    const f = join(sessionDir(sessionId), 'failures.jsonl');
    appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
  } catch { /* best-effort */ }
}

function resolveToolName(idOrName: string, reg: Awaited<ReturnType<typeof getRegistry>>): string {
  if (!reg) return idOrName;
  if (idOrName.startsWith('T-')) {
    const t = reg.tools.find(t => t.id === idOrName);
    return t?.name ?? idOrName;
  }
  return idOrName;
}

function getAlternatives(toolName: string, reg: Awaited<ReturnType<typeof getRegistry>>): string[] {
  if (!reg) return [];
  const t = reg.tools.find(t => t.name === toolName);
  return t?.alternatives ?? [];
}

async function callOne(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output?: unknown; error?: string }> {
  try {
    if (LOCAL_TOOLS.has(toolName)) {
      const r = await handleLocal(toolName, args) as Record<string, unknown> | null;
      const ok = r != null && r.success !== false && !r.error;
      return ok
        ? { ok: true, output: r }
        : { ok: false, output: r, error: (r?.error as string) ?? 'unknown_failure' };
    }
    // Cloud tools — caller's responsibility (chain executor doesn't drive cloud directly,
    // it goes through the proxy's normal callRemote path which is wired in server.ts).
    return { ok: false, error: 'chain_executor_local_only' };
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
}

/**
 * Execute a chain of steps.
 *
 * Per-step failure recovery (bounded — never loops):
 *   1. Try the step
 *   2. If fail, retry ONCE with same args
 *   3. If still fail and registry has alternatives[], try the top alternative ONCE
 *   4. If still fail and !auto: stop and return; chain.ok=false
 *   5. If still fail and auto: log and continue to next step
 *
 * Total wall-clock budget enforced; budget_exceeded flag set in result.
 */
export async function runChain(
  steps: ChainStep[],
  options: ChainOptions = {},
): Promise<ChainResult> {
  const sessionId = options.session_id ?? randomUUID();
  const budgetMs = options.budget_ms ?? 60_000;
  const auto = options.auto ?? false;
  const t0 = Date.now();

  // Cleanup hook (Rule 3: throttled, fire-and-forget — never blocks chain).
  // Looks up project_path from the first STATIC step args if available
  // (function-args resolve only at execution time, after this hook runs).
  const projectPath = (() => {
    for (const s of steps) {
      if (s.args && typeof s.args === 'object' && typeof (s.args as Record<string, unknown>).project_path === 'string') {
        return (s.args as Record<string, unknown>).project_path as string;
      }
    }
    return undefined;
  })();
  onChainStart(projectPath);

  const reg = await getRegistry();
  const results: ChainStepResult[] = [];
  const priorResults: unknown[] = [];
  let chainOk = true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();

    // Conditional skip
    if (step.condition && !step.condition(priorResults)) {
      results.push({
        step: i + 1, tool_name: step.tool, registered: false, fallback_used: false,
        ok: true, output: { skipped: true }, attempts: 0, duration_ms: 0,
      });
      priorResults.push({ skipped: true });
      continue;
    }

    // LLM-only steps (the chain doesn't drive these — they're markers for
    // Claude Code to know it should reason / edit at this point).
    if (step.llm_only) {
      results.push({
        step: i + 1, tool_name: step.tool, registered: false, fallback_used: false,
        ok: true, output: { llm_step: true, label: step.label }, attempts: 0, duration_ms: 0,
      });
      priorResults.push({ llm_step: true });
      continue;
    }

    const toolName = resolveToolName(step.tool, reg);
    const isReg = isRegistered(toolName, reg);
    const toolId = step.tool.startsWith('T-') ? step.tool : reg?.tools.find(t => t.name === toolName)?.id;

    // Fallback discipline (Rule 4): if calling an unregistered tool, log it.
    if (!isReg) {
      logFailure(sessionId, {
        kind: 'unregistered_tool_invoked',
        step: i + 1,
        tool_name: toolName,
        fallback_used: true,
        fallback_tool: toolName,
      });
    }

    let attempts = 0;
    let fallbackTool: string | undefined;
    let result: Awaited<ReturnType<typeof callOne>>;

    // Resolve args (static object or dynamic from prior results)
    const resolvedArgs: Record<string, unknown> = typeof step.args === 'function'
      ? (step.args as (p: unknown[]) => Record<string, unknown>)(priorResults)
      : (step.args ?? {});

    // Attempt 1
    attempts++;
    result = await callOne(toolName, resolvedArgs);

    // Attempt 2 — retry same tool once
    if (!result.ok) {
      logFailure(sessionId, {
        kind: 'step_failed_retry',
        step: i + 1,
        tool_id: toolId,
        tool_name: toolName,
        attempt: attempts,
        input: step.args,
        output_summary: typeof result.output === 'object' ? JSON.stringify(result.output).slice(0, 300) : String(result.output ?? ''),
        reason: result.error,
        fallback_used: !isReg,
      });
      attempts++;
      result = await callOne(toolName, resolvedArgs);
    }

    // Attempt 3 — alternative tool from registry, once
    if (!result.ok && isReg) {
      const alts = getAlternatives(toolName, reg);
      if (alts.length) {
        const altName = resolveToolName(alts[0], reg);
        logFailure(sessionId, {
          kind: 'switching_to_alternative',
          step: i + 1,
          original_tool: toolName,
          alternative_tool: altName,
        });
        attempts++;
        fallbackTool = altName;
        result = await callOne(altName, resolvedArgs);
      }
    }

    // Optional onResult side-effect (test/harness only; never mutates chain state)
    if (step.onResult) { try { step.onResult(result.output); } catch { /* never block on harness cb */ } }

    const duration = Date.now() - stepStart;
    const stepResult: ChainStepResult = {
      step: i + 1,
      tool_id: toolId,
      tool_name: toolName,
      registered: isReg,
      fallback_used: !isReg || !!fallbackTool,
      fallback_tool: fallbackTool,
      ok: result.ok,
      output: result.output,
      error: result.error,
      attempts,
      duration_ms: duration,
    };
    results.push(stepResult);
    priorResults.push(result.output);

    if (!result.ok) {
      logFailure(sessionId, {
        kind: 'step_failed_final',
        step: i + 1,
        tool_id: toolId,
        tool_name: toolName,
        attempts,
        reason: result.error,
        chain_state_so_far: results.length,
      });
      chainOk = false;
      if (!auto) break;     // hand back to user/LLM
    }

    // Budget check
    if (Date.now() - t0 > budgetMs) {
      logFailure(sessionId, {
        kind: 'budget_exceeded',
        budget_ms: budgetMs,
        actual_ms: Date.now() - t0,
        completed_steps: i + 1,
        total_steps: steps.length,
      });
      break;
    }
  }

  const result = {
    session_id: sessionId,
    ok: chainOk,
    total_duration_ms: Date.now() - t0,
    budget_ms: budgetMs,
    budget_exceeded: Date.now() - t0 > budgetMs,
    steps: results,
    failures_log: join(sessionDir(sessionId), 'failures.jsonl'),
  };

  // Session-end purge: keep summary.json + failures.jsonl (if non-empty),
  // delete intermediate artifacts. Async, post-return, never blocks.
  setImmediate(() => {
    try {
      finalizeSession(sessionId, {
        session_id: sessionId,
        ok: chainOk,
        total_duration_ms: result.total_duration_ms,
        steps: results.map(s => ({
          tool_id: s.tool_id, tool_name: s.tool_name, ok: s.ok, duration_ms: s.duration_ms,
        })),
      });
    } catch { /* never block on cleanup */ }
  });

  return result;
}

/**
 * Read a session's failures log (used by contract test harness on Day 5
 * to feed the auto-status-update logic).
 */
export function readFailuresLog(sessionId: string): unknown[] {
  const f = join(sessionDir(sessionId), 'failures.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(x => x != null);
}
