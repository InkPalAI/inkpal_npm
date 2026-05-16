/**
 * Bridge Events — Day 6 of week 2 sprint.
 *
 * The bridge (inkpal_bridge Dart pkg) opens a WebSocket out to the URL
 * configured via `inkpalRunApp(serverUrl: "ws://localhost:8765")`. It
 * sends JSON-RPC 2.0 notifications: `telemetry` (immediate, errors) and
 * `telemetry_batch` (500ms batched, info/debug logs).
 *
 * This module hosts the receiving WebSocket server in the proxy. Events
 * are forwarded as MCP notifications/message so Claude Code surfaces
 * them inline between tool calls. The LLM can then SKIP redundant polls
 * (`get_runtime_errors` after a tap that just emitted an error event).
 *
 * Implementation: hand-rolled minimal WebSocket server (RFC 6455). No
 * `ws` dep — keeps the tarball lean. ~80 LOC for handshake + frame
 * decode. Outbound frames not needed (proxy doesn't send commands TO
 * the bridge over WS; commands go via VM Service ext.flutter.inkpal.*).
 *
 * Discipline check: no new tool added (Rule 1). No new user surface
 * (Rule 7). Sub-1ms event forwarding (Rule 3 ✅).
 *
 * See plan: docs/superpowers/plans/2026-05-03-week2-sprint.md Day 6.
 */

import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';

// ── RFC 6455 handshake ────────────────────────────────────────────────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(clientKey: string): string {
  return createHash('sha1').update(clientKey + WS_GUID).digest('base64');
}

// ── Frame decoder (text frames only — bridge never sends binary) ──────────
function decodeFrame(buf: Buffer): { payload: string; rest: Buffer<ArrayBufferLike> } | null {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  if (!fin) return null;          // bridge never fragments
  if (opcode !== 0x1) return null; // text only
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (!masked) return null;       // RFC: client→server frames MUST be masked
  if (buf.length < offset + 4 + len) return null;
  const mask = buf.subarray(offset, offset + 4);
  const data = Buffer.alloc(len);
  for (let i = 0; i < len; i++) data[i] = buf[offset + 4 + i] ^ mask[i % 4];
  return { payload: data.toString('utf8'), rest: buf.subarray(offset + 4 + len) };
}

// ── Public API ────────────────────────────────────────────────────────────

export interface BridgeEvent {
  /** Event type from JSON-RPC method (telemetry, telemetry_batch, custom). */
  type: string;
  /** Raw event params from the bridge. */
  data: Record<string, unknown>;
  /** ISO timestamp when proxy received it. */
  received_at: string;
}

export type BridgeEventHandler = (evt: BridgeEvent) => void;

let _server: ReturnType<typeof createHttpServer> | null = null;
let _connectedSocket: Socket | null = null;
const _handlers = new Set<BridgeEventHandler>();

export function onBridgeEvent(handler: BridgeEventHandler): () => void {
  _handlers.add(handler);
  return () => _handlers.delete(handler);
}

export function isBridgeConnected(): boolean {
  return _connectedSocket != null && !_connectedSocket.destroyed;
}

/**
 * Start listening for bridge connections. Returns silently if already
 * running. Idempotent — safe to call multiple times.
 */
export function startBridgeEventServer(port = 8765): void {
  if (_server) return;
  _server = createHttpServer();
  _server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') { socket.destroy(); return; }
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '', '',
    ].join('\r\n');
    socket.write(responseHeaders);
    _connectedSocket = socket;
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const decoded = decodeFrame(buf);
        if (!decoded) break;
        buf = Buffer.from(decoded.rest);
        try {
          const msg = JSON.parse(decoded.payload) as { method?: string; params?: Record<string, unknown> };
          if (msg.method && msg.params) {
            const evt: BridgeEvent = {
              type: msg.method,
              data: msg.params,
              received_at: new Date().toISOString(),
            };
            for (const h of _handlers) {
              try { h(evt); } catch { /* never let one handler kill the stream */ }
            }
          }
        } catch { /* malformed frame — ignore */ }
      }
    });
    socket.on('close', () => { if (_connectedSocket === socket) _connectedSocket = null; });
    socket.on('error', () => { if (_connectedSocket === socket) _connectedSocket = null; });
  });
  _server.on('error', (e) => {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      // Another proxy or stale process owns the port — silently disable. The
      // proxy still works; just no event push (chains fall back to polling).
      _server = null;
      return;
    }
  });
  _server.listen(port, '127.0.0.1');
}

/** Stop the server. Idempotent. */
export function stopBridgeEventServer(): void {
  try { _connectedSocket?.destroy(); } catch { /* skip */ }
  _connectedSocket = null;
  try { _server?.close(); } catch { /* skip */ }
  _server = null;
}
