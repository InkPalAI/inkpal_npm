import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function acceptKey(clientKey: string): string {
    return createHash('sha1').update(clientKey + WS_GUID).digest('base64');
}
function decodeFrame(buf: Buffer): {
    payload: string;
    rest: Buffer<ArrayBufferLike>;
} | null {
    if (buf.length < 2)
        return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    if (!fin)
        return null;
    if (opcode !== 0x1)
        return null;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
        if (buf.length < 4)
            return null;
        len = buf.readUInt16BE(2);
        offset = 4;
    }
    else if (len === 127) {
        if (buf.length < 10)
            return null;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
    }
    if (!masked)
        return null;
    if (buf.length < offset + 4 + len)
        return null;
    const mask = buf.subarray(offset, offset + 4);
    const data = Buffer.alloc(len);
    for (let i = 0; i < len; i++)
        data[i] = buf[offset + 4 + i] ^ mask[i % 4];
    return { payload: data.toString('utf8'), rest: buf.subarray(offset + 4 + len) };
}
export interface BridgeEvent {
    type: string;
    data: Record<string, unknown>;
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
export function startBridgeEventServer(port = 8765): void {
    if (_server)
        return;
    _server = createHttpServer();
    _server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
        const key = req.headers['sec-websocket-key'];
        if (typeof key !== 'string') {
            socket.destroy();
            return;
        }
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
                if (!decoded)
                    break;
                buf = Buffer.from(decoded.rest);
                try {
                    const msg = JSON.parse(decoded.payload) as {
                        method?: string;
                        params?: Record<string, unknown>;
                    };
                    if (msg.method && msg.params) {
                        const evt: BridgeEvent = {
                            type: msg.method,
                            data: msg.params,
                            received_at: new Date().toISOString(),
                        };
                        for (const h of _handlers) {
                            try {
                                h(evt);
                            }
                            catch { }
                        }
                    }
                }
                catch { }
            }
        });
        socket.on('close', () => { if (_connectedSocket === socket)
            _connectedSocket = null; });
        socket.on('error', () => { if (_connectedSocket === socket)
            _connectedSocket = null; });
    });
    _server.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
            _server = null;
            return;
        }
    });
    _server.listen(port, '127.0.0.1');
}
export function stopBridgeEventServer(): void {
    try {
        _connectedSocket?.destroy();
    }
    catch { }
    _connectedSocket = null;
    try {
        _server?.close();
    }
    catch { }
    _server = null;
}
