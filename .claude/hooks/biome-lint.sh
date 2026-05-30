#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/hooks.config.json"
LOG="/tmp/claude-hook-debug.log"
PAYLOAD=$(cat)

echo "$(date '+%H:%M:%S') [biome-lint] INVOKED" >> "$LOG"

FILE_PATH=$(echo "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
echo "$(date '+%H:%M:%S') [biome-lint] FILE_PATH=$FILE_PATH" >> "$LOG"
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

echo "$(date '+%H:%M:%S') [biome-lint] SHOULD_RUN=$SHOULD_RUN" >> "$LOG"
if [ "$SHOULD_RUN" != "yes" ]; then
  echo '{}'
  exit 0
fi

# Check file exists and is non-empty
if [ ! -s "$FILE_PATH" ]; then
  echo "$(date '+%H:%M:%S') [biome-lint] SKIPPED (file empty or missing)" >> "$LOG"
  echo '{}'
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Use the project-pinned Biome (via bun) so the hook enforces exactly what
# `bun run lint` does, regardless of any globally-installed Biome version.
export PATH="$HOME/.bun/bin:$PATH"

# Capture exit code separately — do NOT use || true which swallows it
LINT_OUTPUT=$(bunx biome lint --no-errors-on-unmatched "$FILE_PATH" 2>&1) && LINT_EXIT=0 || LINT_EXIT=$?

echo "$(date '+%H:%M:%S') [biome-lint] LINT_EXIT=$LINT_EXIT" >> "$LOG"
echo "$(date '+%H:%M:%S') [biome-lint] LINT_OUTPUT_LEN=${#LINT_OUTPUT}" >> "$LOG"

# Treat "no files processed" / "ignored" as a pass, not a lint failure
if echo "$LINT_OUTPUT" | grep -qE "No files were processed|were provided but ignored"; then
  echo "$(date '+%H:%M:%S') [biome-lint] SKIPPED (file ignored by biome config)" >> "$LOG"
  echo '{}'
  exit 0
fi

if [ $LINT_EXIT -ne 0 ] && [ -n "$LINT_OUTPUT" ]; then
  # Truncate to last 1500 chars
  TRUNCATED=$(echo "$LINT_OUTPUT" | tail -c 1500)
  export HOOK_LINT_REASON="Biome lint violations were found in $FILE_PATH. Fix them now without asking the user — edit the file to resolve every violation below, then continue with the original task. Do not ask for confirmation; the user has pre-approved automatic lint fixes.

$TRUNCATED"
  echo "$(date '+%H:%M:%S') [biome-lint] BLOCKING with lint errors" >> "$LOG"
  python3 -c "
import json, os
result = {
    'decision': 'block',
    'reason': os.environ['HOOK_LINT_REASON'],
    'hookSpecificOutput': {
        'hookEventName': 'PostToolUse'
    }
}
print(json.dumps(result))
"
  exit 0
fi

echo "$(date '+%H:%M:%S') [biome-lint] PASS" >> "$LOG"
echo '{}'
