# Pi Extensions — Agent Guide

## What this is

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
├── .agents/skills/
│   └── sassy-pi-extensions-release/
│       └── SKILL.md
├── .sassywares/
│   ├── config.yaml
│   └── README.md
├── bin/
│   ├── release
│   └── release-ignore
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
| `.sassywares/config.yaml` | Sassy Skills config: commit on the current branch, and the `after_push` release hook. |
| `.sassywares/README.md` | What the `.sassywares/` folder is. |
| `bin/release` | Vendored release script (from [sassywares/sassy-release](https://github.com/sassywares/sassy-release)). |
| `.agents/skills/sassy-pi-extensions-release/` | Project skill that runs `bin/release`; `hooks.push` calls it. |
| `bin/release-ignore` | Paths that do not count as consumer-facing when the release script decides whether to bump. |
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
- **The idle watchdog never fires while a tool runs, but a tool ceiling does.** `extensions/subagent/index.ts` tracks the set of in-flight `toolCallId`s from the child's `tool_execution_start`/`tool_execution_end` events (`nextToolsInFlight`: a duplicate start is harmless, an end for an unknown id is ignored, and `turn_end` clears the set because Pi awaits every tool before ending a turn, so a missed end cannot pause the watchdog for the rest of the run) and `watchdogTimeoutFor` picks the timer: the idle timeout (`PI_SUBAGENT_IDLE_TIMEOUT_MS`, default 2 min) when the set is empty, otherwise the tool ceiling (`PI_SUBAGENT_TOOL_TIMEOUT_MS`, default 30 min, `0` disables only the ceiling). Tools do not reliably have their own timeout (Pi's bash has none by default), so the ceiling is the backstop. The ceiling starts when the first tool begins, is not reset by tool output, and clears when the last tool ends; the full idle window then restarts. Abort and kill paths are unchanged. Telemetry records `watchdogPhase` (`"idle"`, `"tool"`, or `null` when not watchdog-killed).
- **A missing profile is an error, never a fallback.** `resolveAgentModel` in `extensions/subagent/agents.ts` keeps that guarantee; do not soften it.
- **The default stays OSS.** `DEFAULT_PROFILE` is `deepseek`; Anthropic is opt-in per project or per dispatch.
- **Roster edits do not belong here.** Add or change an agent in `sassy-agents`.

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
- A subagent running bash `sleep 130` completes (the idle watchdog does not fire during a tool).
- With `PI_SUBAGENT_IDLE_TIMEOUT_MS=5000`, a silent `sleep 10` tool completes, while a model-phase hang is still killed with the idle message.
- With `PI_SUBAGENT_TOOL_TIMEOUT_MS=5000`, a `sleep 10` tool is killed with "Subagent tool ran for 5000ms without finishing; terminated by watchdog."
- With `PI_SUBAGENT_IDLE_TIMEOUT_MS=0`, a subagent is never idle-killed.
- With `PI_SUBAGENT_TOOL_TIMEOUT_MS=0`, a long silent tool (e.g. `sleep 10` under a 5s idle timeout) is not killed by the ceiling.

## Releasing

Releases go through `sassy-ship`, with `commit.branch: current` in `.sassywares/config.yaml`: the approved work is committed (Conventional Commits, written by `sassy-commit`) and pushed to `main` through ship's review gate, and nothing is pushed or tagged outside it, except the documented recovery below. After the push succeeds, the `hooks.push` `after_push` hook (`hooks.push."*".after_push: [sassy-pi-extensions-release]`) runs the `sassy-pi-extensions-release` project skill (`.agents/skills/sassy-pi-extensions-release/SKILL.md`). The skill runs the vendored `bin/release` script, which:

1. Refuses on a dirty tree.
2. Checks whether consumer-facing files changed since the highest `v*` tag on origin. If none did, it says so and exits.
3. Bumps the patch version in `package.json`, commits `chore: release v<version>`, and pushes `main`.
4. Creates the annotated tag `v<version>` and pushes only that tag.

The script comes from [sassywares/sassy-release](https://github.com/sassywares/sassy-release) and is vendored into each repo. Refresh the vendored copy by comparing its `# sassy-release vN` header with the repo's latest tag.

**Tagging is mandatory.** Every version bump ships to npm, so a bumped version that is not tagged is a release that silently never happened. The tag triggers the OIDC workflow; without it, the npm package drifts behind `main` and every consumer installs a stale extension. The script guarantees the tag: a version already above the highest tag is tagged as-is instead of bumped again.

**Consumer-facing files.** `bin/release-ignore` lists the paths that do not count: `AGENTS.md`, `docs/`, `tests/`, `.sassywares/`, `.github/`, `.agents/`, `.claude/`, `scripts/`, `bin/release`, `bin/release-ignore`, and `.gitignore`. That is the script's default ignore list plus `.gitignore`, so editing `.gitignore` alone does not cut a release. Everything else counts: `extensions/`, `README.md`, `CONCEPTS.md`, `NOTICE`, `LICENSE`, and `package.json`. Keep the file in step with the repo layout: a new top-level path that consumers do not receive belongs in it.

**Minor, major, and prereleases are hand-edited.** Write the new `version` in `package.json` yourself (for example `0.5.0` or `0.5.0-beta.1`) in the commit you ship; the script then tags it as-is. A hand-written version must be >= the highest tag on origin, or the script stops. Update the docs in the same commit (see [Docs upkeep](#docs-upkeep)).

**A prerelease is never auto-bumped.** After `0.5.0-beta.1` is tagged, any later consumer-facing change makes the script stop with an error until the next version (`0.5.0-beta.2`, or the stable `0.5.0`) is hand-set in `package.json` and committed. The dist-tag channels below follow the version, so a beta line stays on `beta` until a stable version is written by hand.

**Recovery.** If a run failed between the commit and the tag, or a push failed, run `bin/release` from a clean `main`; it is idempotent and finishes the tag instead of bumping twice. If any step fails, report the failure; never continue silently.

### Publishing

Publishing uses npm trusted publishing (OIDC). There is no `NPM_TOKEN` secret. The workflow gets a short-lived token from GitHub Actions and npm generates provenance automatically. Pushing a `v*` tag triggers `.github/workflows/publish.yml`.

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

After a release, watch the Publish workflow under the repo's Actions tab and confirm `npm view @sassywares/pi-extensions version` equals the new version.

The workflow skips publishing when the tag's version already exists on npm, so a manually published tag can be pushed safely. A new trusted publisher must complete its first OIDC publish within 2 days of being configured, or npm expires the configuration.

### Release channels (npm dist-tags)

Every release ships from `main`. The workflow still derives the dist-tag from the version, so a prerelease can never hijack `latest`:

| Version | Dist-tag | Install |
|---|---|---|
| `<x.y.z>` | `latest` | `npm:@sassywares/pi-extensions@<x.y.z>` |
| `<x.y.z>-beta.1` | `beta` | `npm:@sassywares/pi-extensions@<x.y.z>-beta.1` or `@beta` |

Guards in the workflow:

- The tagged commit must be an ancestor of `main`.
- A stable version publishes to `latest`.
- A prerelease publishes under the dist-tag named by its identifier (`-beta.1` → `beta`) and may never use `latest`.

There are no provider-specific dist-tags. Selecting Anthropic is a profile choice in settings, not an install choice.

## Docs upkeep

Any change to user-visible behavior, install steps, commands or keys, configuration, environment variables, requirements, or outputs updates `README.md` in the **same commit**. A stale README is a review finding, and a release never goes out with the README describing old behavior.

| Change | README section |
|---|---|
| New, removed, or renamed extension, tool, command, or key | **Extensions** table and that extension's subsection; **Repository layout**; **Contents** if a heading changed |
| New or changed environment variable or setting | **Configuration** table (and the extension's subsection if it describes the knob) |
| Network, filesystem, or credential behavior | **Security** |
| Subagent discovery, profile resolution, or parallelism | **Subagent** and **Model profiles** |
| Ask/work mode behavior or sandbox backends | **Modes** |
| Install steps or requirements | **Quick start** |
| Files added, moved, or removed | **Repository layout** (and the tree in this file's **Layout**) |
| Manual check procedure | **Development** and this file's **Testing** |
| Release flow or channels | **Model profiles** (channels) and **Releasing**, and this file's **Releasing** |
| Derived-from-pi code changes | **Provenance** and `NOTICE` |

- Update `CONCEPTS.md` when a user-facing term is added or renamed.
- Update this file when a rule or an architecture fact changes.
- **Version pins.** The README carries no literal version pins, and the release script never edits the README, so a pin would go stale on every release.

## Conventions

- **Host packages are peers.** `@earendil-works/pi-coding-agent` and `typebox` stay in `peerDependencies` with `"*"`. Never put them in `dependencies`; pi supplies them.
- **No build output.** Extensions ship as TypeScript source.
- **No secrets.** Read configuration from the environment at call time. Never commit keys.
- **No background resources.** Do not start servers, watchers, or timers in the extension factory.
- **Small surface.** Prefer one clear tool or command per extension. Document every environment variable.
- **Fail closed.** Network tools must keep blocking localhost, private addresses, and credential-bearing URLs.
- **Attribute upstream.** `handoff` and `subagent` are derived from pi. Keep `NOTICE` current when they change.

## Knowledge store

- Vocabulary and naming: [`CONCEPTS.md`](CONCEPTS.md)
- Durable learnings and past bugs: `docs/solutions/` (the folder is created on the first write). Read the relevant entry before re-investigating a problem.
- Document new solved problems there rather than in code comments.
