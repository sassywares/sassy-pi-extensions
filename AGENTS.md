# Pi Extensions — Agent Guide

## What this repo is

A pi package containing the custom Sassywares extensions.

- Local: `~/Documents/Workspace/Sassywares/pi-extensions`
- Remote: `sassywares/pi-extensions`
- Package: `@sassywares/pi-extensions`

This repo is the source of truth. Do not keep separate copies under `~/.pi/agent/extensions/`; pi would load both and register duplicate tools and commands.

## Layout

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

| Path | Role |
|---|---|
| `extensions/auto-title.ts` | Automatic session naming and the `/title` command. |
| `extensions/web-search.ts` | `web_search` and `web_fetch` tools backed by Exa. |
| `package.json` | Pi package manifest. Lists both extensions under `pi.extensions`. |

## How to run

Install the working tree as a local package:

```bash
pi install ~/Documents/Workspace/Sassywares/pi-extensions
```

Local installs are read in place. After an edit, run `/reload` in pi.

One-off load without changing settings:

```bash
pi -e ~/Documents/Workspace/Sassywares/pi-extensions
```

## Adding an extension

1. Create `extensions/<name>.ts` with a default export that takes `ExtensionAPI`.
2. Add its path to `pi.extensions` in `package.json`.
3. Document it in `README.md` under **Extensions** and **Configuration**.
4. Run `/reload` and verify the new surface appears once.

## Editing or removing

- Edit the file under `extensions/`.
- To remove an extension, delete the file, remove its entry from `pi.extensions`, and update the README.
- Do not add a build step. Pi loads TypeScript directly with jiti.

## Testing

There is no test runner. Verify manually:

- `pi -e ~/Documents/Workspace/Sassywares/pi-extensions` loads without errors.
- `web_search` works with and without `EXA_API_KEY`.
- `web_fetch` returns page text, and rejects `http://localhost:3000` and private IPs.
- `/title`, `/title <text>`, automatic naming, and `PI_AUTO_TITLE=0`.

## Conventions

- **Host packages are peers.** `@earendil-works/pi-coding-agent` and `typebox` stay in `peerDependencies` with `"*"`. Never put them in `dependencies`; pi supplies them.
- **No build output.** Extensions ship as TypeScript source.
- **No secrets.** Read configuration from the environment at call time. Never commit keys.
- **No background resources.** Do not start servers, watchers, or timers in the extension factory.
- **Small surface.** Prefer one clear tool or command per extension. Document every environment variable.
- **Fail closed.** Network tools must keep blocking localhost, private addresses, and credential-bearing URLs.
