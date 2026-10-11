import { MarkdownRenderChild, setIcon } from 'obsidian';
import { MAX_CHARS } from './settings';
import { excerptLine, hrefTarget, sizeProblem, type DotError } from './dot';
import { isPro } from './pro';
import { countNodes, parseSvg, sanitizeSvg } from './render';
import type DotDiagramsPlugin from './main';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** One rendered ```dot or ```graphviz block. It draws itself, and again when the theme, the settings or the Pro state change. */
export class DotBlock extends MarkdownRenderChild {
	private token = 0;
	/** Node count of the diagram on screen. The end-to-end test reads it. */
	nodes = 0;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: DotDiagramsPlugin,
		readonly source: string,
		private readonly sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.plugin.blocks.add(this);
		this.containerEl.classList.add('dot-diagrams');
		this.registerDomEvent(this.containerEl, 'click', (evt) => this.onClick(evt));
		void this.draw();
	}

	onunload(): void {
		this.token++;
		this.plugin.blocks.delete(this);
	}

	async draw(): Promise<void> {
		const mine = ++this.token;
		const el = this.containerEl;
		if (this.source.trim() === '') return this.showMessage('This DOT block is empty. Write a graph, for example: digraph { a -> b }');
		const problem = sizeProblem(this.source, MAX_CHARS, this.plugin.settings.maxEdges);
		if (problem) return this.showError(null, problem);
		if (!el.querySelector('svg')) this.showMessage('Drawing the diagram...');
		let result;
		try {
			result = await this.plugin.layoutFor(this.source, el);
		} catch (e) {
			if (mine === this.token) this.showError(null, `Graphviz did not load: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		if (mine !== this.token) return;
		if (!result.layout.svg) return this.showError(result.layout.error, '');
		const svg = parseSvg(result.layout.svg, el.doc);
		if (!svg) return this.showError(null, 'Graphviz returned something that is not an SVG.');
		sanitizeSvg(svg, isPro());
		el.empty();
		this.addToolbar(el);
		el.appendChild(svg);
		this.nodes = countNodes(svg);
		for (const note of result.plan.notes) el.createDiv({ cls: 'dot-diagrams-note', text: note });
	}

	private showMessage(text: string): void {
		this.nodes = 0;
		this.containerEl.empty();
		this.containerEl.createDiv({ cls: 'dot-diagrams-status', text });
	}

	private showError(err: DotError | null, text: string): void {
		this.nodes = 0;
		const el = this.containerEl;
		el.empty();
		const box = el.createDiv({ cls: 'dot-diagrams-error' });
		const line = err?.line ?? null;
		box.createDiv({ cls: 'dot-diagrams-error-title', text: line === null ? 'DOT diagram error' : `DOT diagram error on line ${line}` });
		box.createDiv({ cls: 'dot-diagrams-error-message', text: err?.message ?? text });
		const code = excerptLine(this.source, line);
		if (code) box.createEl('code', { cls: 'dot-diagrams-error-code', text: `${line ?? ''}: ${code}` });
	}

	private addToolbar(el: HTMLElement): void {
		if (!this.plugin.settings.showToolbar) return;
		const bar = el.createDiv({ cls: 'dot-diagrams-toolbar' });
		this.addButton(bar, 'copy', 'copy', 'Copy SVG', () => this.plugin.copySvg(this.source));
		this.addButton(bar, 'download', 'export-svg', 'Export SVG to the vault (Pro)', () => this.plugin.exportBlock(this.source, this.sourcePath, 'svg'));
		this.addButton(bar, 'image', 'export-png', 'Export PNG to the vault (Pro)', () => this.plugin.exportBlock(this.source, this.sourcePath, 'png'));
	}

	private addButton(bar: HTMLElement, icon: string, action: string, label: string, run: () => Promise<unknown>): void {
		const b = bar.createEl('button', { cls: 'clickable-icon dot-diagrams-button', attr: { 'aria-label': label, 'data-action': action } });
		setIcon(b, icon);
		this.registerDomEvent(b, 'click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void run();
		});
	}

	private onClick(evt: MouseEvent): void {
		const target = evt.target;
		if (!(target instanceof Element)) return;
		const a = target.closest('a');
		if (!a || !this.containerEl.contains(a)) return;
		evt.preventDefault();
		evt.stopPropagation();
		const href = (a.getAttributeNS(XLINK_NS, 'href') ?? a.getAttribute('href') ?? '').trim();
		const note = hrefTarget(href);
		if (note !== null) void this.plugin.openNote(note, this.sourcePath, evt);
		else if (/^https?:\/\//i.test(href)) this.containerEl.win.open(href, '_blank', 'noopener');
	}
}
