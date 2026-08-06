import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	HostFsError,
	appendContent,
	atomicWrite,
	createExclusive,
	frontmatterEnd,
	prependContent,
	resolveInVault,
	resolveTarget,
	saveNote,
} from './fs-ops';

let vault: string;
let outside: string;

beforeEach(() => {
	// realpath the fixture: on macOS /var is a symlink to /private/var, and
	// resolveInVault legitimately returns resolved paths.
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'clipper-test-')));
	vault = join(root, 'vault');
	outside = join(root, 'outside');
	mkdirSync(vault);
	mkdirSync(outside);
});

afterEach(() => {
	rmSync(join(vault, '..'), { recursive: true, force: true });
});

describe('resolveInVault', () => {
	it('resolves a plain relative path', () => {
		expect(resolveInVault(vault, 'note.md')).toBe(join(vault, 'note.md'));
		expect(resolveInVault(vault, 'Clippings/note.md')).toBe(join(vault, 'Clippings', 'note.md'));
	});

	it('rejects traversal', () => {
		expect(() => resolveInVault(vault, '../escape.md')).toThrow(HostFsError);
		expect(() => resolveInVault(vault, 'a/../../escape.md')).toThrow(/escapes the vault/);
	});

	it('rejects absolute paths', () => {
		expect(() => resolveInVault(vault, '/etc/passwd')).toThrow(/Absolute paths/);
	});

	it('rejects reserved and dot segments', () => {
		expect(() => resolveInVault(vault, '.git/config')).toThrow(/Reserved path segment/);
		expect(() => resolveInVault(vault, '.obsidian/types.json')).toThrow(/Reserved path segment/);
		expect(() => resolveInVault(vault, '.ssh/authorized_keys')).toThrow(/Reserved path segment/);
	});

	it('rejects escapes through a symlinked folder', () => {
		symlinkSync(outside, join(vault, 'link'), 'dir');
		expect(() => resolveInVault(vault, 'link/note.md')).toThrow(/escapes the vault/);
	});

	it('strips leading slashes rather than treating them as absolute', () => {
		expect(resolveInVault(vault, 'Clippings/./note.md')).toBe(join(vault, 'Clippings', 'note.md'));
	});
});

describe('resolveTarget', () => {
	it('appends the .md extension once', () => {
		expect(resolveTarget(vault, '', 'note', 'create').relativePath).toBe('note.md');
		expect(resolveTarget(vault, '', 'note.md', 'create').relativePath).toBe('note.md');
	});

	it('dedupes with a kebab-consistent suffix', () => {
		writeFileSync(join(vault, 'note.md'), 'first');
		const target = resolveTarget(vault, '', 'note', 'create');
		expect(target.relativePath).toBe('note-1.md');
		expect(target.deduped).toBe(true);
		expect(target.existed).toBe(true);
	});

	it('keeps walking past taken suffixes', () => {
		writeFileSync(join(vault, 'note.md'), '');
		writeFileSync(join(vault, 'note-1.md'), '');
		expect(resolveTarget(vault, '', 'note', 'create').relativePath).toBe('note-2.md');
	});

	it('does not dedupe for non-create modes', () => {
		writeFileSync(join(vault, 'note.md'), 'first');
		const target = resolveTarget(vault, '', 'note', 'append');
		expect(target.relativePath).toBe('note.md');
		expect(target.deduped).toBe(false);
	});
});

describe('atomicWrite', () => {
	it('writes content and creates missing folders', () => {
		const path = join(vault, 'Clippings', 'note.md');
		const bytes = atomicWrite(path, 'hello');
		expect(readFileSync(path, 'utf8')).toBe('hello');
		expect(bytes).toBe(5);
	});

	it('reports byte length, not character count', () => {
		const path = join(vault, 'note.md');
		expect(atomicWrite(path, 'héllo')).toBe(6);
	});

	it('leaves no temp files behind', () => {
		atomicWrite(join(vault, 'note.md'), 'hello');
		expect(readdirSync(vault).filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
	});
});

describe('createExclusive', () => {
	it('refuses to clobber an existing file', () => {
		const path = join(vault, 'note.md');
		writeFileSync(path, 'original');
		expect(() => createExclusive(path, 'new')).toThrow(HostFsError);
		expect(readFileSync(path, 'utf8')).toBe('original');
	});
});

describe('frontmatterEnd', () => {
	it('returns 0 when there is no frontmatter', () => {
		expect(frontmatterEnd('# Title\n\nBody')).toBe(0);
		expect(frontmatterEnd('')).toBe(0);
	});

	it('finds the end of a frontmatter block', () => {
		const content = '---\ntype: Clippings\n---\n# Title\n';
		expect(content.slice(frontmatterEnd(content))).toBe('# Title\n');
	});

	it('ignores a horizontal rule that is not a closing delimiter', () => {
		// No closing delimiter at all, so nothing may be treated as frontmatter.
		expect(frontmatterEnd('---\ntype: Clippings\n')).toBe(0);
	});

	it('does not treat a leading --- inside text as frontmatter', () => {
		expect(frontmatterEnd('----\nnot yaml\n')).toBe(0);
	});
});

describe('appendContent / prependContent', () => {
	it('appends after existing content', () => {
		expect(appendContent('a', 'b', '\n\n')).toBe('a\n\nb');
	});

	it('appends into an empty file without a leading separator', () => {
		expect(appendContent('', 'b', '\n\n')).toBe('b');
		expect(appendContent('\n\n', 'b', '\n\n')).toBe('b');
	});

	it('prepends after frontmatter, keeping the YAML valid', () => {
		const existing = '---\ntype: Daily\ncreated: 2026-08-06\n---\n# 2026-08-06\n\nold\n';
		const result = prependContent(existing, 'new', '\n\n');
		expect(result.startsWith('---\ntype: Daily\ncreated: 2026-08-06\n---\n')).toBe(true);
		expect(result).toContain('---\nnew\n\n# 2026-08-06');
	});

	it('prepends at the top when there is no frontmatter', () => {
		expect(prependContent('old\n', 'new', '\n\n')).toBe('new\n\nold\n');
	});

	it('prepends into a frontmatter-only file without a dangling separator', () => {
		const existing = '---\ntype: Daily\n---\n';
		expect(prependContent(existing, 'new', '\n\n')).toBe('---\ntype: Daily\n---\nnew');
	});
});

describe('saveNote', () => {
	it('creates a note', () => {
		const result = saveNote(vault, 'Clippings', 'my-note', '# Hello\n', 'create');
		expect(result.created).toBe(true);
		expect(result.relativePath).toBe(join('Clippings', 'my-note.md'));
		expect(readFileSync(result.absolutePath, 'utf8')).toBe('# Hello\n');
	});

	it('never overwrites in create mode', () => {
		saveNote(vault, '', 'note', 'first', 'create');
		const second = saveNote(vault, '', 'note', 'second', 'create');
		expect(second.relativePath).toBe('note-1.md');
		expect(readFileSync(join(vault, 'note.md'), 'utf8')).toBe('first');
	});

	it('appends while preserving frontmatter', () => {
		writeFileSync(join(vault, 'daily.md'), '---\ntype: Daily\n---\n# Day\n');
		const result = saveNote(vault, '', 'daily', '- a clip', 'append');
		expect(result.created).toBe(false);
		expect(readFileSync(result.absolutePath, 'utf8')).toBe('---\ntype: Daily\n---\n# Day\n\n- a clip\n');
	});

	it('creates the target when appending to a missing note', () => {
		const result = saveNote(vault, 'Dailies', '2026-08-06', 'first entry', 'append');
		expect(result.created).toBe(true);
		expect(readFileSync(result.absolutePath, 'utf8')).toBe('first entry\n');
	});

	it('overwrites in overwrite mode', () => {
		writeFileSync(join(vault, 'note.md'), 'old');
		saveNote(vault, '', 'note', 'new', 'overwrite');
		expect(readFileSync(join(vault, 'note.md'), 'utf8')).toBe('new');
	});

	it('skips an existing note in skipIfExists mode', () => {
		writeFileSync(join(vault, 'note.md'), 'old');
		const result = saveNote(vault, '', 'note', 'new', 'skipIfExists');
		expect(result.created).toBe(false);
		expect(result.bytes).toBe(0);
		expect(readFileSync(join(vault, 'note.md'), 'utf8')).toBe('old');
	});

	it('refuses to write outside the vault', () => {
		expect(() => saveNote(vault, '../outside', 'evil', 'x', 'create')).toThrow(HostFsError);
		expect(existsSync(join(outside, 'evil.md'))).toBe(false);
	});
});
