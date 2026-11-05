// "What Pro adds": one window that lists the Pro features of a plugin, lets the user try each feature on sample
// content, and shows the price, the one-time Sponsor button and the GitHub sign in.
// Products import it from the ./github-obsidian entry of this package (github-obsidian.ts re-exports this file).
// It never opens by itself. Only a command, a button in the settings or the link in the Pro notice opens it.
// A demo runs only after a click on "Try it", draws into the window and never writes to a vault file.
import { Modal, Setting, type App, type Notice, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { COPY_TAG, sponsorUrl, type SponsorsConfig } from './github';
import { CATALOG_TEXT, fillAccountSetting, proNoticeKind, showProNotice, sponsorsSettingItems, type SponsorsUiOptions } from './github-obsidian';
import type { SponsorsManager } from './sponsors';

/** One Pro feature of a plugin. */
export interface WhatProFeature {
	/** Stable id, for tests and the e2e shots. Lowercase letters, digits and dashes. */
	id: string;
	/** One sentence: what the feature does. The README Pro section and notemods.com use the same text. */
	line: string;
	/**
	 * Where the Pro gate of this feature is in the plugin source: a path under the product folder and a literal text of
	 * the gate. A unit test of each product checks that the text is in the file (missingGates).
	 */
	gate: { file: string; text: string };
}

/** A feature with its demo. The demo draws the feature at work on sample content into el. */
export interface WhatProDemoFeature extends WhatProFeature {
	demo: (el: HTMLElement) => void;
}

export interface WhatProConfig {
	/** The plugin id. The Sponsor URL gets metadata_source=<plugin id>-whatpro-<COPY_TAG>. */
	pluginId: string;
	/** The plugin name, for the title. */
	pluginName: string;
	features: WhatProDemoFeature[];
	/** The price sentence, the same text as PRO_UI.priceText. */
	priceText: string;
	/** Status text options of the account row (the same as the settings tab). */
	ui?: Pick<SponsorsUiOptions, 'signedOutText'>;
}

/** The tag added to metadata_source, so a payment that starts in this window shows in the GitHub export. */
export const WHAT_PRO_TAG = 'whatpro';
export const WHAT_PRO_TITLE = 'What Pro adds';
export const WHAT_PRO_DEMO_NOTE = 'Each demo uses sample text in this window. It does not read or change your notes.';

/** metadata_source of the Sponsor button in this window: <plugin id>-whatpro. */
export function whatProSource(pluginId: string): string {
	return `${pluginId}-${WHAT_PRO_TAG}`;
}

/**
 * The Sponsor URL of this window. Same form as sponsorUrl (and tools/pro.mjs), with
 * metadata_source=<plugin id>-whatpro-<COPY_TAG>, for example search-operators-whatpro-all (see COPY_TAG in github.ts).
 */
export function whatProUrl(config: SponsorsConfig, pluginId: string): string {
	return sponsorUrl({ ...config, source: whatProSource(pluginId) }, COPY_TAG);
}

/** The label of the Sponsor button: the one-time price when a one-time sponsorship unlocks Pro. */
export function sponsorButtonText(config: SponsorsConfig): string {
	return config.oneTimeUsd > 0 ? `Sponsor $${config.oneTimeUsd} once` : 'Sponsor on GitHub';
}

/**
 * What the window shows for this user. The owner rule of showProNotice applies: never pitch a paying user.
 *  - active: Pro is on. The window says so and has no Sponsor button and no price.
 *  - recheck: signed in, and GitHub may answer Pro. No Sponsor button; the account row has Refresh.
 *  - pitch: the price, the Sponsor button and the account row with Sign in with GitHub.
 */
export type WhatProState = 'active' | 'recheck' | 'pitch';

export interface WhatProModel {
	state: WhatProState;
	title: string;
	status: string;
	lines: string[];
	/** null when the window must not show a price. */
	priceText: string | null;
	/** CATALOG_TEXT after the price; null when the window must not show a price. */
	catalogText: string | null;
	sponsorText: string | null;
	sponsorUrl: string | null;
	/** Show the GitHub account row (Sign in with GitHub, or Refresh and Sign out). */
	account: boolean;
}

export const WHAT_PRO_STATUS: Record<WhatProState, string> = {
	active: 'Pro is active. Thank you for your support. Each feature below is on in your notes.',
	recheck: 'You are signed in with GitHub. To check your sponsorship again, select Refresh below.',
	pitch: 'Pro is off. The free features work without an account.',
};

export function whatProModel(pro: SponsorsManager | null, cfg: Pick<WhatProConfig, 'pluginId' | 'features' | 'priceText'>, sponsors: SponsorsConfig): WhatProModel {
	const kind = pro ? proNoticeKind(pro) : 'pitch';
	const state: WhatProState = kind === 'none' ? 'active' : kind;
	const pitch = state === 'pitch';
	return {
		state,
		title: WHAT_PRO_TITLE,
		status: WHAT_PRO_STATUS[state],
		lines: cfg.features.map((f) => f.line),
		priceText: pitch ? cfg.priceText : null,
		catalogText: pitch ? CATALOG_TEXT : null,
		sponsorText: pitch ? sponsorButtonText(sponsors) : null,
		sponsorUrl: pitch ? whatProUrl(sponsors, cfg.pluginId) : null,
		account: pro !== null && state !== 'active',
	};
}

/** The ids of the features whose gate text is not in its file. read returns the file text, or null when it is missing. */
export function missingGates(features: readonly WhatProFeature[], read: (file: string) => string | null): string[] {
	return features.filter((f) => f.gate.text === '' || !(read(f.gate.file) ?? '').includes(f.gate.text)).map((f) => f.id);
}

function openUrl(url: string): void {
	window.open(url);
}

/** Demo helper: a short label, then the text in a code block. Returns the code block. */
export function demoText(el: HTMLElement, label: string, text: string): HTMLElement {
	el.createEl('p', { text: label, cls: 'pf-whatpro-demo-label' });
	return el.createEl('pre', { cls: 'pf-whatpro-demo-text' }).createEl('code', { text });
}

/** The window. Open it with showWhatProAdds. */
export class WhatProModal extends Modal {
	private stopAccount: () => void = () => undefined;
	private stopChange: () => void = () => undefined;
	private shown: WhatProState | null = null;

	constructor(
		app: App,
		private readonly pro: SponsorsManager | null,
		private readonly cfg: WhatProConfig,
		private readonly sponsors: SponsorsConfig,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('pf-whatpro');
		this.render();
		// After a sign in or a check, the window shows the new state (for example "Pro is active", no Sponsor button).
		if (this.pro) {
			this.stopChange = this.pro.onChange(() => {
				if (whatProModel(this.pro, this.cfg, this.sponsors).state !== this.shown) this.render();
			});
		}
	}

	onClose(): void {
		this.stopChange();
		this.stopAccount();
		this.contentEl.empty();
	}

	private render(): void {
		this.stopAccount();
		this.stopAccount = () => undefined;
		const model = whatProModel(this.pro, this.cfg, this.sponsors);
		this.shown = model.state;
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(`${model.title}: ${this.cfg.pluginName}`);
		contentEl.createEl('p', { text: model.status, cls: 'pf-whatpro-status', attr: { 'data-state': model.state } });
		const list = contentEl.createDiv({ cls: 'pf-whatpro-features' });
		for (const f of this.cfg.features) this.renderFeature(list, f);
		contentEl.createEl('p', { text: WHAT_PRO_DEMO_NOTE, cls: 'setting-item-description' });
		if (model.priceText !== null && model.sponsorUrl !== null && model.sponsorText !== null) {
			const url = model.sponsorUrl;
			new Setting(contentEl)
				.setName('Price')
				.setDesc(model.catalogText ? `${model.priceText} ${model.catalogText}` : model.priceText)
				.setClass('pf-whatpro-price')
				.addButton((b) =>
					b
						.setButtonText(model.sponsorText ?? '')
						.setCta()
						.onClick(() => openUrl(url)),
				);
		}
		if (model.account && this.pro) {
			const row = new Setting(contentEl).setClass('pf-whatpro-account');
			this.stopAccount = fillAccountSetting(row, this.pro, { proSummary: '', priceText: '', signedOutText: this.cfg.ui?.signedOutText });
		}
	}

	private renderFeature(list: HTMLElement, f: WhatProDemoFeature): void {
		const item = list.createDiv({ cls: 'pf-whatpro-feature', attr: { 'data-feature': f.id } });
		const setting = new Setting(item).setName(f.line);
		const out = item.createDiv({ cls: 'pf-whatpro-demo' });
		out.hide();
		setting.addButton((b) =>
			b.setButtonText('Try it').onClick(() => {
				out.empty();
				out.show();
				try {
					f.demo(out);
				} catch (e) {
					out.empty();
					out.createEl('p', { text: `The demo could not run: ${e instanceof Error ? e.message : String(e)}` });
				}
			}),
		);
		setting.controlEl.querySelector('button')?.setAttribute('aria-label', `Try it: ${f.line}`);
	}
}

/** Opens the "What Pro adds" window. Call it only from a user action (a command, a button or a link). */
export function showWhatProAdds(app: App, pro: SponsorsManager | null, cfg: WhatProConfig, sponsors: SponsorsConfig): WhatProModal {
	const modal = new WhatProModal(app, pro, cfg, sponsors);
	modal.open();
	return modal;
}

/**
 * showProNotice, plus a "What Pro adds" link under the text. The link closes the notice and calls open.
 * Returns the notice, or null when Pro is on (no notice).
 */
export function showProNoticeWithWhatPro(pro: SponsorsManager | null, lead: string, open: () => void): Notice | null {
	const notice = showProNotice(pro, lead);
	if (!notice) return null;
	const host = (notice as Partial<Pick<Notice, 'messageEl'>>).messageEl;
	if (!host) return notice;
	const link = host.createDiv({ cls: 'pf-pro-notice-whatpro' }).createEl('a', { text: WHAT_PRO_TITLE, href: '#' });
	link.addEventListener('click', (e) => {
		e.preventDefault();
		notice.hide();
		open();
	});
	return notice;
}

/** The settings row with the "What Pro adds" button. */
export function whatProSettingItem(open: () => void): SettingDefinition {
	return {
		name: WHAT_PRO_TITLE,
		render: (setting: Setting) => {
			setting.setName(WHAT_PRO_TITLE);
			setting.setDesc('Read the list of paid features, try each one on sample text, and see the price.');
			setting.addButton((b) => b.setButtonText(WHAT_PRO_TITLE).onClick(open));
		},
	};
}

/** sponsorsSettingItems with the "What Pro adds" row added at the end of the Pro group. */
export function sponsorsSettingItemsWithWhatPro(pro: SponsorsManager, ui: SponsorsUiOptions, open: () => void): SettingDefinitionItem[] {
	const items = sponsorsSettingItems(pro, ui);
	const [first, ...rest] = items;
	if (first && 'type' in first && first.type === 'group') return [{ ...first, items: [...(first.items ?? []), whatProSettingItem(open)] }, ...rest];
	return [...items, whatProSettingItem(open)];
}
