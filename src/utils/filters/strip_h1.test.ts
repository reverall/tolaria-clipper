import { describe, it, expect } from 'vitest';
import { strip_h1 } from './strip_h1';

describe('strip_h1', () => {
	it('removes a leading ATX heading', () => {
		expect(strip_h1('# Title\n\nBody text')).toBe('Body text');
	});

	it('removes a leading heading preceded by blank lines', () => {
		expect(strip_h1('\n\n# Title\n\nBody')).toBe('Body');
	});

	it('leaves deeper headings alone', () => {
		expect(strip_h1('## Résumé\n\nBody')).toBe('## Résumé\n\nBody');
	});

	it('leaves content without a heading alone', () => {
		expect(strip_h1('Just a paragraph')).toBe('Just a paragraph');
	});

	it('does not remove a heading that appears later', () => {
		const content = 'Intro\n\n# Later heading\n';
		expect(strip_h1(content)).toBe(content);
	});

	it('removes a setext heading', () => {
		expect(strip_h1('Title\n=====\n\nBody')).toBe('Body');
	});

	it('does not treat a hashtag-like word as a heading', () => {
		expect(strip_h1('#tag not a heading')).toBe('#tag not a heading');
	});

	it('handles a document that is only a heading', () => {
		expect(strip_h1('# Title')).toBe('');
	});
});
