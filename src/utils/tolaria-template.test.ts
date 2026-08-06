// @vitest-environment jsdom
//
// End-to-end check of the note a clip produces, from the default template to
// the final markdown — the shape Tolaria actually has to read back.
//
// jsdom because template-manager transitively pulls in the highlighter, which
// registers window listeners at import time.

import { describe, test, expect } from 'vitest';
import { compileTemplate } from './template-compiler';
import { generateFrontmatter, formatPropertyValue } from './shared';
import { createDefaultTemplate } from '../managers/template-manager';
import { Property } from '../types/types';

const VARIABLES: Record<string, string> = {
	'{{title}}': 'Empreinte environnementale du numérique : le CNRS fait les comptes',
	'{{url}}': 'https://lejournal.cnrs.fr/articles/empreinte-numerique',
	'{{author}}': 'Marie Dupont, Jean Martin',
	'{{published}}': '2026-03-12',
	'{{date}}': '2026-08-06',
	'{{description}}': 'Une étude du CNRS chiffre l\'impact du numérique.',
	'{{content}}': '# Empreinte environnementale du numérique : le CNRS fait les comptes\n\nLe numérique pèse de plus en plus lourd.',
};

const URL = VARIABLES['{{url}}'];

/** Mirrors what the popup does: compile each field, then assemble. */
async function renderNote() {
	const template = createDefaultTemplate();

	const noteName = await compileTemplate(0, template.noteNameFormat, VARIABLES, URL);

	const typeMap: Record<string, string> = {};
	const properties: Property[] = [];
	for (const property of template.properties) {
		const compiled = await compileTemplate(0, property.value, VARIABLES, URL);
		const type = property.type || 'text';
		typeMap[property.name] = type;
		properties.push({
			name: property.name,
			value: formatPropertyValue(compiled, type, property.value),
			type,
		});
	}

	const frontmatter = generateFrontmatter(properties, typeMap);
	const body = await compileTemplate(0, template.noteContentFormat, VARIABLES, URL);

	return { noteName, frontmatter, body, fullContent: frontmatter + body };
}

describe('default Tolaria template', () => {
	test('produces a short kebab-case filename', async () => {
		const { noteName } = await renderNote();
		expect(noteName).toBe('empreinte-environnementale-du-numerique-le-cnrs-fait-les-comptes');
		expect(noteName.length).toBeLessThanOrEqual(80);
	});

	test('puts the title in an H1, which is what Tolaria reads', async () => {
		const { body } = await renderNote();
		expect(body.split('\n')[0]).toBe('# Empreinte environnementale du numérique : le CNRS fait les comptes');
	});

	test('does not duplicate the H1 when the extracted content already has one', async () => {
		const { body } = await renderNote();
		expect(body.match(/^# /gm)).toHaveLength(1);
	});

	test('emits type as an unquoted keyword', async () => {
		const { frontmatter } = await renderNote();
		expect(frontmatter).toContain('type: Clippings\n');
	});

	test('uses url, Tolaria\'s canonical external link field', async () => {
		const { frontmatter } = await renderNote();
		expect(frontmatter).toContain(`url: "${URL}"`);
		expect(frontmatter).not.toContain('source:');
	});

	test('drops the legacy title and tags fields', async () => {
		const { frontmatter } = await renderNote();
		expect(frontmatter).not.toMatch(/^title:/m);
		expect(frontmatter).not.toMatch(/^tags:/m);
	});

	test('leaves relationships as bare empty keys so "to process" views match', async () => {
		const { frontmatter } = await renderNote();
		expect(frontmatter).toContain('belongs_to:\n');
		expect(frontmatter).toContain('related_to:\n');
		expect(frontmatter).not.toContain('belongs_to: ""');
	});

	test('never writes _organized, so the clip lands in the Inbox', async () => {
		const { fullContent } = await renderNote();
		expect(fullContent).not.toContain('_organized');
	});

	test('splits multiple authors into a YAML list', async () => {
		const { frontmatter } = await renderNote();
		expect(frontmatter).toContain('author:\n  - "Marie Dupont"\n  - "Jean Martin"\n');
	});

	test('normalises dates', async () => {
		const { frontmatter } = await renderNote();
		expect(frontmatter).toContain('published: 2026-03-12');
		expect(frontmatter).toContain('created: 2026-08-06');
	});

	test('produces frontmatter Tolaria can parse back', async () => {
		const { fullContent } = await renderNote();
		const match = fullContent.match(/^---\n([\s\S]*?)\n---\n/);
		expect(match).not.toBeNull();

		// Every line is either a key, or a list item under one.
		for (const line of (match as RegExpMatchArray)[1].split('\n')) {
			expect(line).toMatch(/^(?:[A-Za-z_][\w-]*:.*|\s+- .*)$/);
		}
	});
});
