#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { fetchRemoteTools, callRemote, validateKeyRemote, type RemoteTool } from './remote.js';
import { handleLocal, LOCAL_TOOLS } from './local.js';

const VERSION = '18.4.0';

// ── Telemetry (D8) ────────────────────────────────────────────────────────
// Anonymized fire-and-forget log of every tool call so we can read aggregate
// usage + failure patterns from real users. Device identifier is a hash, not
// the license key. Never blocks response. Disabled when INKPAL_TELEMETRY=off.

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

const TELEMETRY_ENABLED = process.env.INKPAL_TELEMETRY !== 'off';
const TELEMETRY_BASE = process.env.INKPAL_API_URL || 'https://mcp.inkpal.ai';
const DEVICE_HASH = createHash('sha256')
  .update(`${hostname()}-${process.platform}-${process.arch}`)
  .digest('hex')
  .slice(0, 16);

interface TelemetryEvent {
  tool: string;
  ok: boolean;
  error_code?: string;
  latency_ms: number;
  platform?: string;
  tier?: string;
  client_version: string;
}

async function fireTelemetry(evt: TelemetryEvent): Promise<void> {
  if (!TELEMETRY_ENABLED) return;
  try {
    await fetch(`${TELEMETRY_BASE}/api/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Inkpal-Device-Hash': DEVICE_HASH,
      },
      body: JSON.stringify(evt),
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* never let telemetry break the caller */ }
}

// ── License Key Validation ────────────────────────────────────────────────

async function validateKey(): Promise<string> {
  const key = process.env.INKPAL_LICENSE_KEY?.trim() ?? '';

  if (!key) {
    process.stderr.write([
      '',
      '┌──────────────────────────────────────────────────────────┐',
      '│  InkPal MCP Server — License Key Required                │',
      '├──────────────────────────────────────────────────────────┤',
      '│  Add to your MCP config:                                 │',
      '│  "env": { "INKPAL_LICENSE_KEY": "ink_your_key_here" }   │',
      '│                                                          │',
      '│  Get your key at: https://inkpal.ai/pricing              │',
      '└──────────────────────────────────────────────────────────┘',
      '',
    ].join('\n'));
    process.exit(1);
  }

  if (!key.startsWith('ink_') || key.length < 10) {
    process.stderr.write('[InkPal] Invalid key format. Keys start with "ink_" (min 10 chars).\n');
    process.stderr.write('[InkPal] Get your key: https://inkpal.ai/pricing\n');
    process.exit(1);
  }

  // All keys validated server-side (no local bypasses)
  const result = await validateKeyRemote(key);
  if (result.valid === false) {
    process.stderr.write(`[InkPal] License rejected: ${result.error ?? 'invalid key'}\n`);
    process.stderr.write('[InkPal] Manage your key: https://inkpal.ai/account\n');
    process.exit(1);
  }
  // Single-plan model: server returns 'pro' for paid keys, 'dev' for trial.
  // We read from the response so trial users see "Trial active" and paid
  // users see "Pro active" (instead of hardcoding everyone to 'pro').
  const tier = (result.tier ?? 'pro').toLowerCase();
  process.env.INKPAL_TIER = tier;
  if (tier === 'dev' || tier === 'trial') {
    process.stderr.write(`[inkpal] Trial active — full access for 24 hours. Subscribe at https://inkpal.ai/pricing\n`);
  } else {
    process.stderr.write(`[inkpal] License OK — Pro active.\n`);
  }
  return key;
}

// ── A5: self-update notifier ─────────────────────────────────────────────
// Probes the npm registry for the latest published version and warns the
// user if the installed proxy is behind. Cached 24h to avoid hammering npm
// on every server boot. Fail-silent — never blocks startup or tool calls.

async function checkForUpdate(): Promise<void> {
  const cacheDir = `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.inkpal`;
  const cachePath = `${cacheDir}/update-check.json`;
  const TTL_MS = 24 * 60 * 60 * 1000;
  try {
    const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    if (existsSync(cachePath)) {
      try {
        const c = JSON.parse(readFileSync(cachePath, 'utf8')) as { checked_at: number; latest: string };
        if (Date.now() - c.checked_at < TTL_MS) {
          if (c.latest && c.latest !== VERSION) {
            process.stderr.write(`[inkpal] v${VERSION} — latest is ${c.latest} (run \`inkpal upgrade\`)\n`);
          }
          return;
        }
      } catch { /* corrupt cache → refetch */ }
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    let latest: string | null = null;
    try {
      const r = await fetch('https://registry.npmjs.org/inkpal/latest', { signal: ac.signal });
      if (r.ok) {
        const j = await r.json() as { version?: string };
        latest = j.version ?? null;
      }
    } catch { /* offline / npm down */ }
    finally { clearTimeout(timer); }
    if (latest) {
      try {
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cachePath, JSON.stringify({ checked_at: Date.now(), latest }));
      } catch { /* best-effort */ }
      if (latest !== VERSION) {
        process.stderr.write(`[inkpal] v${VERSION} — latest is ${latest} (run \`inkpal upgrade\`)\n`);
      }
    }
  } catch { /* never break boot */ }
}

// ── Main ──────────────────────────────────────────────────────────────────

// B-002 part-2 fix: bundled schemas shipped with the npm package. Used as
// fallback when Railway is unreachable. Without this, every offline / network-
// blip session degrades to flat {project_path}-only schemas and breaks every
// interaction tool from any MCP client. Re-runs the same bug we thought was
// closed in 0.8.2 — but only if Railway responds. With this bundle, schemas
// stay rich whether Railway is up or not.
import bundledSchemas from './tool-schemas-bundled.json' with { type: 'json' };

const BUNDLED_BY_NAME = new Map<string, RemoteTool>(
  (bundledSchemas.tools as RemoteTool[]).map(t => [t.name, t]),
);

// RUN6 B-024 fix: project_doctor is an alias for doctor (same handler).
// Mirror doctor's bundled schema so MCP clients see real description+schema
// instead of the stub fallback ("Local: project doctor").
const doctorSchema = BUNDLED_BY_NAME.get('inkpal_doctor');
if (doctorSchema && !BUNDLED_BY_NAME.has('inkpal_project_doctor')) {
  BUNDLED_BY_NAME.set('inkpal_project_doctor', {
    ...doctorSchema,
    name: 'inkpal_project_doctor',
    description: `Alias for inkpal_doctor — ${doctorSchema.description}`,
  });
}

async function main() {
  const key = await validateKey();
  // A5: fire-and-forget update check (24h cache, 2s timeout, never blocks).
  void checkForUpdate();

  // Railway returns ALL tools (remote + local definitions).
  // The client decides at call-time whether to handle locally or forward.
  const remoteTools = await fetchRemoteTools(key);
  const remoteNames = new Set(remoteTools.map(t => t.name));
  const railwayReachable = remoteTools.length > 0;

  // Add any local tools not already in the remote list. Use bundled schemas
  // when present (rich), fall back to flat stub only as last resort.
  const extraLocal: RemoteTool[] = [...LOCAL_TOOLS]
    .filter(name => !remoteNames.has(name))
    .map(name => {
      const bundled = BUNDLED_BY_NAME.get(name);
      if (bundled) return { ...bundled, execMode: 'local-only' as const };
      return {
        name,
        description: `Local: ${name.replace('inkpal_', '').replace(/_/g, ' ')}`,
        inputSchema: { type: 'object', properties: { project_path: { type: 'string' } } },
      };
    });

  // If Railway was unreachable, also include any bundled tools that aren't
  // in remoteTools (which is empty in that case) and aren't in LOCAL_TOOLS
  // either — they're cloud-only, but we can at least advertise the schemas
  // so callers see meaningful inputs and get a clean "cloud unreachable"
  // error at call time instead of a confusing schema-mismatch error.
  const offlineCloudFallback: RemoteTool[] = railwayReachable ? [] :
    [...BUNDLED_BY_NAME.values()]
      .filter(t => !remoteNames.has(t.name) && !LOCAL_TOOLS.has(t.name) && !extraLocal.some(e => e.name === t.name))
      .map(t => ({ ...t, execMode: 'remote-only' as const }));

  // B-014 fix: stamp each tool with execMode so MCP clients see tier/dispatch
  // info in the discovery payload. Local tools include "[local]" in description
  // so the agent + UI can immediately see they need a connected device. Tools
  // tagged remote-only by Railway include "[cloud]". MCP clients that strip
  // unknown fields still get the prefix in description.
  const allTools: RemoteTool[] = [...remoteTools, ...extraLocal, ...offlineCloudFallback].map(t => {
    const isLocal = LOCAL_TOOLS.has(t.name) || t.execMode === 'local-only';
    const isRemote = t.execMode === 'remote-only';
    const tag = isLocal ? '[local] ' : isRemote ? '[cloud] ' : '';
    return {
      ...t,
      execMode: t.execMode ?? (isLocal ? 'local-only' : undefined),
      description: t.description.startsWith('[local]') || t.description.startsWith('[cloud]')
        ? t.description
        : `${tag}${t.description}`,
    };
  });

  const server = new Server(
    { name: 'inkpal', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    // Local tools run on user's machine (Flutter SDK, ADB, device access)
    // Everything else forwards to Railway intelligence server
    const t0 = Date.now();
    const result = LOCAL_TOOLS.has(name)
      ? await handleLocal(name, args)
      : await callRemote(key, name, args);
    const latencyMs = Date.now() - t0;

    // D8: fire-and-forget telemetry. Anonymized; never blocks the response.
    // Captures tool name, success bit, error code, latency, platform, tier.
    void fireTelemetry({
      tool: name,
      ok: !(result as Record<string, unknown>)?.error && (result as Record<string, unknown>)?.success !== false,
      error_code: ((result as Record<string, unknown>)?.error || (result as Record<string, unknown>)?.code) as string | undefined,
      latency_ms: latencyMs,
      platform: ((result as Record<string, unknown>)?.platform) as string | undefined,
      tier: process.env.INKPAL_TIER,
      client_version: VERSION,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // ── Bridge → proxy WebSocket events (Week 2 Day 6) ──────────────────────
  // Listen for the inkpal_bridge in-app instrumentation to dial in on
  // ws://localhost:8765, forward each telemetry event as an MCP notification
  // so Claude Code surfaces "InkPal: route changed to /detail/3" inline
  // between tool calls. Lets the LLM skip redundant polling between steps.
  try {
    const { startBridgeEventServer, onBridgeEvent } = await import('./bridge_events.js');
    startBridgeEventServer(8765);
    onBridgeEvent((evt) => {
      // Surface as an MCP server notification. SDK uses notifications/message
      // for arbitrary server→client text. Logged at info level.
      void server.notification({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'inkpal_bridge',
          data: { event_type: evt.type, received_at: evt.received_at, ...evt.data },
        },
      });
    });
    process.stderr.write(`[inkpal] Bridge event listener on ws://127.0.0.1:8765\n`);
  } catch (e) {
    // Never fatal — proxy works fine without push events (chains fall back to polling)
    process.stderr.write(`[inkpal] Bridge event server skipped: ${(e as Error).message}\n`);
  }

  const localCount = [...LOCAL_TOOLS].filter(n => remoteNames.has(n) || extraLocal.some(t => t.name === n)).length;
  const remoteCount = allTools.length - extraLocal.length;
  process.stderr.write(`[inkpal] v${VERSION} ready — ${allTools.length} tools (${remoteCount} cloud + ${LOCAL_TOOLS.size} local)\n`);
  process.stderr.write(`[inkpal] Local tools run on your machine (Flutter SDK, ADB). Remote tools use Railway intelligence.\n`);
  process.stderr.write(`[inkpal] Setup help: inkpal doctor  |  Docs: https://docs.inkpal.ai\n`);
}

main().catch((err) => {
  process.stderr.write(`[inkpal] Fatal: ${err}\n`);
  process.exit(1);
});
