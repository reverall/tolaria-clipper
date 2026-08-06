// Native messaging manifest locations per browser.
//
// Chrome + Arc are the default targets. The other Chromium entries are listed
// so --browsers=<id> can reach them, without writing into the support directory
// of every browser that happens to be installed. Firefox and Safari are out of
// scope (Safari needs App Sandbox security-scoped bookmarks), but Firefox's
// layout is recorded because it differs in both directory and manifest key.

import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export interface BrowserTarget {
	id: string;
	name: string;
	/** Firefox uses allowed_extensions with a gecko id instead of origins. */
	family: 'chromium' | 'gecko';
	/** Directory holding native messaging manifests, or null on this platform. */
	manifestDir: string | null;
	/** Whether this browser is written to by default (others need --browsers=<id>). */
	supported: boolean;
}

/**
 * Browsers written to by default. Others are reachable with --browsers=<id>,
 * but we do not scatter files into the support directories of apps the user
 * may merely have installed.
 */
const DEFAULT_BROWSERS = new Set(['chrome', 'arc']);

function darwinTargets(home: string): BrowserTarget[] {
	const support = join(home, 'Library', 'Application Support');
	const chromium = (id: string, name: string, ...segments: string[]): BrowserTarget => ({
		id,
		name,
		family: 'chromium',
		manifestDir: join(support, ...segments, 'NativeMessagingHosts'),
		supported: DEFAULT_BROWSERS.has(id),
	});

	return [
		chromium('chrome', 'Google Chrome', 'Google', 'Chrome'),
		// Arc nests its profile under "User Data" — the one path quirk that
		// silently no-ops if you assume the standard Chromium layout.
		chromium('arc', 'Arc', 'Arc', 'User Data'),
		chromium('brave', 'Brave', 'BraveSoftware', 'Brave-Browser'),
		chromium('edge', 'Microsoft Edge', 'Microsoft Edge'),
		chromium('chromium', 'Chromium', 'Chromium'),
		chromium('vivaldi', 'Vivaldi', 'Vivaldi'),
		chromium('chrome-beta', 'Google Chrome Beta', 'Google', 'Chrome Beta'),
		chromium('chrome-canary', 'Google Chrome Canary', 'Google', 'Chrome Canary'),
		{
			id: 'firefox',
			name: 'Firefox',
			family: 'gecko',
			manifestDir: join(support, 'Mozilla', 'NativeMessagingHosts'),
			supported: false,
		},
	];
}

function linuxTargets(home: string): BrowserTarget[] {
	const config = join(home, '.config');
	const chromium = (id: string, name: string, ...segments: string[]): BrowserTarget => ({
		id,
		name,
		family: 'chromium',
		manifestDir: join(config, ...segments, 'NativeMessagingHosts'),
		supported: DEFAULT_BROWSERS.has(id),
	});

	return [
		chromium('chrome', 'Google Chrome', 'google-chrome'),
		chromium('chromium', 'Chromium', 'chromium'),
		chromium('brave', 'Brave', 'BraveSoftware', 'Brave-Browser'),
		chromium('edge', 'Microsoft Edge', 'microsoft-edge'),
		chromium('vivaldi', 'Vivaldi', 'vivaldi'),
		{
			id: 'firefox',
			name: 'Firefox',
			family: 'gecko',
			// Lowercase and hyphenated, unlike every Chromium directory.
			manifestDir: join(home, '.mozilla', 'native-messaging-hosts'),
			supported: false,
		},
	];
}

/**
 * Windows discovers hosts through HKCU, not a fixed directory, so the manifest
 * itself can live anywhere. Registry writes are the installer's job.
 */
function win32Targets(home: string): BrowserTarget[] {
	const base = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
	const dir = join(base, 'tolaria-clipper', 'host');

	return [
		{ id: 'chrome', name: 'Google Chrome', family: 'chromium', manifestDir: dir, supported: true },
		{ id: 'edge', name: 'Microsoft Edge', family: 'chromium', manifestDir: dir, supported: false },
		{ id: 'brave', name: 'Brave', family: 'chromium', manifestDir: dir, supported: false },
	];
}

export const WINDOWS_REGISTRY_KEYS: Record<string, string> = {
	chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
	edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
	brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
};

export function browserTargets(
	plat: string = platform(),
	home: string = homedir()
): BrowserTarget[] {
	if (plat === 'darwin') return darwinTargets(home);
	if (plat === 'win32') return win32Targets(home);
	return linuxTargets(home);
}

/** Root for everything installed outside the repo. */
function installRoot(plat: string, home: string): string {
	if (plat === 'win32') {
		const base = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
		return join(base, 'tolaria-clipper');
	}
	return join(home, '.tolaria-clipper');
}

/** Where the host binary and its shim live. */
export function hostInstallDir(plat: string = platform(), home: string = homedir()): string {
	return join(installRoot(plat, home), 'host');
}

/**
 * Stable home for the unpacked extension.
 *
 * Chrome does not copy an unpacked extension — it stores the path and re-reads
 * it on every launch. Pointing it at a build directory inside a checkout means
 * the extension breaks as soon as that directory is cleaned, moved or deleted.
 */
export function extensionInstallDir(plat: string = platform(), home: string = homedir()): string {
	return join(installRoot(plat, home), 'extension');
}

/**
 * The launcher the manifest points at.
 *
 * A shim, not a shebang: browsers start native hosts with a minimal PATH that
 * excludes Homebrew, nvm and ~/.local/bin, so `#!/usr/bin/env node` fails
 * silently on most developer machines. The installer bakes in an absolute
 * interpreter path instead.
 */
export function hostLauncherPath(plat: string = platform(), home: string = homedir()): string {
	const dir = hostInstallDir(plat, home);
	return join(dir, plat === 'win32' ? 'run.cmd' : 'run.sh');
}
