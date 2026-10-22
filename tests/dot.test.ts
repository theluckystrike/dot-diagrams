import { describe, expect, it } from 'vitest';
import {
	LIGHT_PALETTE,
	buildDefaults,
	countEdges,
	cssColorToHex,
	defaultsText,
	excerptLine,
	fileProblem,
	findBlockAt,
	hrefTarget,
	insertAfterOpener,
	linkHref,
	parseFileDirective,
	mapWikilinks,
	openerEnd,
	parseDirectives,
	parseError,
	plan,
	parseWikiLink,
	resolveEngine,
	scan,
	sizeProblem,
	themeDefaults,
	tidySvg,
} from '../src/dot';

describe('scan', () => {
	it('splits code, strings, comments and html and covers the whole text', () => {
		const src = 'digraph { a [label="x\\"y"]; // c\n b [label=<<b>z</b>>]; /* d */ }';
		const segs = scan(src);
		expect(segs.map((s) => s.kind)).toEqual(['code', 'string', 'code', 'comment', 'code', 'html', 'code', 'comment', 'code']);
		expect(segs.map((s) => src.slice(s.start, s.end)).join('')).toBe(src);
	});
	it('treats a line that starts with # as a comment, but not a # inside a line', () => {
		expect(scan('# hi\na').map((s) => s.kind)).toEqual(['comment', 'code']);
		expect(scan('a #b').map((s) => s.kind)).toEqual(['code']);
	});
	it('ends an unterminated string and comment at the end of the text', () => {
		expect(scan('a "oops').at(-1)).toMatchObject({ kind: 'string', end: 7 });
		expect(scan('/* oops').at(-1)).toMatchObject({ kind: 'comment', end: 7 });
	});
});

describe('directives and engines', () => {
	it('reads engine and preset from comment lines, first one wins', () => {
		expect(parseDirectives('// engine: Neato\n// layout: circo\n# preset = mono\ngraph {}')).toEqual({ engine: 'neato', preset: 'mono', width: null, align: null });
		expect(parseDirectives('graph { // engine: neato\n}')).toEqual({ engine: null, preset: null, width: null, align: null });
	});
	it('gives free users dot, neato and circo only', () => {
		expect(resolveEngine('circo', 'dot', false)).toEqual({ engine: 'circo', note: null });
		expect(resolveEngine('twopi', 'dot', false).note).toContain('Pro feature');
		expect(resolveEngine('twopi', 'dot', true)).toEqual({ engine: 'twopi', note: null });
		expect(resolveEngine(null, 'osage', false)).toEqual({ engine: 'dot', note: null });
		expect(resolveEngine('x', 'neato', true).note).toContain('Unknown');
	});
});

describe('theme defaults', () => {
	it('follows the palette and ends with a statement for each of graph, node and edge', () => {
		const d = themeDefaults(LIGHT_PALETTE);
		expect(d.graph.bgcolor).toBe('transparent');
		expect(d.node.fontcolor).toBe(LIGHT_PALETTE.fg);
		expect(defaultsText(d)).toMatch(/^graph \[.*\]; node \[.*\]; edge \[.*\];$/);
	});
	it('lets a preset override the theme and ignores an unknown preset', () => {
		expect(buildDefaults(LIGHT_PALETTE, 'mono').graph.bgcolor).toBe('#ffffff');
		expect(buildDefaults(LIGHT_PALETTE, 'nope')).toEqual(themeDefaults(LIGHT_PALETTE));
		expect(buildDefaults(LIGHT_PALETTE, null, '#ffffff').graph.bgcolor).toBe('#ffffff');
	});
	it('finds the opening brace past comments and strings', () => {
		expect(openerEnd('/* { */ digraph "{" { a }')).toBe(21);
		expect(insertAfterOpener('digraph {a}', 'x;')).toBe('digraph { x;a}');
		expect(insertAfterOpener('digraph', 'x;')).toBe('digraph');
	});
});

describe('wikilinks', () => {
	it('parses a whole-text wikilink', () => {
		expect(parseWikiLink('[[A]]')).toEqual({ target: 'A', alias: null });
		expect(parseWikiLink('[[Folder/A#H|Alias]]')).toEqual({ target: 'Folder/A#H', alias: 'Alias' });
		expect(parseWikiLink('see [[A]]')).toBeNull();
		expect(parseWikiLink('[[]]')).toBeNull();
	});
	it('round trips a target through the dd: URL', () => {
		const t = 'Projects/My Note #1 & more';
		expect(hrefTarget(linkHref(t))).toBe(t);
		expect(hrefTarget('https://example.com')).toBeNull();
		expect(hrefTarget('dd:%E0%A4%A')).toBeNull();
	});
	it('counts links and leaves text without [[ alone', () => {
		expect(mapWikilinks('digraph { a -> b }', true)).toEqual({ source: 'digraph { a -> b }', links: 0 });
		expect(mapWikilinks('digraph { "[[A]]" -> "[[B]]" }', true).links).toBe(2);
	});
	it('escapes a quote in a link name', () => {
		const out = mapWikilinks('digraph { a [label="[[He said \\"hi\\"]]"]; }', false).source;
		expect(out).toContain('label="He said \\\\\\"hi\\\\\\""');
	});
	it('does not add a second URL to a list that has one, and does not touch other attributes', () => {
		const out = mapWikilinks('digraph { a [href="[[A]]" label="[[B]]"]; b [comment="[[C]]"]; }', true).source;
		expect(out).toBe('digraph { a [href="dd:A" label="B"]; b [comment="[[C]]"]; }');
	});
});

describe('limits and errors', () => {
	it('counts edge operators outside strings and comments', () => {
		expect(countEdges('digraph { a -> b -> c; "x -> y"; // d -> e\n }')).toBe(2);
		expect(countEdges('graph { a -- b }')).toBe(1);
	});
	it('reports a source over the character or edge limit', () => {
		expect(sizeProblem('a'.repeat(101), 100, 10)).toContain('101 characters');
		expect(sizeProblem('a -> b -> c', 100, 1)).toContain('2 edges');
		expect(sizeProblem('a -> b', 100, 10)).toBeNull();
	});
	it('reads the line number out of a Graphviz message', () => {
		expect(parseError('syntax error in line 3 near \'->\'\n')).toEqual({ line: 3, message: "Syntax error near '->'" });
		expect(parseError('Error: <stdin>: syntax error in line 12 near \'}\'\nWarning: x')).toEqual({ line: 12, message: "Syntax error near '}'" });
		expect(parseError('')).toEqual({ line: null, message: 'Graphviz could not draw this diagram.' });
		expect(parseError('Error: something else')).toEqual({ line: null, message: 'Something else' });
	});
	it('gives the source line of an error, cut to 120 characters', () => {
		expect(excerptLine('a\nb c\nd', 2)).toBe('b c');
		expect(excerptLine('a', null)).toBe('');
		expect(excerptLine('a', 9)).toBe('');
		expect(excerptLine('x'.repeat(200), 1)).toHaveLength(120);
	});
});

describe('css colors', () => {
	it.each([
		['rgb(218, 218, 218)', '#dadada'],
		['rgba(0, 0, 0, 0.5)', '#00000080'],
		['rgb(0 0 0 / 50%)', '#00000080'],
		['rgba(1, 2, 3, 1)', '#010203'],
		['#ABC', '#aabbcc'],
		['#aabbccdd', '#aabbccdd'],
		['#fff8', '#ffffff88'],
	])('%s gives %s', (css, hex) => {
		expect(cssColorToHex(css)).toBe(hex);
	});
	it('returns null for text it cannot read', () => {
		expect(cssColorToHex('var(--x)')).toBeNull();
		expect(cssColorToHex('red')).toBeNull();
		expect(cssColorToHex('')).toBeNull();
	});
});

describe('findBlockAt', () => {
	const note = ['# T', '', '```dot', 'digraph { a -> b }', '```', '', '````graphviz', 'graph { x -- y }', '````', '', '```js', 'dot', '```'].join('\n');
	it('finds the block that holds the cursor line', () => {
		expect(findBlockAt(note, 3)).toEqual({ start: 2, end: 4, lang: 'dot', source: 'digraph { a -> b }' });
		expect(findBlockAt(note, 2)?.lang).toBe('dot');
		expect(findBlockAt(note, 7)).toEqual({ start: 6, end: 8, lang: 'graphviz', source: 'graph { x -- y }' });
	});
	it('returns null outside a DOT block and for other languages', () => {
		expect(findBlockAt(note, 0)).toBeNull();
		expect(findBlockAt(note, 5)).toBeNull();
		expect(findBlockAt(note, 11)).toBeNull();
	});
});

describe('tidySvg', () => {
	it('drops comments and shows note names in tooltips', () => {
		const svg = '<?xml version="1.0"?>\n<!-- Generated by graphviz -->\n<svg>\n<!-- [[A]] -->\n<g><title>[[Folder/A|Alpha]]-&gt;[[B]]</title><text>x</text></g></svg>';
		expect(tidySvg(svg)).toBe('<?xml version="1.0"?>\n<svg>\n<g><title>Alpha-&gt;B</title><text>x</text></g></svg>');
	});
});

describe('file directive', () => {
	it('reads the path from // file:, # file: and a block comment', () => {
		expect(parseFileDirective('// file: graphs/build.dot')).toBe('graphs/build.dot');
		expect(parseFileDirective('# file = build.gv')).toBe('build.gv');
		expect(parseFileDirective('// engine: neato\n/* file: build.dot */')).toBe('build.dot');
	});

	it('removes a wikilink or quotes around the path and keeps spaces inside it', () => {
		expect(parseFileDirective('// file: [[build.dot]]')).toBe('build.dot');
		expect(parseFileDirective('// file: [[graphs/build.dot|Build]]')).toBe('graphs/build.dot');
		expect(parseFileDirective('// file: "my graphs/build 1.dot"')).toBe('my graphs/build 1.dot');
		expect(parseFileDirective('// file:   build.dot   ')).toBe('build.dot');
	});

	it('ignores a missing path, a file text inside a string and a comment that is not alone on its line', () => {
		expect(parseFileDirective('digraph { a -> b }')).toBeNull();
		expect(parseFileDirective('// file:')).toBeNull();
		expect(parseFileDirective('digraph { a [label="// file: x.dot"] }')).toBeNull();
		expect(parseFileDirective('digraph { a -> b } // file: x.dot')).toBeNull();
	});

	it('ignores a file line in a block that has its own graph, so old blocks draw as before', () => {
		expect(parseFileDirective('// file: main.c\ndigraph { a -> b }')).toBeNull();
		expect(parseFileDirective('digraph { a -> b }\n/* file: build.dot */')).toBeNull();
		expect(parseFileDirective('# file: x.dot\n"a"')).toBeNull();
	});

	it('the first file line wins', () => {
		expect(parseFileDirective('// file: a.dot\n// file: b.dot')).toBe('a.dot');
	});

	it('accepts .dot and .gv in any letter case and refuses other files', () => {
		expect(fileProblem('a.dot')).toBeNull();
		expect(fileProblem('dir/a.GV')).toBeNull();
		expect(fileProblem('notes.md')).toMatch(/not a DOT file/);
		expect(fileProblem('a.dot.png')).toMatch(/\.dot or \.gv/);
	});

	it('plan takes the graph from fileText and ignores other text of the block', () => {
		const o = { pro: false, defaultEngine: 'dot' as const, defaultPreset: '', palette: LIGHT_PALETTE };
		const out = plan('// file: a.dot\ndigraph { x -> y }', { ...o, fileText: 'digraph F { p -> q }' });
		expect(out.source).toContain('digraph F {');
		expect(out.source).toContain('p -> q');
		expect(out.source).not.toContain('x -> y');
	});

	it('plan without fileText does not change', () => {
		const o = { pro: false, defaultEngine: 'dot' as const, defaultPreset: '', palette: LIGHT_PALETTE };
		expect(plan('digraph { a -> b }', o)).toEqual(plan('digraph { a -> b }', { ...o, fileText: undefined }));
	});
});
