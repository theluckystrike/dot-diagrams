import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRESET_NAMES, isAlign, isEngine, isWidthMode, type Align, type Engine, type WidthMode } from './dot';
import { PRO_UI, isPro } from './pro';
import type DotDiagramsPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface DotDiagramsSettings {
	/** Layout engine for blocks that have no `// engine:` line. */
	defaultEngine: Engine;
	/** Style preset (Pro) for blocks that have no `// preset:` line. Empty means the theme colors. */
	defaultPreset: string;
	/** Largest number of edges to draw in one block. Layout runs on the main thread. */
	maxEdges: number;
	/** Show the Copy, SVG and PNG buttons above a diagram. */
	showToolbar: boolean;
	/** PNG export size: 1 to 4 times the size at 96 dpi. */
	exportScale: number;
	/** Width for blocks without a `// width:` line: fit to the note, or the size that Graphviz gives. */
	defaultWidth: WidthMode;
	/** Alignment for blocks without an `// align:` line. */
	defaultAlign: Align;
}

export const MAX_EDGES_MIN = 50;
export const MAX_EDGES_MAX = 20000;
export const MAX_CHARS = 300000;

export const DEFAULT_SETTINGS: DotDiagramsSettings = {
	defaultEngine: 'dot',
	defaultPreset: '',
	maxEdges: 300,
	showToolbar: true,
	exportScale: 2,
	defaultWidth: 'fit',
	defaultAlign: 'center',
};

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<DotDiagramsSettings> | null | undefined): DotDiagramsSettings {
	const s = saved ?? {};
	return {
		defaultEngine: typeof s.defaultEngine === 'string' && isEngine(s.defaultEngine) ? s.defaultEngine : DEFAULT_SETTINGS.defaultEngine,
		defaultPreset: typeof s.defaultPreset === 'string' && PRESET_NAMES.includes(s.defaultPreset) ? s.defaultPreset : '',
		maxEdges: clampInt(s.maxEdges, MAX_EDGES_MIN, MAX_EDGES_MAX, DEFAULT_SETTINGS.maxEdges),
		showToolbar: typeof s.showToolbar === 'boolean' ? s.showToolbar : DEFAULT_SETTINGS.showToolbar,
		exportScale: clampInt(s.exportScale, 1, 4, DEFAULT_SETTINGS.exportScale),
		defaultWidth: typeof s.defaultWidth === 'string' && isWidthMode(s.defaultWidth) ? s.defaultWidth : DEFAULT_SETTINGS.defaultWidth,
		defaultAlign: typeof s.defaultAlign === 'string' && isAlign(s.defaultAlign) ? s.defaultAlign : DEFAULT_SETTINGS.defaultAlign,
	};
}

export class DotDiagramsSettingTab extends PluginSettingTab {
	plugin: DotDiagramsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: DotDiagramsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const presets: Record<string, string> = { '': 'Theme colors' };
		for (const n of PRESET_NAMES) presets[n] = `${n} (Pro)`;
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Default layout engine',
				desc: 'Used by blocks without a "// engine:" line. The dot engine draws layers, neato and circo draw networks. fdp, sfdp, twopi and osage are Pro.',
				control: {
					type: 'dropdown',
					key: 'defaultEngine',
					defaultValue: DEFAULT_SETTINGS.defaultEngine,
					options: { dot: 'dot', neato: 'neato', circo: 'circo', fdp: 'fdp (Pro)', sfdp: 'sfdp (Pro)', twopi: 'twopi (Pro)', osage: 'osage (Pro)' },
				},
			},
			{
				name: 'Default style preset',
				desc: 'Pro. Used by blocks without a "// preset:" line. Without Pro, diagrams use the colors of your theme.',
				control: { type: 'dropdown', key: 'defaultPreset', defaultValue: DEFAULT_SETTINGS.defaultPreset, options: presets },
			},
			{
				name: 'Default diagram width',
				desc: 'Used by blocks without a "// width:" line. Fit shrinks a wide diagram to the note width. Natural keeps the size that Graphviz gives, and a wide diagram scrolls.',
				control: { type: 'dropdown', key: 'defaultWidth', defaultValue: DEFAULT_SETTINGS.defaultWidth, options: { fit: 'Fit to the note', natural: 'Natural size' } },
			},
			{
				name: 'Default alignment',
				desc: 'Used by blocks without an "// align:" line.',
				control: { type: 'dropdown', key: 'defaultAlign', defaultValue: DEFAULT_SETTINGS.defaultAlign, options: { left: 'Left', center: 'Center', right: 'Right' } },
			},
			{
				name: 'Show buttons above diagrams',
				desc: 'Copy SVG for everyone. Export SVG and export PNG for Pro.',
				control: { type: 'toggle', key: 'showToolbar', defaultValue: DEFAULT_SETTINGS.showToolbar },
			},
			{
				name: 'Edge limit',
				desc: `A block with more edges than this is not drawn, because a very large graph can freeze the window for a long time. From ${MAX_EDGES_MIN} to ${MAX_EDGES_MAX}.`,
				control: { type: 'number', key: 'maxEdges', defaultValue: DEFAULT_SETTINGS.maxEdges, min: MAX_EDGES_MIN, max: MAX_EDGES_MAX, step: 50 },
			},
			{
				name: 'PNG export scale',
				desc: 'Pro. Pixels per point of the diagram, 1 to 4 times the size at 96 dpi.',
				control: { type: 'slider', key: 'exportScale', defaultValue: DEFAULT_SETTINGS.exportScale, min: 1, max: 4, step: 1 },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: all seven layout engines, export to SVG and PNG, notes that open from [[wikilink]] nodes and style presets.'
					: 'Free version: dot, neato and circo layouts, theme colors, error messages with line numbers and Copy SVG. Pro adds fdp, sfdp, twopi and osage, export to SVG and PNG, notes that open from [[wikilink]] nodes and style presets.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.redrawAll();
	}
}
