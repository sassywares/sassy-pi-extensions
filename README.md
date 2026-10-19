# Sassy Pi Extensions

**A zesty power pack for pi — auto-titled sessions, real web access, clean handoffs, and isolated subagents. Install once, ship faster.**

Sassy Pi Extensions is the Sassywares pi suite. It names each session from its first real turn, gives the agent `web_search` and `web_fetch` tools backed by Exa, carries context into a fresh session with `/handoff`, and runs bounded work in isolated subagents.

The package is `@sassywares/pi-extensions`; the repo is `sassy-pi-extensions`.

## Contents

- [Why this suite](#why-this-suite)
- [Quick start](#quick-start)
- [Extensions](#extensions)
  - [Auto-title](#auto-title)
  - [Web search and fetch](#web-search-and-fetch)
  - [Handoff](#handoff)
  - [Subagent](#subagent)
- [Configuration](#configuration)
- [Security](#security)
- [Provenance](#provenance)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Releasing](#releasing)
- [Repository maintenance](#repository-maintenance)

## Why this suite

- **Zero config where it matters.** Exa runs through its public MCP endpoint; titles use the model you are already talking to; `/handoff` uses the current session's model.
- **Native surfaces.** Titles use pi's own session name, so they show up in the session picker, footer, and terminal title. Search, fetch, and subagents are ordinary tools the model can call.
- **Safe by default.** `web_fetch` blocks localhost, private network addresses, and URLs with embedded credentials. Subagents run in isolated pi processes with the tools their agent file allows.
- **Opt out, not opt in.** Auto-titling stops with one environment variable. Manual titles always win.
- **Composable with `sassy-skills`.** `sassy-cycle`, `sassy-debug`, and `sassy-handoff` are built around the `subagent` and `/handoff` extensions.
- **Small.** No background servers. Host-provided dependencies only.

## Quick start

From a checkout (recommended — this also installs the agent definitions):

```bash
git clone https://github.com/sassywares/sassy-pi-extensions.git
./sassy-pi-extensions/scripts/install-agents.sh
pi install ./sassy-pi-extensions
```

Or install the package only:

```bash
pi install git:github.com/sassywares/sassy-pi-extensions@v0.3.0
```

Or from npm once published:

```bash
pi install npm:@sassywares/pi-extensions@0.3.0
```

A package-only install loads the extensions, but `subagent` has no agents until you link or copy some into `~/.pi/agent/agents/`. Run `scripts/install-agents.sh` from a checkout to link the Sassy roster.

Reload pi (`/reload`) and confirm:

- `web_search` and `web_fetch` are available to the model.
- The session gets a title after the first assistant turn, and `/title` is registered.
- `/handoff` is registered.
- The `subagent` tool lists the Sassy agents.

To try the package without changing settings:

```bash
pi -e ./sassy-pi-extensions
```

## Extensions

| Extension | Surface | What it does |
|---|---|---|
| **`auto-title`** | automatic + `/title [text]` | Generates a short session title after the first meaningful turn. `/title` regenerates it; `/title <text>` sets one manually. |
| **`web-search`** | `web_search`, `web_fetch` | Searches the web via Exa and fetches readable page text with local-address protection. |
| **`handoff`** | `/handoff [mode:review|pipeline] <goal>` | Summarizes the session into a continuation prompt and opens a fresh session with it. |
| **`subagent`** | `subagent` tool | Runs single, parallel, or chained tasks in isolated pi processes and returns compact results. |

### Auto-title

Runs after the first assistant turn that contains text. It builds a small transcript from the opening turns, asks the current model for a 2–6 word title, and writes it with `pi.setSessionName()`.

- Tries once per session. Use `/title` to retry after a provider failure.
- Never overwrites a title you set manually.
- Does not delay the turn; the title arrives when it is ready.
- 15 second timeout, 32 output tokens, low temperature.
- Titles are truncated to 60 characters.

### Web search and fetch

`web_search` uses Exa's public MCP endpoint by default. Set `EXA_API_KEY` to use the direct Exa API instead (higher limits and your own quota).

`web_fetch`:

- Accepts absolute `http(s)` URLs only.
- Follows up to 5 redirects.
- Blocks localhost, private/link-local addresses, and URLs with embedded credentials.
- Accepts HTML and plain text, capped at 2 MB.
- Screens the final URL after redirects, not just the first one.
- Returns readable text, truncated to 50,000 characters (12,000 by default).

### Handoff

`/handoff <goal>` (or `mode:review`) generates a focused prompt for a new session, lets you edit it, then opens that session with the prompt seeded in the editor.

`/handoff mode:pipeline <goal>` skips the editor, starts the new session, and sends the prompt immediately. Skill commands inside the prompt are expanded.

The extension uses the current session's model and the current conversation only. The new session cannot see the old one.

### Subagent

The `subagent` tool spawns a separate `pi` process per invocation, so each task gets its own context window. Three modes:

- **single** — `{ agent, task }`
- **parallel** — `{ tasks: [{ agent, task }, …] }`
- **chain** — `{ chain: [{ agent, task }, …] }`, with `{previous}` replaced by the prior result

Agent definitions are Markdown files under `~/.pi/agent/agents/` and the nearest project `.pi/agents/`. Project agents override user agents with the same name.

This repo ships the Sassy roster:

| Agent | Role |
|---|---|
| `scout` | Grounding scout: writes the shared grounding brief other agents read. |
| `worker` | General-purpose implementation in an isolated context. |
| `reviewer` | Quality, correctness, security, project-rule, and design-system review, diff-scoped. |
| `validator` | Checks that the diff matches the plan, independent of review. |

Link them with `./scripts/install-agents.sh`. Edit the frontmatter to change each agent's model, thinking level, or tool allowlist.

Every subagent reads the same grounding brief instead of re-exploring the repo. See [GROUNDING.md](GROUNDING.md) for its location, freshness check, and wait rule.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `PI_AUTO_TITLE` | unset | Set to `0` to disable automatic titles. `/title` still works. |
| `EXA_API_KEY` | unset | Use the direct Exa API instead of the public Exa MCP endpoint. |
| `PI_AGENTS_DIR` | `~/.pi/agent/agents` | Target directory for `scripts/install-agents.sh`. |

## Security

Extensions run inside the pi process with the same OS permissions as pi. Review extension source before installing it.

- `web_fetch` is designed for public web pages, not for reaching services on your machine or local network.
- `auto-title` sends a short transcript of the opening turns to the model already selected for the session. Provider terms and data handling apply.
- `/handoff` sends the conversation and your goal to the current model to generate the continuation prompt.
- `subagent` starts additional pi processes. Their permissions match the tools allowed by their agent file and the pi process that spawned them.
- No credentials are stored by this package. `EXA_API_KEY` is read from the environment at call time.

## Provenance

`handoff` and `subagent` are derived from pi's MIT-licensed examples and documentation, modified for this workflow. See [NOTICE](NOTICE).

## Repository layout

```text
sassy-pi-extensions/
├── extensions/
│   ├── auto-title.ts
│   ├── handoff.ts
│   ├── web-search.ts
│   └── subagent/
│       ├── agents.ts
│       └── index.ts
├── agents/
│   └── *.md
├── scripts/
│   └── install-agents.sh
├── .github/workflows/
│   └── publish.yml
├── AGENTS.md
├── CONCEPTS.md
├── LICENSE
├── NOTICE
├── README.md
└── package.json
```

## Development

This repo is the source of truth for the extensions and the Sassy agents. Install it locally so pi loads the working tree directly:

```bash
./scripts/install-agents.sh
pi install ~/Documents/Workspace/Sassywares/sassy-pi-extensions
```

Local installs are read in place — no copy, no build step. After changing an extension, run `/reload` in pi. Agent edits are picked up on the next subagent invocation.

Do not also keep copies under `~/.pi/agent/extensions/`; pi would load both and register duplicate tools and commands.

Test the package for one invocation without touching settings:

```bash
pi -e ~/Documents/Workspace/Sassywares/sassy-pi-extensions
```

Manual checks after a change:

- `web_search` with and without `EXA_API_KEY`.
- `web_fetch` on a normal page, and on `http://localhost:3000` (must be rejected).
- `/title`, `/title <text>`, and automatic naming with `PI_AUTO_TITLE` unset.
- `PI_AUTO_TITLE=0` starts a session without a generated title.
- `/handoff <goal>` or `/handoff mode:review <goal>` opens an editable prompt; `/handoff mode:pipeline <goal>` sends it.
- `subagent` with a single agent, and a chain using `{previous}`.

## Releasing

Publishing uses npm trusted publishing (OIDC). There is no long-lived npm token and no `NPM_TOKEN` secret.

A brand-new package cannot publish its first version through OIDC, because npm's trusted-publisher settings only exist after the package exists. Bootstrap once:

1. `npm login`, then `npm publish --access public` from a clean checkout.
2. On npmjs.com, open the package → **Settings → Trusted publishing → GitHub Actions** and set:
   - organization: `sassywares`
   - repository: `sassy-pi-extensions`
   - workflow filename: `publish.yml`
   - environment: blank
   - allowed actions: enable **npm publish** (do not leave it stage-only)
3. Bump `version` in `package.json`, commit, then tag and push. The workflow publishes with OIDC and provenance.

```bash
git tag -a v0.3.1 -m v0.3.1
git push origin v0.3.1
```

The workflow skips publishing if the tag's version is already on npm. A new trusted publisher must complete its first OIDC publish within 2 days of configuration, or npm expires it.

## Repository maintenance

- Commit changes under `extensions/` and `agents/`, and update `README.md` when behavior or configuration changes.
- Tag releases (`v0.3.0`, `v0.3.1`, …) so installs can pin a ref. See [Releasing](#releasing).
- Bump `version` in `package.json` to match the tag before pushing it.
- `AGENTS.md` documents the workflow for agents working on this repo.
- `CONCEPTS.md` holds the vocabulary.
