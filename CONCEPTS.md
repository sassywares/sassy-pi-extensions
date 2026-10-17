# Pi Extensions — Concepts

## Package

A pi package is an ordinary directory or npm package with a `package.json`. Pi reads the `pi` manifest and loads the resources it names. This repo exposes extensions. The `pi-package` keyword makes it eligible for the pi.dev gallery.

## Extension

A TypeScript module with a default export that receives `ExtensionAPI`. Pi loads it inside the pi process. An extension can register tools, commands, event handlers, providers, and UI. Here, each file under `extensions/` is one extension; `subagent/` is a directory with an `index.ts` entry point.

## Host-provided dependency

A package that pi supplies to extensions at runtime: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, and `typebox`. These belong in `peerDependencies`, never in `dependencies`.

## Session name

The title pi stores for a session. It appears in the session picker, the footer, and the terminal title. `/name` sets it manually; `pi.setSessionName()` sets it from an extension.

## Auto-title

The `auto-title` extension. After the first assistant turn with text, it generates a short title once per session and writes it as the session name. It never overwrites a manual name. `/title` regenerates; `/title <text>` sets one directly. `PI_AUTO_TITLE=0` disables the automatic pass only.

## Exa MCP

Exa's public, keyless search endpoint (`https://mcp.exa.ai/mcp`). The default provider for `web_search`. Free tier, shared rate limits.

## Exa API

Exa's direct search API (`https://api.exa.ai/search`). Used when `EXA_API_KEY` is set. Your own quota and key.

## Public URL guard

The `web_fetch` rule set that refuses localhost, private and link-local addresses, and URLs with embedded credentials. It checks the initial URL and every redirect target. The intent is public web pages only — not services on the user's machine or local network.

## Readable text

What `web_fetch` returns: HTML converted to plain text with the title extracted, or plain text normalized. Responses are capped at 2 MB and truncated to the requested character limit.

## Handoff

The `handoff` extension. `/handoff <goal>` asks the current model for a self-contained continuation prompt, lets the user edit it, and opens a new session with it in the editor. `/handoff mode:auto <goal>` sends it immediately. Session replacement is command-only in pi, which is why handoff is a command rather than a tool.

## Subagent

The `subagent` tool. It spawns a separate `pi` process per task so each task gets an isolated context window, then returns compact output. Modes are single, parallel, and chain. A chain replaces `{previous}` with the prior task's result.

## Agent

A Markdown file with `name` and `description` frontmatter, plus optional `tools`, `model`, and `thinking`. The body is the system prompt. Agents are discovered from `~/.pi/agent/agents/` and the nearest project `.pi/agents/`. Project agents take precedence over user agents with the same name.

## Agent scope

Where the `subagent` tool looks for agents: `user`, `project`, or `both`. Default is `both`. The Sassy roster is user-scoped, linked from this repo's `agents/` directory.

## Upstream derivation

`handoff` and `subagent` are modified versions of pi's MIT-licensed examples and documentation. `NOTICE` records the attribution; `LICENSE` covers this repository.
