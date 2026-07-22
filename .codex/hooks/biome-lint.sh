#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/hooks.config.json"
LOG="/tmp/claude-hook-debug.log"
PAYLOAD=$(cat)

echo "$(date '+%H:%M:%S') [biome-lint] INVOKED" >> "$LOG"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

FILES=()
while IFS= read -r file_path; do
  FILES+=("$file_path")
done < <(printf '%s' "$PAYLOAD" | python3 "$SCRIPT_DIR/biome-files.py" "$PROJECT_DIR" "$CONFIG")

echo "$(date '+%H:%M:%S') [biome-lint] FILES=${FILES[*]-}" >> "$LOG"
if [ ${#FILES[@]} -eq 0 ]; then
  echo "$(date '+%H:%M:%S') [biome-lint] SKIPPED (no eligible changed files)" >> "$LOG"
  echo '{}'
  exit 0
fi

# Use the project-pinned Biome (via bun) so the hook enforces exactly what
# `bun run lint` does, regardless of any globally-installed Biome version.
export PATH="$HOME/.bun/bin:$PATH"

# Capture exit code separately — do NOT use || true which swallows it
LINT_OUTPUT=$(bunx biome lint --no-errors-on-unmatched "${FILES[@]}" 2>&1) && LINT_EXIT=0 || LINT_EXIT=$?

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
  export HOOK_LINT_REASON="Biome lint violations were found in these changed files: ${FILES[*]}. Fix them now without asking the user — edit the files to resolve every violation below, then continue with the original task. Do not ask for confirmation; the user has pre-approved automatic lint fixes.

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
