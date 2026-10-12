import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

// Real-app checks of DOT Diagrams: a dot block draws an SVG with N nodes in reading view and Live Preview,
// a syntax error shows its line number, the theme changes the colors, Pro features are locked until a stubbed
// GitHub Sponsors reply turns them on, and the renderer asks no remote host for anything.

const FLOW = ['digraph G {', '  rankdir=LR;', '  a -> b -> c;', '  a -> d;', '}'].join('\n');
const BROKEN = ['digraph G {', '  a -> b;', '  b -> ;', '}'].join('\n');

interface BlockState {
	blocks: number;
	nodes: number;
	edges: number;
	problem: string;
	notes: string[];
	links: number;
	firstTextFill: string;
	svgText: string;
	buttons: string[];
}

/** State of the first DOT block in the active tab. */
async function blockState(): Promise<BlockState> {
	return browser.executeObsidian(() => {
		// Only visible blocks: a note that was switched from Live Preview to reading view keeps the hidden editor widget.
		const blocks = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .dot-diagrams')).filter((b) => b.offsetParent !== null);
		const el = blocks[0];
		const svg = el?.querySelector('svg.dot-diagrams-svg');
		return {
			blocks: blocks.length,
			nodes: el?.querySelectorAll('svg g.node').length ?? 0,
			edges: el?.querySelectorAll('svg g.edge').length ?? 0,
			problem: el?.querySelector('.dot-diagrams-error')?.textContent ?? '',
			notes: Array.from(el?.querySelectorAll('.dot-diagrams-note') ?? []).map((n) => n.textContent ?? ''),
			links: el?.querySelectorAll('svg a.dot-diagrams-link').length ?? 0,
			firstTextFill: el?.querySelector('svg.dot-diagrams-svg text')?.getAttribute('fill') ?? '',
			svgText: svg ? new XMLSerializer().serializeToString(svg) : '',
			buttons: Array.from(el?.querySelectorAll('.dot-diagrams-button') ?? []).map((b) => b.getAttribute('data-action') ?? ''),
		};
	});
}

async function waitFor(pred: (s: BlockState) => boolean, msg: string, timeout = 20000): Promise<BlockState> {
	let last: BlockState | null = null;
	let failure = '';
	try {
		await browser.waitUntil(
			async () => {
				try {
					last = await blockState();
				} catch (e) {
					failure = e instanceof Error ? e.message : String(e);
					return false;
				}
				return pred(last);
			},
			{ timeout, interval: 250 },
		);
	} catch {
		const shown = last ? { ...(last as BlockState), svgText: '...' } : null;
		throw new Error(`${msg}; last state ${JSON.stringify(shown)}; last failure ${failure}`);
	}
	return last!;
}

/** Puts the cursor of the active editor on a line (0-based) and returns the line it reports. */
async function setCursorLine(line: number): Promise<number | null> {
	return browser.executeObsidian(({ app }, l) => {
		const ed = (app.workspace as unknown as { activeEditor?: { editor?: { setCursor(p: { line: number; ch: number }): void; getCursor(): { line: number } } } }).activeEditor?.editor;
		ed?.setCursor({ line: l, ch: 0 });
		return ed ? ed.getCursor().line : null;
	}, line);
}

/** The text color of the current theme (--text-normal) as #rrggbb, resolved by the browser at the visible block. */
async function themeTextHex(): Promise<string> {
	return browser.execute(() => {
		const el = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .dot-diagrams')).find((b) => b.offsetParent !== null) ?? document.body;
		const probe = document.createElement('span');
		probe.style.color = getComputedStyle(el).getPropertyValue('--text-normal').trim();
		el.appendChild(probe);
		const rgb = getComputedStyle(probe).color;
		probe.remove();
		const n = (rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0'));
		return `#${n.join('')}`;
	});
}

/** Text of every notice on screen. */
async function allNotices(): Promise<string> {
	return browser.execute(() => Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? '').join(' | '));
}

/** Writes a note with one fenced block, opens it, and switches to reading view or Live Preview. */
async function openBlock(name: string, code: string, mode: 'preview' | 'live', lang = 'dot'): Promise<void> {
	const path = `Diagrams/${name}.md`;
	await obsidianPage.write(path, `# ${name}\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\nAfter.\n`);
	await obsidianPage.openFile(path);
	await browser.executeObsidian(async ({ app }, m) => {
		const leaf = app.workspace.getLeaf(false);
		const state = leaf.getViewState();
		await leaf.setViewState({ ...state, state: { ...state.state, mode: m === 'preview' ? 'preview' : 'source', source: false } });
	}, mode);
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
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

async function click(selector: string): Promise<void> {
	await browser.execute((sel: string) => Array.from(document.querySelectorAll<HTMLElement>(`.workspace-leaf.mod-active ${sel}`)).find((e) => (e.closest('.dot-diagrams') as HTMLElement | null)?.offsetParent !== null)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), selector);
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setPro(false);
	});

	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('draws a dot block as an SVG with 4 nodes and 3 edges in reading view', async function () {
		await openBlock('Flow reading', FLOW, 'preview');
		const s = await waitFor((x) => x.nodes > 0, 'no svg in reading view');
		expect(s).toMatchObject({ blocks: 1, nodes: 4, edges: 3, problem: '' });
		expect(s.buttons).toEqual(['copy', 'export-svg', 'export-png']);
	});

	it('draws the same block in Live Preview, and shows its source while the cursor is inside it', async function () {
		await openBlock('Flow live', FLOW, 'live');
		// FLOW sits on lines 3 to 7 of the note (the fences are lines 2 and 8). Line 10 is the text after the block.
		expect(await setCursorLine(10)).toBe(10);
		const s = await waitFor((x) => x.nodes > 0, 'no svg in Live Preview with the cursor outside the block');
		expect(s).toMatchObject({ nodes: 4, edges: 3, problem: '' });
		expect(await setCursorLine(5)).toBe(5);
		await waitFor((x) => x.blocks === 0, 'the diagram still shows while the cursor is inside the block');
		expect(await setCursorLine(10)).toBe(10);
		await waitFor((x) => x.nodes === 4, 'the diagram did not come back when the cursor left the block');
	});

	it('draws a graphviz block too', async function () {
		await openBlock('Graphviz lang', 'graph { x -- y -- z -- x }', 'preview', 'graphviz');
		const s = await waitFor((x) => x.nodes > 0, 'no svg for the graphviz language');
		expect(s.nodes).toBe(3);
	});

	it('shows a syntax error with its line number inside the note', async function () {
		await openBlock('Broken', BROKEN, 'preview');
		const s = await waitFor((x) => x.problem !== '', 'no error message');
		expect(s.problem).toContain('line 3');
		expect(s.problem).toMatch(/syntax error/i);
		expect(s.problem).toContain('b -> ;');
		expect(s.nodes).toBe(0);
	});

	it('draws a .dot file of the vault, and draws again when the file changes', async function () {
		await obsidianPage.write('Diagrams/build.dot', 'digraph Build {\n  src -> obj -> bin;\n}');
		await openBlock('From file', '// file: build.dot', 'preview');
		const first = await waitFor((x) => x.nodes === 3, 'the file diagram did not draw with 3 nodes');
		expect(first).toMatchObject({ edges: 2, problem: '' });
		await obsidianPage.write('Diagrams/build.dot', 'digraph Build {\n  src -> obj -> bin;\n  obj -> test;\n}');
		const second = await waitFor((x) => x.nodes === 4, 'the diagram did not draw again after the file changed');
		expect(second.edges).toBe(3);
	});

	it('names the file and its line in a syntax error of a .gv file', async function () {
		await obsidianPage.write('Diagrams/broken.gv', 'digraph G {\n  a -> b;\n  b -> ;\n}');
		await openBlock('Broken file', '// file: broken.gv', 'preview');
		const s = await waitFor((x) => x.problem !== '', 'no error message for the broken file');
		expect(s.problem).toContain('line 3');
		expect(s.problem).toContain('Diagrams/broken.gv');
		expect(s.problem).toContain('b -> ;');
	});

	it('says that a missing file is not in the vault', async function () {
		await openBlock('Missing file', '// file: nowhere.dot', 'preview');
		const s = await waitFor((x) => x.problem !== '', 'no error message for the missing file');
		expect(s.problem).toContain('"nowhere.dot" is not in this vault');
	});

	it('follows the theme: light text on a dark theme, dark text on a light theme', async function () {
		await openBlock('Theme', FLOW, 'preview');
		await waitFor((x) => x.nodes > 0, 'no svg for the theme test');
		const original = await browser.execute(() => document.body.className);
		const fills: Record<string, string> = {};
		try {
			for (const theme of ['theme-dark', 'theme-light']) {
				await browser.executeObsidian(({ app }, t) => {
					document.body.classList.remove('theme-dark', 'theme-light');
					document.body.classList.add(t);
					app.workspace.trigger('css-change');
				}, theme);
				// The diagram draws again after a short delay. Wait until its text color is the theme's text color.
				const want = await themeTextHex();
				await waitFor((x) => x.firstTextFill === want, `the diagram text did not take the ${theme} text color ${want}`);
				fills[theme] = want;
			}
		} finally {
			await browser.executeObsidian(({ app }, cls) => {
				document.body.className = cls;
				app.workspace.trigger('css-change');
			}, original);
		}
		const lum = (hex: string): number => parseInt(hex.slice(1, 3), 16);
		expect(fills['theme-dark']).toMatch(/^#[0-9a-f]{6}$/);
		expect(fills['theme-light']).toMatch(/^#[0-9a-f]{6}$/);
		expect(fills['theme-dark']).not.toBe(fills['theme-light']);
		expect(lum(fills['theme-dark']!)).toBeGreaterThan(lum(fills['theme-light']!));
	});

	it('asks no remote host for anything, even when the block names a remote image', async function () {
		await openBlock('Remote', 'digraph { a [image="https://example.com/remote.png" label=""]; a -> b }', 'preview');
		const s = await waitFor((x) => x.nodes > 0, 'no svg for the remote image block');
		expect(s.svgText).not.toContain('example.com/remote.png');
		const remote = await browser.execute(() => performance.getEntriesByType('resource').filter((e) => /example\.com/.test(e.name)).length);
		expect(remote).toBe(0);
	});

	describe('free version', function () {
		before(async function () {
			await setPro(false);
		});

		it('uses dot for a Pro layout engine and says so', async function () {
			await openBlock('Engine free', '// engine: fdp\ngraph { a -- b -- c }', 'preview');
			const s = await waitFor((x) => x.nodes > 0, 'no svg for the fdp block');
			expect(s.notes.join(' ')).toContain('fdp layout engine is a Pro feature');
		});

		it('draws neato and circo for free', async function () {
			for (const engine of ['neato', 'circo']) {
				await openBlock(`Engine ${engine}`, `// engine: ${engine}\ngraph { a -- b -- c -- a }`, 'preview');
				const s = await waitFor((x) => x.nodes > 0, `no svg for ${engine}`);
				expect(s.notes).toEqual([]);
				expect(s.nodes).toBe(3);
			}
		});

		it('shows wikilink nodes as plain text, with no link', async function () {
			await obsidianPage.write('Diagrams/Target.md', '# Target\n');
			await openBlock('Links free', 'digraph { "[[Diagrams/Target|Target note]]" -> "[[Missing]]" }', 'preview');
			const s = await waitFor((x) => x.nodes > 0, 'no svg for the wikilink block');
			expect(s.links).toBe(0);
			expect(s.svgText).toContain('Target note');
			expect(s.svgText).not.toContain('[[');
		});

		it('refuses the export buttons with a notice and creates no file', async function () {
			await openBlock('Export free', FLOW, 'preview');
			await waitFor((x) => x.nodes > 0, 'no svg for the export test');
			await click('.dot-diagrams-button[data-action="export-svg"]');
			await browser.waitUntil(async () => (await lastNotice()).includes('Pro feature'), { timeout: 5000, timeoutMsg: 'no Pro notice' });
			const found = await browser.executeObsidian(({ app }) => app.vault.getFiles().filter((f) => f.extension === 'svg' || f.extension === 'png').length);
			expect(found).toBe(0);
		});
	});

	describe('Pro (stubbed GitHub Sponsors reply, no real request)', function () {
		before(async function () {
			await setPro(true);
		});
		after(async function () {
			await setPro(false);
		});

		it('draws with the fdp engine and no note', async function () {
			await openBlock('Engine pro', '// engine: fdp\ngraph { a -- b -- c }', 'preview');
			const s = await waitFor((x) => x.nodes > 0, 'no svg for the Pro fdp block');
			expect(s.notes).toEqual([]);
			expect(s.nodes).toBe(3);
		});

		it('applies a style preset', async function () {
			await openBlock('Preset', '// preset: blueprint\ndigraph { a -> b }', 'preview');
			const s = await waitFor((x) => x.nodes > 0, 'no svg for the preset');
			expect(s.svgText.toLowerCase()).toContain('#0b3d91');
		});

		it('opens the note of a wikilink node on click', async function () {
			await obsidianPage.write('Diagrams/Target.md', '# Target\n');
			await openBlock('Links pro', 'digraph { "[[Diagrams/Target|Target note]]" -> "[[Diagrams/Target]]" }', 'preview');
			const s = await waitFor((x) => x.links > 0, 'no link on the wikilink node');
			expect(s.links).toBe(2);
			await click('svg a.dot-diagrams-link');
			await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === 'Diagrams/Target.md', {
				timeout: 8000,
				timeoutMsg: 'the note did not open',
			});
		});

		it('exports SVG and PNG into the vault', async function () {
			await openBlock('Export pro', FLOW, 'preview');
			await waitFor((x) => x.nodes > 0, 'no svg for the export test');
			await click('.dot-diagrams-button[data-action="export-svg"]');
			await click('.dot-diagrams-button[data-action="export-png"]');
			const count = (): Promise<number> => browser.executeObsidian(({ app }) => app.vault.getFiles().filter((f) => f.extension === 'svg' || f.extension === 'png').length);
			try {
				await browser.waitUntil(async () => (await count()) === 2, { timeout: 10000 });
			} catch {
				throw new Error(`the two export files did not appear (found ${await count()}); notices: ${await allNotices()}`);
			}
			const out = await browser.executeObsidian(async ({ app }) => {
				const svg = app.vault.getFiles().find((f) => f.extension === 'svg')!;
				const png = app.vault.getFiles().find((f) => f.extension === 'png')!;
				const text = await app.vault.read(svg);
				const head = Array.from(new Uint8Array(await app.vault.readBinary(png)).slice(0, 4));
				return { svgName: svg.name, text, head, pngSize: png.stat.size };
			});
			expect(out.svgName).toContain('Export pro diagram');
			expect(out.text).toContain('<svg');
			expect(out.text).toContain('fill="#ffffff"');
			expect(out.text).not.toContain('dd:');
			expect(out.head).toEqual([0x89, 0x50, 0x4e, 0x47]);
			expect(out.pngSize).toBeGreaterThan(500);
		});
	});
});
