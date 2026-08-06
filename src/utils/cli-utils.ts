// CLI-side vault writing.
//
// Shares fs-ops with the native host, so the CLI and the extension cannot drift
// on dedupe naming, frontmatter-aware prepend, or path containment.

import { Template } from '../types/types';
import { saveNote } from '../native-host/fs-ops';
import { findVault, loadVaults } from '../native-host/vaults';
import { behaviorToSaveMode } from './clip-behavior';
import { sanitizeFileName } from './string-utils';

export interface SaveToVaultOptions {
	fileContent: string;
	noteName: string;
	path: string;
	/** Vault id, slug, label or absolute path. Empty means the active vault. */
	vault: string;
	behavior: Template['behavior'];
	/** Folder holding daily notes, for the -daily behaviours. */
	dailyNotePath?: string;
	dailyNoteFormat?: string;
}

export interface SaveToVaultResult {
	message: string;
	absolutePath: string;
	relativePath: string;
	deepLink: string;
}

function todayFormatted(format: string): string {
	// Deliberately dependency-free: dayjs is not bundled into the CLI's node
	// build, and the default format is plain ISO.
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return format
		.replace(/YYYY/g, String(now.getFullYear()))
		.replace(/MM/g, pad(now.getMonth() + 1))
		.replace(/DD/g, pad(now.getDate()));
}

export async function saveToVault(options: SaveToVaultOptions): Promise<SaveToVaultResult> {
	const { vaults } = loadVaults();
	if (vaults.length === 0) {
		throw new Error('No Tolaria vaults found. Open a vault in Tolaria first.');
	}

	const vault = findVault(vaults, options.vault);
	if (!vault) {
		throw new Error(`Unknown vault: ${options.vault}`);
	}
	if (!vault.exists) {
		throw new Error(`Vault folder is unavailable: ${vault.path}`);
	}

	const isDaily = options.behavior === 'append-daily' || options.behavior === 'prepend-daily';
	const name = isDaily
		? todayFormatted(options.dailyNoteFormat || 'YYYY-MM-DD')
		: sanitizeFileName(options.noteName, process.platform) || 'untitled';
	const folder = isDaily ? (options.dailyNotePath ?? '') : options.path;

	const result = saveNote(
		vault.path,
		folder.replace(/^[\\/]+|[\\/]+$/g, ''),
		name,
		options.fileContent,
		behaviorToSaveMode(options.behavior)
	);

	const deepLink = `tolaria://${vault.slug}/${result.relativePath
		.split(/[\\/]/)
		.filter(Boolean)
		.map(encodeURIComponent)
		.join('/')}`;

	return {
		message: `${result.created ? 'Created' : 'Updated'} ${result.relativePath} in ${vault.label}`,
		absolutePath: result.absolutePath,
		relativePath: result.relativePath,
		deepLink,
	};
}
