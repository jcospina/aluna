#!/usr/bin/env bash
set -euo pipefail

LOG="/tmp/claude-hook-debug.log"
BIOME_HOOK_CONFIG_KEY=biomeLint
BIOME_HOOK_LOG="$LOG"
# shellcheck source=./biome-hook-common.sh
source "$(cd "$(dirname "$0")" && pwd)/biome-hook-common.sh"

# Capture exit code separately — do NOT use || true which swallows it
LINT_OUTPUT=$(bunx biome lint --no-errors-on-unmatched "$FILE_PATH" 2>&1) && LINT_EXIT=0 || LINT_EXIT=$?

echo "$(date '+%H:%M:%S') [biome-lint] LINT_EXIT=$LINT_EXIT" >> "$LOG"

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
