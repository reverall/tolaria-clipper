// Vault discovery. Reads Tolaria's own vaults.json rather than asking the user
// to retype vault names, mirroring the resolution order Tolaria's bundled MCP
// server uses (see Tolaria.app/Contents/Resources/mcp-server/ws-bridge.js).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { VaultInfo } from './protocol';

const APP_CONFIG_DIR = 'com.tolaria.app';
/** Tolaria's pre-rename namespace; still read for older installs. */
const LEGACY_CONFIG_DIR = 'club.refactoring.tolaria';
const NAMESPACE_READ_ORDER = [APP_CONFIG_DIR, LEGACY_CONFIG_DIR];
const VAULTS_FILE = 'vaults.json';

interface RawVault {
	label?: string;
	path?: string;
	alias?: string | null;
	mounted?: boolean;
}

interface RawVaultsJson {
	vaults?: RawVault[];
	active_vault?: string;
	default_workspace_path?: string;
}

function absoluteOrNull(value: string | undefined): string | null {
	return typeof value === 'string' && isAbsolute(value) ? value : null;
}

function platformConfigDir(env: NodeJS.ProcessEnv, plat: string, home: string): string {
	if (plat === 'darwin') return join(home, 'Library', 'Application Support');
	if (plat === 'win32') return absoluteOrNull(env.APPDATA) || join(home, 'AppData', 'Roaming');
	return absoluteOrNull(env.XDG_CONFIG_HOME) || join(home, '.config');
}

/** Config roots to search, most specific first. */
export function appConfigBaseDirs(
	env: NodeJS.ProcessEnv = process.env,
	plat: string = platform(),
	home: string = homedir()
): string[] {
	const platformDir = platformConfigDir(env, plat, home);
	const primary = absoluteOrNull(env.XDG_CONFIG_HOME)
		|| (plat === 'darwin' || plat === 'win32' ? platformDir : join(home, '.config'));

	const dirs = [primary];
	if (platformDir !== primary) dirs.push(platformDir);
	return dirs;
}

/**
 * Locate vaults.json. Returns the first existing candidate, or the preferred
 * path when none exist (so callers can report where they looked).
 */
export function vaultsJsonPath(configDirs: string[] = appConfigBaseDirs()): string {
	for (const configDir of configDirs) {
		for (const namespace of NAMESPACE_READ_ORDER) {
			const candidate = join(configDir, namespace, VAULTS_FILE);
			if (existsSync(candidate)) return candidate;
		}
	}
	return join(configDirs[0], APP_CONFIG_DIR, VAULTS_FILE);
}

/** Stable id derived from the resolved path, so relabelling a vault is harmless. */
export function vaultId(resolvedPath: string): string {
	return createHash('sha256').update(resolvedPath).digest('hex').slice(0, 12);
}

/**
 * Vault slug for tolaria:// deep links: alias, else label, else basename,
 * lowercased and kebabed. Collisions get a stable suffix so two vaults never
 * produce the same link.
 */
function baseSlug(vault: RawVault, resolvedPath: string): string {
	const source = vault.alias
		|| vault.label
		|| resolvedPath.split(/[\\/]/).filter(Boolean).pop()
		|| 'vault';

	const slug = source
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'vault';
}

/** FNV-1a base36, matching the disambiguation scheme Tolaria documents. */
function slugHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36).padStart(6, '0').slice(0, 6);
}

function resolvePath(rawPath: string): string {
	try {
		return realpathSync(rawPath);
	} catch {
		// Vault folder missing (unmounted volume, moved directory). Keep the
		// declared path so the UI can show it as unavailable rather than drop it.
		return rawPath;
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export interface LoadedVaults {
	vaults: VaultInfo[];
	source: 'vaults.json' | 'env';
	vaultsJsonPath: string | null;
}

/**
 * Read the vault registry. Falls back to VAULT_PATHS / VAULT_PATH, the same
 * env vars Tolaria passes to its MCP server, which makes the host testable
 * without a Tolaria install.
 */
export function loadVaults(env: NodeJS.ProcessEnv = process.env): LoadedVaults {
	const fromEnv = loadVaultsFromEnv(env);
	if (fromEnv) return fromEnv;

	const jsonPath = vaultsJsonPath();
	let parsed: RawVaultsJson;
	try {
		parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as RawVaultsJson;
	} catch {
		return { vaults: [], source: 'vaults.json', vaultsJsonPath: jsonPath };
	}

	const activeVault = typeof parsed.active_vault === 'string' ? resolvePath(parsed.active_vault) : null;
	const raw = Array.isArray(parsed.vaults) ? parsed.vaults : [];

	return {
		vaults: buildVaultInfos(raw, activeVault),
		source: 'vaults.json',
		vaultsJsonPath: jsonPath,
	};
}

function loadVaultsFromEnv(env: NodeJS.ProcessEnv): LoadedVaults | null {
	const paths: string[] = [];

	if (env.VAULT_PATHS) {
		try {
			const list = JSON.parse(env.VAULT_PATHS);
			if (Array.isArray(list)) paths.push(...list.filter((p): p is string => typeof p === 'string'));
		} catch {
			// Malformed VAULT_PATHS is not fatal — fall through to VAULT_PATH.
		}
	}
	if (env.VAULT_PATH) paths.push(env.VAULT_PATH);

	const unique = [...new Set(paths.filter(Boolean))];
	if (unique.length === 0) return null;

	const raw: RawVault[] = unique.map(path => ({ path, mounted: true }));
	return {
		vaults: buildVaultInfos(raw, resolvePath(unique[0])),
		source: 'env',
		vaultsJsonPath: null,
	};
}

function buildVaultInfos(raw: RawVault[], activeVault: string | null): VaultInfo[] {
	const resolved = raw
		.filter(v => typeof v.path === 'string' && v.path.length > 0)
		.map(v => ({ raw: v, path: resolvePath(v.path as string) }));

	// Disambiguate slugs only where they actually collide, so the common case
	// keeps clean links like tolaria://olimar-pkm/note.md
	const slugCounts = new Map<string, number>();
	for (const entry of resolved) {
		const slug = baseSlug(entry.raw, entry.path);
		slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
	}

	return resolved.map(({ raw: vault, path }) => {
		const base = baseSlug(vault, path);
		const slug = (slugCounts.get(base) ?? 0) > 1 ? `${base}-${slugHash(path)}` : base;

		return {
			id: vaultId(path),
			label: vault.label || base,
			alias: vault.alias ?? null,
			path,
			slug,
			mounted: vault.mounted !== false,
			exists: isDirectory(path),
			isActive: activeVault !== null && path === activeVault,
		};
	});
}

/** Resolve a vault by id, then slug, then label, then absolute path. */
export function findVault(vaults: VaultInfo[], ref: string): VaultInfo | undefined {
	if (!ref) return vaults.find(v => v.isActive) ?? vaults[0];
	return vaults.find(v => v.id === ref)
		?? vaults.find(v => v.slug === ref)
		?? vaults.find(v => v.label === ref)
		?? vaults.find(v => v.path === ref);
}
