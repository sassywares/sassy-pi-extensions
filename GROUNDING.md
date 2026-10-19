# Grounding brief

Every subagent in a run reads one shared grounding brief instead of exploring the repo for itself. `scout` writes it; `reviewer`, `validator`, and `worker` consume it.

## Location

A per-user temp directory, keyed by the absolute repo or worktree root:

```bash
ROOT="/tmp/pi-grounding-$(id -u)"
[ -L "$ROOT" ] && { echo "unsafe symlink: $ROOT" >&2; exit 1; }
[ -d "$ROOT" ] || { umask 077; mkdir -p "$ROOT"; }
chmod 700 "$ROOT" 2>/dev/null
ROOT_ABS=$(cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")" && pwd -P)
KEY=$(printf '%s' "$ROOT_ABS" | shasum -a 256 | cut -d' ' -f1)
BRIEF="$ROOT/$KEY.md"
```

For example, `tap2-workspace` resolves to `/tmp/pi-grounding-501/<sha>.md`. The directory is `0700` and owned by the current user; a symlinked or foreign-owned root aborts rather than being followed, because the brief is read as trusted-ish context by later agents.

Keying on the worktree root means:

- Two repos, or two worktrees of one repo, never share a brief.
- A non-git folder still gets a stable location (hash of `$PWD`), so a scout and a consumer launched from the same directory agree.
- Nothing is written into the repo, so there is no `.gitignore` entry and nothing to commit.
- `/tmp` is cleared on reboot, which is the desired lifetime for a brief describing a working tree.

## Freshness

A brief is usable when all four hold:

1. `repo` matches the current `ROOT_ABS`.
2. `head` matches `git rev-parse HEAD`.
3. `dirty` matches the current digest of `git status --porcelain`, `git diff`, and `git diff --cached` combined.
4. `scope` covers what the consumer is about to ask.

The digest covers statuses and diffs, not statuses alone: `git status --porcelain` reports ` M path` no matter what changed inside the file, so a status-only digest leaves a brief "fresh" after further edits to an already-dirty file. Including the diffs closes that. Any commit, edit, staged change, or new untracked file changes the digest and invalidates the brief; for a non-git folder the digest is empty, so freshness there rests on `scope` and `written` alone.

## Waiting

Consumers wait for a stale brief to be rewritten, never for one that does not exist. Waiting is token-free:

```bash
if [ -f "$BRIEF" ]; then
  for _ in $(seq 1 30); do
    { grep -qx "head: $HEAD" "$BRIEF" && grep -qx "dirty: $DIRTY" "$BRIEF"; } && break
    sleep 2
  done
fi
```

Sixty seconds is the ceiling. A missing brief reports `grounding: missing`; a brief that never refreshes reports `grounding: stale`. Either way the consumer does **at most 5 bounded reads** to fill the gap and says so in its output. It never runs a broad discovery pass and never becomes a second scout.

## Sequencing

The orchestrator dispatches `scout` first and awaits it, then dispatches the rest. Agents dispatched without the path still resolve the default location themselves, so a brief written by any earlier agent is reused.

## What the brief is not

It is not a cache across commits and not a substitute for judging evidence. A stale or thin brief is a finding the consumer reports, not something it silently papers over.
