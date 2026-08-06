// Removes a leading H1 from markdown.
//
// Tolaria reads the first H1 as the note title, so the template emits one
// explicitly. Defuddle is inconsistent about whether extracted content already
// starts with the page's H1, and without this the note would sometimes carry
// two titles.

export const strip_h1 = (str: string): string => {
	// Leading blank lines first, so an H1 preceded by whitespace still matches.
	const content = str.replace(/^\s*\n/, '');

	// ATX form: "# Title" (not "##"), optionally with closing hashes.
	const atx = content.match(/^#[ \t]+.*?(?:\n|$)/);
	if (atx) {
		return content.slice(atx[0].length).replace(/^\s*\n/, '');
	}

	// Setext form: a title underlined with "===".
	const setext = content.match(/^(.+)\n=+[ \t]*(?:\n|$)/);
	if (setext) {
		return content.slice(setext[0].length).replace(/^\s*\n/, '');
	}

	return str;
};
