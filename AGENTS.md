# Pi Extensions — Agent Guide

## What this repo is

A pi package containing the Sassywares extensions and the Sassy subagent roster.

- Local: `~/Documents/Workspace/Sassywares/pi-extensions`
- Remote: `sassywares/pi-extensions`
- Package: `@sassywares/pi-extensions`

This repo is the source of truth. Do not keep separate copies under `~/.pi/agent/extensions/`; pi would load both and register duplicate tools and commands. Agents are linked from `~/.pi/agent/agents/` to `agents/` by `scripts/install-agents.sh`.

## Layout

```text
pi-extensions/
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
├── AGENTS.md
├── CONCEPTS.md
├── LICENSE
├── NOTICE
├── README.md
└── package.json
```

| Path | Role |
|---|---|
| `extensions/auto-title.ts` | Automatic session naming and the `/title` command. |
| `extensions/web-search.ts` | `web_search` and `web_fetch` tools backed by Exa. |
| `extensions/handoff.ts` | `/handoff` command and session replacement. |
| `extensions/subagent/` | The `subagent` tool and its agent discovery. |
| `agents/*.md` | Sassy subagent definitions. Linked into `~/.pi/agent/agents/`. |
| `scripts/install-agents.sh` | Symlinks `agents/*.md` into the user agent directory. |
| `package.json` | Pi package manifest. Lists the extensions under `pi.extensions`. |

## How to run

Install the working tree as a local package and link the agents:

```bash
./scripts/install-agents.sh
pi install ~/Documents/Workspace/Sassywares/pi-extensions
```

Local installs are read in place. After an extension edit, run `/reload` in pi. Agent edits are read on the next subagent invocation.

One-off load without changing settings:

```bash
pi -e ~/Documents/Workspace/Sassywares/pi-extensions
```

## Adding an extension

1. Create `extensions/<name>.ts`, or `extensions/<name>/index.ts` for a multi-file extension.
2. Add its path to `pi.extensions` in `package.json`.
3. Document it in `README.md` under **Extensions** and **Configuration**.
4. Run `/reload` and verify the new surface appears once.

## Adding or editing an agent

1. Create or edit `agents/<name>.md` with `name`, `description`, and optional `tools`, `model`, and `thinking` frontmatter.
2. Run `./scripts/install-agents.sh` once if the agent is new.
3. Keep the body focused on the role, hard rules, and return shape.
4. Update the agent table in `README.md`.

## Editing or removing

- Edit files under `extensions/` or `agents/`.
- To remove an extension, delete it, remove its entry from `pi.extensions`, and update the README.
- To remove an agent, delete the file and its symlink under `~/.pi/agent/agents/`.
- Do not add a build step. Pi loads TypeScript directly with jiti.

## Testing

There is no test runner. Verify manually:

- `pi -e ~/Documents/Workspace/Sassywares/pi-extensions` loads without errors.
- `web_search` works with and without `EXA_API_KEY`.
- `web_fetch` returns page text, and rejects `http://localhost:3000` and private IPs.
- `/title`, `/title <text>`, automatic naming, and `PI_AUTO_TITLE=0`.
- `/handoff <goal>` opens an editable prompt; `/handoff mode:auto <goal>` sends it.
- `subagent` runs a single task and a chain using `{previous}`.

## Conventions

- **Host packages are peers.** `@earendil-works/pi-coding-agent` and `typebox` stay in `peerDependencies` with `"*"`. Never put them in `dependencies`; pi supplies them.
- **No build output.** Extensions ship as TypeScript source.
- **No secrets.** Read configuration from the environment at call time. Never commit keys.
- **No background resources.** Do not start servers, watchers, or timers in the extension factory.
- **Small surface.** Prefer one clear tool or command per extension. Document every environment variable.
- **Fail closed.** Network tools must keep blocking localhost, private addresses, and credential-bearing URLs.
- **Attribute upstream.** `handoff` and `subagent` are derived from pi. Keep `NOTICE` current when they change.
