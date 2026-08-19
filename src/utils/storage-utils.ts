import browser from './browser-polyfill';
import { Settings, ModelConfig, PropertyType, HistoryEntry, Provider, Rating } from '../types/types';
import { debugLog } from './debug';

export type { Settings, ModelConfig, PropertyType, HistoryEntry, Provider, Rating };

export let generalSettings: Settings = {
	vaults: [],
	openAfterSave: false,
	notifyTolariaBridge: false,
	dailyNotePath: '',
	dailyNoteFormat: 'YYYY-MM-DD',
	openBehavior: 'popup',
	highlighterEnabled: true,
	alwaysShowHighlights: false,
	highlightBehavior: 'highlight-inline',
	showMoreActionsButton: false,
	interpreterModel: '',
	models: [],
	providers: [],
	interpreterEnabled: false,
	interpreterAutoRun: false,
	defaultPromptContext: '',
	propertyTypes: [],
	readerSettings: {
		fontSize: 16,
		lineHeight: 1.6,
		maxWidth: 38,
		lightTheme: 'default',
		darkTheme: 'same',
		appearance: 'auto',
		fonts: [],
		defaultFont: '',
		blendImages: true,
		colorLinks: false,
		followLinks: true,
		pinPlayer: true,
		autoScroll: true,
		highlightActiveLine: true,
		customCss: ''
	},
	stats: {
		addToTolaria: 0,
		saveFile: 0,
		copyToClipboard: 0,
		share: 0,
		readerMode: 0
	},
	history: [],
	ratings: [],
	saveBehavior: 'addToTolaria'
};

export function setLocalStorage(key: string, value: any): Promise<void> {
	return browser.storage.local.set({ [key]: value });
}

export function getLocalStorage(key: string): Promise<any> {
	return browser.storage.local.get(key).then((result: {[key: string]: any}) => result[key]);
}

interface StorageData {
	general_settings?: {
		showMoreActionsButton?: boolean;
		openAfterSave?: boolean;
		notifyTolariaBridge?: boolean;
		dailyNotePath?: string;
		dailyNoteFormat?: string;
		openBehavior?: boolean | 'popup' | 'embedded';
		// `addToObsidian` is the pre-v3 spelling; see migrateToV3.
		saveBehavior?: 'addToTolaria' | 'addToObsidian' | 'copyToClipboard' | 'saveFile';
	};
	vaults?: string[];
	highlighter_settings?: {
		highlighterEnabled?: boolean;
		alwaysShowHighlights?: boolean;
		highlightBehavior?: string;
	};
	reader_settings?: {
		fontSize?: number;
		lineHeight?: number;
		maxWidth?: number;
		lightTheme?: string;
		darkTheme?: string;
		appearance?: 'auto' | 'light' | 'dark';
		fonts?: string[];
		defaultFont?: string;
		blendImages?: boolean;
		colorLinks?: boolean;
		followLinks?: boolean;
		pinPlayer?: boolean;
		autoScroll?: boolean;
		highlightActiveLine?: boolean;
		customCss?: string;
	};
	interpreter_settings?: {
		interpreterModel?: string;
		models?: ModelConfig[];
		providers?: Provider[];
		interpreterEnabled?: boolean;
		interpreterAutoRun?: boolean;
		defaultPromptContext?: string;
	};
	property_types?: PropertyType[];
	stats?: {
		addToTolaria?: number;
		/** Pre-v3 spelling of `addToTolaria`; see migrateToV3. */
		addToObsidian?: number;
		saveFile: number;
		copyToClipboard: number;
		share: number;
		readerMode?: number;
	};
	history?: HistoryEntry[];
	ratings?: Rating[];
	migrationVersion?: number;
}

const CURRENT_MIGRATION_VERSION = 3;

/**
 * v3 renames the `addToObsidian` action to `addToTolaria`.
 *
 * That token is a stored *value*, not just a symbol: it is the clip counter's
 * key, the saved default action, and the discriminator on every history entry.
 * Renaming it without this migration silently zeroes the counter and drops the
 * main button back to its default label.
 *
 * History is the awkward part — `StorageData` declares it under sync, but
 * `addHistoryEntry` writes it to local. Both locations are rewritten here.
 *
 * Reader custom CSS is rewritten too: it is user-authored and targets the
 * class names the same changeset renames.
 */
export async function migrateToV3(data: StorageData): Promise<void> {
	const syncPatch: Record<string, unknown> = {};

	const legacyStat = data.stats?.addToObsidian;
	if (typeof legacyStat === 'number') {
		const { addToObsidian: _dropped, ...rest } = data.stats!;
		syncPatch.stats = { ...rest, addToTolaria: data.stats!.addToTolaria ?? legacyStat };
	}

	if (data.general_settings?.saveBehavior === 'addToObsidian') {
		syncPatch.general_settings = { ...data.general_settings, saveBehavior: 'addToTolaria' };
	}

	const customCss = data.reader_settings?.customCss;
	if (customCss?.includes('obsidian-')) {
		syncPatch.reader_settings = {
			...data.reader_settings,
			customCss: customCss.replace(/obsidian-/g, 'tolaria-'),
		};
	}

	const syncHistory = migrateHistoryActions(data.history);
	if (syncHistory) syncPatch.history = syncHistory;

	if (Object.keys(syncPatch).length > 0) {
		await browser.storage.sync.set(syncPatch);
	}

	const local = await browser.storage.local.get('history');
	const localHistory = migrateHistoryActions(local.history as HistoryEntry[] | undefined);
	if (localHistory) {
		await browser.storage.local.set({ history: localHistory });
	}
}

/** Returns a rewritten history, or null when there is nothing to rewrite. */
function migrateHistoryActions(history?: HistoryEntry[]): HistoryEntry[] | null {
	if (!Array.isArray(history)) return null;
	let changed = false;
	const migrated = history.map(entry => {
		if ((entry?.action as string) !== 'addToObsidian') return entry;
		changed = true;
		return { ...entry, action: 'addToTolaria' as const };
	});
	return changed ? migrated : null;
}

export async function loadSettings(): Promise<Settings> {
	const data = await browser.storage.sync.get(null) as StorageData;

	// Load default settings first
	const defaultSettings: Settings = {
		vaults: [],
		showMoreActionsButton: false,
			openAfterSave: false,
		notifyTolariaBridge: false,
		dailyNotePath: '',
		dailyNoteFormat: 'YYYY-MM-DD',
		openBehavior: 'popup',
		highlighterEnabled: true,
		alwaysShowHighlights: true,
		highlightBehavior: 'highlight-inline',
		interpreterModel: '',
		models: [],
		providers: [],
		interpreterEnabled: false,
		interpreterAutoRun: false,
		defaultPromptContext: '',
		propertyTypes: [],
		saveBehavior: 'addToTolaria',
		readerSettings: {
			fontSize: 16,
			lineHeight: 1.6,
			maxWidth: 38,
			lightTheme: 'default',
			darkTheme: 'same',
			appearance: 'auto',
			fonts: [],
			defaultFont: '',
			blendImages: true,
			colorLinks: false,
			followLinks: true,
			pinPlayer: true,
			autoScroll: true,
			highlightActiveLine: true,
			customCss: ''
		},
		stats: {
			addToTolaria: 0,
			saveFile: 0,
			copyToClipboard: 0,
			share: 0,
			readerMode: 0
		},
		history: [],
		ratings: [],
	};

	// Run migrations before stamping the version, so a failure part-way through
	// leaves the old version in place and the next load retries.
	if (!data.migrationVersion || data.migrationVersion < CURRENT_MIGRATION_VERSION) {
		if (!data.migrationVersion || data.migrationVersion < 3) {
			await migrateToV3(data);
			Object.assign(data, await browser.storage.sync.get(null) as StorageData);
		}
		await browser.storage.sync.set({ migrationVersion: CURRENT_MIGRATION_VERSION });
		debugLog('Settings', `Updated migration version to ${CURRENT_MIGRATION_VERSION}`);
	}

	// Validate and sanitize data to prevent corruption
	const sanitizedVaults = Array.isArray(data.vaults) ? data.vaults.filter(v => typeof v === 'string') : [];
	const sanitizedModels = Array.isArray(data.interpreter_settings?.models) 
		? data.interpreter_settings.models.filter(m => m && typeof m === 'object' && typeof m.id === 'string') 
		: [];
	const sanitizedProviders = Array.isArray(data.interpreter_settings?.providers)
		? data.interpreter_settings.providers.filter(p => p && typeof p === 'object' && typeof p.id === 'string')
		: [];

	// Keep reading the pre-v3 key even after the migration has run: storage.sync
	// propagates between devices, and one still on an older build will push the
	// old spelling back. Cheaper than losing the counter.
	const { addToObsidian: legacyClipCount, ...incomingStats } =
		data.stats ?? ({} as NonNullable<StorageData['stats']>);
	const storedSaveBehavior = data.general_settings?.saveBehavior === 'addToObsidian'
		? 'addToTolaria'
		: data.general_settings?.saveBehavior;

	// Load user settings
	const loadedSettings: Settings = {
		vaults: sanitizedVaults.length > 0 ? sanitizedVaults : defaultSettings.vaults,
		showMoreActionsButton: data.general_settings?.showMoreActionsButton ?? defaultSettings.showMoreActionsButton,
		openAfterSave: data.general_settings?.openAfterSave ?? defaultSettings.openAfterSave,
		notifyTolariaBridge: data.general_settings?.notifyTolariaBridge ?? defaultSettings.notifyTolariaBridge,
		dailyNotePath: data.general_settings?.dailyNotePath ?? defaultSettings.dailyNotePath,
		dailyNoteFormat: data.general_settings?.dailyNoteFormat || defaultSettings.dailyNoteFormat,
		openBehavior: typeof data.general_settings?.openBehavior === 'boolean' 
			? (data.general_settings.openBehavior ? 'embedded' : 'popup') 
			: (data.general_settings?.openBehavior ?? defaultSettings.openBehavior),
		highlighterEnabled: data.highlighter_settings?.highlighterEnabled ?? defaultSettings.highlighterEnabled,
		alwaysShowHighlights: data.highlighter_settings?.alwaysShowHighlights ?? defaultSettings.alwaysShowHighlights,
		highlightBehavior: data.highlighter_settings?.highlightBehavior ?? defaultSettings.highlightBehavior,
		interpreterModel: data.interpreter_settings?.interpreterModel || defaultSettings.interpreterModel,
		models: sanitizedModels,
		providers: sanitizedProviders,
		interpreterEnabled: data.interpreter_settings?.interpreterEnabled ?? defaultSettings.interpreterEnabled,
		interpreterAutoRun: data.interpreter_settings?.interpreterAutoRun ?? defaultSettings.interpreterAutoRun,
		defaultPromptContext: data.interpreter_settings?.defaultPromptContext || defaultSettings.defaultPromptContext,
		propertyTypes: data.property_types || defaultSettings.propertyTypes,
		readerSettings: {
			fontSize: data.reader_settings?.fontSize ?? defaultSettings.readerSettings.fontSize,
			lineHeight: data.reader_settings?.lineHeight ?? defaultSettings.readerSettings.lineHeight,
			maxWidth: data.reader_settings?.maxWidth ?? defaultSettings.readerSettings.maxWidth,
			lightTheme: data.reader_settings?.lightTheme ?? defaultSettings.readerSettings.lightTheme,
			darkTheme: data.reader_settings?.darkTheme ?? defaultSettings.readerSettings.darkTheme,
			appearance: data.reader_settings?.appearance as 'auto' | 'light' | 'dark' ?? defaultSettings.readerSettings.appearance,
			fonts: data.reader_settings?.fonts ?? defaultSettings.readerSettings.fonts,
			defaultFont: data.reader_settings?.defaultFont ?? defaultSettings.readerSettings.defaultFont,
			blendImages: data.reader_settings?.blendImages ?? defaultSettings.readerSettings.blendImages,
			colorLinks: data.reader_settings?.colorLinks ?? defaultSettings.readerSettings.colorLinks,
			followLinks: data.reader_settings?.followLinks ?? defaultSettings.readerSettings.followLinks,
			pinPlayer: data.reader_settings?.pinPlayer ?? defaultSettings.readerSettings.pinPlayer,
			autoScroll: data.reader_settings?.autoScroll ?? defaultSettings.readerSettings.autoScroll,
			highlightActiveLine: data.reader_settings?.highlightActiveLine ?? defaultSettings.readerSettings.highlightActiveLine,
			customCss: data.reader_settings?.customCss ?? defaultSettings.readerSettings.customCss
		},
		stats: {
			...defaultSettings.stats,
			...incomingStats,
			addToTolaria: incomingStats.addToTolaria ?? legacyClipCount ?? defaultSettings.stats.addToTolaria
		},
		history: data.history || defaultSettings.history,
		ratings: data.ratings || defaultSettings.ratings,
		saveBehavior: storedSaveBehavior ?? defaultSettings.saveBehavior
	};

	generalSettings = loadedSettings;
	debugLog('Settings', 'Loaded settings:', generalSettings);
	return generalSettings;
}

export async function saveSettings(settings?: Partial<Settings>): Promise<void> {
	if (settings) {
		generalSettings = { ...generalSettings, ...settings };
	}

	await browser.storage.sync.set({
		vaults: generalSettings.vaults,
		general_settings: {
			showMoreActionsButton: generalSettings.showMoreActionsButton,
			openAfterSave: generalSettings.openAfterSave,
			notifyTolariaBridge: generalSettings.notifyTolariaBridge,
			dailyNotePath: generalSettings.dailyNotePath,
			dailyNoteFormat: generalSettings.dailyNoteFormat,
			openBehavior: generalSettings.openBehavior,
			saveBehavior: generalSettings.saveBehavior,
		},
		highlighter_settings: {
			highlighterEnabled: generalSettings.highlighterEnabled,
			alwaysShowHighlights: generalSettings.alwaysShowHighlights,
			highlightBehavior: generalSettings.highlightBehavior
		},
		interpreter_settings: {
			interpreterModel: generalSettings.interpreterModel,
			models: generalSettings.models,
			providers: generalSettings.providers,
			interpreterEnabled: generalSettings.interpreterEnabled,
			interpreterAutoRun: generalSettings.interpreterAutoRun,
			defaultPromptContext: generalSettings.defaultPromptContext
		},
		property_types: generalSettings.propertyTypes,
		reader_settings: {
			fontSize: generalSettings.readerSettings.fontSize,
			lineHeight: generalSettings.readerSettings.lineHeight,
			maxWidth: generalSettings.readerSettings.maxWidth,
			lightTheme: generalSettings.readerSettings.lightTheme,
			darkTheme: generalSettings.readerSettings.darkTheme,
			appearance: generalSettings.readerSettings.appearance,
			fonts: generalSettings.readerSettings.fonts,
			defaultFont: generalSettings.readerSettings.defaultFont,
			blendImages: generalSettings.readerSettings.blendImages,
			colorLinks: generalSettings.readerSettings.colorLinks,
			followLinks: generalSettings.readerSettings.followLinks,
			pinPlayer: generalSettings.readerSettings.pinPlayer,
			autoScroll: generalSettings.readerSettings.autoScroll,
			highlightActiveLine: generalSettings.readerSettings.highlightActiveLine,
			customCss: generalSettings.readerSettings.customCss
		},
		stats: generalSettings.stats
	});
}

export async function incrementStat(
	action: keyof Settings['stats'],
	vault?: string,
	path?: string,
	url?: string,
	title?: string
): Promise<void> {
	const settings = await loadSettings();
	settings.stats[action]++;
	await saveSettings(settings);

	// Add history entry if URL is provided
	if (url) {
		await addHistoryEntry(action, url, title, vault, path);
	}
}

export async function addHistoryEntry(
	action: keyof Settings['stats'], 
	url: string, 
	title?: string,
	vault?: string,
	path?: string
): Promise<void> {
	const entry: HistoryEntry = {
		datetime: new Date().toISOString(),
		url,
		action,
		title,
		vault,
		path
	};

	// Get existing history from local storage
	const result = await browser.storage.local.get('history');
	const history: HistoryEntry[] = (result.history || []) as HistoryEntry[];

	// Add new entry at the beginning
	history.unshift(entry);

	// Keep only the last 1000 entries
	const trimmedHistory = history.slice(0, 1000);

	// Save back to local storage
	await browser.storage.local.set({ history: trimmedHistory });
}

export async function getClipHistory(): Promise<HistoryEntry[]> {
	const result = await browser.storage.local.get('history');
	return (result.history || []) as HistoryEntry[];
}

declare global {
	interface Window {
		debugStorage: (key?: string) => Promise<Record<string, unknown>>;
	}
}

// Make storage accessible from console — use `window.debugStorage()` to see all sync storage, or `window.debugStorage(key)` to see a specific key
if (typeof window !== 'undefined') {
	window.debugStorage = (key?: string) => {
		if (key) {
			return browser.storage.sync.get(key).then(data => {
				console.log(`Sync storage contents for key "${key}":`, data);
				return data;
			});
		}
		return browser.storage.sync.get(null).then(data => {
			console.log('Sync storage contents:', data);
			return data;
		});
	};
}
