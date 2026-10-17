#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="$REPO/agents"
TARGET="${PI_AGENTS_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/agents}"

if [ ! -d "$AGENTS_DIR" ]; then
  echo "pi-extensions: $AGENTS_DIR does not exist" >&2
  exit 1
fi

mkdir -p "$TARGET"

# One symlink per agent keeps the directory writable for personal agents.
for src in "$AGENTS_DIR"/*.md; do
  name="$(basename "$src")"
  dest="$TARGET/$name"

  if [ -L "$dest" ]; then
    ln -sfn "$src" "$dest"
    continue
  fi

  if [ -e "$dest" ]; then
    if cmp -s "$src" "$dest"; then
      # Identical copy from before this repo became the source of truth.
      rm "$dest"
      ln -s "$src" "$dest"
    else
      echo "pi-extensions: skipping $dest (exists and differs)" >&2
    fi
    continue
  fi

  ln -s "$src" "$dest"
done

echo "pi-extensions: agents linked into $TARGET"
