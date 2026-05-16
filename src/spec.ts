/**
 * Spec → Plan — proxy.
 *
 * Was a 388-line local intelligence module. 1.0.0 LOCKDOWN moved the
 * taxonomy + scoring + blocker detection server-side. This proxy
 * forwards 'parse' actions to POST /api/spec/parse and keeps only the
 * pure-storage 'list' / 'get' actions local (just .inkpal/specs/*.json
 * filesystem ops — no intelligence).
 *
 * See: feedback_inkpal_moat_protection.md
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { callOrchestrationEndpoint } from './remote.js';

interface SavedPlan {
  plan_id: string;
  created_at: string;
  confidence: number;
  features?: string[];
  screens?: string[];
  [k: string]: unknown;
}

export interface SpecArgs {
  action?: 'parse' | 'list' | 'get';
  project_path?: string;
  spec?: string;
  plan_id?: string;
  clarify?: boolean;
}

export interface SpecResponse {
  success: boolean;
  action: string;
  project_path: string;
  plan?: SavedPlan;
  plans?: Array<{ plan_id: string; created_at: string; confidence: number; feature_count: number; screen_count: number }>;
  clarification_questions?: string[];
  policy_preview?: Record<string, unknown>;
  orchestration_version?: string;
  engine_version?: string;
  elapsed_ms?: number;
  hint?: string;
  error?: string;
  [k: string]: unknown;
}

function getLicenseKey(): string {
  return process.env.INKPAL_LICENSE_KEY ?? '';
}

export async function handleSpec(args: SpecArgs): Promise<SpecResponse> {
  const t0 = Date.now();
  const action = args.action ?? 'parse';
  const projectPath = args.project_path ?? process.cwd();
  const specsDir = join(projectPath, '.inkpal', 'specs');

  switch (action) {
    case 'parse': {
      if (!args.spec) {
        return { success: false, action, project_path: projectPath, error: 'spec_required',
          hint: 'Pass {spec: "Build a todo app with home/add/detail screens, go_router, Material 3"}.' };
      }
      const key = getLicenseKey();
      if (!key) {
        return { success: false, action, project_path: projectPath, error: 'license_required',
          hint: 'Set INKPAL_LICENSE_KEY. Get a key at https://inkpal.ai/signup (free, includes 24h trial).' };
      }
      const pubspecPath = join(projectPath, 'pubspec.yaml');
      const pubspec_yaml = existsSync(pubspecPath)
        ? (() => { try { return readFileSync(pubspecPath, 'utf8'); } catch { return undefined; } })()
        : undefined;

      const cloud = await callOrchestrationEndpoint(key, '/api/spec/parse', {
        spec: args.spec,
        clarify: args.clarify !== false,
        ...(pubspec_yaml ? { pubspec_yaml } : {}),
      });

      if (!cloud.success) {
        return {
          success: false,
          action,
          project_path: projectPath,
          error: (cloud.error as string) ?? 'cloud_error',
          hint: (cloud.hint as string) ?? 'Spec parsing requires the InkPal cloud.',
          elapsed_ms: Date.now() - t0,
          ...cloud,
        };
      }

      const plan = cloud.plan as SavedPlan;
      try {
        mkdirSync(specsDir, { recursive: true });
        writeFileSync(join(specsDir, `${plan.plan_id}.json`), JSON.stringify(plan, null, 2));
      } catch { /* persistence is best-effort */ }

      return {
        success: true,
        action,
        project_path: projectPath,
        plan,
        ...(cloud.clarification_questions ? { clarification_questions: cloud.clarification_questions as string[] } : {}),
        ...(cloud.policy_preview ? { policy_preview: cloud.policy_preview as Record<string, unknown> } : {}),
        orchestration_version: cloud.orchestration_version as string | undefined,
        engine_version: cloud.engine_version as string | undefined,
        elapsed_ms: Date.now() - t0,
        hint: cloud.hint as string | undefined,
      };
    }

    case 'list': {
      if (!existsSync(specsDir)) {
        return { success: true, action, project_path: projectPath, plans: [], hint: 'No saved plans.' };
      }
      const files = readdirSync(specsDir).filter(f => f.endsWith('.json'));
      const plans = files.map(f => {
        try {
          const p = JSON.parse(readFileSync(join(specsDir, f), 'utf8')) as SavedPlan;
          return {
            plan_id: p.plan_id, created_at: p.created_at, confidence: p.confidence,
            feature_count: p.features?.length ?? 0, screen_count: p.screens?.length ?? 0,
          };
        } catch { return null; }
      }).filter(Boolean) as Array<{ plan_id: string; created_at: string; confidence: number; feature_count: number; screen_count: number }>;
      return { success: true, action, project_path: projectPath, plans,
        hint: plans.length === 0 ? 'No saved plans.' : `${plans.length} plan(s) saved.` };
    }

    case 'get': {
      if (!args.plan_id) return { success: false, action, project_path: projectPath, error: 'plan_id_required' };
      const path = join(specsDir, `${args.plan_id}.json`);
      if (!existsSync(path)) return { success: false, action, project_path: projectPath, error: 'plan_not_found', plan_id: args.plan_id };
      const plan = JSON.parse(readFileSync(path, 'utf8')) as SavedPlan;
      return { success: true, action, project_path: projectPath, plan };
    }

    default:
      return { success: false, action, project_path: projectPath, error: 'unknown_action',
        hint: 'Valid actions: parse | list | get' };
  }
}
