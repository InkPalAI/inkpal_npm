import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
export type FeatureStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';
export interface FeatureProgress {
    status: FeatureStatus;
    completed: string[];
    pending: string[];
    notes: string[];
    created_at: string;
    updated_at: string;
}
export interface ProgressFile {
    version: '1.0.0';
    project_path: string;
    features: Record<string, FeatureProgress>;
    updated_at: string;
}
function progressPath(projectPath: string): string {
    return join(projectPath, '.inkpal', 'progress.json');
}
function emptyFile(projectPath: string): ProgressFile {
    return {
        version: '1.0.0',
        project_path: projectPath,
        features: {},
        updated_at: new Date().toISOString(),
    };
}
function load(projectPath: string): ProgressFile {
    const path = progressPath(projectPath);
    if (!existsSync(path))
        return emptyFile(projectPath);
    try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as ProgressFile;
        if (data.version !== '1.0.0' || !data.features)
            return emptyFile(projectPath);
        return data;
    }
    catch {
        return emptyFile(projectPath);
    }
}
function save(projectPath: string, data: ProgressFile): void {
    const path = progressPath(projectPath);
    mkdirSync(dirname(path), { recursive: true });
    data.updated_at = new Date().toISOString();
    writeFileSync(path, JSON.stringify(data, null, 2));
}
function ensureFeature(file: ProgressFile, name: string): FeatureProgress {
    if (!file.features[name]) {
        const now = new Date().toISOString();
        file.features[name] = {
            status: 'not_started', completed: [], pending: [], notes: [],
            created_at: now, updated_at: now,
        };
    }
    return file.features[name];
}
export interface ProgressArgs {
    action?: 'get' | 'set' | 'list' | 'append_done' | 'append_pending' | 'note';
    project_path?: string;
    feature?: string;
    status?: FeatureStatus;
    completed?: string[];
    pending?: string[];
    done_item?: string;
    pending_item?: string;
    note?: string;
}
export interface ProgressResponse {
    success: boolean;
    action: string;
    project_path: string;
    feature?: string;
    data?: FeatureProgress | Record<string, FeatureProgress> | {
        feature_count: number;
        summary: Array<{
            feature: string;
            status: FeatureStatus;
            pct_complete: number;
        }>;
    };
    hint?: string;
    error?: string;
}
export function handleProgress(args: ProgressArgs): ProgressResponse {
    const action = args.action ?? 'get';
    const projectPath = args.project_path ?? process.cwd();
    const file = load(projectPath);
    switch (action) {
        case 'list': {
            const summary = Object.entries(file.features).map(([feature, fp]) => {
                const total = fp.completed.length + fp.pending.length;
                const pct = total > 0 ? Math.round((fp.completed.length / total) * 100) : 0;
                return { feature, status: fp.status, pct_complete: pct };
            });
            return {
                success: true, action, project_path: projectPath,
                data: { feature_count: summary.length, summary },
                hint: summary.length === 0
                    ? 'No features tracked yet. Use action:"set" with a feature name to start.'
                    : `${summary.length} feature(s) tracked.`,
            };
        }
        case 'get': {
            if (!args.feature) {
                return {
                    success: true, action, project_path: projectPath,
                    data: file.features,
                    hint: 'Pass {feature: "Login"} to scope to a single feature.',
                };
            }
            const fp = file.features[args.feature];
            if (!fp)
                return {
                    success: false, action, project_path: projectPath, feature: args.feature,
                    error: 'feature_not_found',
                    hint: 'Use action:"list" to see tracked features, or action:"set" to create.',
                };
            return { success: true, action, project_path: projectPath, feature: args.feature, data: fp };
        }
        case 'set': {
            if (!args.feature)
                return { success: false, action, project_path: projectPath, error: 'feature_required' };
            const fp = ensureFeature(file, args.feature);
            if (args.status)
                fp.status = args.status;
            if (args.completed)
                fp.completed = args.completed;
            if (args.pending)
                fp.pending = args.pending;
            fp.updated_at = new Date().toISOString();
            save(projectPath, file);
            return {
                success: true, action, project_path: projectPath, feature: args.feature, data: fp,
                hint: `Feature "${args.feature}" updated. Status: ${fp.status} (${fp.completed.length} done, ${fp.pending.length} pending).`,
            };
        }
        case 'append_done': {
            if (!args.feature || !args.done_item)
                return { success: false, action, project_path: projectPath, error: 'feature_and_done_item_required' };
            const fp = ensureFeature(file, args.feature);
            if (!fp.completed.includes(args.done_item))
                fp.completed.push(args.done_item);
            fp.pending = fp.pending.filter(p => p !== args.done_item);
            if (fp.pending.length === 0 && fp.completed.length > 0)
                fp.status = 'done';
            else if (fp.completed.length > 0)
                fp.status = 'in_progress';
            fp.updated_at = new Date().toISOString();
            save(projectPath, file);
            return {
                success: true, action, project_path: projectPath, feature: args.feature, data: fp,
                hint: `Marked "${args.done_item}" done on "${args.feature}". Status: ${fp.status}.`,
            };
        }
        case 'append_pending': {
            if (!args.feature || !args.pending_item)
                return { success: false, action, project_path: projectPath, error: 'feature_and_pending_item_required' };
            const fp = ensureFeature(file, args.feature);
            if (!fp.pending.includes(args.pending_item) && !fp.completed.includes(args.pending_item)) {
                fp.pending.push(args.pending_item);
            }
            if (fp.status === 'not_started' && fp.pending.length > 0)
                fp.status = 'in_progress';
            fp.updated_at = new Date().toISOString();
            save(projectPath, file);
            return {
                success: true, action, project_path: projectPath, feature: args.feature, data: fp,
                hint: `Added "${args.pending_item}" to "${args.feature}" pending list.`,
            };
        }
        case 'note': {
            if (!args.feature || !args.note)
                return { success: false, action, project_path: projectPath, error: 'feature_and_note_required' };
            const fp = ensureFeature(file, args.feature);
            fp.notes.push(`${new Date().toISOString()}: ${args.note}`);
            fp.updated_at = new Date().toISOString();
            save(projectPath, file);
            return {
                success: true, action, project_path: projectPath, feature: args.feature, data: fp,
                hint: `Note appended to "${args.feature}" (${fp.notes.length} total).`,
            };
        }
        default:
            return { success: false, action, project_path: projectPath, error: 'unknown_action', hint: 'Valid actions: get | set | list | append_done | append_pending | note' };
    }
}
