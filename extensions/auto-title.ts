/**
 * Auto-title
 *
 * Generates a short session title after the first meaningful turn, and adds
 * `/title` to regenerate or set one manually. Titles use pi's native session
 * name, so they appear in the session picker, footer, and terminal title.
 *
 * Disable auto-generation with PI_AUTO_TITLE=0.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_TITLE_LENGTH = 60;
const AUTO_TITLE_DISABLED = process.env.PI_AUTO_TITLE === "0";

let generationToken = 0;
let generating = false;
let autoAttemptedSessionId: string | undefined;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function normalizeTitle(raw: string): string {
  let title = (raw.split(/\r?\n/, 1)[0] ?? "").trim();
  title = title.replace(/^#+\s*/, "");
  title = title.replace(/^(?:session\s+)?title\s*:\s*/i, "");
  title = title.replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "").trim();
  title = title.replace(/[.!?;:,，。！？；：]+$/, "").trim();
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).replace(/\s+\S*$/, "").trim();
  }
  return title;
}

function hasAssistantText(ctx: ExtensionContext): boolean {
  return ctx.sessionManager.getBranch().some(
    (entry) =>
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      textOf(entry.message.content).trim().length > 0,
  );
}

function buildTranscript(ctx: ExtensionContext): string {
  const parts: string[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") continue;

    const text = textOf(message.content).trim();
    if (!text) continue;

    // Titles only need the gist of the opening turns.
    parts.push(`${message.role.toUpperCase()}: ${text.slice(0, 3000)}`);
    if (parts.length >= 4) break;
  }
  return parts.join("\n\n").slice(0, 8000);
}

async function generateTitle(ctx: ExtensionContext): Promise<string | undefined> {
  if (!ctx.model) return undefined;
  const transcript = buildTranscript(ctx);
  if (!transcript) return undefined;

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15_000);
  try {
    const result = await ctx.modelRegistry.complete(
      ctx.model,
      {
        systemPrompt:
          "You create concise session titles for a coding agent. Reply with only the title: " +
          "2-6 words, no quotes, no markdown, no trailing punctuation. " +
          "Describe the concrete task, not the conversation. Use the user's language.",
        messages: [
          {
            role: "user",
            content: `Create a title for this session:\n\n${transcript}`,
            timestamp: Date.now(),
          },
        ],
      },
      { maxTokens: 32, temperature: 0.2, signal: abort.signal },
    );

    if (result.stopReason === "error" || result.stopReason === "aborted") return undefined;
    return normalizeTitle(textOf(result.content));
  } finally {
    clearTimeout(timeout);
  }
}

async function titleCurrentSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  force: boolean,
): Promise<string | undefined> {
  if (generating) return undefined;

  const sessionId = ctx.sessionManager.getSessionId();
  const token = generationToken;
  const existing = pi.getSessionName();
  if (!force && existing?.trim()) return existing;

  generating = true;
  try {
    const title = await generateTitle(ctx);
    if (!title) return undefined;

    // The user may have switched sessions or named this one while we waited.
    if (token !== generationToken || ctx.sessionManager.getSessionId() !== sessionId) return undefined;
    if (!force && pi.getSessionName()?.trim()) return pi.getSessionName();

    pi.setSessionName(title);
    return title;
  } finally {
    generating = false;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    generationToken++;
    generating = false;
    autoAttemptedSessionId = undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (AUTO_TITLE_DISABLED) return;
    if (pi.getSessionName()?.trim()) return;

    const sessionId = ctx.sessionManager.getSessionId();
    if (autoAttemptedSessionId === sessionId) return;
    if (!hasAssistantText(ctx)) return;

    // Try once per session. `/title` can retry after a provider failure.
    autoAttemptedSessionId = sessionId;

    // Do not delay the turn; the title can arrive a moment later.
    void titleCurrentSession(pi, ctx, false).catch(() => {
      // A title is a convenience; never surface provider errors into the session.
    });
  });

  pi.registerCommand("title", {
    description: "Generate a title from the conversation, or set one: /title <text>",
    handler: async (args, ctx) => {
      const requested = args.trim();
      if (requested) {
        const title = normalizeTitle(requested) || requested;
        pi.setSessionName(title);
        ctx.ui.notify(`Session titled: ${title}`, "info");
        return;
      }

      ctx.ui.notify("Generating session title…", "info");
      const title = await titleCurrentSession(pi, ctx, true);
      if (title) {
        ctx.ui.notify(`Session titled: ${title}`, "info");
      } else {
        ctx.ui.notify("Could not generate a title from this conversation.", "warning");
      }
    },
  });
}
