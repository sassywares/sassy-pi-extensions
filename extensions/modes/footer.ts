/**
 * Ask-mode footer.
 *
 * The built-in footer puts every `ctx.ui.setStatus()` entry on its own line
 * below the token stats, which leaves stale blank space above the model line
 * and pushes the transcript up by one row. This footer is installed only while
 * ask mode is active, and draws the mode badge on the working-directory/session
 * line instead, right-aligned into space that is otherwise empty.
 *
 * It is deliberately a subset of pi's footer: working directory, git branch,
 * session name, token totals, cost, context usage, and model. Any other
 * extension statuses are kept on their own line.
 */

import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";

export interface ModeBadge {
	text: string;
	tone: "warning" | "error";
}

interface Usage {
	input?: number;
	output?: number;
	cost?: { total?: number };
}

interface Totals {
	input: number;
	output: number;
	cost: number;
}

const EMPTY_TOTALS: Totals = { input: 0, output: 0, cost: 0 };

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwd(cwd: string, home = homedir()): string {
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const delta = relative(resolvedHome, resolvedCwd);
	const insideHome = delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolutePath(delta));
	if (!insideHome) return cwd;
	return delta === "" ? "~" : `~${sep}${delta}`;
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

/** Left text on the left edge, right text on the right edge, one space minimum between. */
function justify(left: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + rightWidth + 1 <= width) {
		return left + " ".repeat(width - leftWidth - rightWidth) + right;
	}

	const availableLeft = width - rightWidth - 1;
	if (availableLeft >= 12) {
		const shortened = truncateToWidth(left, availableLeft, "…");
		const shortenedWidth = visibleWidth(shortened);
		return shortened + " ".repeat(Math.max(0, width - shortenedWidth - rightWidth)) + right;
	}

	if (rightWidth + 1 <= width) {
		return " ".repeat(Math.max(0, width - rightWidth)) + right;
	}

	return truncateToWidth(right, width, "…");
}

function addUsage(totals: Totals, usage: Usage | undefined): void {
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}

export function createModesFooter(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	badge: () => ModeBadge,
): Component & { dispose?(): void } {
	let cacheKey = "";
	let cache: Totals = EMPTY_TOTALS;

	function totals(): Totals {
		const leaf = ctx.sessionManager.getLeafId() ?? "";
		const entries = ctx.sessionManager.getEntries();
		const key = `${leaf}:${entries.length}`;
		if (key === cacheKey) return cache;

		const next: Totals = { input: 0, output: 0, cost: 0 };
		for (const entry of entries) {
			const record = entry as { type: string; usage?: Usage; message?: { role?: string; usage?: Usage } };
			if (record.type === "usage") {
				addUsage(next, record.usage);
			} else if (record.type === "message") {
				addUsage(next, record.message?.usage);
			}
		}
		cacheKey = key;
		cache = next;
		return next;
	}

	function render(width: number): string[] {
		const model = ctx.model;
		const branch = footerData.getGitBranch();
		const sessionName = ctx.sessionManager.getSessionName();

		let place = formatCwd(ctx.sessionManager.getCwd());
		if (branch) place += ` (${branch})`;
		if (sessionName) place += ` • ${sessionName}`;

		const current = badge();
		const lines = [justify(theme.fg("dim", place), theme.fg(current.tone, current.text), width)];

		const used = totals();
		const stats: string[] = [];
		if (used.input) stats.push(`↑${formatTokens(used.input)}`);
		if (used.output) stats.push(`↓${formatTokens(used.output)}`);
		if (used.cost) stats.push(`$${used.cost.toFixed(3)}`);
		const context = ctx.getContextUsage();
		if (context) {
			const percent = context.percent === null ? "?" : `${context.percent.toFixed(1)}%`;
			stats.push(`${percent}/${formatTokens(context.contextWindow ?? 0)}`);
		}

		let modelText = model?.id ?? "no-model";
		if (model?.reasoning) modelText += ` • ${ctx.thinkingLevel ?? "off"}`;
		if (stats.length > 0) {
			lines.push(justify(theme.fg("dim", stats.join(" ")), theme.fg("dim", modelText), width));
		}

		const statuses = [...footerData.getExtensionStatuses().entries()]
			.filter(([key]) => key !== "modes")
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
			.filter((text) => text.length > 0);
		if (statuses.length > 0) {
			lines.push(truncateToWidth(statuses.join(" "), width, "…"));
		}

		return lines;
	}

	return {
		invalidate() {},
		render,
	};
}
