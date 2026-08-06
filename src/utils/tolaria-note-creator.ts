// Saves a clip into a Tolaria vault.
//
// Replaces the obsidian:// URI dance. Nothing here navigates a tab or launches
// an app: the note is written straight to disk and Tolaria's filesystem watcher
// picks it up — even when Tolaria is closed. The one exception is the explicit,
// opt-in "open after saving" setting.

import dayjs from 'dayjs';

import { Property, Template } from '../types/types';
import { SaveNoteResult } from '../native-host/protocol';
import { behaviorToSaveMode, isDailyBehavior } from './clip-behavior';
import { callHost } from './native-host-client';
import { generateFrontmatter as generateFrontmatterCore } from './shared';
import { generalSettings } from './storage-utils';
import { sanitizeFileName } from './string-utils';

export { behaviorToSaveMode, isDailyBehavior };

export async function generateFrontmatter(properties: Property[]): Promise<string> {
	const typeMap: Record<string, string> = {};
	for (const pt of generalSettings.propertyTypes) {
		typeMap[pt.name] = pt.type;
	}
	return generateFrontmatterCore(properties, typeMap);
}

export interface DailyNoteTarget {
	path: string;
	name: string;
}

/**
 * Resolve today's daily note.
 *
 * Tolaria has no daily-note URI, so this is worked out client-side and then
 * saved like any other append target. Keeping the date logic here — rather than
 * in the host — avoids a second place where time zones can drift.
 */
export function resolveDailyNote(now: dayjs.Dayjs = dayjs()): DailyNoteTarget {
	const format = generalSettings.dailyNoteFormat || 'YYYY-MM-DD';
	return {
		path: generalSettings.dailyNotePath || '',
		name: now.format(format),
	};
}

export interface SaveToTolariaOptions {
	fileContent: string;
	noteName: string;
	path: string;
	/** Vault id, slug or label. Empty means the active vault. */
	vault: string;
	behavior: Template['behavior'];
}

export async function saveToTolaria(options: SaveToTolariaOptions): Promise<SaveNoteResult> {
	const { fileContent, vault, behavior } = options;

	const daily = isDailyBehavior(behavior) ? resolveDailyNote() : null;
	const name = sanitizeFileName(daily ? daily.name : options.noteName) || 'untitled';
	const path = daily ? daily.path : options.path;

	return callHost('saveNote', {
		vaultId: vault,
		path: normalizeFolder(path),
		name,
		content: fileContent,
		mode: behaviorToSaveMode(behavior),
		openAfter: generalSettings.openAfterSave,
		refreshBridge: generalSettings.notifyTolariaBridge,
	});
}

/** Vault-relative, no leading or trailing separators. */
function normalizeFolder(path: string): string {
	return path.replace(/^[\\/]+|[\\/]+$/g, '');
}
