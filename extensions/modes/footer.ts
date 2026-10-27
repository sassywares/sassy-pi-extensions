/**
 * Right-aligned mode badge.
 *
 * `ctx.ui.setStatus()` has no placement: pi appends status texts as a line of
 * their own, left-aligned, and its sanitizer collapses runs of spaces, so a
 * badge cannot be pushed to the right edge from there.
 *
 * This footer keeps pi's own rendering (it delegates to the exported
 * `FooterComponent`) and appends one extra line with the badge aligned to the
 * right edge. Nothing about the directory, session name, token stats, or model
 * line is reimplemented here, so it stays correct as pi's footer evolves.
 *
 * If a future pi version changes what `FooterComponent` reads from its session
 * argument, the render below throws; `onError` then tells the extension to
 * restore the native footer and fall back to the plain status line.
 */

import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { FooterComponent } from "@earendil-works/pi-coding-agent";

export interface ModeBadge {
	text: string;
	tone: "warning" | "error" | "accent";
}

export interface ModesFooterOptions {
	/** Session auto-compaction, shown by the footer as the `(auto)` suffix. */
	autoCompact: boolean;
	/** Called once if pi's footer cannot be rendered through this shim. */
	onError: () => void;
}

/**
 * The subset of `AgentSession` that `FooterComponent` reads. Everything except
 * a few computed values is already on the extension context.
 *
 * Every value is a getter, not a snapshot: `FooterComponent` reads
 * `session.state.model` and `session.state.thinkingLevel` on each render, and
 * `ctx` stays live for the whole session. Snapshotting here would freeze the
 * model name and thinking level for the session, so `/model` and `/thinking`
 * changes mid-session would never reach the footer.
 */
function sessionShim(ctx: ExtensionContext) {
	const state = {
		get model() {
			return ctx.model;
		},
		get thinkingLevel() {
			return ctx.thinkingLevel;
		},
	};

	return {
		get model() {
			return ctx.model;
		},
		state,
		routedModel: undefined,
		getContextUsage: () => ctx.getContextUsage(),
		modelRuntime: {
			// Extensions cannot observe subscription backing; the provider name is
			// the only signal available.
			isUsingSubscription: (provider: string) => provider === "kimi-coding",
		},
		get sessionManager() {
			return ctx.sessionManager;
		},
	} as unknown as ConstructorParameters<typeof FooterComponent>[0];
}

export function createModesFooter(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	badge: () => ModeBadge,
	options: ModesFooterOptions,
): Component & { dispose?(): void } {
	const inner = new FooterComponent(sessionShim(ctx), footerData);
	inner.setAutoCompactEnabled(options.autoCompact);
	let failed = false;

	function badgeLine(width: number): string {
		const current = badge();
		const text = current.text;
		if (visibleWidth(text) >= width) return theme.fg(current.tone, truncateToWidth(text, width, "…"));
		const padding = Math.max(1, width - visibleWidth(text));
		return " ".repeat(padding) + theme.fg(current.tone, text);
	}

	return {
		invalidate() {
			inner.invalidate();
		},
		render(width: number): string[] {
			if (failed) return [badgeLine(width)];
			try {
				return [...inner.render(width), badgeLine(width)];
			} catch {
				failed = true;
				options.onError();
				return [badgeLine(width)];
			}
		},
	};
}
