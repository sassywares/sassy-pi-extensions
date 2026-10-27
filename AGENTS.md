# Pi Extensions — Agent Guide

## What this repo is

A pi package containing the Sassywares extensions and the Sassy subagent roster.

- Local: `~/Documents/Workspace/Sassywares/sassy-pi-extensions`
- Remote: `sassywares/sassy-pi-extensions`
- Package: `@sassywares/pi-extensions`

This repo is the source of truth. Do not keep separate copies under `~/.pi/agent/extensions/`; pi would load both and register duplicate tools and commands. Agents are linked from `~/.pi/agent/agents/` to `agents/` by `scripts/install-agents.sh`.

## Branches: `main` and `anthropic`

`main` is the OSS release: the Sassy roster runs on open-weight models (`deepseek/deepseek-flash`).

`anthropic` is the same package with the same roster pinned to Anthropic models. It is a **projection of `main`, not a fork**. Extensions, agents' prompts, tools, thinking levels, scripts, workflows, and docs are byte-identical to `main`; the only permitted differences are:

1. The `model:` line in each `agents/*.md`.
2. The `version` field in `package.json`, which carries an `-anthropic.<n>` prerelease suffix.

Rules:

- **No work happens on `anthropic` first.** Every change lands on `main`, is released there, and is then merged into `anthropic`. Never open a PR against `anthropic`; never patch it directly.
- **Keep them in sync.** Any time `main` changes, merge it into `anthropic` in the same session. `anthropic` must never carry commits that are not also on `main`.
- **Model swaps are the only edits.** When adding an agent, add it to `main` with an OSS model, merge, then pin the Anthropic model on `anthropic`. Do not rewrite prompts to suit a model.
- **`anthropic` only publishes prereleases.** Stable versions ship from `main` with the `latest` dist-tag; the branch ships `X.Y.Z-anthropic.N` under the `anthropic` dist-tag.

Run the invariant check before releasing from either branch:

```bash
scripts/check-anthropic-branch.sh   # on anthropic; exits non-zero on any disallowed divergence
```

It verifies every agent pins `anthropic/*`, the version is an `-anthropic` prerelease, `main` is an ancestor of `HEAD`, and nothing outside `agents/*.md` model lines and `package.json` differs. The publish workflow runs it for `v*-anthropic*` tags and refuses the release when it fails.

### Syncing `main` into `anthropic`

```bash
git checkout main && git pull --ff-only
git checkout anthropic && git merge main
# Only package.json (version) and agents/*.md (model lines) may conflict; resolve to both.
./scripts/check-anthropic-branch.sh
```

Then bump the prerelease counter, commit, and release:

```bash
npm version 0.4.0-anthropic.1 --no-git-tag-version   # next counter or next base
V=$(node -p "require('./package.json').version")
git commit -am "chore: sync anthropic with main ($V)"
git push origin anthropic
git tag -a "v$V" -m "v$V" && git push origin "v$V"
```

## Layout

```text
sassy-pi-extensions/
├── extensions/
│   ├── auto-title.ts
│   ├── handoff.ts
│   ├── web-search.ts
│   ├── modes/
│   │   ├── backends.ts
│   │   ├── footer.ts
│   │   └── index.ts
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

| Path | Role |
|---|---|
| `extensions/auto-title.ts` | Automatic session naming and the `/title` command. |
| `extensions/web-search.ts` | `web_search` and `web_fetch` tools backed by Exa. |
| `extensions/handoff.ts` | `/handoff` command and session replacement. |
| `extensions/modes/` | Ask/work modes, and the read-only bash backends behind ask mode. |
| `extensions/subagent/` | The `subagent` tool and its agent discovery. |
| `agents/*.md` | Sassy subagent definitions. Linked into `~/.pi/agent/agents/`. |
| `scripts/install-agents.sh` | Symlinks `agents/*.md` into the user agent directory. |
| `scripts/check-anthropic-branch.sh` | Verifies the `anthropic` branch is `main` plus model lines and a prerelease version, nothing else. |
| `.github/workflows/publish.yml` | Publishes to npm when a `v*` tag is pushed, choosing the dist-tag from the version. |
| `package.json` | Pi package manifest. Lists the extensions under `pi.extensions`. |

## How to run

Install the working tree as a local package and link the agents:

```bash
./scripts/install-agents.sh
pi install ~/Documents/Workspace/Sassywares/sassy-pi-extensions
```

Local installs are read in place. After an extension edit, run `/reload` in pi. Agent edits are read on the next subagent invocation.

One-off load without changing settings:

```bash
pi -e ~/Documents/Workspace/Sassywares/sassy-pi-extensions
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

## Version, commit, and push every extension change

Any change under `extensions/` or `agents/`, or to the `pi` manifest in `package.json`, is a release-worthy change. Do it on `main`; if you are on `anthropic`, land it on `main` first and merge back. In the same turn:

1. Bump the patch version:
   ```bash
   npm version patch --no-git-tag-version
   ```
2. Commit everything:
   ```bash
   git add -A
   git commit -m "<type>: <summary>"
   ```
3. Push:
   ```bash
   git push origin main
   ```
4. Tag and push the tag, always, using the version just bumped:
   ```bash
   git tag -a v$(node -p "require('./package.json').version") -m v$(node -p "require('./package.json').version")
   git push origin --tags
   ```

Do this without asking for confirmation. Do not leave extension changes uncommitted, unpushed, or untagged. If any step fails, report the failure instead of continuing silently.

**Tagging is mandatory, not optional.** Every version bump ships to npm, so a bumped version that is not tagged is a release that silently never happened. The tag triggers the OIDC workflow; without it, the npm package drifts behind `main` and every consumer installs a stale roster. Never bump without tagging in the same turn. See [Publishing](#publishing).

## Testing

There is no test runner. Verify manually:

- `pi -e ~/Documents/Workspace/Sassywares/sassy-pi-extensions` loads without errors.
- `web_search` works with and without `EXA_API_KEY`.
- `web_fetch` returns page text, and rejects `http://localhost:3000` and private IPs.
- `/title`, `/title <text>`, automatic naming, and `PI_AUTO_TITLE=0`.
- `/handoff <goal>` or `/handoff mode:review <goal>` opens an editable prompt; `/handoff mode:pipeline <goal>` sends it.
- `subagent` runs a single task and a chain using `{previous}`.
- `/modes` reports `sandbox-exec` or `bwrap`, and the footer badge matches.
- The mode badge is right-aligned on its own footer line, and pi's directory/stats/model lines are unchanged.
- In ask mode, `touch x` fails with `Operation not permitted`, while `git log` and `rg` still work.
- In ask mode, `edit` and `write` are absent from the tool list and are blocked if called anyway.
- `alt+m` returns to work mode with the original toolset and no `[ASK MODE ACTIVE]` context left.
- Switching ask -> work mid-session answers work on the next turn, and work -> ask answers ask.
- Only one mode notice is present in context at a time (check with `/context` or a debug extension).
## Conventions

- **Host packages are peers.** `@earendil-works/pi-coding-agent` and `typebox` stay in `peerDependencies` with `"*"`. Never put them in `dependencies`; pi supplies them.
- **No build output.** Extensions ship as TypeScript source.
- **No secrets.** Read configuration from the environment at call time. Never commit keys.
- **No background resources.** Do not start servers, watchers, or timers in the extension factory.
- **Small surface.** Prefer one clear tool or command per extension. Document every environment variable.
- **Fail closed.** Network tools must keep blocking localhost, private addresses, and credential-bearing URLs.
- **Attribute upstream.** `handoff` and `subagent` are derived from pi. Keep `NOTICE` current when they change.

## Publishing

Publishing uses npm trusted publishing (OIDC). There is no `NPM_TOKEN` secret. The workflow gets a short-lived token from GitHub Actions and npm generates provenance automatically.

`.github/workflows/publish.yml` requires:

- `permissions.id-token: write` and `permissions.contents: read`
- npm CLI 11.5.1 or later (the workflow updates npm and uses Node 24)
- a trusted publisher configured on npmjs.com for `@sassywares/pi-extensions`:
  - organization: `sassywares`
  - repository: `sassy-pi-extensions`
  - workflow filename: `publish.yml`
  - environment: blank
  - allowed actions: allow `npm publish` (not stage-only)

OIDC cannot publish the first version of a package, because the package settings page does not exist yet. Bootstrap once with a manual publish, then configure the trusted publisher.

Release checklist (stable, from `main`):

1. Bump `version` in `package.json`.
2. Commit and push `main`.
3. Tag and push: `git tag -a v0.3.1 -m v0.3.1 && git push origin v0.3.1`.
4. Watch the Publish workflow under the repo's Actions tab.
5. Confirm `npm view @sassywares/pi-extensions version` equals the new version.

Treat steps 1–3 as one atomic action. If a bump is ever found untagged, tag it immediately rather than bumping again.

The workflow skips publishing when the tag's version already exists on npm, so a manually published tag can be pushed safely. A new trusted publisher must complete its first OIDC publish within 2 days of being configured, or npm expires the configuration.

### Release channels (npm dist-tags)

The workflow derives the dist-tag from the version, so a profile can never hijack `latest`:

| Version | Branch | Dist-tag | Install |
|---|---|---|---|
| `0.3.25` | `main` | `latest` | `npm:@sassywares/pi-extensions@0.3.25` |
| `0.4.0-anthropic.1` | `anthropic` | `anthropic` | `npm:@sassywares/pi-extensions@0.4.0-anthropic.1` or `@anthropic` |

Guards in the workflow:

- A stable version must be an ancestor of `main`; a stable tag pushed from `anthropic` fails the run.
- A prerelease publishes under the dist-tag named by its identifier (`-anthropic.1` → `anthropic`) and may never use `latest`.
- An `-anthropic*` tag also runs `scripts/check-anthropic-branch.sh` and fails if the branch has drifted from `main`.

Anthropic profile releases follow the same three atomic steps, from the `anthropic` branch, with an incremented `-anthropic.N` version. Confirm them with `npm view @sassywares/pi-extensions dist-tags` rather than `npm view … version`, which reports `latest` only.
