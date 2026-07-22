#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/hooks.config.json"
PAYLOAD=$(cat)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

FILES=()
while IFS= read -r file_path; do
  FILES+=("$file_path")
done < <(printf '%s' "$PAYLOAD" | python3 "$SCRIPT_DIR/biome-files.py" "$PROJECT_DIR" "$CONFIG")

if [ ${#FILES[@]} -eq 0 ]; then
  echo '{}'
  exit 0
fi

# Use the project-pinned Biome (via bun) so the hook matches `bun run format`.
export PATH="$HOME/.bun/bin:$PATH"

# Formatter only — does not apply lint fixes or organize imports.
bunx biome format --write --no-errors-on-unmatched "${FILES[@]}" > /dev/null 2>&1 || true

echo '{}'
