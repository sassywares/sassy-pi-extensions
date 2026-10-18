/**
 * Sassy Handoff - summarize the current session and continue in a fresh one.
 *
 * Usage:
 *   /handoff [mode:review|pipeline] <goal for the next session>
 *
 * mode:review (default): generate a focused continuation prompt, let the user
 * edit it, then open a new session with the prompt seeded in the editor
 * (submit to continue).
 *
 * mode:pipeline: generate the prompt and start the new session immediately,
 * sending the prompt as its first user message (skill commands inside it are
 * expanded).
 *
 * Session replacement is only available from command handlers, which is why
 * this is a command and not a tool.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes the relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists the relevant files that were discussed or modified, with the specific part that matters
3. States the next task clearly, based on the user's goal
4. Is self-contained - the new thread must be able to proceed without the old conversation

If the user's goal names a plan file and a phase, make the plan path and phase explicit, and end with the exact follow-up command to run them (for example: run /skill:sassy-work <plan> phase:<n>).

Format your response as the prompt itself. No preamble. Example shape:

## Context
We were building X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file.ts - what matters there

## Task
[Clear description of what to do next, including the exact command to run]`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") {
		return entry.message;
	}
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((message) => message !== undefined);
	}

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const compactedBranch = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return compactedBranch.map(entryToMessage).filter((message) => message !== undefined);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Summarize this session and continue in a fresh one",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			let rest = args.trim();
			let pipeline = false;
			if (rest.startsWith("mode:review")) {
				rest = rest.slice("mode:review".length).trim();
			} else if (rest.startsWith("mode:pipeline")) {
				pipeline = true;
				rest = rest.slice("mode:pipeline".length).trim();
			}
			if (!rest) {
				ctx.ui.notify("Usage: /handoff [mode:review|pipeline] <goal for next session>", "error");
				return;
			}
			const goal = rest;

			const messages = getHandoffMessages(ctx.sessionManager.getBranch());
			if (messages.length === 0) {
				ctx.ui.notify("No conversation to hand off", "error");
				return;
			}

			const conversationText = serializeConversation(convertToLlm(messages));
			const currentSessionFile = ctx.sessionManager.getSessionFile();

			const generated = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, "Generating handoff prompt...");
				loader.onAbort = () => done(null);

				const doGenerate = async () => {
					const userMessage: Message = {
						role: "user",
						content: [
							{
								type: "text",
								text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
							},
						],
						timestamp: Date.now(),
					};

					const response = await ctx.modelRegistry.complete(
						ctx.model!,
						{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
						{ signal: loader.signal, cacheRetention: "none", sessionId: uuidv7() },
					);

					if (response.stopReason === "aborted") return null;

					return response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");
				};

				doGenerate()
					.then(done)
					.catch((err) => {
						console.error("Handoff generation failed:", err);
						done(null);
					});

				return loader;
			});

			if (generated === null) {
				ctx.ui.notify("Handoff cancelled", "info");
				return;
			}

			let prompt = generated;
			if (!pipeline) {
				const edited = await ctx.ui.editor("Edit handoff prompt", generated);
				if (edited === undefined) {
					ctx.ui.notify("Handoff cancelled", "info");
					return;
				}
				prompt = edited;
			}

			const result = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (replacementCtx) => {
					if (pipeline) {
						await replacementCtx.sendUserMessage(prompt, { expandPromptTemplates: true });
					} else {
						replacementCtx.ui.setEditorText(prompt);
						replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
					}
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
			}
		},
	});
}
