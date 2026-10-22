/**
 * Modes - ask and work
 *
 * Ask mode is read-only: the write tools are removed from the model's toolset,
 * and bash runs under an OS-level sandbox that denies filesystem writes (see
 * backends.ts). Work mode is pi as usual.
 *
 * Toggle with `alt+m`, `/ask`, `/work`, or start in ask mode with `--ask`.
 *
 * Configuration:
 * - PI_MODES_BASH=auto|off   Detect a read-only bash backend, or skip detection.
 * - PI_MODES_ASK_TOOLS=a,b   Extra tool names to allow in ask mode.
 *
 * Windows is intentionally unsupported: no modes are registered there.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createWrappedOperations, detectBackend, type SandboxBackend } from "./backends.ts";
import { createModesFooter, type ModeBadge } from "./footer.ts";

type Mode = "work" | "ask";

/** Tools that may run in ask mode. Everything else is hidden and blocked. */
const ASK_TOOLS = ["read", "grep", "find", "ls", "bash", "web_search", "web_fetch", "questionnaire"];

const CONTEXT_CUSTOM_TYPE = "modes-ask-context";
const CONTEXT_MARKER = "[ASK MODE ACTIVE]";
const STATE_CUSTOM_TYPE = "modes";
const SHORTCUT = "alt+m";

interface PersistedState {
	mode?: Mode;
}

const ASK_PROMPT = `${CONTEXT_MARKER}
You are in ask mode: reading, searching, and answering only.

Rules:
- Do not modify files. The edit and write tools are not available.
- bash runs inside a read-only sandbox. Reading, searching, git history, and network access work; anything that writes fails with a permission error. Do not retry a failed write - report the limitation instead.
- Answer from evidence: cite file paths with line numbers, and URLs for web results.
- If a change is needed, describe it precisely and tell the user to switch to work mode (/work or alt+m).`;

export default function modesExtension(pi: ExtensionAPI): void {
	// Ask mode depends on an OS-level sandbox that Windows does not provide.
	// Rather than ship a weaker guardrail, the extension does nothing there.
	if (process.platform === "win32") return;

	let mode: Mode = "work";
	let backend: SandboxBackend | undefined;
	let backendReason = "not detected yet";
	let backendChecked = false;
	let workTools: string[] | undefined;
	let footerTui: { requestRender(): void } | undefined;
	let footerOwned = false;
	const wrappedCalls = new Set<string>();

	function configuredAskTools(): string[] {
		const extra = (process.env.PI_MODES_ASK_TOOLS ?? "")
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name.length > 0);
		return [...new Set([...ASK_TOOLS, ...extra])];
	}

	/** Ask toolset, restricted to tools that actually exist in this session. */
	function askToolset(): string[] {
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		return configuredAskTools().filter((name) => registered.has(name));
	}

	function persist(): void {
		pi.appendEntry(STATE_CUSTOM_TYPE, { mode } satisfies PersistedState);
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus("modes", undefined);

		if (mode !== "ask") return;

		// In the TUI the badge lives in the footer's first line; other modes have
		// no footer, so they keep the plain status line.
		if (ctx.mode === "tui") {
			footerTui?.requestRender();
			return;
		}

		const badge = badgeSpec();
		ctx.ui.setStatus("modes", ctx.ui.theme.fg(badge.tone, badge.text));
	}

	function badgeSpec(): ModeBadge {
		if (backend) return { text: `⏸ ask · ro(${backend.id})`, tone: "warning" };
		return { text: "⏸ ask · bash off", tone: "error" };
	}

	/**
	 * Ask mode replaces the built-in footer so the badge can sit on the
	 * directory/session line instead of taking a row of its own. Work mode
	 * restores pi's native footer.
	 */
	function installAskFooter(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || footerOwned) return;
		try {
			ctx.ui.setFooter((tui, theme, footerData) => {
				footerTui = tui;
				const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
				return {
					...createModesFooter(ctx, theme, footerData, badgeSpec),
					dispose() {
						unsubscribe();
						footerTui = undefined;
					},
				};
			});
			footerOwned = true;
		} catch {
			// Fall back to the status line rendered by updateStatus().
			ctx.ui.setFooter(undefined);
			footerOwned = false;
			footerTui = undefined;
		}
	}

	function removeAskFooter(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || !footerOwned) return;
		ctx.ui.setFooter(undefined);
		footerOwned = false;
		footerTui = undefined;
	}

	function describe(): string {
		const lines = [
			`Mode: ${mode}`,
			`Read-only bash: ${backend ? backend.id : "unavailable"}`,
			`Backend check: ${backendReason}`,
		];
		if (mode === "ask") {
			lines.push(`Allowed tools: ${askToolset().join(", ") || "(none)"}`);
		}
		lines.push("", "Toggle: alt+m, /ask, /work");
		return lines.join("\n");
	}

	/** Detect a backend at most once per session, on first use. */
	async function ensureBackend(cwd: string): Promise<void> {
		if (backendChecked) return;
		backendChecked = true;
		const detected = await detectBackend(cwd);
		backend = detected.backend;
		backendReason = detected.reason;
	}

	async function setMode(next: Mode, ctx: ExtensionContext): Promise<void> {
		if (next === mode) {
			updateStatus(ctx);
			return;
		}

		if (next === "ask") {
			await ensureBackend(ctx.cwd);
			mode = "ask";
			workTools = pi.getActiveTools();
			pi.setActiveTools(askToolset());
			installAskFooter(ctx);
			updateStatus(ctx);
			persist();
			if (backend) {
				ctx.ui.notify(`Ask mode: no changes. bash is read-only (${backend.id}).`, "info");
			} else {
				ctx.ui.notify(`Ask mode: no changes, and bash is disabled. ${backendReason}`, "warning");
			}
			return;
		}

		mode = "work";
		pi.setActiveTools(workTools ?? pi.getActiveTools());
		workTools = undefined;
		removeAskFooter(ctx);
		updateStatus(ctx);
		persist();
		ctx.ui.notify("Work mode: full access restored.", "info");
	}

	pi.registerFlag("ask", {
		description: "Start in ask mode (read-only)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("ask", {
		description: "Switch to ask mode (read-only)",
		handler: async (_args, ctx) => setMode("ask", ctx),
	});

	pi.registerCommand("work", {
		description: "Switch to work mode (full access)",
		handler: async (_args, ctx) => setMode("work", ctx),
	});

	pi.registerCommand("modes", {
		description: "Show the current mode and sandbox backend",
		handler: async (_args, ctx) => ctx.ui.notify(describe(), "info"),
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Toggle ask/work mode",
		handler: async (ctx) => setMode(mode === "ask" ? "work" : "ask", ctx),
	});

	// Bash is the one tool that survives ask mode, so it is wrapped at the call
	// site instead of being replaced. Each call id is wrapped once.
	pi.on("tool_call", async (event) => {
		if (mode !== "ask") return undefined;

		if (event.toolName === "bash") {
			const input = event.input as { command?: unknown };
			if (typeof input.command !== "string") return undefined;
			if (!backend) {
				return {
					block: true,
					reason:
						"Ask mode: bash is disabled because no read-only sandbox backend is available. Use /work to leave ask mode.",
				};
			}
			if (wrappedCalls.has(event.toolCallId)) return undefined;
			wrappedCalls.add(event.toolCallId);
			if (wrappedCalls.size > 512) wrappedCalls.clear();
			input.command = backend.wrap(input.command);
			return undefined;
		}

		if (configuredAskTools().includes(event.toolName)) return undefined;

		return {
			block: true,
			reason: `Ask mode: ${event.toolName} is not available, because it can change files or run arbitrary code. Use /work to leave ask mode.`,
		};
	});

	// `!command` bypasses the bash tool and therefore the tool_call handler.
	pi.on("user_bash", () => {
		if (mode !== "ask") return undefined;
		if (!backend) {
			return {
				result: {
					output:
						"Ask mode: bash is disabled because no read-only sandbox backend is available. Use /work to leave ask mode.",
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}
		return { operations: createWrappedOperations(backend) };
	});

	pi.on("before_agent_start", async (event) => {
		if (mode !== "ask") return undefined;
		if (event.messageType !== "user") return undefined;
		return {
			message: {
				customType: CONTEXT_CUSTOM_TYPE,
				content: ASK_PROMPT,
				display: false,
			},
		};
	});

	// Drop ask-mode context once the session leaves ask mode.
	pi.on("context", async (event) => {
		if (mode === "ask") return undefined;
		return { messages: event.messages.filter((message) => !isAskContext(message)) };
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const state = entries
			.filter(
				(entry: { type: string; customType?: string }) =>
					entry.type === "custom" && entry.customType === STATE_CUSTOM_TYPE,
			)
			.pop() as { data?: PersistedState } | undefined;

		mode = state?.data?.mode ?? "work";
		if (pi.getFlag("ask") === true) mode = "ask";

		workTools = undefined;
		if (mode === "ask") {
			await ensureBackend(ctx.cwd);
			workTools = pi.getActiveTools();
			pi.setActiveTools(askToolset());
			installAskFooter(ctx);
		} else {
			removeAskFooter(ctx);
		}
		updateStatus(ctx);
	});
}

/** True for the hidden ask-mode prompt and for user messages that carry it. */
function isAskContext(message: AgentMessage): boolean {
	const candidate = message as AgentMessage & { customType?: string };
	if (candidate.customType === CONTEXT_CUSTOM_TYPE) return true;
	if (candidate.role === "assistant") return false;
	const content = (candidate as { content?: unknown }).content;
	if (typeof content === "string") return content.includes(CONTEXT_MARKER);
	if (!Array.isArray(content)) return false;
	return content.some(
		(part) =>
			!!part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string" &&
			(part as { text: string }).text.includes(CONTEXT_MARKER),
	);
}
