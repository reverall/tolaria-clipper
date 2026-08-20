// Installs and removes the native messaging host.
//
// Reached from a checkout through `node dist/cli.cjs install-host`, and from
// the downloadable archive through `node connect.cjs`.

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { BrowserTarget, WINDOWS_REGISTRY_KEYS, browserTargets, extensionInstallDir, hostInstallDir, hostLauncherPath } from './browsers';
import { HOST_NAME } from './protocol';

/** Node build outputs that share dist/ with the extension but are not part of it. */
const NODE_ARTIFACTS = new Set(['cli.cjs', 'api.mjs', 'native-host.cjs', 'connect.cjs']);

/**
 * Extension IDs allowed to talk to the host.
 *
 * Pinned by the "key" field in src/manifest.chrome.json — without it Chrome
 * derives an unpacked extension's ID from its load directory, which differs per
 * machine and cannot be baked into a manifest. Pinning it is also what lets the
 * extension be moved to a stable directory without breaking the host. Regenerate
 * both together with `node scripts/gen-extension-key.mjs --write`.
 */
export const PINNED_EXTENSION_IDS = [
	'ogohmgmbmmkokgjcbhjdhnkmbejmhkhn',
];

export interface InstallOptions {
	browsers?: string[] | null;
	extensionIds?: string[];
	dryRun?: boolean;
	/** Write manifests even for browsers whose profile directory is absent. */
	force?: boolean;
	/** Absolute path to the built host bundle; defaults to the packaged one. */
	hostBundle?: string;
	/** Directory holding the built extension; defaults to ./dist. */
	from?: string;
	log?: (line: string) => void;
}

export interface InstallReport {
	launcherPath: string;
	installDir: string;
	extensionIds: string[];
	installed: Array<{ browser: string; path: string }>;
}

export function parseInstallArgs(argv: string[]): InstallOptions {
	const options: InstallOptions = { browsers: null, extensionIds: [], dryRun: false, force: false };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--force') options.force = true;
		else if (arg.startsWith('--browsers=')) {
			options.browsers = arg.slice('--browsers='.length).split(',').map(s => s.trim()).filter(Boolean);
		} else if (arg === '--extension-id') {
			const value = argv[++i];
			if (value) options.extensionIds?.push(value);
		} else if (arg.startsWith('--extension-id=')) {
			options.extensionIds?.push(arg.slice('--extension-id='.length));
		} else if (arg === '--from') {
			const value = argv[++i];
			if (value) options.from = resolve(value);
		} else if (arg.startsWith('--from=')) {
			options.from = resolve(arg.slice('--from='.length));
		}
	}

	return options;
}

function resolveHostBundle(explicit?: string): string {
	if (explicit) {
		if (!existsSync(explicit)) throw new Error(`Host bundle not found: ${explicit}`);
		return explicit;
	}

	// __dirname is dist/ once bundled; the repo layout is the dev fallback.
	const here = typeof __dirname === 'string' ? __dirname : process.cwd();
	const candidates = [
		join(here, 'native-host.cjs'),
		resolve(here, '..', 'dist', 'native-host.cjs'),
		resolve(process.cwd(), 'dist', 'native-host.cjs'),
	];

	const found = candidates.find(existsSync);
	if (!found) {
		throw new Error(
			`Host bundle not found. Run "npm run build:host" first.\nLooked in:\n  ${candidates.join('\n  ')}`
		);
	}
	return found;
}

/**
 * Launcher with an absolute interpreter path.
 *
 * Browsers spawn native hosts with a minimal PATH (roughly /usr/bin:/bin) that
 * excludes Homebrew, nvm and ~/.local/bin, so `#!/usr/bin/env node` fails
 * silently on most developer machines. Bake in process.execPath instead.
 */
function writeLauncher(installDir: string, plat: string, dryRun: boolean): string {
	const hostPath = join(installDir, 'host.cjs');
	const launcherPath = hostLauncherPath(plat, homedir());

	const contents = plat === 'win32'
		? `@echo off\r\n"${process.execPath}" "${hostPath}" %*\r\n`
		: `#!/bin/sh\nexec "${process.execPath}" "${hostPath}" "$@"\n`;

	if (!dryRun) {
		writeFileSync(launcherPath, contents);
		if (plat !== 'win32') chmodSync(launcherPath, 0o755);
	}

	return launcherPath;
}

function buildManifest(
	target: BrowserTarget,
	launcherPath: string,
	extensionIds: string[]
): Record<string, unknown> {
	const base = {
		name: HOST_NAME,
		description: 'Tolaria Web Clipper native host',
		path: launcherPath,
		type: 'stdio',
	};

	// Chrome wants origins with a trailing slash and supports no wildcards;
	// Firefox wants bare gecko ids under a different key.
	return target.family === 'gecko'
		? { ...base, allowed_extensions: ['clipper@tolaria.md'] }
		: { ...base, allowed_origins: extensionIds.map(id => `chrome-extension://${id}/`) };
}

export function installHost(options: InstallOptions = {}): InstallReport {
	const log = options.log ?? console.log;
	const dryRun = options.dryRun ?? false;
	const plat = platform();
	const installDir = hostInstallDir(plat, homedir());
	const extensionIds = [...new Set([...PINNED_EXTENSION_IDS, ...(options.extensionIds ?? [])])];
	const bundle = resolveHostBundle(options.hostBundle);

	log(`tolaria-clipper native host installer${dryRun ? ' (dry run)' : ''}`);
	log(`  node:       ${process.execPath}`);
	log(`  install to: ${installDir}`);
	log(`  extension:  ${extensionIds.join(', ')}`);
	log('');

	if (!dryRun) {
		mkdirSync(installDir, { recursive: true });
		copyFileSync(bundle, join(installDir, 'host.cjs'));
	}

	const launcherPath = writeLauncher(installDir, plat, dryRun);
	log(`  launcher:   ${launcherPath}`);
	log('');

	const targets = browserTargets(plat, homedir()).filter(target => {
		if (!target.manifestDir) return false;
		// An explicit list opts in to browsers outside the default set.
		if (options.browsers && options.browsers.length > 0) return options.browsers.includes(target.id);
		if (!target.supported) return false;
		// Only write where the browser actually keeps a profile, unless forced.
		return options.force || existsSync(dirname(target.manifestDir));
	});

	if (targets.length === 0) {
		log('No supported browser profile found. Pass --browsers=chrome,arc to force.');
		return { launcherPath, installDir, extensionIds, installed: [] };
	}

	const installed: InstallReport['installed'] = [];
	for (const target of targets) {
		const manifestDir = target.manifestDir as string;
		const manifestPath = join(manifestDir, `${HOST_NAME}.json`);

		if (!dryRun) {
			mkdirSync(manifestDir, { recursive: true });
			writeFileSync(manifestPath, `${JSON.stringify(buildManifest(target, launcherPath, extensionIds), null, 2)}\n`);
			if (plat === 'win32') registerWindows(target.id, manifestPath, log);
		}

		installed.push({ browser: target.name, path: manifestPath });
		log(`  [ok] ${target.name}`);
		log(`       ${manifestPath}`);
	}

	log('');
	log(
		dryRun
			? 'Dry run — nothing was written.'
			: 'Done. Reload the extension, then clip a page: Tolaria should not come to the front.'
	);

	return { launcherPath, installDir, extensionIds, installed };
}

function registerWindows(browserId: string, manifestPath: string, log: (line: string) => void): void {
	const key = WINDOWS_REGISTRY_KEYS[browserId];
	if (!key) return;
	try {
		execFileSync(
			'reg',
			['add', `${key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
			{ stdio: 'ignore' }
		);
	} catch (error) {
		log(`  [warn] Could not write registry key for ${browserId}: ${(error as Error).message}`);
	}
}

/**
 * Copy the built extension somewhere stable and print the path to load.
 *
 * Chrome keeps a *reference* to an unpacked extension's directory rather than
 * copying it, so loading straight from a checkout's `dist/` means the extension
 * silently disables itself the moment that directory is cleaned or the
 * workspace is removed.
 *
 * The extension id survives the move because it is pinned by the `key` field in
 * the manifest, so the native messaging manifest keeps allowing it.
 */
export function installExtension(options: InstallOptions = {}): string {
	const log = options.log ?? console.log;
	const dryRun = options.dryRun ?? false;
	const target = extensionInstallDir(platform(), homedir());
	const source = resolveBuiltExtension(options.from);

	log(`tolaria-clipper extension installer${dryRun ? ' (dry run)' : ''}`);
	log(`  from: ${source}`);
	log(`  to:   ${target}`);
	log('');

	if (!dryRun) {
		// Replace wholesale so files removed since the last build do not linger.
		rmSync(target, { recursive: true, force: true });
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, {
			recursive: true,
			// dist/ also holds the Node builds (CLI, host, API). They are not
			// part of the extension and would add megabytes to what Chrome loads.
			filter: src => !NODE_ARTIFACTS.has(basename(src)),
		});
	}

	log(dryRun ? 'Dry run — nothing was copied.' : 'Copied.');
	log('');
	log('In chrome://extensions (and arc://extensions), enable Developer mode and');
	log(`use "Load unpacked" on:  ${target}`);
	log('');
	log('Re-run this after each build, then hit Reload on the extension card.');

	return target;
}

function resolveBuiltExtension(explicit?: string): string {
	if (explicit) {
		if (!existsSync(join(explicit, 'manifest.json'))) {
			throw new Error(`No manifest.json in ${explicit}`);
		}
		return explicit;
	}

	const candidates = [
		resolve(process.cwd(), 'dist'),
		resolve(__dirname, '..', 'dist'),
		resolve(__dirname, '..'),
	];

	const found = candidates.find(dir => existsSync(join(dir, 'manifest.json')));
	if (!found) {
		throw new Error(
			`No built extension found. Run "npm run build:chrome" first.\nLooked in:\n  ${candidates.join('\n  ')}`
		);
	}
	return found;
}

export function uninstallHost(options: InstallOptions = {}): void {
	const log = options.log ?? console.log;
	const dryRun = options.dryRun ?? false;
	const plat = platform();
	const installDir = hostInstallDir(plat, homedir());

	log(`tolaria-clipper native host uninstaller${dryRun ? ' (dry run)' : ''}`);

	for (const target of browserTargets(plat, homedir())) {
		if (!target.manifestDir) continue;
		const manifestPath = join(target.manifestDir, `${HOST_NAME}.json`);
		if (!existsSync(manifestPath)) continue;

		if (!dryRun) {
			rmSync(manifestPath, { force: true });
			if (plat === 'win32' && WINDOWS_REGISTRY_KEYS[target.id]) {
				try {
					execFileSync('reg', ['delete', `${WINDOWS_REGISTRY_KEYS[target.id]}\\${HOST_NAME}`, '/f'], {
						stdio: 'ignore',
					});
				} catch { /* key may already be gone */ }
			}
		}
		log(`  removed ${manifestPath}`);
	}

	if (existsSync(installDir)) {
		if (!dryRun) rmSync(installDir, { recursive: true, force: true });
		log(`  removed ${installDir}`);
	}

	log('Done.');
}
