import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { handleLocal, getRegistry, isRegistered, LOCAL_TOOLS } from './local.js';
import { onChainStart, finalizeSession } from './cleanup.js';
export interface ChainStep {
    tool: string;
    args?: Record<string, unknown> | ((priorResults: unknown[]) => Record<string, unknown>);
    onResult?: (output: unknown) => void;
    condition?: (priorResults: unknown[]) => boolean;
    llm_only?: boolean;
    label?: string;
}
export interface ChainOptions {
    budget_ms?: number;
    session_id?: string;
    auto?: boolean;
}
export interface ChainStepResult {
    step: number;
    tool_id?: string;
    tool_name: string;
    registered: boolean;
    fallback_used: boolean;
    fallback_tool?: string;
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
    failures_log: string;
}
function sessionDir(sessionId: string): string {
    const d = join(homedir(), '.inkpal', 'sessions', sessionId);
    mkdirSync(d, { recursive: true });
    return d;
}
function logFailure(sessionId: string, payload: Record<string, unknown>): void {
    try {
        const f = join(sessionDir(sessionId), 'failures.jsonl');
        appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
    }
    catch { }
}
function resolveToolName(idOrName: string, reg: Awaited<ReturnType<typeof getRegistry>>): string {
    if (!reg)
        return idOrName;
    if (idOrName.startsWith('T-')) {
        const t = reg.tools.find(t => t.id === idOrName);
        return t?.name ?? idOrName;
    }
    return idOrName;
}
function getAlternatives(toolName: string, reg: Awaited<ReturnType<typeof getRegistry>>): string[] {
    if (!reg)
        return [];
    const t = reg.tools.find(t => t.name === toolName);
    return t?.alternatives ?? [];
}
async function callOne(toolName: string, args: Record<string, unknown>): Promise<{
    ok: boolean;
    output?: unknown;
    error?: string;
}> {
    try {
        if (LOCAL_TOOLS.has(toolName)) {
            const r = await handleLocal(toolName, args) as Record<string, unknown> | null;
            const ok = r != null && r.success !== false && !r.error;
            return ok
                ? { ok: true, output: r }
                : { ok: false, output: r, error: (r?.error as string) ?? 'unknown_failure' };
        }
        return { ok: false, error: 'chain_executor_local_only' };
    }
    catch (e) {
        return { ok: false, error: (e as Error).message ?? String(e) };
    }
}
export async function runChain(steps: ChainStep[], options: ChainOptions = {}): Promise<ChainResult> {
    const sessionId = options.session_id ?? randomUUID();
    const budgetMs = options.budget_ms ?? 60000;
    const auto = options.auto ?? false;
    const t0 = Date.now();
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
        if (step.condition && !step.condition(priorResults)) {
            results.push({
                step: i + 1, tool_name: step.tool, registered: false, fallback_used: false,
                ok: true, output: { skipped: true }, attempts: 0, duration_ms: 0,
            });
            priorResults.push({ skipped: true });
            continue;
        }
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
        const resolvedArgs: Record<string, unknown> = typeof step.args === 'function'
            ? (step.args as (p: unknown[]) => Record<string, unknown>)(priorResults)
            : (step.args ?? {});
        attempts++;
        result = await callOne(toolName, resolvedArgs);
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
        if (step.onResult) {
            try {
                step.onResult(result.output);
            }
            catch { }
        }
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
            if (!auto)
                break;
        }
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
        }
        catch { }
    });
    return result;
}
export function readFailuresLog(sessionId: string): unknown[] {
    const f = join(sessionDir(sessionId), 'failures.jsonl');
    if (!existsSync(f))
        return [];
    return readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => { try {
        return JSON.parse(l);
    }
    catch {
        return null;
    } })
        .filter(x => x != null);
}
