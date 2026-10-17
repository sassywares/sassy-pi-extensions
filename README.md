# Pi Extensions

**Automatic session titles and zero-config web access for [pi](https://github.com/earendil-works/pi).**

Pi Extensions is a small suite of custom pi extensions. It names each session from its first real turn, and gives the agent `web_search` and `web_fetch` tools backed by Exa — no API key required for the free tier.

## Why this suite

- **Zero config.** Install the package and both extensions work. Exa runs through its public MCP endpoint; titles use the model you are already talking to.
- **Native surfaces.** Titles use pi's own session name, so they show up in the session picker, footer, and terminal title. Search and fetch are ordinary tools the model can call.
- **Safe by default.** `web_fetch` blocks localhost, private network addresses, and URLs with embedded credentials.
- **Opt out, not opt in.** Auto-titling stops with one environment variable. Manual titles and manual `/title` always win.
- **Small.** Two files, host-provided dependencies only, no background servers.

## Quick start

Install from GitHub:

```bash
pi install git:github.com/sassywares/pi-extensions@v0.1.0
```

Or from npm once published:

```bash
pi install npm:@sassywares/pi-extensions@0.1.0
```

Reload pi (`/reload`) and confirm:

- `web_search` and `web_fetch` are available to the model.
- The session gets a title after the first assistant turn, and `/title` is registered.

To try the package without changing settings:

```bash
pi -e git:github.com/sassywares/pi-extensions
```

## Extensions

| Extension | Surface | What it does |
|---|---|---|
| **`auto-title`** | automatic + `/title [text]` | Generates a short session title after the first meaningful turn. `/title` regenerates it; `/title <text>` sets one manually. |
| **`web-search`** | `web_search`, `web_fetch` | Searches the web via Exa and fetches readable page text with local-address protection. |

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

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `PI_AUTO_TITLE` | unset | Set to `0` to disable automatic titles. `/title` still works. |
| `EXA_API_KEY` | unset | Use the direct Exa API instead of the public Exa MCP endpoint. |

## Security

Extensions run inside the pi process with the same OS permissions as pi. Review extension source before installing it.

- `web_fetch` is designed for public web pages, not for reaching services on your machine or local network.
- `auto-title` sends a short transcript of the opening turns to the model already selected for the session. Provider terms and data handling apply.
- No credentials are stored by this package. `EXA_API_KEY` is read from the environment at call time.

## Repository layout

```text
pi-extensions/
├── extensions/
│   ├── auto-title.ts
│   └── web-search.ts
├── AGENTS.md
├── CONCEPTS.md
├── LICENSE
├── README.md
└── package.json
```

## Development

This repo is the source of truth for both extensions. Install it locally so pi loads the working tree directly:

```bash
pi install ~/Documents/Workspace/Sassywares/pi-extensions
```

Local installs are read in place — no copy, no build step. After changing an extension, run `/reload` in pi.

Do not also keep copies under `~/.pi/agent/extensions/`; pi would load both and register duplicate tools and commands.

Test the package for one invocation without touching settings:

```bash
pi -e ~/Documents/Workspace/Sassywares/pi-extensions
```

Manual checks after a change:

- `web_search` with and without `EXA_API_KEY`.
- `web_fetch` on a normal page, and on `http://localhost:3000` (must be rejected).
- `/title`, `/title <text>`, and automatic naming with `PI_AUTO_TITLE` unset.
- `PI_AUTO_TITLE=0` starts a session without a generated title.

## Repository maintenance

- Commit changes under `extensions/` and update `README.md` when behavior or configuration changes.
- Tag releases (`v0.1.0`, `v0.1.1`, …) so installs can pin a ref.
- For npm, bump `version` and run `npm publish --access public`.
- `AGENTS.md` documents the workflow for agents working on this repo.
- `CONCEPTS.md` holds the vocabulary.
