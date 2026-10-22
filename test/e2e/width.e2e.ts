import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Real-app checks of "// width:" and "// align:": the size and place of the diagram in the block, in reading view and
// Live Preview, the lines of a "// file:" file, and Export SVG that does not change with these lines.

const SMALL = 'digraph { a -> b }';
/** 40 nodes in one row: far wider than the note. */
const WIDE = `digraph { rankdir=LR; ${Array.from({ length: 40 }, (_, i) => `n${i}`).join(' -> ')} }`;

interface Box {
	/** Visible DOT blocks in the active tab. */
	blocks: number;
	nodes: number;
	notes: string[];
	/** Content box of the block (it has no side padding). */
	blockLeft: number;
	blockRight: number;
	blockWidth: number;
	scrollWidth: number;
	svgLeft: number;
	svgRight: number;
	svgWidth: number;
	/** The width attribute that Graphviz wrote, in CSS pixels (1 pt = 4/3 px). */
	naturalWidth: number;
}

/** Size and place of the first visible DOT block and its SVG in the active tab. */
async function box(): Promise<Box> {
	return browser.executeObsidian(() => {
		const blocks = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .dot-diagrams')).filter((b) => b.offsetParent !== null);
		const el = blocks[0];
		const svg = el?.querySelector<SVGSVGElement>('svg.dot-diagrams-svg');
		const b = el?.getBoundingClientRect();
		const s = svg?.getBoundingClientRect();
		const pt = Number.parseFloat(svg?.getAttribute('width') ?? '0');
		return {
			blocks: blocks.length,
			nodes: el?.querySelectorAll('svg g.node').length ?? 0,
			notes: Array.from(el?.querySelectorAll('.dot-diagrams-note') ?? []).map((n) => n.textContent ?? ''),
			blockLeft: b?.left ?? 0,
			blockRight: (b?.left ?? 0) + (el?.clientWidth ?? 0),
			blockWidth: el?.clientWidth ?? 0,
			scrollWidth: el?.scrollWidth ?? 0,
			svgLeft: s?.left ?? 0,
			svgRight: s?.right ?? 0,
			svgWidth: s?.width ?? 0,
			naturalWidth: (pt * 4) / 3,
		};
	});
}

async function waitFor(pred: (s: Box) => boolean, msg: string, timeout = 20000): Promise<Box> {
	let last: Box | null = null;
	try {
		await browser.waitUntil(
			async () => {
				last = await box();
				return pred(last);
			},
			{ timeout, interval: 250 },
		);
	} catch {
		throw new Error(`${msg}; last state ${JSON.stringify(last)}`);
	}
	return last!;
}

/** Writes a note with one dot block, opens it in reading view or Live Preview, and puts the cursor after the block. */
async function openBlock(name: string, code: string, mode: 'preview' | 'live'): Promise<void> {
	const path = `Width/${name}.md`;
	await obsidianPage.write(path, `# ${name}\n\n\`\`\`dot\n${code}\n\`\`\`\n\nAfter.\n`);
	await obsidianPage.openFile(path);
	await browser.executeObsidian(async ({ app }, m) => {
		const leaf = app.workspace.getLeaf(false);
		const state = leaf.getViewState();
		await leaf.setViewState({ ...state, state: { ...state.state, mode: m === 'preview' ? 'preview' : 'source', source: false } });
		const ed = (app.workspace as unknown as { activeEditor?: { editor?: { lastLine(): number; setCursor(p: { line: number; ch: number }): void } } }).activeEditor?.editor;
		if (m === 'live' && ed) ed.setCursor({ line: ed.lastLine(), ch: 0 });
	}, mode);
}

/** Pro on with a stubbed GitHub Sponsors reply and a fake token (no real request), or off. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

describe(`${pluginId} width and alignment`, function () {
	for (const mode of ['preview', 'live'] as const) {
		it(`${mode}: // width: 50% draws the SVG at half of the block width`, async function () {
			await openBlock(`Half ${mode}`, `// width: 50%\n${SMALL}`, mode);
			const s = await waitFor((x) => x.nodes === 2 && x.svgWidth > 0, `no svg in ${mode}`);
			expect(s.notes).toEqual([]);
			expect(Math.abs(s.svgWidth - s.blockWidth * 0.5)).toBeLessThanOrEqual(2);
		});
	}

	for (const mode of ['preview', 'live'] as const) {
		it(`${mode}: // width: natural draws a wide graph at the Graphviz width, and the block scrolls`, async function () {
			await openBlock(`Natural ${mode}`, `// width: natural\n${WIDE}`, mode);
			const s = await waitFor((x) => x.nodes === 40 && x.svgWidth > 0, `no wide svg in ${mode}`);
			expect(s.naturalWidth).toBeGreaterThan(s.blockWidth);
			expect(Math.abs(s.svgWidth - s.naturalWidth)).toBeLessThanOrEqual(2);
			expect(s.scrollWidth).toBeGreaterThan(s.blockWidth);
		});
	}

	it('fit (no width line) shrinks the same wide graph to the block width', async function () {
		await openBlock('Fit', WIDE, 'preview');
		const s = await waitFor((x) => x.nodes === 40 && x.svgWidth > 0, 'no fit svg');
		expect(s.svgWidth).toBeLessThanOrEqual(s.blockWidth + 1);
	});

	for (const mode of ['preview', 'live'] as const) {
		it(`${mode}: // align: left puts the diagram at the left edge, and no align line centers it`, async function () {
			await openBlock(`Left ${mode}`, `// align: left\n${SMALL}`, mode);
			const left = await waitFor((x) => x.nodes === 2 && x.svgWidth > 0, `no left svg in ${mode}`);
			expect(left.svgWidth).toBeLessThan(left.blockWidth / 2);
			expect(Math.abs(left.svgLeft - left.blockLeft)).toBeLessThanOrEqual(2);
			await openBlock(`Center ${mode}`, SMALL, mode);
			const mid = await waitFor((x) => x.nodes === 2 && x.svgWidth > 0, `no centered svg in ${mode}`);
			expect(Math.abs(mid.svgLeft - mid.blockLeft - (mid.blockRight - mid.svgRight))).toBeLessThanOrEqual(2);
		});
	}

	it('// align: right puts the diagram at the right edge', async function () {
		await openBlock('Right', `// align: right\n${SMALL}`, 'preview');
		const s = await waitFor((x) => x.nodes === 2 && x.svgWidth > 0, 'no right svg');
		expect(Math.abs(s.blockRight - s.svgRight)).toBeLessThanOrEqual(2);
	});

	it('a // file: block uses the width line of the file, and a width line of the block wins', async function () {
		await obsidianPage.write('graphs/build.dot', `// width: 70%\ndigraph Build {\n  src -> obj -> bin;\n}`);
		await openBlock('File width', '// file: graphs/build.dot', 'preview');
		const fromFile = await waitFor((x) => x.nodes === 3 && x.svgWidth > 0, 'the file diagram did not draw');
		expect(Math.abs(fromFile.svgWidth - fromFile.blockWidth * 0.7)).toBeLessThanOrEqual(2);
		await openBlock('Block width', '// file: graphs/build.dot\n// width: 40%', 'preview');
		const fromBlock = await waitFor((x) => x.nodes === 3 && x.svgWidth > 0, 'the file diagram with a block width did not draw');
		expect(Math.abs(fromBlock.svgWidth - fromBlock.blockWidth * 0.4)).toBeLessThanOrEqual(2);
	});

	it('shows a note under the diagram for a width that is not valid', async function () {
		await openBlock('Huge', `// width: huge\n${SMALL}`, 'preview');
		const s = await waitFor((x) => x.nodes === 2 && x.notes.length > 0, 'no note for the bad width');
		expect(s.notes).toEqual(['Unknown width "huge". Use fit, natural, 10% to 100%, or 50px to 4000px.']);
	});

	describe('Export SVG (Pro, stubbed GitHub Sponsors reply)', function () {
		before(async function () {
			await setPro(true);
		});
		after(async function () {
			await setPro(false);
		});

		it('gives the same file for a block with // width: 30% and the same block without it', async function () {
			const out = await browser.executeObsidian(async ({ app }, id, graph) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, { exportBlock(s: string, path: string, kind: 'svg'): Promise<string | null> }> } }).plugins.plugins[id]!;
				await app.vault.adapter.write('Width/Export.md', '');
				const plain = await p.exportBlock(graph, 'Width/Export.md', 'svg');
				const sized = await p.exportBlock(`// width: 30%\n${graph}`, 'Width/Export.md', 'svg');
				const read = async (path: string | null) => (path ? app.vault.adapter.read(path) : '');
				return { plain, sized, a: await read(plain), b: await read(sized) };
			}, pluginId, SMALL);
			expect(out.plain).not.toBeNull();
			expect(out.sized).not.toBeNull();
			expect(out.plain).not.toBe(out.sized);
			expect(out.a).toContain('<svg');
			expect(out.b).toBe(out.a);
		});
	});
});
