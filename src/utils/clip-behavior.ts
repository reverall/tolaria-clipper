// Mapping from template behaviours to host save modes.
//
// Dependency-free on purpose: shared by the extension, the CLI and the native
// host, none of which can import the others' environment.

import { SaveMode } from '../native-host/protocol';
import { Template } from '../types/types';

export function behaviorToSaveMode(behavior: Template['behavior']): SaveMode {
	if (behavior.startsWith('append')) return 'append';
	if (behavior.startsWith('prepend')) return 'prepend';
	if (behavior === 'overwrite') return 'overwrite';
	return 'create';
}

/**
 * Daily behaviours are sugar over append/prepend: Tolaria has no daily-note
 * URI, so the target is resolved from settings at clip time.
 */
export function isDailyBehavior(behavior: Template['behavior']): boolean {
	return behavior === 'append-daily' || behavior === 'prepend-daily';
}
