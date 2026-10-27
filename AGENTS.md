# Pi Extensions — Agent Guide

## What this repo is

A pi package containing the Sassywares extensions.

- Local: `~/Documents/Workspace/Sassywares/sassy-pi-extensions`
- Remote: `sassywares/sassy-pi-extensions`
- Package: `@sassywares/pi-extensions`

This repo is the source of truth for the extensions. Do not keep separate copies under `~/.pi/agent/extensions/`; pi would load both and register duplicate tools and commands.

The Sassy subagent roster is not here. It lives in [`sassy-agents`](https://github.com/sassywares/sassy-agents), which links its `pi/` directory into `~/.pi/agent/agents/`. This package owns the `subagent` tool, its discovery, and profile resolution; that repo owns the agents it dispatches.

The three repos split cleanly:

| Repo | Owns |
|---|---|
| `sassy-pi-extensions` | Tools and commands: auto-title, web search, handoff, subagent, modes. |
| `sassy-agents` | The `scout`, `worker`, `reviewer`, and `validator` definitions and their profiles. |
| `sassy-skills` | The skills that orchestrate agents through these tools. |

## Branches: `main` only

`main` is the only branch and the only release line. There is no `anthropic` branch, no provider-specific branch, and no provider-specific release.

Provider choice is configuration, not a branch:

- Every agent in `sassy-agents` declares a `profiles:` list — the model choices it can run on, one entry per provider.
- Which profile a dispatch uses is decided at run time: the `subagent` tool's `profile` parameter, then `PI_SASSY_PROFILE`, then `sassy.profile` in settings, then the built-in default `deepseek`.
- A project that wants another provider sets it once in its own settings file:

  ```json
  { "sassy": { "profile": "anthropic" } }
  ```

  `<project>/.pi/settings.json` overrides `~/.pi/agent/settings.json`, so a project opts into Anthropic (or anything else) without touching the package.

Rules:

- **Never reintroduce a provider branch.** Model choice belongs in agent frontmatter, not in git history.
- **A missing profile is an error, never a fallback.** `resolveAgentModel` in `extensions/subagent/agents.ts` keeps that guarantee; do not soften it.
- **The default stays OSS.** `DEFAULT_PROFILE` is `deepseek`; Anthropic is opt-in per project or per dispatch.
- **Roster edits do not belong here.** Add or change an agent in `sassy-agents`.

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
| `extensions/subagent/` | The `subagent` tool, agent discovery, and profile resolution. |
| `.github/workflows/publish.yml` | Publishes to npm when a `v*` tag is pushed, choosing the dist-tag from the version. |
| `package.json` | Pi package manifest. Lists the extensions under `pi.extensions`. |

## How to run

Install the working tree as a local package:

```bash
pi install ~/Documents/Workspace/Sassywares/sassy-pi-extensions
```

Local installs are read in place. After an extension edit, run `/reload` in pi.

One-off load without changing settings:

```bash
pi -e ~/Documents/Workspace/Sassywares/sassy-pi-extensions
```

To exercise `subagent` end to end you also need the roster linked:

```bash
~/Documents/Workspace/Sassywares/sassy-agents/scripts/install.sh
```

## Adding an extension

1. Create `extensions/<name>.ts`, or `extensions/<name>/index.ts` for a multi-file extension.
2. Add its path to `pi.extensions` in `package.json`.
3. Document it in `README.md` under **Extensions** and **Configuration**.
4. Run `/reload` and verify the new surface appears once.

## Editing or removing

- Edit files under `extensions/`.
- To remove an extension, delete it, remove its entry from `pi.extensions`, and update the README.
- Do not add a build step. Pi loads TypeScript directly with jiti.
- Do not add agents, skills, prompts, or themes to this package. Agents live in `sassy-agents`; skills live in `sassy-skills`.

## Agent discovery and profiles

Agent parsing lives in `extensions/subagent/agents.ts`. It supports three agent shapes:

```yaml
profiles:
  - name: deepseek
    model: deepseek/deepseek-flash
    thinking: low
```

```yaml
model: openai/gpt-4o
thinking: low
```

```yaml
# neither: inherit the dispatcher's model and thinking
```

Rules enforced there:

- Profile names are lowercase letters, digits, and dashes, and must be unique within an agent.
- `model` is always `provider/id`; `thinking` is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- `profiles:` and `model:` are mutually exclusive — pinning a model and offering profiles at once is a parse error.
- A bad file is reported when its agent is dispatched; discovery keeps walking the directory.

The roster's own `scripts/test-profiles.mjs` in `sassy-agents` imports this parser and checks it against the real roster plus malformed fixtures. Run it after changing discovery or parsing.

## Version, commit, and push every extension change

Any change under `extensions/`, or to the `pi` manifest in `package.json`, is a release-worthy change. It lands on `main`. In the same turn:

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

**Tagging is mandatory, not optional.** Every version bump ships to npm, so a bumped version that is not tagged is a release that silently never happened. The tag triggers the OIDC workflow; without it, the npm package drifts behind `main` and every consumer installs a stale extension. Never bump without tagging in the same turn. See [Publishing](#publishing).

## Testing

There is no test runner. Verify manually:

- `pi -e ~/Documents/Workspace/Sassywares/sassy-pi-extensions` loads without errors.
- `web_search` works with and without `EXA_API_KEY`.
- `web_fetch` returns page text, and rejects `http://localhost:3000` and private IPs.
- `/title`, `/title <text>`, automatic naming, and `PI_AUTO_TITLE=0`.
- `/handoff <goal>` or `/handoff mode:review <goal>` opens an editable prompt; `/handoff mode:pipeline <goal>` sends it.
- `subagent` runs a single task and a chain using `{previous}`, with the roster linked from `sassy-agents`.
- A dispatch with `profile: "anthropic"` runs the Anthropic model shown in the run line, and the same dispatch with `profile: "nope"` fails with the available profile names.
- `PI_SASSY_PROFILE=anthropic` and `{"sassy":{"profile":"anthropic"}}` in `<project>/.pi/settings.json` both select Anthropic without a parameter.
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

Release checklist (from `main`):

1. Bump `version` in `package.json`.
2. Commit and push `main`.
3. Tag and push: `git tag -a v0.3.1 -m v0.3.1 && git push origin v0.3.1`.
4. Watch the Publish workflow under the repo's Actions tab.
5. Confirm `npm view @sassywares/pi-extensions version` equals the new version.

Treat steps 1–3 as one atomic action. If a bump is ever found untagged, tag it immediately rather than bumping again.

The workflow skips publishing when the tag's version already exists on npm, so a manually published tag can be pushed safely. A new trusted publisher must complete its first OIDC publish within 2 days of being configured, or npm expires the configuration.

### Release channels (npm dist-tags)

Every release ships from `main`. The workflow still derives the dist-tag from the version, so a prerelease can never hijack `latest`:

| Version | Dist-tag | Install |
|---|---|---|
| `0.4.2` | `latest` | `npm:@sassywares/pi-extensions@0.4.2` |
| `0.5.0-beta.1` | `beta` | `npm:@sassywares/pi-extensions@0.5.0-beta.1` or `@beta` |

Guards in the workflow:

- The tagged commit must be an ancestor of `main`.
- A stable version publishes to `latest`.
- A prerelease publishes under the dist-tag named by its identifier (`-beta.1` → `beta`) and may never use `latest`.

There are no provider-specific dist-tags. Selecting Anthropic is a profile choice in settings, not an install choice.
