// Extension-side client for the Tolaria native messaging host.
//
// Every call funnels through the background script, because sendNativeMessage
// is only reliable there — the popup can be torn down mid-flight.

import browser from './browser-polyfill';
import { debugLog } from './debug';
import {
	HOST_ERROR_I18N,
	HOST_NAME,
	HostError,
	HostOpMap,
	HostResponse,
	PROTOCOL_VERSION,
	PingResult,
	makeError,
} from '../native-host/protocol';

/** How long a probe result stays trusted, so we don't spawn a process per popup. */
const PROBE_TTL_MS = 60_000;
const PROBE_CACHE_KEY = 'tolariaHostProbe';

export class NativeHostError extends Error {
	constructor(public readonly hostError: HostError) {
		super(hostError.message);
		this.name = 'NativeHostError';
	}

	get code(): HostError['code'] {
		return this.hostError.code;
	}

	/** Locale key for a user-facing message. */
	get i18nKey(): string {
		return this.hostError.i18nKey ?? HOST_ERROR_I18N[this.hostError.code] ?? 'hostWriteFailed';
	}

	get isNotInstalled(): boolean {
		return this.hostError.code === 'E_NOT_INSTALLED';
	}
}

function randomId(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Chrome and Firefox word "no such host" differently, and neither exposes a
 * code, so the message is the only signal available.
 */
function isHostMissing(message: string): boolean {
	const normalized = message.toLowerCase();
	return normalized.includes('not found')
		|| normalized.includes('no such native application')
		|| normalized.includes('specified native messaging host')
		|| normalized.includes('host not found');
}

/**
 * Send one request to the host. Only valid in the background script; other
 * contexts should go through callHost().
 */
export async function sendToHost<Op extends keyof HostOpMap>(
	op: Op,
	params: HostOpMap[Op]['params']
): Promise<HostOpMap[Op]['result']> {
	if (typeof browser.runtime.sendNativeMessage !== 'function') {
		throw new NativeHostError(
			makeError('E_NOT_INSTALLED', 'Native messaging is unavailable in this browser')
		);
	}

	let response: HostResponse<HostOpMap[Op]['result']>;
	try {
		response = await browser.runtime.sendNativeMessage(HOST_NAME, {
			v: PROTOCOL_VERSION,
			id: randomId(),
			op,
			params,
		}) as HostResponse<HostOpMap[Op]['result']>;
	} catch (error) {
		const message = (error as Error)?.message ?? String(error);
		throw new NativeHostError(
			isHostMissing(message)
				? makeError('E_NOT_INSTALLED', message)
				: makeError('E_INTERNAL', message)
		);
	}

	if (!response) {
		throw new NativeHostError(makeError('E_INTERNAL', 'Empty response from the native host'));
	}
	if (!response.ok) {
		throw new NativeHostError(response.error);
	}

	return response.result;
}

/**
 * Call the host from any extension context. Popup, side panel and settings all
 * route through the background script.
 */
export async function callHost<Op extends keyof HostOpMap>(
	op: Op,
	params: HostOpMap[Op]['params']
): Promise<HostOpMap[Op]['result']> {
	const response = await browser.runtime.sendMessage({
		action: 'nativeHostCall',
		op,
		params,
	}) as { ok: boolean; result?: HostOpMap[Op]['result']; error?: HostError } | undefined;

	if (!response) {
		throw new NativeHostError(makeError('E_INTERNAL', 'No response from the background script'));
	}
	if (!response.ok) {
		throw new NativeHostError(response.error ?? makeError('E_INTERNAL', 'Unknown native host error'));
	}

	return response.result as HostOpMap[Op]['result'];
}

// ---------------------------------------------------------------------------
// Install probe
// ---------------------------------------------------------------------------

export interface HostStatus {
	installed: boolean;
	info: PingResult | null;
	error: HostError | null;
	checkedAt: number;
}

/**
 * Whether the host is reachable. Cached briefly so opening the popup doesn't
 * spawn a process every time; invalidate after a failed save so "install it,
 * then retry" works immediately.
 */
export async function getHostStatus(forceRefresh = false): Promise<HostStatus> {
	if (!forceRefresh) {
		const cached = await readProbeCache();
		if (cached && Date.now() - cached.checkedAt < PROBE_TTL_MS) return cached;
	}

	let status: HostStatus;
	try {
		const info = await callHost('ping', {});
		status = { installed: true, info, error: null, checkedAt: Date.now() };
	} catch (error) {
		const hostError = error instanceof NativeHostError
			? error.hostError
			: makeError('E_INTERNAL', (error as Error)?.message ?? String(error));
		status = { installed: false, info: null, error: hostError, checkedAt: Date.now() };
		debugLog('NativeHost', 'Probe failed', hostError);
	}

	await writeProbeCache(status);
	return status;
}

export async function invalidateHostStatus(): Promise<void> {
	try {
		await browser.storage.local.remove(PROBE_CACHE_KEY);
	} catch {
		// Cache is an optimisation; losing it is harmless.
	}
}

async function readProbeCache(): Promise<HostStatus | null> {
	try {
		const stored = await browser.storage.local.get(PROBE_CACHE_KEY);
		return (stored?.[PROBE_CACHE_KEY] as HostStatus) ?? null;
	} catch {
		return null;
	}
}

async function writeProbeCache(status: HostStatus): Promise<void> {
	try {
		await browser.storage.local.set({ [PROBE_CACHE_KEY]: status });
	} catch {
		// Ignore quota or context errors — the probe simply re-runs next time.
	}
}
