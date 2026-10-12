import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import DotDiagramsPlugin from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, MAX_EDGES_MAX, MAX_EDGES_MIN, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
		listeners: () => fns.size,
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new DotDiagramsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ defaultEngine: 'bogus' as never, defaultPreset: 'neon', maxEdges: 'x' as never, showToolbar: 1 as never, exportScale: NaN })).toEqual(DEFAULT_SETTINGS);
	});

	it('clamps numbers and keeps good values', () => {
		expect(normalizeSettings({ maxEdges: 1 }).maxEdges).toBe(MAX_EDGES_MIN);
		expect(normalizeSettings({ maxEdges: 9e9 }).maxEdges).toBe(MAX_EDGES_MAX);
		expect(normalizeSettings({ exportScale: 9 }).exportScale).toBe(4);
		expect(normalizeSettings({ exportScale: 0 }).exportScale).toBe(1);
		expect(normalizeSettings({ defaultEngine: 'circo', defaultPreset: 'mono', showToolbar: false, maxEdges: 123.4 })).toMatchObject({ defaultEngine: 'circo', defaultPreset: 'mono', showToolbar: false, maxEdges: 123 });
	});
});

describe('pro facade', () => {
	it('is off with no manager', () => {
		expect(isPro()).toBe(false);
	});

	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('reset unbinds the manager', () => {
		const m = fakeManager(true);
		bindPro(m as never);
		expect(m.listeners()).toBe(1);
		resetPro();
		expect(m.listeners()).toBe(0);
		expect(isPro()).toBe(false);
	});

	it('the sponsor terms match product.yaml', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});

describe('plugin', () => {
	it('registers the dot and graphviz code block processors and the export commands', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new DotDiagramsPlugin(app as never, manifest as never);
		const langs: string[] = [];
		plugin.registerMarkdownCodeBlockProcessor = ((lang: string) => {
			langs.push(lang);
			return {};
		}) as never;
		const ids: string[] = [];
		plugin.addCommand = ((c: { id: string }) => {
			ids.push(c.id);
			return c;
		}) as never;
		await plugin.onload();
		expect(langs).toEqual(['dot', 'graphviz']);
		expect(ids).toEqual(['export-svg', 'export-png']);
		plugin.onunload();
	});

	it('refuses export and note opening without Pro, with a notice and no file', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new DotDiagramsPlugin(app as never, manifest as never);
		expect(await plugin.exportBlock('digraph { a -> b }', 'n.md', 'svg')).toBeNull();
		await plugin.openNote('Home', 'n.md', new MouseEvent('click'));
		expect(app.vault.getFiles().length).toBe(0);
	});

	describe('blockText', () => {
		const load = async (files: Record<string, string>) => {
			const app = App.createConfigured__({ files });
			const plugin = new DotDiagramsPlugin(app as never, manifest as never);
			return plugin;
		};

		it('gives the block text when there is no file line', async () => {
			const plugin = await load({});
			expect(await plugin.blockText('digraph { a -> b }', 'n.md')).toEqual({ text: 'digraph { a -> b }', file: null, problem: null });
		});

		it('reads a file by its path and by its name', async () => {
			const plugin = await load({ 'graphs/build.dot': 'digraph B { a -> b }', 'n.md': '' });
			const byPath = await plugin.blockText('// file: graphs/build.dot', 'n.md');
			expect(byPath).toMatchObject({ text: 'digraph B { a -> b }', fileText: 'digraph B { a -> b }', file: 'graphs/build.dot', problem: null });
			const byLink = await plugin.blockText('// file: [[graphs/build.dot]]', 'n.md');
			expect(byLink.fileText).toBe('digraph B { a -> b }');
		});

		it('finds a file in a folder by its bare name, as a link does', async () => {
			const plugin = await load({ 'graphs/build.gv': 'graph G { a -- b }', 'n.md': '' });
			const r = await plugin.blockText('// file: build.gv', 'n.md');
			expect(r).toMatchObject({ fileText: 'graph G { a -- b }', file: 'graphs/build.gv', problem: null });
		});

		it('keeps the graph of a block that has its own graph and a file comment', async () => {
			const plugin = await load({ 'graphs/build.dot': 'digraph B { a -> b }', 'n.md': '' });
			const src = '// file: graphs/build.dot\ndigraph { x -> y }';
			expect(await plugin.blockText(src, 'n.md')).toEqual({ text: src, file: null, problem: null });
		});

		it('says so when the file is not in the vault', async () => {
			const plugin = await load({ 'n.md': '' });
			const r = await plugin.blockText('// file: missing.dot', 'n.md');
			expect(r.problem).toBe('The file "missing.dot" is not in this vault.');
			expect(r.fileText).toBeUndefined();
			expect(r.file).toBe('missing.dot');
		});

		it('refuses a file that is not .dot or .gv, even when it exists', async () => {
			const plugin = await load({ 'notes/secret.md': 'private text', 'n.md': '' });
			const r = await plugin.blockText('// file: notes/secret.md', 'n.md');
			expect(r.problem).toMatch(/not a DOT file/);
			expect(r.fileText).toBeUndefined();
		});

		it('does not read a path outside the vault', async () => {
			const plugin = await load({ 'n.md': '' });
			const r = await plugin.blockText('// file: ../../etc/hosts.dot', 'n.md');
			expect(r.problem).toMatch(/not in this vault/);
		});
	});
});
