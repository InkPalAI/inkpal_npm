import { existsSync, readdirSync, statSync, rmSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const PROJECT_SIZE_CAP_BYTES = 300 * 1024 * 1024;
const STDERR_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
const PRESERVE_NAMES = new Set<string>([
    'baselines',
    'constitution.yaml', 'dna.json', 'team-dna.json', 'team-dna-audit.json',
    'run-state.json', 'recording-state.json', 'sweep_marker.txt',
    'cache',
    'figma-workspace',
    'config.json',
    'progress.json',
    'specs',
]);
const PROJECT_EPHEMERAL_DIRS = [
    'screenshots',
    'recordings',
    'network-recordings',
    'cross-device',
    'production',
];
const VISUAL_EPHEMERAL_DIRS = ['current', 'diffs'];
let _sizePassCounter = 0;
const SIZE_PASS_EVERY = 10;
function safeStat(path: string): {
    size: number;
    mtimeMs: number;
} | null {
    try {
        const s = statSync(path);
        return { size: s.size, mtimeMs: s.mtimeMs };
    }
    catch {
        return null;
    }
}
function dirSize(path: string): number {
    if (!existsSync(path))
        return 0;
    let total = 0;
    try {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const full = join(path, entry.name);
            if (entry.isDirectory())
                total += dirSize(full);
            else {
                const s = safeStat(full);
                if (s)
                    total += s.size;
            }
        }
    }
    catch { }
    return total;
}
function rmSafe(path: string): boolean {
    try {
        rmSync(path, { recursive: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
export function sweepOldSessions(now = Date.now()): {
    deleted: number;
    bytes_freed: number;
} {
    const sessionsRoot = join(homedir(), '.inkpal', 'sessions');
    if (!existsSync(sessionsRoot))
        return { deleted: 0, bytes_freed: 0 };
    let deleted = 0;
    let freed = 0;
    try {
        for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const full = join(sessionsRoot, entry.name);
            const s = safeStat(full);
            if (!s)
                continue;
            if (now - s.mtimeMs > SESSION_RETENTION_MS) {
                const size = dirSize(full);
                if (rmSafe(full)) {
                    deleted++;
                    freed += size;
                }
            }
        }
    }
    catch { }
    return { deleted, bytes_freed: freed };
}
export function sweepProjectEphemeral(projectPath: string, now = Date.now()): {
    deleted: number;
    bytes_freed: number;
    details: Record<string, number>;
} {
    const root = join(projectPath, '.inkpal');
    if (!existsSync(root))
        return { deleted: 0, bytes_freed: 0, details: {} };
    let deleted = 0;
    let freed = 0;
    const details: Record<string, number> = {};
    for (const dirName of PROJECT_EPHEMERAL_DIRS) {
        const dir = join(root, dirName);
        if (!existsSync(dir))
            continue;
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                const s = safeStat(full);
                if (!s || now - s.mtimeMs <= SESSION_RETENTION_MS)
                    continue;
                const size = entry.isDirectory() ? dirSize(full) : s.size;
                if (rmSafe(full)) {
                    deleted++;
                    freed += size;
                    details[dirName] = (details[dirName] ?? 0) + size;
                }
            }
        }
        catch { }
    }
    for (const sub of VISUAL_EPHEMERAL_DIRS) {
        const dir = join(root, 'visual-tests', sub);
        if (!existsSync(dir))
            continue;
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                const s = safeStat(full);
                if (!s || now - s.mtimeMs <= SESSION_RETENTION_MS)
                    continue;
                const size = s.size;
                if (rmSafe(full)) {
                    deleted++;
                    freed += size;
                    details[`visual-tests/${sub}`] = (details[`visual-tests/${sub}`] ?? 0) + size;
                }
            }
        }
        catch { }
    }
    const stderr = join(root, 'flutter-stderr.log');
    const ss = safeStat(stderr);
    if (ss && now - ss.mtimeMs > STDERR_LOG_RETENTION_MS) {
        const sz = ss.size;
        try {
            unlinkSync(stderr);
            deleted++;
            freed += sz;
            details['flutter-stderr.log'] = sz;
        }
        catch { }
    }
    return { deleted, bytes_freed: freed, details };
}
interface ScanEntry {
    path: string;
    size: number;
    mtimeMs: number;
}
export function enforceProjectSizeCap(projectPath: string, capBytes = PROJECT_SIZE_CAP_BYTES): {
    before_bytes: number;
    after_bytes: number;
    deleted: number;
    bytes_freed: number;
} {
    const root = join(projectPath, '.inkpal');
    if (!existsSync(root))
        return { before_bytes: 0, after_bytes: 0, deleted: 0, bytes_freed: 0 };
    const before = dirSize(root);
    if (before <= capBytes)
        return { before_bytes: before, after_bytes: before, deleted: 0, bytes_freed: 0 };
    const candidates: ScanEntry[] = [];
    const collect = (dir: string, depth: number) => {
        if (depth > 6)
            return;
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (PRESERVE_NAMES.has(entry.name))
                    continue;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    collect(full, depth + 1);
                }
                else {
                    const s = safeStat(full);
                    if (s)
                        candidates.push({ path: full, size: s.size, mtimeMs: s.mtimeMs });
                }
            }
        }
        catch { }
    };
    collect(root, 0);
    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let freed = 0;
    let deleted = 0;
    let current = before;
    for (const c of candidates) {
        if (current <= capBytes)
            break;
        try {
            unlinkSync(c.path);
            freed += c.size;
            deleted++;
            current -= c.size;
        }
        catch { }
    }
    return { before_bytes: before, after_bytes: current, deleted, bytes_freed: freed };
}
export interface ChainResultSummary {
    session_id: string;
    ok: boolean;
    total_duration_ms: number;
    steps: Array<{
        tool_id?: string;
        tool_name: string;
        ok: boolean;
        duration_ms: number;
    }>;
}
export function finalizeSession(sessionId: string, summary: ChainResultSummary): {
    kept: string[];
    deleted: string[];
    bytes_freed: number;
} {
    const dir = join(homedir(), '.inkpal', 'sessions', sessionId);
    if (!existsSync(dir))
        return { kept: [], deleted: [], bytes_freed: 0 };
    const kept: string[] = [];
    const deleted: string[] = [];
    let freed = 0;
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
        kept.push('summary.json');
    }
    catch { }
    const failures = join(dir, 'failures.jsonl');
    if (existsSync(failures)) {
        try {
            const content = readFileSync(failures, 'utf8');
            if (content.trim().length > 0)
                kept.push('failures.jsonl');
            else {
                unlinkSync(failures);
                deleted.push('failures.jsonl');
            }
        }
        catch { }
    }
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (kept.includes(entry.name))
                continue;
            const full = join(dir, entry.name);
            const s = safeStat(full);
            const size = entry.isDirectory() ? dirSize(full) : (s?.size ?? 0);
            if (rmSafe(full)) {
                deleted.push(entry.name);
                freed += size;
            }
        }
    }
    catch { }
    return { kept, deleted, bytes_freed: freed };
}
let _lastSweepAt = 0;
const SWEEP_THROTTLE_MS = 5 * 60 * 1000;
export function onChainStart(projectPath?: string): void {
    const now = Date.now();
    if (now - _lastSweepAt < SWEEP_THROTTLE_MS)
        return;
    _lastSweepAt = now;
    setImmediate(() => {
        try {
            sweepOldSessions(now);
            if (projectPath)
                sweepProjectEphemeral(projectPath, now);
            _sizePassCounter++;
            if (projectPath && _sizePassCounter % SIZE_PASS_EVERY === 0) {
                enforceProjectSizeCap(projectPath);
            }
        }
        catch { }
    });
}
export interface CleanupOptions {
    project_path?: string;
    force_size_cap?: boolean;
    retention_hours?: number;
}
export interface CleanupReport {
    success: true;
    ts: string;
    global_sessions: ReturnType<typeof sweepOldSessions>;
    project: {
        path: string;
        ephemeral: ReturnType<typeof sweepProjectEphemeral>;
        size_cap?: ReturnType<typeof enforceProjectSizeCap>;
    } | null;
    total_bytes_freed: number;
}
export function runManualCleanup(opts: CleanupOptions = {}): CleanupReport {
    const now = Date.now();
    const retention = (opts.retention_hours ?? 24) * 60 * 60 * 1000;
    const cutoff = now - retention + SESSION_RETENTION_MS;
    const global_sessions = sweepOldSessions(cutoff);
    let project: CleanupReport['project'] = null;
    let totalFreed = global_sessions.bytes_freed;
    if (opts.project_path) {
        const ephemeral = sweepProjectEphemeral(opts.project_path, cutoff);
        totalFreed += ephemeral.bytes_freed;
        project = { path: opts.project_path, ephemeral };
        if (opts.force_size_cap) {
            const size_cap = enforceProjectSizeCap(opts.project_path);
            totalFreed += size_cap.bytes_freed;
            project.size_cap = size_cap;
        }
    }
    return {
        success: true,
        ts: new Date().toISOString(),
        global_sessions,
        project,
        total_bytes_freed: totalFreed,
    };
}
