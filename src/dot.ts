// Pure logic for DOT Diagrams: scan DOT source, read directives, map [[wikilinks]], inject theme colors.
// No Obsidian and no DOM here. Every function takes text and returns text, so vitest and the golden vectors cover it.

export type SegKind = 'code' | 'string' | 'comment' | 'html';
export interface Seg {
	kind: SegKind;
	start: number;
	end: number;
}

/** Free layout engines. */
export const FREE_ENGINES = ['dot', 'neato', 'circo'] as const;
/** Layout engines that need Pro. */
export const PRO_ENGINES = ['fdp', 'sfdp', 'twopi', 'osage'] as const;
export const ALL_ENGINES = [...FREE_ENGINES, ...PRO_ENGINES] as const;
export type Engine = (typeof ALL_ENGINES)[number];

export function isEngine(name: string): name is Engine {
	return (ALL_ENGINES as readonly string[]).includes(name);
}

/** Hex colors that Graphviz reads. `bg2` fills nodes and clusters. */
export interface Palette {
	fg: string;
	muted: string;
	bg2: string;
	border: string;
	accent: string;
}

export const LIGHT_PALETTE: Palette = { fg: '#222222', muted: '#6b6b6b', bg2: '#f2f3f5', border: '#c9c9cf', accent: '#7c5cd6' };
export const DARK_PALETTE: Palette = { fg: '#dadada', muted: '#a3a3a3', bg2: '#262626', border: '#4a4a4a', accent: '#a78bfa' };

/** Splits DOT source into code, string, comment and HTML-string segments. Segments cover the whole text in order. */
export function scan(src: string): Seg[] {
	const segs: Seg[] = [];
	let i = 0;
	let codeStart = 0;
	const flush = (end: number): void => {
		if (end > codeStart) segs.push({ kind: 'code', start: codeStart, end });
	};
	while (i < src.length) {
		const found = segAt(src, i);
		if (found) {
			flush(i);
			segs.push(found);
			i = found.end;
			codeStart = i;
		} else i++;
	}
	flush(src.length);
	return segs;
}

/** The string, comment or HTML segment that starts at index i, or null for plain code. */
function segAt(src: string, i: number): Seg | null {
	const c = src[i];
	const two = src.slice(i, i + 2);
	if (c === '"') return { kind: 'string', start: i, end: endOfString(src, i) };
	if (two === '//') return { kind: 'comment', start: i, end: endOfLine(src, i) };
	if (two === '/*') {
		const close = src.indexOf('*/', i + 2);
		return { kind: 'comment', start: i, end: close < 0 ? src.length : close + 2 };
	}
	if (c === '#' && /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))) return { kind: 'comment', start: i, end: endOfLine(src, i) };
	if (c === '<') return { kind: 'html', start: i, end: endOfHtml(src, i) };
	return null;
}

function endOfLine(src: string, i: number): number {
	const nl = src.indexOf('\n', i);
	return nl < 0 ? src.length : nl;
}

function endOfString(src: string, i: number): number {
	for (let j = i + 1; j < src.length; j++) {
		if (src[j] === '\\') j++;
		else if (src[j] === '"') return j + 1;
	}
	return src.length;
}

function endOfHtml(src: string, i: number): number {
	let depth = 0;
	for (let j = i; j < src.length; j++) {
		if (src[j] === '<') depth++;
		else if (src[j] === '>' && --depth === 0) return j + 1;
	}
	return src.length;
}

/** Layout engine and style preset that the author asked for in comment lines such as `// engine: neato`. */
export interface Directives {
	engine: string | null;
	preset: string | null;
}

const DIRECTIVE = /^[ \t]*(?:\/\/|#|\/\*)[ \t]*(engine|layout|preset|style)[ \t]*[:=][ \t]*([A-Za-z][\w-]*)[ \t]*(?:\*\/)?[ \t]*$/;

/** Reads `// engine: name` and `// preset: name` from comment lines. The first one of each kind wins. */
export function parseDirectives(src: string): Directives {
	const out: Directives = { engine: null, preset: null };
	for (const seg of scan(src)) {
		if (seg.kind !== 'comment') continue;
		const lineStart = src.lastIndexOf('\n', seg.start - 1) + 1;
		const m = DIRECTIVE.exec(src.slice(lineStart, seg.end));
		if (!m) continue;
		const key = m[1] === 'engine' || m[1] === 'layout' ? 'engine' : 'preset';
		out[key] ??= (m[2] ?? '').toLowerCase();
	}
	return out;
}

export interface EngineChoice {
	engine: Engine;
	note: string | null;
}

/** Picks the engine. Free users get dot, neato and circo; a Pro-only or unknown name falls back and says why. */
export function resolveEngine(requested: string | null, fallback: Engine, pro: boolean): EngineChoice {
	const base: Engine = !pro && !(FREE_ENGINES as readonly string[]).includes(fallback) ? 'dot' : fallback;
	if (requested === null) return { engine: base, note: null };
	if (!isEngine(requested)) return { engine: base, note: `Unknown layout engine "${requested}". Used ${base}.` };
	if (!pro && (PRO_ENGINES as readonly string[]).includes(requested)) return { engine: base, note: `The ${requested} layout engine is a Pro feature. Used ${base}.` };
	return { engine: requested, note: null };
}

export type AttrMap = Record<string, string>;
export interface Defaults {
	graph: AttrMap;
	node: AttrMap;
	edge: AttrMap;
}

/** Default attributes that follow the Obsidian theme: transparent background, text and lines in the text color. */
export function themeDefaults(p: Palette): Defaults {
	return {
		graph: { bgcolor: 'transparent', color: p.border, fontcolor: p.fg, fillcolor: p.bg2 },
		node: { color: p.fg, fontcolor: p.fg, fillcolor: p.bg2 },
		edge: { color: p.muted, fontcolor: p.fg },
	};
}

/** Style presets (Pro). Each one sets defaults for graph, node and edge; they do not follow the theme on purpose. */
export const PRESETS: Record<string, Defaults> = {
	clean: {
		graph: { pad: '0.3', nodesep: '0.5', ranksep: '0.6' },
		node: { shape: 'box', style: 'rounded,filled', margin: '0.2,0.1', penwidth: '1.2' },
		edge: { arrowsize: '0.8' },
	},
	blueprint: {
		graph: { bgcolor: '#0b3d91', color: '#e8f1ff', fontcolor: '#e8f1ff', pad: '0.3' },
		node: { shape: 'box', color: '#e8f1ff', fontcolor: '#e8f1ff', fillcolor: '#0b3d91', style: 'filled', fontname: 'Courier' },
		edge: { color: '#e8f1ff', fontcolor: '#e8f1ff', style: 'dashed' },
	},
	mono: {
		graph: { bgcolor: '#ffffff', color: '#222222', fontcolor: '#111111', fillcolor: '#e6e6e6' },
		node: { shape: 'box', color: '#222222', fontcolor: '#111111', fillcolor: '#e6e6e6', style: 'filled' },
		edge: { color: '#222222', fontcolor: '#111111' },
	},
	pastel: {
		graph: { bgcolor: '#fffaf0', color: '#b8a99a', fontcolor: '#2b2b2b', fillcolor: '#fde2e4' },
		node: { shape: 'box', color: '#b8a99a', fontcolor: '#2b2b2b', fillcolor: '#cddafd', style: 'rounded,filled' },
		edge: { color: '#6b7280', fontcolor: '#2b2b2b' },
	},
	contrast: {
		graph: { pad: '0.3' },
		node: { shape: 'box', penwidth: '2.5', fontsize: '16', fontname: 'Helvetica-Bold' },
		edge: { penwidth: '2', arrowsize: '1.2' },
	},
};

export const PRESET_NAMES = Object.keys(PRESETS);

/** Merges a preset over the theme defaults. An unknown or empty preset name leaves the theme defaults as they are. */
export function buildDefaults(p: Palette, preset: string | null, background?: string): Defaults {
	const base = themeDefaults(p);
	if (background) base.graph.bgcolor = background;
	const over = preset ? PRESETS[preset] : undefined;
	if (!over) return base;
	return { graph: { ...base.graph, ...over.graph }, node: { ...base.node, ...over.node }, edge: { ...base.edge, ...over.edge } };
}

const quote = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** One line of default statements, such as `graph [bgcolor="transparent"]; node [color="#222"]; edge [color="#555"];`. */
export function defaultsText(d: Defaults): string {
	const part = (kind: keyof Defaults): string => {
		const attrs = Object.entries(d[kind]).map(([k, v]) => `${k}=${quote(v)}`);
		return attrs.length ? `${kind} [${attrs.join(' ')}];` : '';
	};
	return [part('graph'), part('node'), part('edge')].filter(Boolean).join(' ');
}

/** Index just after the `{` that opens the first graph, or -1. Comments, strings and HTML are skipped. */
export function openerEnd(src: string): number {
	for (const seg of scan(src)) {
		if (seg.kind !== 'code') continue;
		const at = src.slice(seg.start, seg.end).indexOf('{');
		if (at >= 0) return seg.start + at + 1;
	}
	return -1;
}

/** Inserts text right after the opening brace, on the same line, so line numbers in error messages stay true. */
export function insertAfterOpener(src: string, text: string): string {
	const at = openerEnd(src);
	if (at < 0 || text === '') return src;
	return `${src.slice(0, at)} ${text}${src.slice(at)}`;
}

export interface WikiLink {
	target: string;
	alias: string | null;
}

/** Reads `[[Note]]`, `[[Note#Heading]]` or `[[Note|Alias]]` that fills the whole text. */
export function parseWikiLink(text: string): WikiLink | null {
	const m = /^\[\[([^\][|]+?)(?:\|([^\][]+?))?\]\]$/.exec(text.trim());
	return m ? { target: (m[1] ?? '').trim(), alias: m[2] ? m[2].trim() : null } : null;
}

const WIKI_IN_TEXT = /\[\[([^\][|]+?)(?:\|([^\][]+?))?\]\]/g;

/** The URL that a linked node gets. The click handler reads it back with hrefTarget. */
export function linkHref(target: string): string {
	return `dd:${encodeURIComponent(target)}`;
}

/** The note link of a `dd:` URL, or null for any other URL. */
export function hrefTarget(href: string): string | null {
	if (!href.startsWith('dd:')) return null;
	try {
		return decodeURIComponent(href.slice(3));
	} catch {
		return null;
	}
}

const display = (l: WikiLink): string => l.alias ?? l.target;
const dotEscape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

interface Edit {
	start: number;
	end: number;
	text: string;
}

interface AttrList {
	start: number;
	end: number;
	hasUrl: boolean;
}

/** Ranges of `[ ... ]` attribute lists outside strings, with whether the list sets URL or href. */
function attrLists(src: string, segs: Seg[]): AttrList[] {
	const lists: AttrList[] = [];
	let open = -1;
	for (const seg of segs) {
		if (seg.kind !== 'code') continue;
		for (let i = seg.start; i < seg.end; i++) {
			if (src[i] === '[' && open < 0) open = i;
			else if (src[i] === ']' && open >= 0) {
				lists.push({ start: open, end: i, hasUrl: false });
				open = -1;
			}
		}
	}
	for (const l of lists) {
		const code = segs
			.filter((s) => s.kind === 'code' && s.end > l.start && s.start < l.end)
			.map((s) => src.slice(Math.max(s.start, l.start), Math.min(s.end, l.end)))
			.join(' ');
		l.hasUrl = /\b(?:URL|href)\s*=/i.test(code);
	}
	return lists;
}

/** Text before index `at` on its code segment, to read the attribute name that comes before a string. */
function keyBefore(src: string, at: number): string | null {
	const m = /([A-Za-z_]\w*)\s*=\s*$/.exec(src.slice(Math.max(0, at - 40), at));
	return m ? (m[1] ?? '').toLowerCase() : null;
}

export interface MapResult {
	source: string;
	links: number;
}

/**
 * Maps `[[wikilinks]]` for Graphviz.
 * - A quoted node id that is only a link, `"[[Note]]"`, shows the note name (or alias) and, with links on, opens the note.
 * - `URL="[[Note]]"` or `href=...` becomes a `dd:` URL (links on) or is emptied (links off).
 * - A label with a link, `label="See [[Note]]"`, shows plain text, and with links on the node opens the first note.
 * The text keeps its line breaks, so error line numbers stay true.
 */
export function mapWikilinks(src: string, links: boolean): MapResult {
	if (!src.includes('[[')) return { source: src, links: 0 };
	const segs = scan(src);
	const lists = attrLists(src, segs);
	const edits: Edit[] = [];
	const ids = new Map<string, WikiLink>();
	let count = 0;
	for (const seg of segs) {
		if (seg.kind !== 'string') continue;
		const raw = src.slice(seg.start, seg.end);
		const inner = raw.slice(1, raw.endsWith('"') && raw.length > 1 ? -1 : undefined);
		if (!inner.includes('[[')) continue;
		const list = lists.find((l) => seg.start > l.start && seg.end <= l.end);
		if (!list) {
			const link = parseWikiLink(inner);
			if (link) ids.set(raw, link);
			continue;
		}
		count += mapInList(src, seg, inner, list, links, edits);
	}
	let out = applyEdits(src, edits);
	if (links && ids.size > 0) {
		const decl = [...ids].map(([raw, l]) => `${raw} [label="${dotEscape(display(l))}" URL="${linkHref(l.target)}"];`).join(' ');
		out = insertAfterOpener(out, decl);
		count += ids.size;
	} else if (ids.size > 0) {
		const decl = [...ids].map(([raw, l]) => `${raw} [label="${dotEscape(display(l))}"];`).join(' ');
		out = insertAfterOpener(out, decl);
	}
	return { source: out, links: count };
}

/** Adds the edits for one string inside an attribute list. Returns how many links it made. */
function mapInList(src: string, seg: Seg, inner: string, list: AttrList, links: boolean, edits: Edit[]): number {
	const key = keyBefore(src, seg.start);
	if (key === 'url' || key === 'href') {
		const link = parseWikiLink(inner);
		if (!link) return 0;
		edits.push({ start: seg.start, end: seg.end, text: links ? `"${linkHref(link.target)}"` : '""' });
		return links ? 1 : 0;
	}
	if (key !== 'label' && key !== 'xlabel' && key !== 'tooltip') return 0;
	let first: WikiLink | null = null;
	const text = inner.replace(WIKI_IN_TEXT, (_m, t: string, a?: string) => {
		const l: WikiLink = { target: t.trim(), alias: a ? a.trim() : null };
		first ??= l;
		return dotEscape(display(l));
	});
	edits.push({ start: seg.start, end: seg.end, text: `"${text}"` });
	if (!links || !first || list.hasUrl) return 0;
	list.hasUrl = true;
	edits.push({ start: seg.end, end: seg.end, text: ` URL="${linkHref((first as WikiLink).target)}"` });
	return 1;
}

function applyEdits(src: string, edits: Edit[]): string {
	const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
	let out = '';
	let at = 0;
	for (const e of sorted) {
		out += src.slice(at, e.start) + e.text;
		at = e.end;
	}
	return out + src.slice(at);
}

/**
 * Cleans the SVG text that Graphviz writes: drops its XML comments (they repeat node ids) and shows a wikilink node id
 * in a <title> tooltip as the note name or alias.
 */
export function tidySvg(svg: string): string {
	return svg
		.replace(/<!--[\s\S]*?-->\s*/g, '')
		.replace(/<title>([\s\S]*?)<\/title>/g, (_m, t: string) => `<title>${t.replace(WIKI_IN_TEXT, (_w, target: string, alias?: string) => (alias ? alias.trim() : target.trim()))}</title>`);
}

/** Number of `->` and `--` edge operators outside strings and comments. */
export function countEdges(src: string): number {
	let n = 0;
	for (const seg of scan(src)) {
		if (seg.kind !== 'code') continue;
		n += (src.slice(seg.start, seg.end).match(/->|--/g) ?? []).length;
	}
	return n;
}

/** A message when the source is over the size limits, else null. Layout runs on the main thread, so big graphs are capped. */
export function sizeProblem(src: string, maxChars: number, maxEdges: number): string | null {
	if (src.length > maxChars) return `This diagram has ${src.length} characters. The limit is ${maxChars}. Raise it in the DOT Diagrams settings.`;
	const edges = countEdges(src);
	if (edges > maxEdges) return `This diagram has ${edges} edges. The limit is ${maxEdges}. Raise it in the DOT Diagrams settings.`;
	return null;
}

export interface DotError {
	line: number | null;
	message: string;
}

/** Turns the text that Graphviz throws into a line number and a short sentence. */
export function parseError(raw: string): DotError {
	const lines = raw
		.split('\n')
		.map((l) => l.replace(/^(?:Error|Warning):\s*(?:<stdin>:\s*)?/, '').trim())
		.filter(Boolean);
	const first = lines.find((l) => /line \d+/.test(l)) ?? lines[0] ?? 'Graphviz could not draw this diagram.';
	const m = /\bline (\d+)/.exec(first);
	const message = first.replace(/\s+in line \d+/, '').replace(/^./, (c) => c.toUpperCase());
	return { line: m ? Number(m[1]) : null, message };
}

/** The source line with that number (1-based), cut to 120 characters, or "". */
export function excerptLine(src: string, line: number | null): string {
	if (line === null) return '';
	const text = src.split('\n')[line - 1] ?? '';
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export interface Plan {
	source: string;
	engine: Engine;
	preset: string | null;
	notes: string[];
	links: number;
}

export interface PlanOptions {
	pro: boolean;
	defaultEngine: Engine;
	defaultPreset: string;
	palette: Palette;
	/** Map wikilinks to clickable nodes. Default: the value of pro. Off for exported files. */
	links?: boolean;
	/** Graph background. Default: transparent, so the theme shows through. Exports use white. */
	background?: string;
}

/** The whole preprocessing: directives, engine choice, preset, wikilinks, theme defaults. */
export function plan(raw: string, o: PlanOptions): Plan {
	const dir = parseDirectives(raw);
	const notes: string[] = [];
	const choice = resolveEngine(dir.engine, o.defaultEngine, o.pro);
	if (choice.note) notes.push(choice.note);
	const wanted = dir.preset ?? (o.defaultPreset || null);
	let preset: string | null = null;
	if (wanted && !(wanted in PRESETS)) notes.push(`Unknown preset "${wanted}". Known presets: ${PRESET_NAMES.join(', ')}.`);
	else if (wanted && !o.pro) notes.push(`The ${wanted} preset is a Pro feature. Used the theme colors.`);
	else preset = wanted;
	const mapped = mapWikilinks(raw, o.links ?? o.pro);
	const source = insertAfterOpener(mapped.source, defaultsText(buildDefaults(o.palette, preset, o.background)));
	return { source, engine: choice.engine, preset, notes, links: mapped.links };
}

/** CSS color text such as `rgb(218, 218, 218)`, `rgba(0, 0, 0, 0.5)` or `#abc` as `#rrggbb` or `#rrggbbaa`. Null when it does not parse. */
export function cssColorToHex(css: string): string | null {
	const t = css.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
	if (hex) {
		const h = hex[1] ?? '';
		const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
		return `#${full}`;
	}
	const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t);
	if (!m) return null;
	const two = (v: string): string => Math.min(255, Math.max(0, Math.round(Number(v)))).toString(16).padStart(2, '0');
	const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
	const alpha = a >= 1 ? '' : two(String(a * 255));
	return `#${two(m[1] ?? '0')}${two(m[2] ?? '0')}${two(m[3] ?? '0')}${alpha}`;
}

export interface Block {
	start: number;
	end: number;
	lang: string;
	source: string;
}

/** The DOT or Graphviz fenced block that holds a line (0-based), or null. start and end are the fence lines. */
export function findBlockAt(text: string, line: number): Block | null {
	const lines = text.split('\n');
	let open = -1;
	let fence = '';
	let lang = '';
	for (let i = 0; i < lines.length; i++) {
		const m = /^( {0,3})(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i] ?? '');
		if (open < 0 && m) {
			open = i;
			fence = m[2] ?? '';
			lang = (m[3] ?? '').toLowerCase();
		} else if (open >= 0 && m && (m[2] ?? '').startsWith(fence.charAt(0)) && (m[2] ?? '').length >= fence.length && (lines[i] ?? '').trim() === (m[2] ?? '')) {
			if (line >= open && line <= i && (lang === 'dot' || lang === 'graphviz')) return { start: open, end: i, lang, source: lines.slice(open + 1, i).join('\n') };
			open = -1;
		}
	}
	return null;
}
