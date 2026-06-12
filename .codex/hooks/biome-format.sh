#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/hooks.config.json"
PAYLOAD=$(cat)

FILE_PATH=$(echo "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [ -z "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

# Check extension against config
export HOOK_CONFIG="$CONFIG"
export HOOK_FILE_PATH="$FILE_PATH"

SHOULD_RUN=$(python3 -c "
import json, os, sys

config = json.load(open(os.environ['HOOK_CONFIG']))
bio = config.get('biomeLint', {})
if not bio.get('enabled', False):
    print('no')
    sys.exit(0)

extensions = bio.get('extensions', ['.ts', '.tsx', '.js', '.jsx', '.json', '.jsonc', '.css'])
_, ext = os.path.splitext(os.environ['HOOK_FILE_PATH'])
print('yes' if ext in extensions else 'no')
" 2>/dev/null || echo "no")

if [ "$SHOULD_RUN" != "yes" ]; then
  echo '{}'
  exit 0
fi

# Check file exists and is non-empty
if [ ! -s "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Use the project-pinned Biome (via bun) so the hook matches `bun run format`.
export PATH="$HOME/.bun/bin:$PATH"

# Formatter only — does not apply lint fixes or organize imports.
bunx biome format --write --no-errors-on-unmatched "$FILE_PATH" > /dev/null 2>&1 || true

echo '{}'
