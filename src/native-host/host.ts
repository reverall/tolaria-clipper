// Native messaging host entrypoint.
//
// Framing (Chrome/Firefox): a 4-byte native-endian uint32 length prefix
// followed by UTF-8 JSON, in both directions.
//
// Everything is written to the vault through fs-ops, so path containment and
// atomicity apply to every op without each handler having to remember.

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import { isBridgeReachable, refreshVault } from './bridge';
import { HOST_VERSION, runDoctor } from './doctor';
import { HostFsError, resolveTarget, saveNote } from './fs-ops';
import {
	DoctorResult,
	HostError,
	HostRequest,
	HostResponse,
	ListVaultsResult,
	MAX_RESPONSE_BYTES,
	OpenNoteParams,
	OpenNoteResult,
	PROTOCOL_MIN,
	PROTOCOL_VERSION,
	PingParams,
	PingResult,
	ResolveNoteParams,
	ResolveNoteResult,
	SaveMode,
	SaveNoteParams,
	SaveNoteResult,
	makeError,
} from './protocol';
import { VaultInfo } from './protocol';
import { findVault, loadVaults, vaultsJsonPath } from './vaults';

const VALID_MODES: SaveMode[] = ['create', 'overwrite', 'append', 'prepend', 'skipIfExists'];

// ---------------------------------------------------------------------------
// Vault helpers
// ---------------------------------------------------------------------------

class HostOpError extends Error {
	constructor(public readonly error: HostError) {
		super(error.message);
		this.name = 'HostOpError';
	}
}

function fail(code: HostError['code'], message: string, detail?: Record<string, unknown>): never {
	throw new HostOpError(makeError(code, message, detail ? { detail } : undefined));
}

/**
 * Resolve the vault a request refers to. The host never accepts a filesystem
 * path from the browser — only a reference into the registry Tolaria owns.
 */
function requireVault(ref: unknown): VaultInfo {
	const { vaults } = loadVaults();
	if (vaults.length === 0) {
		fail('E_NO_VAULTS', 'No Tolaria vaults found. Open a vault in Tolaria first.');
	}

	const vault = findVault(vaults, typeof ref === 'string' ? ref : '');
	if (!vault) {
		fail('E_VAULT_NOT_FOUND', `Unknown vault: ${String(ref)}`, { ref });
	}
	if (!vault.exists) {
		fail('E_VAULT_UNMOUNTED', `Vault folder is unavailable: ${vault.path}`, { path: vault.path });
	}
	return vault;
}

function deepLink(vault: VaultInfo, relativePath: string): string {
	const encoded = relativePath
		.split(/[\\/]/)
		.filter(Boolean)
		.map(encodeURIComponent)
		.join('/');
	return `tolaria://${vault.slug}/${encoded}`;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string') fail('E_BAD_REQUEST', `Missing or invalid "${field}"`);
	return value;
}

function requireMode(value: unknown): SaveMode {
	if (typeof value !== 'string' || !VALID_MODES.includes(value as SaveMode)) {
		fail('E_BAD_REQUEST', `Invalid save mode: ${String(value)}`);
	}
	return value as SaveMode;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function opPing(params: PingParams): Promise<PingResult> {
	const { vaults, vaultsJsonPath: jsonPath } = loadVaults();
	return {
		hostVersion: HOST_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		protocolMin: PROTOCOL_MIN,
		platform: platform(),
		nodeVersion: process.version,
		vaultsJsonPath: jsonPath ?? vaultsJsonPath(),
		vaultCount: vaults.length,
		bridgeReachable: params?.probeBridge ? await isBridgeReachable() : null,
	};
}

function opListVaults(): ListVaultsResult {
	const { vaults, source, vaultsJsonPath: jsonPath } = loadVaults();
	return { vaults, source, vaultsJsonPath: jsonPath };
}

function opResolveNote(params: ResolveNoteParams): ResolveNoteResult {
	const vault = requireVault(params?.vaultId);
	const target = resolveTarget(
		vault.path,
		typeof params.path === 'string' ? params.path : '',
		requireString(params?.name, 'name'),
		requireMode(params?.mode)
	);

	return {
		targetPath: target.relativePath,
		absolutePath: target.absolutePath,
		exists: target.existed,
		deduped: target.deduped,
	};
}

async function opSaveNote(params: SaveNoteParams): Promise<SaveNoteResult> {
	const vault = requireVault(params?.vaultId);
	const content = requireString(params?.content, 'content');
	const name = requireString(params?.name, 'name');
	const mode = requireMode(params?.mode);
	const folder = typeof params.path === 'string' ? params.path : '';

	const result = saveNote(
		vault.path,
		folder,
		name,
		content,
		mode,
		typeof params.separator === 'string' ? params.separator : '\n\n'
	);

	const link = deepLink(vault, result.relativePath);

	// Fire-and-forget: a refresh failure must never turn a successful write into
	// a failed clip.
	let bridgeRefreshed: boolean | null = null;
	if (params.refreshBridge) {
		bridgeRefreshed = await refreshVault(vault.path).catch(() => false);
	}

	if (params.openAfter) {
		launchDeepLink(link);
	}

	return {
		path: result.relativePath,
		absolutePath: result.absolutePath,
		created: result.created,
		deduped: result.deduped,
		mode,
		bytes: result.bytes,
		deepLink: link,
		bridgeRefreshed,
	};
}

function opOpenNote(params: OpenNoteParams): OpenNoteResult {
	const vault = requireVault(params?.vaultId);
	const link = deepLink(vault, requireString(params?.path, 'path'));
	return { deepLink: link, launched: launchDeepLink(link) };
}

/**
 * The single place in the host that can bring Tolaria to the front. Keeping it
 * to one named function is what makes "clipping never steals focus" auditable.
 */
function launchDeepLink(link: string): boolean {
	try {
		const plat = platform();
		const [command, args] = plat === 'darwin'
			? ['open', [link]]
			: plat === 'win32'
				? ['cmd', ['/c', 'start', '', link]]
				: ['xdg-open', [link]];

		spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
		return true;
	} catch {
		return false;
	}
}

async function dispatch(op: string, params: unknown): Promise<unknown> {
	switch (op) {
		case 'ping': return opPing((params ?? {}) as PingParams);
		case 'listVaults': return opListVaults();
		case 'resolveNote': return opResolveNote(params as ResolveNoteParams);
		case 'saveNote': return opSaveNote(params as SaveNoteParams);
		case 'openNote': return opOpenNote(params as OpenNoteParams);
		case 'doctor': return runDoctor() as Promise<DoctorResult>;
		default:
			fail('E_UNKNOWN_OP', `Unknown operation: ${op}`);
	}
}

function toHostError(error: unknown): HostError {
	if (error instanceof HostOpError) return error.error;
	if (error instanceof HostFsError) return makeError(error.code, error.message);
	return makeError('E_INTERNAL', (error as Error)?.message ?? String(error));
}

async function handleRequest(request: HostRequest): Promise<HostResponse> {
	const id = typeof request?.id === 'string' ? request.id : '';

	if (typeof request?.v === 'number' && request.v < PROTOCOL_MIN) {
		return {
			v: PROTOCOL_VERSION,
			id,
			ok: false,
			error: makeError('E_PROTOCOL_VERSION', `Client protocol ${request.v} is too old`),
		};
	}

	try {
		return { v: PROTOCOL_VERSION, id, ok: true, result: await dispatch(request.op, request.params) };
	} catch (error) {
		return { v: PROTOCOL_VERSION, id, ok: false, error: toHostError(error) };
	}
}

// ---------------------------------------------------------------------------
// stdio framing
// ---------------------------------------------------------------------------

function writeMessage(message: unknown): void {
	let payload = Buffer.from(JSON.stringify(message), 'utf8');

	if (payload.length > MAX_RESPONSE_BYTES) {
		// Better a typed error than a message the browser silently drops.
		const response = message as HostResponse;
		payload = Buffer.from(JSON.stringify({
			v: PROTOCOL_VERSION,
			id: response?.id ?? '',
			ok: false,
			error: makeError('E_TOO_LARGE', 'Response exceeds the 1 MB native messaging limit'),
		}), 'utf8');
	}

	const header = Buffer.alloc(4);
	header.writeUInt32LE(payload.length, 0);
	process.stdout.write(Buffer.concat([header, payload]));
}

function main(): void {
	let buffer = Buffer.alloc(0);
	// Responses are written in arrival order; each request is independent.
	let queue: Promise<void> = Promise.resolve();

	process.stdin.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);

		for (;;) {
			if (buffer.length < 4) return;
			const length = buffer.readUInt32LE(0);
			if (buffer.length < 4 + length) return;

			const body = buffer.subarray(4, 4 + length).toString('utf8');
			buffer = buffer.subarray(4 + length);

			let request: HostRequest;
			try {
				request = JSON.parse(body) as HostRequest;
			} catch (error) {
				writeMessage({
					v: PROTOCOL_VERSION,
					id: '',
					ok: false,
					error: makeError('E_BAD_REQUEST', `Malformed JSON: ${(error as Error).message}`),
				});
				continue;
			}

			queue = queue.then(() => handleRequest(request).then(writeMessage));
		}
	});

	// The browser closing the port is the normal way this process ends.
	process.stdin.on('end', () => process.exit(0));
	process.stdin.on('error', () => process.exit(0));
}

main();
