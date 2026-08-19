import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import I18nAutomation from '../src/utils/i18n-automation';

// Load environment variables from .env file
dotenv.config();

const LOCALES_DIR = path.join(__dirname, '../src/_locales');
const SRC_DIR = path.join(__dirname, '../src');

/**
 * Mechanical rebrand of the translated locales.
 *
 * "Obsidian" is a proper noun and is left untranslated in every locale, so
 * substituting the token in place gets the translations right without paying
 * for 35 round trips to a translation model. Only `message` and
 * `placeholders.*.content` are touched — never the keys.
 *
 * `en` is excluded: it is the source of truth and is edited by hand, because
 * some of its strings describe Obsidian mechanisms that need rewriting rather
 * than renaming.
 */
const REBRAND_RULES: Array<[RegExp, string]> = [
	[/https:\/\/help\.obsidian\.md\/web-clipper\/interpreter/g, 'https://github.com/reverall/tolaria-clipper/blob/main/docs/interpreter.md'],
	[/https:\/\/help\.obsidian\.md\/web-clipper\/(?:variables|templates|filters)/g, 'https://github.com/reverall/tolaria-clipper/blob/main/docs/templates.md'],
	[/https:\/\/help\.obsidian\.md[^"'\s]*/g, 'https://github.com/reverall/tolaria-clipper#readme'],
	[/Obsidian Web Clipper/g, 'Tolaria Clipper'],
	[/Obsidian Clipper/g, 'Tolaria Clipper'],
	[/Obsidian/g, 'Tolaria'],
	[/obsidian\.md/g, 'tolaria.md'],
];

/**
 * Keys dropped from `en`; they would otherwise linger as orphans. legacyMode
 * and silentOpen went with the obsidian:// URL handling in the transport
 * rewrite, but their translations were left behind.
 */
const REMOVED_KEYS = [
	'earlyAccessFeatures', 'earlyAccessDescription',
	'legacyMode', 'legacyModeDescription',
	'silentOpen', 'silentOpenDescription',
];

/**
 * Keys whose English text was rewritten rather than renamed, so the existing
 * translations now say something untrue — that types.json lives in a hidden
 * `.obsidian` folder, that it imports into a vault, that this is the official
 * extension. Dropping them makes getMessage fall back to the rewritten English,
 * which beats a confidently wrong translation.
 */
const RESEMANTICISED_KEYS = [
	'importPropertiesDescription',
	'exportPropertiesDescription',
	'extensionDescription',
];

/** Keys renamed in `en`, old name → new name. */
const RENAMED_KEYS: Record<string, string> = { addToObsidian: 'addToTolaria' };

function rebrand(text: string): string {
	return REBRAND_RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

function rebrandLocales(): void {
	const locales = fs.readdirSync(LOCALES_DIR).filter(name => name !== 'en');

	for (const locale of locales) {
		const file = path.join(LOCALES_DIR, locale, 'messages.json');
		if (!fs.existsSync(file)) continue;

		const messages = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
		let touched = 0;

		for (const [oldKey, newKey] of Object.entries(RENAMED_KEYS)) {
			if (oldKey in messages) {
				messages[newKey] = messages[oldKey];
				delete messages[oldKey];
				touched++;
			}
		}

		for (const key of [...REMOVED_KEYS, ...RESEMANTICISED_KEYS]) {
			if (key in messages) {
				delete messages[key];
				touched++;
			}
		}

		for (const entry of Object.values(messages)) {
			if (typeof entry?.message === 'string') {
				const next = rebrand(entry.message);
				if (next !== entry.message) { entry.message = next; touched++; }
			}
			for (const placeholder of Object.values(entry?.placeholders ?? {}) as any[]) {
				if (typeof placeholder?.content !== 'string') continue;
				const next = rebrand(placeholder.content);
				if (next !== placeholder.content) { placeholder.content = next; touched++; }
			}
		}

		if (touched > 0) {
			fs.writeFileSync(file, JSON.stringify(messages, null, '\t') + '\n');
		}
		console.log(`${locale}: ${touched} change(s)`);
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args.includes('--rebrand')) {
		rebrandLocales();
		return;
	}

	const targetLocale = args[0];
	const automation = new I18nAutomation(LOCALES_DIR, process.env.OPENAI_API_KEY);

	try {
		await automation.processLocales(SRC_DIR, targetLocale);
		console.log('Successfully updated locales');
	} catch (error) {
		console.error('Failed to update locales:', error);
		process.exit(1);
	}
}

main();
