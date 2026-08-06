// Optional best-effort nudge to Tolaria's tool bridge.
//
// Tolaria watches the filesystem, so a written note is picked up on its own and
// this is redundant in the normal case. It exists only for the rare event a
// watcher misses (coalesced fsevents on synced or network volumes), and it is
// off by default.
//
// The bridge rejects any client sending an Origin header, which is why the
// extension can never do this itself — but a plain Node socket sends none.
//
// Minimal RFC 6455 client: pulling in a websocket dependency would bloat the
// host bundle for a feature that is disabled by default.

import { createHash, randomBytes } from 'node:crypto';
import { Socket, connect } from 'node:net';

export const BRIDGE_PORT = 9710;
const BRIDGE_HOST = '127.0.0.1';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Resolves true if the bridge accepted the call, false in every other case. */
export function refreshVault(
	vaultPath: string,
	timeoutMs = 250,
	port = BRIDGE_PORT
): Promise<boolean> {
	return new Promise(resolve => {
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			try { socket.destroy(); } catch { /* already gone */ }
			resolve(value);
		};

		const key = randomBytes(16).toString('base64');
		const expectedAccept = createHash('sha1').update(key + GUID).digest('base64');

		const socket: Socket = connect({ host: BRIDGE_HOST, port });
		socket.setTimeout(timeoutMs);
		socket.on('timeout', () => finish(false));
		socket.on('error', () => finish(false));
		socket.on('close', () => finish(false));

		socket.on('connect', () => {
			socket.write(
				`GET / HTTP/1.1\r\n`
				+ `Host: ${BRIDGE_HOST}:${port}\r\n`
				+ `Upgrade: websocket\r\n`
				+ `Connection: Upgrade\r\n`
				+ `Sec-WebSocket-Key: ${key}\r\n`
				+ `Sec-WebSocket-Version: 13\r\n`
				+ `\r\n`
			);
		});

		let buffer = Buffer.alloc(0);
		let handshakeDone = false;

		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);

			if (!handshakeDone) {
				const headerEnd = buffer.indexOf('\r\n\r\n');
				if (headerEnd === -1) return;

				const headers = buffer.subarray(0, headerEnd).toString('latin1');
				if (!/^HTTP\/1\.1 101/i.test(headers) || !headers.includes(expectedAccept)) {
					finish(false);
					return;
				}

				handshakeDone = true;
				buffer = buffer.subarray(headerEnd + 4);

				const payload = JSON.stringify({
					id: randomBytes(8).toString('hex'),
					tool: 'refresh_vault',
					args: { vaultPath },
				});
				socket.write(encodeTextFrame(payload));
			}

			// Any well-formed frame back means the bridge processed the call.
			if (handshakeDone && buffer.length >= 2) finish(true);
		});
	});
}

/** Single masked text frame. Clients must mask; servers must not. */
function encodeTextFrame(payload: string): Buffer {
	const data = Buffer.from(payload, 'utf8');
	const mask = randomBytes(4);

	let header: Buffer;
	if (data.length < 126) {
		header = Buffer.from([0x81, 0x80 | data.length]);
	} else if (data.length < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x81;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(data.length, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x81;
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(data.length), 2);
	}

	const masked = Buffer.allocUnsafe(data.length);
	for (let i = 0; i < data.length; i++) {
		masked[i] = data[i] ^ mask[i % 4];
	}

	return Buffer.concat([header, mask, masked]);
}

/** Cheap liveness probe used by ping and doctor. */
export function isBridgeReachable(timeoutMs = 200, port = BRIDGE_PORT): Promise<boolean> {
	return new Promise(resolve => {
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			try { socket.destroy(); } catch { /* already gone */ }
			resolve(value);
		};

		const socket = connect({ host: BRIDGE_HOST, port });
		socket.setTimeout(timeoutMs);
		socket.on('connect', () => finish(true));
		socket.on('timeout', () => finish(false));
		socket.on('error', () => finish(false));
	});
}
