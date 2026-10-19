# Grounding brief

Every subagent in a run reads one shared grounding brief instead of exploring the repo for itself. `scout` writes it; `reviewer`, `validator`, and `worker` consume it.

## Location

```bash
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || GIT_DIR=""
BRIEF="${GIT_DIR:-.}/pi-grounding.md"
```

The brief lives in the git directory, so it never shows up in `git status` and never needs a `.gitignore` entry. In a non-git folder it is `./pi-grounding.md`.

## Freshness

A brief is usable when all three hold:

1. `repo` matches the current repo root.
2. `head` matches `git rev-parse HEAD`.
3. `dirty` matches the current `git status --porcelain` digest.
4. `scope` covers what the consumer is about to ask.

Check it in one call:

```bash
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || GIT_DIR=""
BRIEF="${GIT_DIR:-.}/pi-grounding.md"
HEAD=$(git rev-parse HEAD 2>/dev/null || echo none)
DIRTY=$(git status --porcelain 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
[ -f "$BRIEF" ] && grep -qx "head: $HEAD" "$BRIEF" && grep -qx "dirty: $DIRTY" "$BRIEF" && echo FRESH || echo STALE
```

## Waiting

Consumers wait for the brief rather than duplicating the scout's work. Waiting is token-free:

```bash
for _ in $(seq 1 30); do [ "$( ... FRESH check ... )" = FRESH ] && break; sleep 2; done
```

Sixty seconds is the ceiling. After that the consumer does **at most 5 bounded reads** to fill the gap and notes the gap in its output. It never runs a broad discovery pass, and never becomes a second scout.

## Sequencing

The orchestrator dispatches `scout` first and awaits it, then dispatches the rest with the brief path. Agents dispatched without a path still check the default location, so a brief written by any earlier agent is reused.

## What the brief is not

It is not a cache across commits and not a substitute for judging evidence. A stale or thin brief is a finding the consumer reports, not something it silently papers over.
