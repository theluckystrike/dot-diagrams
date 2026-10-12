import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_ENGINES, FREE_ENGINES, LIGHT_PALETTE, PRO_ENGINES, plan } from '../src/dot';
import { countNodes, layoutSvg, parseSvg, sanitizeSvg, svgSize } from '../src/render';
// @ts-expect-error plain JS build helper without types
import { patchGraphviz } from '../patch-graphviz.mjs';

const LIB = join(__dirname, '..', 'node_modules', '@hpcc-js', 'wasm-graphviz', 'dist', 'index.js');

describe('layout with the real Graphviz WASM build', () => {
	it('draws three nodes for a three node chain', async () => {
		const r = await layoutSvg('digraph { a -> b -> c }', 'dot', 'digraph { a -> b -> c }');
		expect(r.error).toBeNull();
		const svg = parseSvg(r.svg ?? '', document);
		expect(svg).not.toBeNull();
		expect(countNodes(svg as SVGSVGElement)).toBe(3);
		expect(svgSize(r.svg ?? '')).not.toBeNull();
	});
	it('draws with every one of the seven engines', async () => {
		expect([...FREE_ENGINES, ...PRO_ENGINES]).toEqual([...ALL_ENGINES]);
		for (const engine of ALL_ENGINES) {
			const r = await layoutSvg('graph { a -- b -- c -- a }', engine, 'graph { a -- b -- c -- a }');
			expect(r.svg, engine).toContain('<svg');
			expect(countNodes(parseSvg(r.svg ?? '', document) as SVGSVGElement), engine).toBe(3);
		}
	});
	it('reports a syntax error with its line number', async () => {
		const src = 'digraph {\n  a -> b;\n  b -> ;\n}';
		const r = await layoutSvg(src, 'dot', src);
		expect(r.svg).toBeNull();
		expect(r.error?.line).toBe(3);
		expect(r.error?.message).toMatch(/syntax error/i);
	});
	it('names the line of the author text when only the preprocessed text is wrong', async () => {
		const raw = 'digraph {\n  a -> b -> ;\n}';
		const r = await layoutSvg(raw.replace('{', '{ node [color="x"];'), 'dot', raw);
		expect(r.error?.line).toBe(2);
	});
});

describe('wikilink nodes with the real Graphviz WASM build', () => {
	const draw = async (src: string, pro: boolean) => {
		const p = plan(src, { pro, defaultEngine: 'dot', defaultPreset: '', palette: LIGHT_PALETTE });
		const r = await layoutSvg(p.source, p.engine, src);
		expect(r.error).toBeNull();
		return parseSvg(r.svg ?? '', document) as SVGSVGElement;
	};
	const texts = (svg: SVGSVGElement, sel: string) => Array.from(svg.querySelectorAll(`${sel} text`)).map((t) => t.textContent);

	it('gives wikilink nodes the node defaults of the author', async () => {
		for (const pro of [false, true]) {
			const svg = await draw('digraph {\n  node [shape=box];\n  "[[A]]" -> "[[B|Bee]]";\n  subgraph cluster_x { node [shape=diamond]; "[[C]]" }\n}', pro);
			expect(svg.querySelectorAll('g.node ellipse').length, `pro ${pro}`).toBe(0);
			expect(svg.querySelectorAll('g.node polygon').length, `pro ${pro}`).toBe(3);
			expect(texts(svg, 'g.node')).toEqual(['A', 'Bee', 'C']);
		}
	});

	it('draws a wikilink edge with no semicolon before the closing brace', async () => {
		const svg = await draw('digraph { "[[A]]" -> "[[B|Bee]]" }', true);
		expect(texts(svg, 'g.node')).toEqual(['A', 'Bee']);
	});

	it('keeps a label and a URL that the author set on a wikilink node', async () => {
		const svg = await draw('digraph {\n  "[[A]]" -> "[[B]]";\n  "[[B]]" [label="Custom" URL="https://example.com/"];\n}', true);
		expect(texts(svg, 'g.node')).toEqual(['A', 'Custom']);
		expect(Array.from(svg.querySelectorAll('g.node a')).map((a) => a.getAttribute('xlink:href'))).toEqual(['dd:A', 'https://example.com/']);
	});

	it('does not make a node from a graph label or a subgraph name', async () => {
		const svg = await draw('digraph {\n  label="[[Home]]";\n  subgraph "[[S]]" { a }\n  a -> b;\n}', true);
		expect(countNodes(svg)).toBe(2);
		const graphText = Array.from(svg.querySelector('g.graph')?.children ?? []).filter((c) => c.localName === 'text');
		expect(graphText.map((t) => t.textContent)).toEqual(['Home']);
	});
});

describe('sanitizeSvg', () => {
	const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="x()">
<script>alert(1)</script><foreignObject><div>x</div></foreignObject>
<image xlink:href="https://example.com/a.png"/><image xlink:href="data:image/png;base64,AAAA"/>
<a xlink:href="javascript:alert(1)"><text>js</text></a>
<a xlink:href="https://example.com/"><text>web</text></a>
<a xlink:href="dd:Note"><text>note</text></a>
<g class="node" onclick="y()"><title>a</title></g></svg>`;
	it('removes scripts, handlers, foreign objects, remote images and unsafe links; keeps notes for Pro', () => {
		const svg = parseSvg(dirty, document) as SVGSVGElement;
		sanitizeSvg(svg, true);
		expect(svg.querySelector('script, foreignObject')).toBeNull();
		expect(svg.getAttribute('onload')).toBeNull();
		expect(svg.querySelector('g')?.getAttribute('onclick')).toBeNull();
		const images = Array.from(svg.querySelectorAll('image')).map((i) => i.getAttribute('xlink:href'));
		expect(images).toEqual(['data:image/png;base64,AAAA']);
		const hrefs = Array.from(svg.querySelectorAll('a')).map((a) => a.getAttribute('xlink:href'));
		expect(hrefs).toEqual([null, 'https://example.com/', 'dd:Note']);
		expect(svg.classList.contains('dot-diagrams-svg')).toBe(true);
	});
	it('drops note links for free users', () => {
		const svg = parseSvg(dirty, document) as SVGSVGElement;
		sanitizeSvg(svg, false);
		expect(Array.from(svg.querySelectorAll('a')).map((a) => a.getAttribute('xlink:href'))).toEqual([null, 'https://example.com/', null]);
	});
	it('rejects text that is not an SVG', () => {
		expect(parseSvg('<html></html>', document)).toBeNull();
		expect(parseSvg('<svg><', document)).toBeNull();
	});
});

describe('patch-graphviz', () => {
	const text = readFileSync(LIB, 'utf8');
	const patched = patchGraphviz(text) as string;
	it('removes every network call site of the library', () => {
		expect(text).toMatch(/new XMLHttpRequest/);
		expect(text).toMatch(/fetch\(e,/);
		expect(patched).not.toMatch(/new XMLHttpRequest/);
		expect(patched).not.toMatch(/\bfetch\s*\(/);
		expect(patched).not.toMatch(/\.open\(["'](?:GET|HEAD)/);
		expect(text.length - patched.length).toBeGreaterThan(1500);
	});
	it('still draws a graph', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dot-diagrams-patch-'));
		writeFileSync(join(dir, 'graphviz.mjs'), patched);
		const run = `import { Graphviz } from './graphviz.mjs'; const g = await Graphviz.load(); process.stdout.write(g.layout('digraph { a -> b }', 'svg', 'dot'));`;
		writeFileSync(join(dir, 'run.mjs'), run);
		const out = execFileSync(process.execPath, [join(dir, 'run.mjs')], { encoding: 'utf8' });
		expect(out).toContain('class="node"');
	});
	it('fails the build on a library that is not the pinned version', () => {
		expect(() => patchGraphviz('function other(){}')).toThrow(/expected one/);
		expect(() => patchGraphviz(text.replace('c.stream_ops=y,c}', 'c.stream_ops=y,d}'))).toThrow(/end of createLazyFile/);
	});
});
