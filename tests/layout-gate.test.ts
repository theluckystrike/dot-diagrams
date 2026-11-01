// Pro gate for the Graphviz `layout` graph attribute (s1101 FIX item 1).
// Graphviz reads `layout=` in the DOT text and then ignores the engine that the plugin passes.
// A free user must get the base engine and a note, the same as for a `// engine: fdp` comment line.
import { describe, expect, it } from 'vitest';
import { LIGHT_PALETTE, PRO_ENGINES, graphvizSource, plan, type Engine } from '../src/dot';
import { layoutSvg } from '../src/render';

const TRIANGLE = 'a -- b -- c -- a; c -- d; d -- e; e -- a;';

/** Node centers in SVG order. Two layouts are the same when the centers are the same. */
const centers = (svg: string): string[] => Array.from(svg.matchAll(/<ellipse[^>]*?cx="([-\d.]+)" cy="([-\d.]+)"/g)).map((m) => `${m[1]},${m[2]}`);

/** The text that main.ts gives Graphviz (main.ts cachedLayout). On code without graphvizSource, the plan source. */
const drawnSource = (p: ReturnType<typeof plan>, pro: boolean): string => (typeof graphvizSource === 'function' ? graphvizSource(p, pro) : p.source);

async function draw(src: string, pro: boolean, defaultEngine: Engine = 'dot') {
	const p = plan(src, { pro, defaultEngine, defaultPreset: '', palette: LIGHT_PALETTE });
	const r = await layoutSvg(drawnSource(p, pro), p.engine, src);
	expect(r.error, src).toBeNull();
	return { plan: p, svg: r.svg ?? '' };
}

const FREE_LEAKS: [string, string][] = [
	['statement layout=fdp', `graph {\n  layout=fdp;\n  ${TRIANGLE}\n}`],
	['quoted value layout="fdp"', `graph {\n  layout="fdp";\n  ${TRIANGLE}\n}`],
	['graph [layout=fdp]', `graph {\n  graph [layout=fdp];\n  ${TRIANGLE}\n}`],
	['quoted name "layout"="fdp" in a graph list', `graph {\n  graph [ "layout" = "fdp" ];\n  ${TRIANGLE}\n}`],
	['HTML value layout=<fdp>', `graph {\n  layout=<fdp>;\n  ${TRIANGLE}\n}`],
	['concatenated value "f" + "dp"', `graph {\n  layout="f" + "dp";\n  ${TRIANGLE}\n}`],
	['layout set last, after the edges', `graph {\n  ${TRIANGLE}\n  layout=fdp\n}`],
	['comment between name and value', `graph {\n  layout /* x */ = /* y */ fdp;\n  ${TRIANGLE}\n}`],
	['line continuation inside the string', `graph {\n  layout="fd\\\np";\n  ${TRIANGLE}\n}`],
];

describe('layout graph attribute: free users get the base engine and a note', () => {
	it('can tell the dot layout from the fdp layout (control)', async () => {
		const dot = await draw(`graph {\n  ${TRIANGLE}\n}`, false);
		const fdp = await draw(`graph {\n  // engine: fdp\n  ${TRIANGLE}\n}`, true);
		expect(fdp.plan.engine).toBe('fdp');
		expect(centers(dot.svg).length).toBe(5);
		expect(centers(fdp.svg)).not.toEqual(centers(dot.svg));
	});

	for (const [name, src] of FREE_LEAKS) {
		it(`free: ${name}`, async () => {
			const base = await draw(`graph {\n  ${TRIANGLE}\n}`, false);
			const got = await draw(src, false);
			expect(centers(got.svg), 'layout of the drawn SVG').toEqual(centers(base.svg));
			expect(got.plan.engine).toBe('dot');
			expect(got.plan.notes).toContain('The fdp layout engine is a Pro feature. Used dot.');
		});
	}

	it('free: every Pro engine in a layout attribute falls back to the default free engine', async () => {
		for (const engine of PRO_ENGINES) {
			const base = await draw(`graph {\n  ${TRIANGLE}\n}`, false, 'circo');
			const got = await draw(`graph {\n  graph [layout=${engine}];\n  ${TRIANGLE}\n}`, false, 'circo');
			expect(centers(got.svg), `layout of the drawn SVG, ${engine}`).toEqual(centers(base.svg));
			expect(got.plan.engine, engine).toBe('circo');
			expect(got.plan.notes, engine).toContain(`The ${engine} layout engine is a Pro feature. Used circo.`);
		}
	});

	it('free: a layout attribute in a // file: text is gated too', async () => {
		const p = plan('// file: g.dot', { pro: false, defaultEngine: 'dot', defaultPreset: '', palette: LIGHT_PALETTE, fileText: `graph { layout=fdp; ${TRIANGLE} }` });
		const r = await layoutSvg(drawnSource(p, false), p.engine, `graph { ${TRIANGLE} }`);
		const base = await draw(`graph { ${TRIANGLE} }`, false);
		expect(centers(r.svg ?? ''), 'layout of the drawn SVG').toEqual(centers(base.svg));
		expect(p.engine).toBe('dot');
		expect(p.notes).toContain('The fdp layout engine is a Pro feature. Used dot.');
	});

	it('free: a free engine in a layout attribute still works, with no note', async () => {
		const neato = await draw(`graph {\n  // engine: neato\n  ${TRIANGLE}\n}`, false);
		const got = await draw(`graph {\n  layout=neato;\n  ${TRIANGLE}\n}`, false);
		expect(got.plan.notes).toEqual([]);
		expect(centers(got.svg)).toEqual(centers(neato.svg));
	});

	it('free: an unknown layout value gives the base engine and the unknown-engine note (Graphviz names are case-sensitive)', async () => {
		const base = await draw(`graph {\n  ${TRIANGLE}\n}`, false);
		const got = await draw(`graph {\n  layout=FDP;\n  ${TRIANGLE}\n}`, false);
		expect(got.plan.engine).toBe('dot');
		expect(got.plan.notes).toEqual(['Unknown layout engine "FDP". Used dot.']);
		expect(centers(got.svg)).toEqual(centers(base.svg));
	});

	it('free: a layout attribute on a node, an edge list or a subgraph does not count', async () => {
		const got = await draw(`graph {\n  node [layout=fdp];\n  subgraph s { layout=fdp; x }\n  ${TRIANGLE}\n}`, false);
		expect(got.plan.notes).toEqual([]);
	});

	it('free: the word layout in a label, a node name or a comment is not a layout attribute', async () => {
		const got = await draw(`graph {\n  label="layout=fdp";\n  // layout=fdp is a Pro engine\n  "layout" -- x;\n  ${TRIANGLE}\n}`, false);
		expect(got.plan.engine).toBe('dot');
		expect(got.plan.notes).toEqual([]);
	});

	it('free: the pin wins over a layout attribute that the reader did not see', async () => {
		const base = await draw(`graph {\n  ${TRIANGLE}\n}`, false);
		const p = plan(`graph {\n  ${TRIANGLE}\n}`, { pro: false, defaultEngine: 'dot', defaultPreset: '', palette: LIGHT_PALETTE });
		const leaked = { ...p, source: p.source.replace('{', '{ layout=fdp; graph [layout=sfdp];') };
		const r = await layoutSvg(drawnSource(leaked, false), 'dot', leaked.source);
		expect(centers(r.svg ?? '')).toEqual(centers(base.svg));
	});

	it('pro: the layout attribute keeps working as before', async () => {
		const fdp = await draw(`graph {\n  // engine: fdp\n  ${TRIANGLE}\n}`, true);
		const got = await draw(`graph {\n  layout=fdp;\n  ${TRIANGLE}\n}`, true);
		expect(got.plan.notes).toEqual([]);
		expect(centers(got.svg)).toEqual(centers(fdp.svg));
	});
});
