// One-shot migration of notes clipped by the Obsidian-era templates into the
// shape the Tolaria templates now produce.
//
// Ships alongside the template change on purpose: run separately, the two
// halves of a vault disagree about which key holds the source URL.
//
// What it does, per clipped note:
//   1. source: → url:            (Tolaria's canonical external link field)
//   2. title:  → an H1 in the body, then drop the key
//   3. filename → kebab-case, ≤ 80 chars, rewriting inbound wikilinks
//   4. strip injected browser-extension UI that leaked into the content
//   5. normalise "[[a]],[[b]]" scalars into proper YAML relationship lists
//
// Usage:
//   node scripts/migrate-vault-clips.mjs <vault-path> [--folder Clippings] [--apply]
//
// Defaults to a dry run. The vault is usually a Git repo with auto-commit and
// push, so review `git diff` before letting it sync.

import { readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const vaultPath = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply');
const folderArg = args.find(a => a.startsWith('--folder='));
const clipFolder = folderArg ? folderArg.slice('--folder='.length) : 'Clippings';

if (!vaultPath) {
	console.error('Usage: node scripts/migrate-vault-clips.mjs <vault-path> [--folder=Clippings] [--apply]');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers (kept in sync with src/utils/filters/kebab_slug.ts)
// ---------------------------------------------------------------------------

const MAX_SLUG_LENGTH = 80;

function kebabSlug(str) {
	const slug = str
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (slug.length <= MAX_SLUG_LENGTH) return slug || 'untitled';

	const clipped = slug.slice(0, MAX_SLUG_LENGTH);
	const lastSeparator = clipped.lastIndexOf('-');
	const candidate = lastSeparator > MAX_SLUG_LENGTH / 2 ? clipped.slice(0, lastSeparator) : clipped;
	return candidate.replace(/-+$/, '') || 'untitled';
}

function splitFrontmatter(content) {
	if (!content.startsWith('---\n')) return null;
	const end = content.indexOf('\n---', 3);
	if (end === -1) return null;

	const after = content.indexOf('\n', end + 1);
	return {
		frontmatter: content.slice(4, end),
		body: after === -1 ? '' : content.slice(after + 1),
	};
}

/** Top-level `key:` lines only — list items and nested values are left alone. */
function readScalar(frontmatter, key) {
	const match = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
	if (!match) return null;
	return match[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function walkMarkdown(dir) {
	const results = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) results.push(...walkMarkdown(full));
		else if (extname(entry.name) === '.md') results.push(full);
	}
	return results;
}

// ---------------------------------------------------------------------------
// Per-note transforms
// ---------------------------------------------------------------------------

function migrateNote(content) {
	const parts = splitFrontmatter(content);
	if (!parts) return { changed: false, content, notes: [] };

	let { frontmatter, body } = parts;
	const notes = [];

	// 1. source: → url:, unless the note already carries a url.
	if (/^source:/m.test(frontmatter)) {
		if (/^url:/m.test(frontmatter)) {
			notes.push('kept existing url:, left source: in place');
		} else {
			frontmatter = frontmatter.replace(/^source:/m, 'url:');
			notes.push('source: → url:');
		}
	}

	// 2. title: → H1, then drop the key. Tolaria reads the first H1 as the
	//    title; keeping both is a second source of truth that drifts.
	const title = readScalar(frontmatter, 'title');
	if (title !== null) {
		const hasH1 = /^#[ \t]+\S/m.test(body.split('\n').slice(0, 5).join('\n'));
		if (!hasH1 && title) {
			body = `# ${title}\n\n${body.replace(/^\s*\n/, '')}`;
			notes.push('added H1 from title:');
		}
		frontmatter = frontmatter.replace(/^title:.*$\n?/m, '');
		notes.push('dropped title:');
	}

	// 3. Injected extension UI that was captured as page content.
	const withoutInjected = body.replace(
		/^.*<iframe[^>]*(?:chrome|moz|safari-web)-extension:\/\/[^>]*>.*$\n?/gm,
		''
	);
	if (withoutInjected !== body) {
		body = withoutInjected;
		notes.push('removed injected extension iframe');
	}

	// 4. Relationship scalars written as one comma-joined string, which Tolaria
	//    reads as a single link rather than several.
	frontmatter = frontmatter.replace(
		/^([A-Za-z_][\w-]*):[ \t]*"((?:\[\[[^\]]*\]\][ \t]*,[ \t]*)+\[\[[^\]]*\]\])"[ \t]*$/gm,
		(_match, key, value) => {
			const items = value.split(/,(?![^[]*\]\])/).map(v => v.trim()).filter(Boolean);
			notes.push(`${key}: split into a YAML list`);
			return `${key}:\n${items.map(item => `  - "${item}"`).join('\n')}`;
		}
	);

	const migrated = `---\n${frontmatter}\n---\n${body}`;
	return { changed: migrated !== content, content: migrated, notes };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const clipDir = join(vaultPath, clipFolder);
if (!statSync(clipDir, { throwIfNoEntry: false })?.isDirectory()) {
	console.error(`Clip folder not found: ${clipDir}`);
	process.exit(1);
}

const clipFiles = walkMarkdown(clipDir);
const allFiles = walkMarkdown(vaultPath);

console.log(`${apply ? 'Migrating' : 'Dry run:'} ${clipFiles.length} notes in ${clipFolder}\n`);

// Pass 1: content.
let contentChanged = 0;
for (const file of clipFiles) {
	const original = readFileSync(file, 'utf8');
	const { changed, content, notes } = migrateNote(original);
	if (!changed) continue;

	contentChanged++;
	console.log(`  ${relative(vaultPath, file)}`);
	for (const note of notes) console.log(`      ${note}`);
	if (apply) writeFileSync(file, content);
}

// Pass 2: filenames, plus the wikilinks that point at them.
const renames = [];
const taken = new Set(clipFiles.map(f => basename(f, '.md')));

for (const file of clipFiles) {
	const currentName = basename(file, '.md');
	let slug = kebabSlug(currentName);
	if (slug === currentName) continue;

	// Do not collide with a note that already owns the slug.
	if (taken.has(slug)) {
		let suffix = 1;
		while (taken.has(`${slug}-${suffix}`)) suffix++;
		slug = `${slug}-${suffix}`;
	}
	taken.add(slug);
	renames.push({ file, from: currentName, to: slug });
}

if (renames.length > 0) {
	console.log(`\nRenaming ${renames.length} files to kebab-case:\n`);
	for (const { from, to } of renames) console.log(`  ${from}\n    → ${to}`);

	// Rewrite inbound wikilinks across the whole vault, not just the clips —
	// a renamed note may be referenced from anywhere.
	const linkMap = new Map(renames.map(r => [r.from, r.to]));
	let linkFilesChanged = 0;

	for (const file of allFiles) {
		const original = readFileSync(file, 'utf8');
		const updated = original.replace(/\[\[([^\]|#]+)([|#][^\]]*)?\]\]/g, (match, target, rest) => {
			const replacement = linkMap.get(target.trim());
			return replacement ? `[[${replacement}${rest ?? ''}]]` : match;
		});
		if (updated === original) continue;

		linkFilesChanged++;
		console.log(`  updated links in ${relative(vaultPath, file)}`);
		if (apply) writeFileSync(file, updated);
	}

	if (apply) {
		for (const { file, to } of renames) {
			renameSync(file, join(clipDir, `${to}.md`));
		}
	}

	console.log(`\n  ${linkFilesChanged} file(s) with inbound links updated`);
}

console.log(`\n${contentChanged} note(s) with content changes, ${renames.length} rename(s).`);
if (!apply) console.log('\nDry run — nothing written. Re-run with --apply.');
