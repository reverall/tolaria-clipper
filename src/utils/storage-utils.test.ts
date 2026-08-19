import { describe, test, expect, beforeEach } from 'vitest';
import { storage } from './__mocks__/webextension-polyfill';
import { loadSettings, migrateToV3 } from './storage-utils';
import type { HistoryEntry } from '../types/types';

// A v2 profile as it exists on disk before the rename: clip counter under the
// old key, old default action, history split across sync and local.
function seedV2Profile() {
	storage.sync.__seed({
		migrationVersion: 2,
		general_settings: {
			saveBehavior: 'addToObsidian',
			showMoreActionsButton: true,
		},
		stats: {
			addToObsidian: 49,
			saveFile: 3,
			copyToClipboard: 1,
			share: 0,
			readerMode: 7,
		},
		history: [
			{ datetime: '2025-01-01T00:00:00Z', url: 'https://a.example', action: 'addToObsidian' },
			{ datetime: '2025-01-02T00:00:00Z', url: 'https://b.example', action: 'saveFile' },
		],
		reader_settings: {
			customCss: '.obsidian-reader-content { max-width: 40em }',
		},
	});
	storage.local.__seed({
		history: [
			{ datetime: '2025-01-03T00:00:00Z', url: 'https://c.example', action: 'addToObsidian' },
			{ datetime: '2025-01-04T00:00:00Z', url: 'https://d.example', action: 'readerMode' },
		],
	});
}

beforeEach(async () => {
	await storage.sync.clear();
	await storage.local.clear();
});

describe('migrateToV3', () => {
	test('carries the clip counter over to the new key', async () => {
		seedV2Profile();
		await migrateToV3(await storage.sync.get(null) as never);

		const stats = (await storage.sync.get('stats')).stats as Record<string, number>;
		expect(stats.addToTolaria).toBe(49);
		expect(stats).not.toHaveProperty('addToObsidian');
		// untouched counters survive
		expect(stats.saveFile).toBe(3);
		expect(stats.readerMode).toBe(7);
	});

	test('translates the stored default action', async () => {
		seedV2Profile();
		await migrateToV3(await storage.sync.get(null) as never);

		const general = (await storage.sync.get('general_settings')).general_settings as Record<string, unknown>;
		expect(general.saveBehavior).toBe('addToTolaria');
		// unrelated keys in the same object are preserved
		expect(general.showMoreActionsButton).toBe(true);
	});

	test('rewrites history in both storage areas', async () => {
		seedV2Profile();
		await migrateToV3(await storage.sync.get(null) as never);

		const syncHistory = (await storage.sync.get('history')).history as HistoryEntry[];
		const localHistory = (await storage.local.get('history')).history as HistoryEntry[];

		expect(syncHistory.map(e => e.action)).toEqual(['addToTolaria', 'saveFile']);
		expect(localHistory.map(e => e.action)).toEqual(['addToTolaria', 'readerMode']);
	});

	test('rewrites reader custom CSS selectors', async () => {
		seedV2Profile();
		await migrateToV3(await storage.sync.get(null) as never);

		const reader = (await storage.sync.get('reader_settings')).reader_settings as Record<string, string>;
		expect(reader.customCss).toBe('.tolaria-reader-content { max-width: 40em }');
	});

	test('is idempotent', async () => {
		seedV2Profile();
		await migrateToV3(await storage.sync.get(null) as never);
		const afterFirst = { sync: storage.sync.__all(), local: storage.local.__all() };

		await migrateToV3(await storage.sync.get(null) as never);
		expect({ sync: storage.sync.__all(), local: storage.local.__all() }).toEqual(afterFirst);
	});

	test('leaves a profile with nothing to migrate untouched', async () => {
		storage.sync.__seed({ migrationVersion: 3, stats: { addToTolaria: 5, saveFile: 0, copyToClipboard: 0, share: 0 } });
		const before = storage.sync.__all();

		await migrateToV3(await storage.sync.get(null) as never);
		expect(storage.sync.__all()).toEqual(before);
	});
});

describe('loadSettings', () => {
	test('migrates a v2 profile and stamps the new version', async () => {
		seedV2Profile();
		const settings = await loadSettings();

		expect(settings.stats.addToTolaria).toBe(49);
		expect(settings.saveBehavior).toBe('addToTolaria');
		expect((await storage.sync.get('migrationVersion')).migrationVersion).toBe(3);
	});

	test('still reads the pre-v3 key when a stale device pushes it back', async () => {
		// Already stamped v3, so the migration does not run — this is the
		// cross-device case the read-side fallback exists for.
		storage.sync.__seed({
			migrationVersion: 3,
			general_settings: { saveBehavior: 'addToObsidian' },
			stats: { addToObsidian: 12, saveFile: 0, copyToClipboard: 0, share: 0 },
		});

		const settings = await loadSettings();
		expect(settings.stats.addToTolaria).toBe(12);
		expect(settings.saveBehavior).toBe('addToTolaria');
	});
});
