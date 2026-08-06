// Wire protocol shared by the browser extension and the native messaging host.
// Environment-agnostic — must not import anything from node or the browser,
// because both sides bundle this file.

export const HOST_NAME = 'com.tolaria.clipper';

/** Bumped when the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Oldest client protocol the host still accepts. */
export const PROTOCOL_MIN = 1;

/**
 * Chrome caps host → extension messages at 1 MB. Extension → host is
 * effectively unbounded, so only responses need budgeting.
 */
export const MAX_RESPONSE_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface HostRequest<Op extends HostOp = HostOp, P = unknown> {
	v: typeof PROTOCOL_VERSION;
	id: string;
	op: Op;
	params: P;
}

export type HostResponse<R = unknown> =
	| { v: typeof PROTOCOL_VERSION; id: string; ok: true; result: R }
	| { v: typeof PROTOCOL_VERSION; id: string; ok: false; error: HostError };

export type HostErrorCode =
	// Synthesised client-side; the host never sends these.
	| 'E_NOT_INSTALLED'
	| 'E_TIMEOUT'
	// Protocol
	| 'E_BAD_REQUEST'
	| 'E_UNKNOWN_OP'
	| 'E_PROTOCOL_VERSION'
	// Vaults
	| 'E_NO_VAULTS'
	| 'E_VAULT_NOT_FOUND'
	| 'E_VAULT_UNMOUNTED'
	// Filesystem
	| 'E_PATH_ESCAPE'
	| 'E_EXISTS'
	| 'E_NOT_FOUND'
	| 'E_IO'
	| 'E_PERM'
	| 'E_TOO_LARGE'
	| 'E_INTERNAL';

export interface HostError {
	code: HostErrorCode;
	/** Human-readable English message, for logs. */
	message: string;
	/** Key in the locale message files, when a translated message exists. */
	i18nKey?: string;
	detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type HostOp =
	| 'ping'
	| 'listVaults'
	| 'resolveNote'
	| 'saveNote'
	| 'openNote'
	| 'doctor';

/** How saveNote treats an existing file at the target path. */
export type SaveMode = 'create' | 'overwrite' | 'append' | 'prepend' | 'skipIfExists';

// --- ping -------------------------------------------------------------------

export interface PingParams {
	/** Probe the Tolaria tool bridge on 127.0.0.1:9710. Adds latency; opt in. */
	probeBridge?: boolean;
}

export interface PingResult {
	hostVersion: string;
	protocolVersion: number;
	protocolMin: number;
	platform: NodeJS.Platform | string;
	nodeVersion: string;
	vaultsJsonPath: string | null;
	vaultCount: number;
	bridgeReachable: boolean | null;
}

// --- listVaults -------------------------------------------------------------

export interface VaultInfo {
	/** Stable across renames: sha256 of the realpath, truncated. */
	id: string;
	label: string;
	alias: string | null;
	/** Absolute, realpath-resolved. */
	path: string;
	/** Vault slug used in tolaria:// deep links. */
	slug: string;
	/** As declared in vaults.json. */
	mounted: boolean;
	/** Whether the folder is actually present — mounted-but-missing is a real case. */
	exists: boolean;
	/** Matches vaults.json active_vault. */
	isActive: boolean;
}

export interface ListVaultsResult {
	vaults: VaultInfo[];
	source: 'vaults.json' | 'env';
	vaultsJsonPath: string | null;
}

// --- resolveNote ------------------------------------------------------------

export interface ResolveNoteParams {
	vaultId: string;
	/** Vault-relative folder. '' means the vault root. */
	path: string;
	/** Note name without the .md extension. */
	name: string;
	mode: SaveMode;
}

export interface ResolveNoteResult {
	/** Vault-relative path saveNote would actually write to. */
	targetPath: string;
	absolutePath: string;
	/** Whether the naive (pre-dedupe) target already exists. */
	exists: boolean;
	/** Whether dedupe changed the target. */
	deduped: boolean;
}

// --- saveNote ---------------------------------------------------------------

export interface SaveNoteParams {
	vaultId: string;
	path: string;
	name: string;
	/** Full markdown, frontmatter included. */
	content: string;
	mode: SaveMode;
	/** Separator inserted between existing and new content for append/prepend. */
	separator?: string;
	/** Navigate to the note's deep link after writing. The only focus-stealing path. */
	openAfter?: boolean;
	/** Best-effort refresh_vault over the Tolaria tool bridge. Off by default. */
	refreshBridge?: boolean;
}

export interface SaveNoteResult {
	path: string;
	absolutePath: string;
	/** False for append/prepend onto an existing note. */
	created: boolean;
	deduped: boolean;
	mode: SaveMode;
	bytes: number;
	deepLink: string;
	/** null when no refresh was attempted. */
	bridgeRefreshed: boolean | null;
}

// --- openNote ---------------------------------------------------------------

export interface OpenNoteParams {
	vaultId: string;
	path: string;
}

export interface OpenNoteResult {
	deepLink: string;
	launched: boolean;
}

// --- doctor -----------------------------------------------------------------

export interface DoctorResult {
	hostVersion: string;
	hostPath: string;
	nodePath: string;
	platform: string;
	manifests: Array<{
		browser: string;
		path: string;
		present: boolean;
		writable: boolean;
		allowedOrigins: string[];
	}>;
	vaultsJson: {
		path: string | null;
		present: boolean;
		readable: boolean;
		vaultCount: number;
	};
	vaults: Array<{
		label: string;
		path: string;
		exists: boolean;
		writable: boolean;
	}>;
	bridge: { port: number; reachable: boolean };
	warnings: string[];
}

// ---------------------------------------------------------------------------
// Op → params/result mapping, so callHost() can be typed at call sites
// ---------------------------------------------------------------------------

export interface HostOpMap {
	ping: { params: PingParams; result: PingResult };
	listVaults: { params: Record<string, never>; result: ListVaultsResult };
	resolveNote: { params: ResolveNoteParams; result: ResolveNoteResult };
	saveNote: { params: SaveNoteParams; result: SaveNoteResult };
	openNote: { params: OpenNoteParams; result: OpenNoteResult };
	doctor: { params: Record<string, never>; result: DoctorResult };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeError(
	code: HostErrorCode,
	message: string,
	extra?: { i18nKey?: string; detail?: Record<string, unknown> }
): HostError {
	return { code, message, ...extra };
}

/** Maps a host error code to a locale key, for user-facing messages. */
export const HOST_ERROR_I18N: Record<HostErrorCode, string> = {
	E_NOT_INSTALLED: 'hostNotInstalled',
	E_TIMEOUT: 'hostTimeout',
	E_BAD_REQUEST: 'hostBadRequest',
	E_UNKNOWN_OP: 'hostBadRequest',
	E_PROTOCOL_VERSION: 'hostVersionMismatch',
	E_NO_VAULTS: 'hostNoVaults',
	E_VAULT_NOT_FOUND: 'hostVaultNotFound',
	E_VAULT_UNMOUNTED: 'hostVaultUnmounted',
	E_PATH_ESCAPE: 'hostPathEscape',
	E_EXISTS: 'hostNoteExists',
	E_NOT_FOUND: 'hostNoteNotFound',
	E_IO: 'hostWriteFailed',
	E_PERM: 'hostPermissionDenied',
	E_TOO_LARGE: 'hostTooLarge',
	E_INTERNAL: 'hostWriteFailed',
};
