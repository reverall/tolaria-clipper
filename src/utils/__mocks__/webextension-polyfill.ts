// Mock for webextension-polyfill in test environment
export const runtime = {
	getURL: (path: string) => `chrome-extension://mock-id/${path}`,
	sendMessage: async () => ({}),
	onMessage: {
		addListener: () => {},
		removeListener: () => {},
	},
};

// Backed by a real in-memory record rather than always returning {}, so tests
// that exercise read-modify-write paths (settings migrations, history rewrites)
// can seed a starting state and assert on what was written back.
type Area = Record<string, unknown>;

function createArea() {
	let data: Area = {};
	return {
		async get(keys?: string | string[] | null): Promise<Area> {
			if (keys === null || keys === undefined) return { ...data };
			const wanted = Array.isArray(keys) ? keys : [keys];
			const out: Area = {};
			for (const key of wanted) {
				if (key in data) out[key] = data[key];
			}
			return out;
		},
		async set(items: Area): Promise<void> {
			data = { ...data, ...items };
		},
		async remove(keys: string | string[]): Promise<void> {
			for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
		},
		async clear(): Promise<void> {
			data = {};
		},
		/** Test-only: seed or inspect the backing record. */
		__seed(items: Area): void {
			data = { ...items };
		},
		__all(): Area {
			return { ...data };
		},
	};
}

export const storage = {
	local: createArea(),
	sync: createArea(),
	onChanged: {
		addListener: () => {},
		removeListener: () => {},
	},
};

export const tabs = {
	query: async () => [],
	sendMessage: async () => ({}),
};

export const i18n = {
	getMessage: (key: string) => key,
};

export default {
	runtime,
	storage,
	tabs,
	i18n,
};
