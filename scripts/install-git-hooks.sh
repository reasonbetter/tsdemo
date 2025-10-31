#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$ROOT_DIR/.git/hooks"

if [ ! -d "$ROOT_DIR/.git" ]; then
  echo "This does not look like a git working copy: $ROOT_DIR" >&2
  exit 1
fi

mkdir -p "$HOOKS_DIR"
cp -f "$ROOT_DIR/scripts/hooks/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook to .git/hooks/pre-commit"

