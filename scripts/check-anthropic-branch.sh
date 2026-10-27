#!/usr/bin/env bash
# Verify the anthropic branch is main plus Anthropic models and a version profile, nothing else.
#
# The anthropic branch is a projection of main: same extensions, same agents, same prompts,
# same tools, same docs. Only the `model:` line in each agent file and the prerelease version
# in package.json may differ. Every piece of real work lands on main first and is merged in.
#
# Usage:
#   scripts/check-anthropic-branch.sh            # check working branch against origin/main
#   scripts/check-anthropic-branch.sh <base-ref> # check against another base ref
#
# Exit 0 when the invariant holds, 1 otherwise. Runs locally and in the publish workflow.
set -euo pipefail

BASE="${1:-origin/main}"
fail=0

fail_with() {
  echo "check-anthropic-branch: $*" >&2
  fail=1
}

# 1. Every agent must pin an Anthropic model.
shopt -s nullglob
agents=(agents/*.md)
if [ "${#agents[@]}" -eq 0 ]; then
  fail_with "no agents found under agents/"
fi
for file in "${agents[@]}"; do
  model="$(sed -n 's/^model:[[:space:]]*//p' "$file" | head -n 1)"
  case "$model" in
    anthropic/*) ;;
    "") fail_with "$file has no model" ;;
    *) fail_with "$file pins $model, expected an anthropic/* model" ;;
  esac
done

# 2. package.json must carry an -anthropic.<n> prerelease version.
version="$(node -p "require('./package.json').version")"
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-anthropic(\.[0-9]+)?$'; then
  fail_with "version $version is not an -anthropic prerelease (expected e.g. 0.4.0-anthropic.1)"
fi

# 3. Nothing but the agents and the version may differ from main. Tracked and untracked
# working-tree changes count too, so the check is useful before a commit, not just after one.
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  fail_with "base ref $BASE not found; fetch it first (git fetch origin main)"
else
  changed_paths="$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard; } | sort -u )"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
      agents/*.md) continue ;;
      package.json) continue ;;
    esac
    fail_with "diverges from $BASE outside agents/*.md and package.json: $path"
  done <<< "$changed_paths"

  # 4. main must already be merged in: the branch is main, not a fork of an old main.
  if ! git merge-base --is-ancestor "$BASE" HEAD; then
    fail_with "$BASE is not an ancestor of HEAD; merge main into anthropic first"
  fi
fi

# 5. Only the model lines inside agents/*.md may differ, not prompts or tools.
if git rev-parse --verify --quiet "$BASE" >/dev/null; then
  while IFS= read -r path; do
    case "$path" in
      agents/*.md) ;;
      *) continue ;;
    esac
    if git cat-file -e "$BASE:$path" 2>/dev/null; then
      changed="$(git diff "$BASE" -- "$path" | grep -E '^[+-][^+-]' | grep -vE '^[+-]model:' || true)"
    else
      changed="$path is new on this branch"
    fi
    if [ -n "$changed" ]; then
      fail_with "$path differs from $BASE beyond its model line"
    fi
  done < <(git diff --name-only "$BASE" -- agents)
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "check-anthropic-branch: ok ($(basename "$BASE") in sync, ${#agents[@]} agents on anthropic/*, version $version)"
