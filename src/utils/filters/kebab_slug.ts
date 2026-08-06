// Filename-safe slug for Tolaria notes.
//
// Separate from the `kebab` filter, which only handles camelCase, spaces and
// underscores: fed a real page title it leaves accents and punctuation intact
// ("Idée" stays "idée", "Huashu Design · HTML-native" keeps the "·"). Changing
// `kebab` would silently break existing templates, so this is a new filter.
//
// Length is capped well below the filesystem limit because in Tolaria the
// filename is secondary — the H1 carries the title — so short is strictly
// better than a 180-character filename.
const MAX_LENGTH = 80;

/** Reserved device names on Windows, which cannot be used as filenames. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export const kebab_slug = (str: string): string => {
	const slug = str
		.normalize('NFKD')
		// Strip the combining marks that NFKD just split off: é → e.
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	const truncated = truncateAtWordBoundary(slug, MAX_LENGTH);

	if (!truncated) return 'untitled';
	if (WINDOWS_RESERVED.test(truncated)) return `${truncated}-note`;
	return truncated;
};

/** Cut on a separator when there is one, so words are not left half-written. */
function truncateAtWordBoundary(slug: string, maxLength: number): string {
	if (slug.length <= maxLength) return slug;

	const clipped = slug.slice(0, maxLength);
	const lastSeparator = clipped.lastIndexOf('-');

	// Only honour the boundary if it keeps a useful amount of the title.
	const candidate = lastSeparator > maxLength / 2 ? clipped.slice(0, lastSeparator) : clipped;
	return candidate.replace(/-+$/, '');
}
