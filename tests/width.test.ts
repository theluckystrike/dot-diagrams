import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import vectors from './vectors/dot-diagrams.json';
import { LIGHT_PALETTE, parseDirectives, parseWidth, plan, viewOptions, type PlanOptions, type ViewDefaults } from '../src/dot';
import { DotBlock } from '../src/block';
import DotDiagramsPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

const DEFAULTS: ViewDefaults = { width: 'fit', align: 'center' };
const GRAPH = 'digraph { a -> b }';

describe('width and align directives', () => {
	it('reads // width and # align lines, and viewOptions gives 60% and right', () => {
		const block = `// width: 60%\n# align: right\n${GRAPH}`;
		expect(parseDirectives(block)).toMatchObject({ width: '60%', align: 'right' });
		expect(viewOptions(block, undefined, DEFAULTS)).toEqual({ width: '60%', align: 'right', notes: [] });
	});

	it('reads block comments, and the first line of each kind wins', () => {
		const block = `/* width: 480px */\n/* align: left */\n// width: natural\n// align: right\n${GRAPH}`;
		expect(viewOptions(block, undefined, DEFAULTS)).toEqual({ width: '480px', align: 'left', notes: [] });
	});

	it('accepts fit, natural, 10% to 100% and 50px to 4000px, in any case', () => {
		for (const [value, want] of [
			['fit', 'fit'],
			['Natural', 'natural'],
			['10%', '10%'],
			['100%', '100%'],
			['62.5%', '62.5%'],
			['50px', '50px'],
			['4000PX', '4000px'],
			['60 %', '60%'],
		] as const) {
			expect(parseWidth(value), value).toBe(want);
		}
	});

	it('gives the default width and one note for each value that is not valid', () => {
		for (const bad of ['5%', '120%', '20px', '5000px', 'huge']) {
			const v = viewOptions(`// width: ${bad}\n${GRAPH}`, undefined, DEFAULTS);
			expect(v.width, bad).toBe('fit');
			expect(v.notes, bad).toEqual([`Unknown width "${bad}". Use fit, natural, 10% to 100%, or 50px to 4000px.`]);
		}
		expect(viewOptions(`// width: huge\n${GRAPH}`, undefined, { width: 'natural', align: 'left' })).toMatchObject({ width: 'natural', align: 'left' });
	});

	it('gives the default alignment and a note for an unknown alignment', () => {
		const v = viewOptions(`// align: middle\n${GRAPH}`, undefined, { width: 'fit', align: 'left' });
		expect(v).toEqual({ width: 'fit', align: 'left', notes: ['Unknown alignment "middle". Use left, center or right.'] });
	});

	it('does not read a width line inside the graph code', () => {
		expect(viewOptions('digraph { a -> b // width: 50%\n}', undefined, DEFAULTS)).toEqual({ width: 'fit', align: 'center', notes: [] });
	});

	it('uses the width and align lines of a // file: file, and lines of the block win', () => {
		const file = `// width: 70%\n// align: right\n${GRAPH}`;
		expect(viewOptions('// file: graphs/build.dot', file, DEFAULTS)).toEqual({ width: '70%', align: 'right', notes: [] });
		expect(viewOptions('// file: graphs/build.dot\n// width: 40%', file, DEFAULTS)).toEqual({ width: '40%', align: 'right', notes: [] });
	});
});

describe('blocks from 1.2.0', () => {
	it('give the default width and alignment, with no note', () => {
		for (const c of vectors.cases) {
			const [block, opts] = c.args as [string, PlanOptions];
			expect(viewOptions(block, opts.fileText, DEFAULTS), c.name).toEqual({ width: 'fit', align: 'center', notes: [] });
		}
	});

	it('the width and align lines do not change the plan: no attribute goes to Graphviz', () => {
		const opts: PlanOptions = { pro: false, defaultEngine: 'dot', defaultPreset: '', palette: LIGHT_PALETTE };
		const before = plan(GRAPH, opts);
		const after = plan(`// width: 30%\n// align: left\n${GRAPH}`, opts);
		expect(after).toEqual({ ...before, source: `// width: 30%\n// align: left\n${before.source}` });
		expect(after.source).not.toMatch(/\bwidth\s*=|\balign\s*=/);
	});
});

describe('default width and alignment settings', () => {
	it('default to fit and center', () => {
		expect(DEFAULT_SETTINGS).toMatchObject({ defaultWidth: 'fit', defaultAlign: 'center' });
	});

	it('replace an unknown default width or alignment with fit and center', () => {
		expect(normalizeSettings({ defaultWidth: '60%' as never, defaultAlign: 'middle' as never })).toMatchObject({ defaultWidth: 'fit', defaultAlign: 'center' });
		expect(normalizeSettings({ defaultWidth: 3 as never, defaultAlign: null as never })).toMatchObject({ defaultWidth: 'fit', defaultAlign: 'center' });
		expect(normalizeSettings({ defaultWidth: 'natural', defaultAlign: 'right' })).toMatchObject({ defaultWidth: 'natural', defaultAlign: 'right' });
	});
});

describe('DotBlock width and alignment', () => {
	async function drawn(source: string, settings: Partial<typeof DEFAULT_SETTINGS> = {}, files: Record<string, string> = {}): Promise<HTMLElement> {
		const app = App.createConfigured__({ files: { 'n.md': '', ...files } });
		const plugin = new DotDiagramsPlugin(app as never, manifest as never);
		plugin.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
		const el = document.createElement('div');
		document.body.appendChild(el);
		const block = new DotBlock(el, plugin, source, 'n.md');
		await block.draw();
		return el;
	}

	it('sets the width variable and the align class for a percent width', async () => {
		const el = await drawn(`// width: 50%\n// align: left\n${GRAPH}`);
		expect(el.querySelector('svg.dot-diagrams-svg')).not.toBeNull();
		expect(el.style.getPropertyValue('--dot-diagrams-width')).toBe('50%');
		expect(el.classList.contains('dot-diagrams-sized')).toBe(true);
		expect(el.classList.contains('dot-diagrams-align-left')).toBe(true);
		expect(el.classList.contains('dot-diagrams-align-center')).toBe(false);
		expect(el.querySelectorAll('.dot-diagrams-note').length).toBe(0);
	});

	it('has no width variable for fit, and is centered by default', async () => {
		const el = await drawn(GRAPH);
		expect(el.style.getPropertyValue('--dot-diagrams-width')).toBe('');
		expect(el.classList.contains('dot-diagrams-sized')).toBe(false);
		expect(el.classList.contains('dot-diagrams-natural')).toBe(false);
		expect(el.classList.contains('dot-diagrams-align-center')).toBe(true);
	});

	it('uses the default width and alignment settings', async () => {
		const el = await drawn(GRAPH, { defaultWidth: 'natural', defaultAlign: 'right' });
		expect(el.classList.contains('dot-diagrams-natural')).toBe(true);
		expect(el.classList.contains('dot-diagrams-align-right')).toBe(true);
	});

	it('shows a note under the diagram for a width that is not valid', async () => {
		const el = await drawn(`// width: huge\n${GRAPH}`);
		expect(el.querySelector('svg.dot-diagrams-svg')).not.toBeNull();
		expect(Array.from(el.querySelectorAll('.dot-diagrams-note')).map((n) => n.textContent)).toEqual(['Unknown width "huge". Use fit, natural, 10% to 100%, or 50px to 4000px.']);
	});

	it('reads the width of a DOT file, and the block line wins', async () => {
		const files = { 'graphs/build.dot': `// width: 70%\n${GRAPH}` };
		expect((await drawn('// file: graphs/build.dot', {}, files)).style.getPropertyValue('--dot-diagrams-width')).toBe('70%');
		expect((await drawn('// file: graphs/build.dot\n// width: 40%', {}, files)).style.getPropertyValue('--dot-diagrams-width')).toBe('40%');
	});
});

describe('export', () => {
	it('gives the same SVG with and without width and align lines', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new DotDiagramsPlugin(app as never, manifest as never);
		const plain = await plugin.exportSvgText(GRAPH, 'n.md');
		const sized = await plugin.exportSvgText(`// width: 30%\n// align: right\n${GRAPH}`, 'n.md');
		expect(plain).toContain('<svg');
		expect(sized).toBe(plain);
	});
});
