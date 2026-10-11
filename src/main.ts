import { Keymap, Notice, Plugin, debounce, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DotBlock } from './block';
import { LIGHT_PALETTE, findBlockAt, plan as makePlan, type Plan } from './dot';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { layoutSvg, readPalette, svgToPng, type Layout } from './render';
import { DEFAULT_SETTINGS, DotDiagramsSettingTab, normalizeSettings, type DotDiagramsSettings } from './settings';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 64;
const REDRAW_MS = 150;

export interface Drawn {
	plan: Plan;
	layout: Layout;
}

export default class DotDiagramsPlugin extends Plugin {
	settings: DotDiagramsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Blocks on screen. A block adds itself when it loads and removes itself when it unloads. */
	readonly blocks = new Set<DotBlock>();
	private cache = new Map<string, Layout>();
	private settingTab: DotDiagramsSettingTab | null = null;
	readonly redrawAll = debounce(() => {
		for (const b of [...this.blocks]) void b.draw();
	}, REDRAW_MS);

	async onload(): Promise<void> {
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.register(onProChange(() => this.redrawAll()));
		this.settingTab = new DotDiagramsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		for (const lang of ['dot', 'graphviz']) {
			this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
				ctx.addChild(new DotBlock(el, this, source, ctx.sourcePath));
				return Promise.resolve();
			});
		}
		this.registerEvent(this.app.workspace.on('css-change', () => this.redrawAll()));
		this.addExportCommand('export-svg', 'Export the diagram at the cursor to SVG', 'svg');
		this.addExportCommand('export-png', 'Export the diagram at the cursor to PNG', 'png');
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
		this.cache.clear();
		this.blocks.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<DotDiagramsSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Plan and layout for a block, with the theme colors read at el. Results are cached by engine and final source. */
	async layoutFor(source: string, el: HTMLElement): Promise<Drawn> {
		const palette = readPalette(el);
		const plan = makePlan(source, { pro: isPro(), defaultEngine: this.settings.defaultEngine, defaultPreset: this.settings.defaultPreset, palette });
		return { plan, layout: await this.cachedLayout(plan, source) };
	}

	private async cachedLayout(plan: Plan, raw: string): Promise<Layout> {
		const key = `${plan.engine}\u0000${plan.source}`;
		const hit = this.cache.get(key);
		if (hit) return hit;
		const layout = await layoutSvg(plan.source, plan.engine, raw);
		if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
		this.cache.set(key, layout);
		return layout;
	}

	/** SVG text for a file or the clipboard: light colors on white, no note links. Null (with a notice) on an error. */
	async exportSvgText(source: string): Promise<string | null> {
		const plan = makePlan(source, {
			pro: isPro(),
			defaultEngine: this.settings.defaultEngine,
			defaultPreset: this.settings.defaultPreset,
			palette: LIGHT_PALETTE,
			links: false,
			background: '#ffffff',
		});
		const layout = await this.cachedLayout(plan, source);
		if (!layout.svg) {
			new Notice(`DOT diagram error${layout.error?.line ? ` on line ${layout.error.line}` : ''}: ${layout.error?.message ?? 'not drawn'}`);
			return null;
		}
		return layout.svg;
	}

	async copySvg(source: string): Promise<void> {
		const svg = await this.exportSvgText(source);
		if (svg === null) return;
		await navigator.clipboard.writeText(svg);
		new Notice('SVG copied to the clipboard.');
	}

	static needsPro(what: string): void {
		new Notice(`${what} is a Pro feature. Open Settings, DOT Diagrams, and sign in with GitHub Sponsors.`);
	}

	/** Pro: draws the block in light colors and saves it as SVG or PNG in the attachment folder of the note. */
	async exportBlock(source: string, sourcePath: string, kind: 'svg' | 'png'): Promise<string | null> {
		if (!isPro()) {
			DotDiagramsPlugin.needsPro('Export to SVG and PNG');
			return null;
		}
		const svg = await this.exportSvgText(source);
		if (svg === null) return null;
		try {
			const data = kind === 'svg' ? toArrayBuffer(new TextEncoder().encode(svg)) : await svgToPng(svg, this.settings.exportScale);
			const base = (sourcePath.split('/').pop() ?? 'note').replace(/\.md$/i, '') || 'note';
			const path = await this.app.fileManager.getAvailablePathForAttachment(`${base} diagram.${kind}`, sourcePath);
			const file = await this.app.vault.createBinary(path, data);
			new Notice(`Saved ${file.path}`);
			return file.path;
		} catch (e) {
			new Notice(`Could not export the diagram: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/** Pro: opens the note of a [[wikilink]] node. A modifier key opens it in a new tab. */
	async openNote(target: string, sourcePath: string, evt: MouseEvent): Promise<void> {
		if (!isPro()) {
			DotDiagramsPlugin.needsPro('Opening a note from a diagram');
			return;
		}
		await this.app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(evt));
	}

	private addExportCommand(id: string, name: string, kind: 'svg' | 'png'): void {
		this.addCommand({
			id,
			name,
			editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const block = findBlockAt(editor.getValue(), editor.getCursor().line);
				if (!block) return false;
				if (!checking) void this.exportBlock(block.source, ctx.file?.path ?? '', kind);
				return true;
			},
		});
	}
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
