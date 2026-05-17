const BASE = process.env.INKPAL_API_URL || 'https://mcp.inkpal.ai';
export interface RemoteTool {
    name: string;
    description: string;
    inputSchema: unknown;
    execMode?: 'local-only' | 'remote-only';
}
export async function fetchRemoteTools(key: string): Promise<RemoteTool[]> {
    try {
        const r = await fetch(`${BASE}/api/tools?include_local=1`, {
            headers: {
                Authorization: `Bearer ${key}`,
                'X-Inkpal-Client': 'proxy',
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok)
            return [];
        const data = await r.json() as {
            tools?: RemoteTool[];
        };
        return data.tools ?? [];
    }
    catch {
        return [];
    }
}
function categorizeNetworkError(msg: string): {
    code: string;
    recoverable: boolean;
    hint: string;
} {
    if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|DNS/i.test(msg)) {
        return {
            code: 'dns_failed',
            recoverable: true,
            hint: 'DNS lookup failed for the InkPal API host. Local DNS may be misconfigured. Try: `networksetup -setdnsservers Wi-Fi 1.1.1.1 1.0.0.1` (macOS) then `sudo killall -HUP mDNSResponder`.',
        };
    }
    if (/ECONNREFUSED/i.test(msg)) {
        return {
            code: 'connection_refused',
            recoverable: true,
            hint: 'The InkPal API host refused connection. The service may be restarting. Retry in 30s.',
        };
    }
    if (/timeout|ETIMEDOUT|aborted/i.test(msg)) {
        return {
            code: 'request_timeout',
            recoverable: true,
            hint: 'Request timed out. The InkPal server may be slow. Retry, or check inkpal.ai/status.',
        };
    }
    if (/ECONNRESET|EPIPE|socket hang up/i.test(msg)) {
        return {
            code: 'connection_reset',
            recoverable: true,
            hint: 'Connection dropped mid-request. Likely transient — retry.',
        };
    }
    if (/network|fetch failed/i.test(msg)) {
        return {
            code: 'network_error',
            recoverable: true,
            hint: 'Generic network failure. Check internet connection.',
        };
    }
    return { code: 'unknown_error', recoverable: false, hint: msg };
}
function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
export async function callRemote(key: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const enrichedArgs: Record<string, unknown> = {
        project_path: process.cwd(),
        ...args,
    };
    const MAX_ATTEMPTS = 3;
    const BACKOFFS_MS = [0, 500, 1500];
    let lastErrorCategory: {
        code: string;
        recoverable: boolean;
        hint: string;
    } | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (BACKOFFS_MS[attempt] > 0)
            await sleep(BACKOFFS_MS[attempt]);
        try {
            const r = await fetch(`${BASE}/api/tools/${encodeURIComponent(toolName)}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(enrichedArgs),
                signal: AbortSignal.timeout(60000),
            });
            if (!r.ok) {
                const err = await r.text().catch(() => r.statusText);
                if (r.status >= 500 && r.status < 600 && attempt < MAX_ATTEMPTS - 1) {
                    lastErrorCategory = { code: `server_${r.status}`, recoverable: true, hint: `Server returned ${r.status}. Retrying...` };
                    continue;
                }
                try {
                    return JSON.parse(err) as unknown;
                }
                catch {
                    return { error: err, status: r.status, tool: toolName };
                }
            }
            return r.json();
        }
        catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            lastErrorCategory = categorizeNetworkError(msg);
            if (!lastErrorCategory.recoverable || attempt >= MAX_ATTEMPTS - 1)
                break;
        }
    }
    return cloudUnreachableEnvelope(toolName, lastErrorCategory, MAX_ATTEMPTS);
}
function cloudUnreachableEnvelope(context: string, lastError: {
    code: string;
    recoverable: boolean;
    hint: string;
} | null, attempts: number): Record<string, unknown> {
    return {
        success: false,
        error: 'cloud_unreachable',
        code: lastError?.code ?? 'unknown',
        tool: context,
        attempts,
        message: `InkPal cloud unreachable after ${attempts} attempts (${lastError?.code ?? 'unknown'}).`,
        hint: lastError?.hint ?? 'Check inkpal.ai/status. Local SDK tools (doctor, launch_app, screenshot) still work.',
    };
}
export async function callOrchestrationEndpoint(key: string, endpointPath: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const MAX_ATTEMPTS = 3;
    const BACKOFFS_MS = [0, 500, 1500];
    let lastErrorCategory: {
        code: string;
        recoverable: boolean;
        hint: string;
    } | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (BACKOFFS_MS[attempt] > 0)
            await sleep(BACKOFFS_MS[attempt]);
        try {
            const r = await fetch(`${BASE}${endpointPath}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(30000),
            });
            if (!r.ok) {
                const err = await r.text().catch(() => r.statusText);
                if (r.status >= 500 && r.status < 600 && attempt < MAX_ATTEMPTS - 1) {
                    lastErrorCategory = { code: `server_${r.status}`, recoverable: true, hint: `Server returned ${r.status}.` };
                    continue;
                }
                try {
                    return JSON.parse(err) as Record<string, unknown>;
                }
                catch {
                    return { success: false, error: err, status: r.status, endpoint: endpointPath };
                }
            }
            return await r.json() as Record<string, unknown>;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            lastErrorCategory = categorizeNetworkError(msg);
            if (!lastErrorCategory.recoverable || attempt >= MAX_ATTEMPTS - 1)
                break;
        }
    }
    return cloudUnreachableEnvelope(endpointPath, lastErrorCategory, MAX_ATTEMPTS);
}
export async function claimTrial(email: string): Promise<{
    license_key?: string;
    tier?: string;
    expires_at?: string;
    screens_included?: number;
    message?: string;
    error?: string;
}> {
    try {
        const r = await fetch(`${BASE}/api/trial/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
            signal: AbortSignal.timeout(10000),
        });
        return r.json() as Promise<{
            license_key?: string;
            tier?: string;
            expires_at?: string;
            screens_included?: number;
            message?: string;
            error?: string;
        }>;
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : 'Network error' };
    }
}
export async function validateKeyRemote(key: string): Promise<{
    valid: boolean;
    tier?: string;
    error?: string;
}> {
    try {
        const r = await fetch(`${BASE}/api/validate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: key }),
            signal: AbortSignal.timeout(5000),
        });
        return r.json() as Promise<{
            valid: boolean;
            tier?: string;
            error?: string;
        }>;
    }
    catch {
        return { valid: true };
    }
}
