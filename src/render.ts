// Layout and SVG handling. The Graphviz WASM build loads on the first diagram, not at plugin start.
// Nothing here sends a request: the WASM bytes sit inside main.js, and the SVG is cleaned of anything that could load a URL.
import { DARK_PALETTE, LIGHT_PALETTE, cssColorToHex, parseError, tidySvg, type DotError, type Engine, type Palette } from './dot';

interface GraphvizApi {
	layout(source: string, format: 'svg', engine: Engine): string;
}

let loading: Promise<GraphvizApi> | null = null;

/** Loads the bundled Graphviz WASM build once. A failed load is tried again on the next diagram. */
export function loadGraphviz(): Promise<GraphvizApi> {
	loading ??= import('@hpcc-js/wasm-graphviz').then((m) => m.Graphviz.load() as Promise<GraphvizApi>);
	loading.catch(() => {
		loading = null;
	});
	return loading;
}

export interface Layout {
	svg: string | null;
	error: DotError | null;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Runs the layout. A syntax error comes back as a DotError, never as a throw. */
export async function layoutSvg(source: string, engine: Engine, raw: string): Promise<Layout> {
	const gv = await loadGraphviz();
	try {
		return { svg: tidySvg(gv.layout(source, 'svg', engine)), error: null };
	} catch (e) {
		const first = parseError(errorText(e));
		if (source === raw) return { svg: null, error: first };
		// The preprocessed text failed. Ask Graphviz about the author's own text, so the message names the author's code.
		try {
			gv.layout(raw, 'svg', engine);
			return { svg: null, error: first };
		} catch (e2) {
			return { svg: null, error: parseError(errorText(e2)) };
		}
	}
}

const PALETTE_VARS: Record<keyof Palette, string> = {
	fg: '--text-normal',
	muted: '--text-muted',
	bg2: '--background-secondary',
	border: '--background-modifier-border',
	accent: '--interactive-accent',
};

/** Reads the colors of the current Obsidian theme at an element. A color that does not parse falls back to the light or dark set. */
export function readPalette(el: HTMLElement): Palette {
	const doc = el.ownerDocument;
	const fallback = doc.body.classList.contains('theme-dark') ? DARK_PALETTE : LIGHT_PALETTE;
	const style = el.win.getComputedStyle(el);
	const probe = el.createDiv();
	const out: Palette = { ...fallback };
	for (const key of Object.keys(PALETTE_VARS) as (keyof Palette)[]) {
		const value = style.getPropertyValue(PALETTE_VARS[key]).trim();
		if (!value) continue;
		probe.setCssProps({ color: value });
		out[key] = cssColorToHex(el.win.getComputedStyle(probe).color) ?? fallback[key];
	}
	probe.remove();
	return out;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Parses Graphviz SVG text into an element of the given document. Null when it is not an SVG. */
export function parseSvg(text: string, doc: Document): SVGSVGElement | null {
	const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
	const root = parsed.documentElement;
	if (root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length > 0) return null;
	return doc.importNode(root, true) as unknown as SVGSVGElement;
}

const hrefOf = (a: Element): string => (a.getAttributeNS(XLINK_NS, 'href') ?? a.getAttribute('href') ?? '').trim();

/**
 * Removes everything in an SVG that could run code or load a URL: scripts, foreign objects, event handlers,
 * images that are not data: URLs, and links that are not http(s) or a dd: note link. A dd: link stays only when allowLinks is true.
 */
export function sanitizeSvg(svg: SVGSVGElement, allowLinks: boolean): void {
	for (const el of Array.from(svg.querySelectorAll('script, foreignObject, style, use, iframe, object, embed'))) el.remove();
	for (const el of Array.from(svg.querySelectorAll('image'))) {
		if (!hrefOf(el).toLowerCase().startsWith('data:image/')) el.remove();
	}
	for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
		for (const attr of Array.from(el.attributes)) {
			if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
		}
	}
	for (const a of Array.from(svg.querySelectorAll('a'))) {
		const href = hrefOf(a);
		const note = href.startsWith('dd:');
		if ((note && allowLinks) || /^https?:\/\//i.test(href)) a.classList.add('dot-diagrams-link');
		else {
			a.removeAttributeNS(XLINK_NS, 'href');
			a.removeAttribute('href');
		}
	}
	svg.classList.add('dot-diagrams-svg');
}

/** Number of node groups in a Graphviz SVG. */
export function countNodes(svg: ParentNode): number {
	return svg.querySelectorAll('g.node').length;
}

/** The viewBox size of an SVG text in Graphviz points, or null. */
export function svgSize(text: string): { w: number; h: number } | null {
	const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(text);
	return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

const MAX_SIDE = 8192;

/** Draws SVG text into a PNG. One Graphviz point is 96/72 pixels, times the scale. */
export async function svgToPng(text: string, scale: number): Promise<ArrayBuffer> {
	const size = svgSize(text);
	if (!size) throw new Error('The diagram has no size.');
	const k = (96 / 72) * Math.min(4, Math.max(1, scale));
	const w = Math.max(1, Math.min(MAX_SIDE, Math.round(size.w * k)));
	const h = Math.max(1, Math.min(MAX_SIDE, Math.round(size.h * k)));
	const img = createEl('img');
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('The browser could not read the SVG.'));
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
	});
	const canvas = createEl('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No canvas in this window.');
	ctx.drawImage(img, 0, 0, w, h);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('The browser could not make a PNG.');
	return blob.arrayBuffer();
}

export { SVG_NS };
