// Filesystem operations for the native host.
//
// Two properties matter more than anything else here, because a Tolaria vault
// is watched live (fsevents) and usually auto-committed and pushed by AutoGit:
//
//   1. Writes are atomic (tmp + rename), so the watcher and git never observe
//      a half-written note.
//   2. The browser can never reach outside a registered vault root.

import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { SaveMode } from './protocol';

/** Directories the clipper must never write into, even inside a vault. */
const FORBIDDEN_SEGMENTS = new Set([
	'.git',
	'.obsidian',
	'.tolaria-rename-txn',
	'.laputa',
	'node_modules',
]);

const MAX_DEDUPE_ATTEMPTS = 999;

export class HostFsError extends Error {
	constructor(
		public readonly code:
			| 'E_PATH_ESCAPE'
			| 'E_EXISTS'
			| 'E_NOT_FOUND'
			| 'E_IO'
			| 'E_PERM',
		message: string
	) {
		super(message);
		this.name = 'HostFsError';
	}
}

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

/**
 * Resolve a vault-relative path against its root, refusing anything that
 * escapes. Checks the literal path first, then re-checks after resolving
 * symlinks on the deepest existing ancestor — a symlinked subfolder is the
 * non-obvious way out of a directory.
 */
export function resolveInVault(vaultRoot: string, relativePath: string): string {
	if (isAbsolute(relativePath)) {
		throw new HostFsError('E_PATH_ESCAPE', `Absolute paths are not accepted: ${relativePath}`);
	}

	const normalized = normalize(relativePath).replace(/^[\\/]+/, '');
	const segments = normalized.split(/[\\/]/).filter(s => s.length > 0 && s !== '.');

	for (const segment of segments) {
		if (segment === '..') {
			throw new HostFsError('E_PATH_ESCAPE', `Path escapes the vault: ${relativePath}`);
		}
		if (FORBIDDEN_SEGMENTS.has(segment) || segment.startsWith('.')) {
			throw new HostFsError('E_PATH_ESCAPE', `Reserved path segment: ${segment}`);
		}
	}

	const root = realpathSync(vaultRoot);
	const target = resolve(root, segments.join(sep));
	assertInside(root, target, relativePath);

	// The deepest existing ancestor is what a symlink could redirect.
	let ancestor = target;
	while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
		ancestor = dirname(ancestor);
	}
	if (existsSync(ancestor)) {
		const realAncestor = realpathSync(ancestor);
		const suffix = relative(ancestor, target);
		assertInside(root, resolve(realAncestor, suffix), relativePath);
	}

	return target;
}

function assertInside(root: string, candidate: string, original: string): void {
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		throw new HostFsError('E_PATH_ESCAPE', `Path escapes the vault: ${original}`);
	}
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

export interface ResolvedTarget {
	/** Vault-relative, with .md */
	relativePath: string;
	absolutePath: string;
	/** Whether the pre-dedupe target already existed. */
	existed: boolean;
	deduped: boolean;
}

function withMdExtension(name: string): string {
	return name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
}

/**
 * Work out where a save would land. For 'create', walks 'note.md',
 * 'note 1.md', … — matching the naming Obsidian's URI handler produced, so
 * existing vaults stay visually consistent.
 */
export function resolveTarget(
	vaultRoot: string,
	folder: string,
	name: string,
	mode: SaveMode
): ResolvedTarget {
	const fileName = withMdExtension(name);
	const cleanFolder = folder.replace(/^[\\/]+|[\\/]+$/g, '');
	const naiveRelative = cleanFolder ? join(cleanFolder, fileName) : fileName;

	const naiveAbsolute = resolveInVault(vaultRoot, naiveRelative);
	const existed = existsSync(naiveAbsolute);

	if (mode !== 'create' || !existed) {
		return { relativePath: naiveRelative, absolutePath: naiveAbsolute, existed, deduped: false };
	}

	// '-1' rather than Obsidian's ' 1': filenames are kebab-case in Tolaria, and
	// a space here would be the one place the convention breaks.
	const base = fileName.slice(0, -3);
	for (let i = 1; i <= MAX_DEDUPE_ATTEMPTS; i++) {
		const candidateName = `${base}-${i}.md`;
		const candidateRelative = cleanFolder ? join(cleanFolder, candidateName) : candidateName;
		const candidateAbsolute = resolveInVault(vaultRoot, candidateRelative);
		if (!existsSync(candidateAbsolute)) {
			return {
				relativePath: candidateRelative,
				absolutePath: candidateAbsolute,
				existed: true,
				deduped: true,
			};
		}
	}

	throw new HostFsError('E_EXISTS', `Could not find a free filename for ${fileName}`);
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
	try {
		mkdirSync(dir, { recursive: true });
	} catch (error) {
		throw toHostFsError(error, `Could not create folder ${dir}`);
	}
}

/**
 * Write via a sibling temp file plus rename(2). Same directory guarantees the
 * same filesystem, which is what makes the rename atomic — the watcher sees
 * exactly one event, carrying complete content.
 */
export function atomicWrite(absolutePath: string, content: string): number {
	const dir = dirname(absolutePath);
	ensureDir(dir);

	const tmpPath = join(dir, `.tmp-clip-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
	const bytes = Buffer.byteLength(content, 'utf8');

	let fd: number | null = null;
	try {
		fd = openSync(tmpPath, 'wx', 0o644);
		writeSync(fd, content, 0, 'utf8');
		fsyncSync(fd);
		closeSync(fd);
		fd = null;
		renameSync(tmpPath, absolutePath);
		return bytes;
	} catch (error) {
		if (fd !== null) {
			try { closeSync(fd); } catch { /* already closing down */ }
		}
		try { rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
		throw toHostFsError(error, `Could not write ${absolutePath}`);
	}
}

/**
 * Claim a filename atomically. Prevents two concurrent clips of the same page
 * from both deciding 'note.md' is free and one silently overwriting the other.
 */
export function createExclusive(absolutePath: string, content: string): number {
	ensureDir(dirname(absolutePath));
	const bytes = Buffer.byteLength(content, 'utf8');

	let fd: number;
	try {
		fd = openSync(absolutePath, 'wx', 0o644);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new HostFsError('E_EXISTS', `Note already exists: ${absolutePath}`);
		}
		throw toHostFsError(error, `Could not create ${absolutePath}`);
	}

	try {
		writeSync(fd, content, 0, 'utf8');
		fsyncSync(fd);
		return bytes;
	} catch (error) {
		throw toHostFsError(error, `Could not write ${absolutePath}`);
	} finally {
		try { closeSync(fd); } catch { /* best effort */ }
	}
}

// ---------------------------------------------------------------------------
// Frontmatter-aware append / prepend
// ---------------------------------------------------------------------------

/**
 * Byte offset just past a leading YAML frontmatter block, or 0 when there is
 * none. Prepending blindly to a note that opens with `---` would corrupt the
 * YAML, and Tolaria would then lose the note's type and relationships.
 */
export function frontmatterEnd(content: string): number {
	if (!content.startsWith('---')) return 0;

	const firstLineEnd = content.indexOf('\n');
	if (firstLineEnd === -1) return 0;
	if (content.slice(0, firstLineEnd).trim() !== '---') return 0;

	const closingPattern = /^---[ \t]*$/gm;
	closingPattern.lastIndex = firstLineEnd + 1;

	const match = closingPattern.exec(content);
	if (!match) return 0;

	const afterClosing = match.index + match[0].length;
	// Consume the newline that terminates the closing delimiter, if present.
	return content.startsWith('\n', afterClosing) ? afterClosing + 1 : afterClosing;
}

export function appendContent(existing: string, addition: string, separator: string): string {
	const trimmed = existing.replace(/\s+$/, '');
	if (trimmed.length === 0) return addition;
	return `${trimmed}${separator}${addition}`;
}

export function prependContent(existing: string, addition: string, separator: string): string {
	const boundary = frontmatterEnd(existing);
	const head = existing.slice(0, boundary);
	const body = existing.slice(boundary);

	if (body.replace(/\s+/g, '').length === 0) {
		return `${head}${addition}`;
	}
	return `${head}${addition}${separator}${body.replace(/^\s+/, '')}`;
}

// ---------------------------------------------------------------------------
// High-level save
// ---------------------------------------------------------------------------

export interface SaveResult {
	relativePath: string;
	absolutePath: string;
	created: boolean;
	deduped: boolean;
	bytes: number;
}

export function saveNote(
	vaultRoot: string,
	folder: string,
	name: string,
	content: string,
	mode: SaveMode,
	separator = '\n\n'
): SaveResult {
	const { relativePath, absolutePath, existed, deduped } = resolveTarget(vaultRoot, folder, name, mode);
	const base = { relativePath, absolutePath, deduped };

	switch (mode) {
		case 'create': {
			// resolveTarget already picked a free name; createExclusive closes
			// the remaining race.
			return { ...base, created: true, bytes: createExclusive(absolutePath, content) };
		}

		case 'skipIfExists': {
			if (existed) return { ...base, created: false, bytes: 0 };
			return { ...base, created: true, bytes: createExclusive(absolutePath, content) };
		}

		case 'overwrite': {
			return { ...base, created: !existed, bytes: atomicWrite(absolutePath, content) };
		}

		case 'append':
		case 'prepend': {
			const existing = existed ? readExisting(absolutePath) : '';
			const merged = mode === 'append'
				? appendContent(existing, content, separator)
				: prependContent(existing, content, separator);
			return {
				...base,
				created: !existed,
				bytes: atomicWrite(absolutePath, ensureTrailingNewline(merged)),
			};
		}

		default:
			throw new HostFsError('E_IO', `Unsupported save mode: ${mode}`);
	}
}

function ensureTrailingNewline(content: string): string {
	return content.endsWith('\n') ? content : `${content}\n`;
}

function readExisting(absolutePath: string): string {
	try {
		return readFileSync(absolutePath, 'utf8');
	} catch (error) {
		throw toHostFsError(error, `Could not read ${absolutePath}`);
	}
}

export function isWritableDir(path: string): boolean {
	try {
		if (!statSync(path).isDirectory()) return false;
		const probe = join(path, `.tmp-clip-probe-${process.pid}`);
		writeFileSync(probe, '');
		rmSync(probe, { force: true });
		return true;
	} catch {
		return false;
	}
}

function toHostFsError(error: unknown, message: string): HostFsError {
	const code = (error as NodeJS.ErrnoException)?.code;
	if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
		return new HostFsError('E_PERM', `${message}: permission denied`);
	}
	if (code === 'ENOENT') {
		return new HostFsError('E_NOT_FOUND', `${message}: not found`);
	}
	if (error instanceof HostFsError) return error;
	return new HostFsError('E_IO', `${message}: ${(error as Error)?.message ?? String(error)}`);
}
