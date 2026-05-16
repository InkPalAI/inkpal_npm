#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { fetchRemoteTools, callRemote, validateKeyRemote, type RemoteTool } from './remote.js';
import { handleLocal, LOCAL_TOOLS } from './local.js';
const VERSION = '18.4.0';
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
    if (!TELEMETRY_ENABLED)
        return;
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
    }
    catch { }
}
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
    const result = await validateKeyRemote(key);
    if (result.valid === false) {
        process.stderr.write(`[InkPal] License rejected: ${result.error ?? 'invalid key'}\n`);
        process.stderr.write('[InkPal] Manage your key: https://inkpal.ai/account\n');
        process.exit(1);
    }
    const tier = (result.tier ?? 'pro').toLowerCase();
    process.env.INKPAL_TIER = tier;
    if (tier === 'dev' || tier === 'trial') {
        process.stderr.write(`[inkpal] Trial active — full access for 24 hours. Subscribe at https://inkpal.ai/pricing\n`);
    }
    else {
        process.stderr.write(`[inkpal] License OK — Pro active.\n`);
    }
    return key;
}
async function checkForUpdate(): Promise<void> {
    const cacheDir = `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.inkpal`;
    const cachePath = `${cacheDir}/update-check.json`;
    const TTL_MS = 24 * 60 * 60 * 1000;
    try {
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
        if (existsSync(cachePath)) {
            try {
                const c = JSON.parse(readFileSync(cachePath, 'utf8')) as {
                    checked_at: number;
                    latest: string;
                };
                if (Date.now() - c.checked_at < TTL_MS) {
                    if (c.latest && c.latest !== VERSION) {
                        process.stderr.write(`[inkpal] v${VERSION} — latest is ${c.latest} (run \`inkpal upgrade\`)\n`);
                    }
                    return;
                }
            }
            catch { }
        }
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 2000);
        let latest: string | null = null;
        try {
            const r = await fetch('https://registry.npmjs.org/inkpal/latest', { signal: ac.signal });
            if (r.ok) {
                const j = await r.json() as {
                    version?: string;
                };
                latest = j.version ?? null;
            }
        }
        catch { }
        finally {
            clearTimeout(timer);
        }
        if (latest) {
            try {
                if (!existsSync(cacheDir))
                    mkdirSync(cacheDir, { recursive: true });
                writeFileSync(cachePath, JSON.stringify({ checked_at: Date.now(), latest }));
            }
            catch { }
            if (latest !== VERSION) {
                process.stderr.write(`[inkpal] v${VERSION} — latest is ${latest} (run \`inkpal upgrade\`)\n`);
            }
        }
    }
    catch { }
}
import bundledSchemas from './tool-schemas-bundled.json' with { type: 'json' };
const BUNDLED_BY_NAME = new Map<string, RemoteTool>((bundledSchemas.tools as RemoteTool[]).map(t => [t.name, t]));
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
    void checkForUpdate();
    const remoteTools = await fetchRemoteTools(key);
    const remoteNames = new Set(remoteTools.map(t => t.name));
    const railwayReachable = remoteTools.length > 0;
    const extraLocal: RemoteTool[] = [...LOCAL_TOOLS]
        .filter(name => !remoteNames.has(name))
        .map(name => {
        const bundled = BUNDLED_BY_NAME.get(name);
        if (bundled)
            return { ...bundled, execMode: 'local-only' as const };
        return {
            name,
            description: `Local: ${name.replace('inkpal_', '').replace(/_/g, ' ')}`,
            inputSchema: { type: 'object', properties: { project_path: { type: 'string' } } },
        };
    });
    const offlineCloudFallback: RemoteTool[] = railwayReachable ? [] :
        [...BUNDLED_BY_NAME.values()]
            .filter(t => !remoteNames.has(t.name) && !LOCAL_TOOLS.has(t.name) && !extraLocal.some(e => e.name === t.name))
            .map(t => ({ ...t, execMode: 'remote-only' as const }));
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
    const server = new Server({ name: 'inkpal', version: VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const name = req.params.name;
        const args = (req.params.arguments ?? {}) as Record<string, unknown>;
        const t0 = Date.now();
        const result = LOCAL_TOOLS.has(name)
            ? await handleLocal(name, args)
            : await callRemote(key, name, args);
        const latencyMs = Date.now() - t0;
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
    try {
        const { startBridgeEventServer, onBridgeEvent } = await import('./bridge-events.js');
        startBridgeEventServer(8765);
        onBridgeEvent((evt) => {
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
    }
    catch (e) {
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
