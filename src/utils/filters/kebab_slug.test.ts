import { describe, it, expect } from 'vitest';
import { kebab_slug } from './kebab_slug';

describe('kebab_slug', () => {
	it('lowercases and hyphenates', () => {
		expect(kebab_slug('How to Build an Agent Platform')).toBe('how-to-build-an-agent-platform');
	});

	it('strips accents', () => {
		expect(kebab_slug('Idée')).toBe('idee');
		expect(kebab_slug('Empreinte environnementale du numérique')).toBe('empreinte-environnementale-du-numerique');
	});

	it('drops punctuation that the plain kebab filter leaves behind', () => {
		expect(kebab_slug('Huashu Design · HTML-native design skill')).toBe('huashu-design-html-native-design-skill');
		expect(kebab_slug('MANHATTAN 37 | MAEN WATCHES')).toBe('manhattan-37-maen-watches');
	});

	it('collapses runs of separators and trims the edges', () => {
		expect(kebab_slug('  --Hello,,,   World!!  ')).toBe('hello-world');
	});

	it('truncates long titles on a word boundary', () => {
		const title = 'CloakHQ CloakBrowser Stealth Chromium that passes every bot detection test drop in Playwright replacement';
		const slug = kebab_slug(title);
		expect(slug.length).toBeLessThanOrEqual(80);
		expect(slug.endsWith('-')).toBe(false);
		// A boundary cut must not leave a half-written word.
		expect(title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).toContain(slug);
	});

	it('falls back for titles with nothing sluggable', () => {
		expect(kebab_slug('')).toBe('untitled');
		expect(kebab_slug('!!!')).toBe('untitled');
		expect(kebab_slug('日本語')).toBe('untitled');
	});

	it('avoids Windows reserved device names', () => {
		expect(kebab_slug('CON')).toBe('con-note');
		expect(kebab_slug('aux')).toBe('aux-note');
		expect(kebab_slug('console')).toBe('console');
	});

	it('keeps digits', () => {
		expect(kebab_slug('2026-08-06 Daily')).toBe('2026-08-06-daily');
	});
});
