# Shared preamble for the two Biome hooks. Sourced, never executed.
#
# Both hooks answer the same three questions before they do anything: which file was edited, is
# it one Biome handles, and does it still have content. They carried a verbatim copy each, so a
# fix to the payload reading or the extension gate landed in one and not the other.
#
# Set BIOME_HOOK_CONFIG_KEY before sourcing to choose the section of hooks.config.json that
# switches the hook on. On any early answer this exits the calling hook with an empty result.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/hooks.config.json"
PAYLOAD=$(cat)

FILE_PATH=$(echo "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
[ -n "${BIOME_HOOK_LOG:-}" ] && echo "$(date '+%H:%M:%S') [$BIOME_HOOK_CONFIG_KEY] INVOKED FILE_PATH=$FILE_PATH" >> "$BIOME_HOOK_LOG"
if [ -z "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

export HOOK_CONFIG="$CONFIG"
export HOOK_FILE_PATH="$FILE_PATH"
export HOOK_CONFIG_KEY="${BIOME_HOOK_CONFIG_KEY:-biomeLint}"

# Extensions come from the hook's own section, else from `biomeLint` — the two hooks handle the
# same file kinds, so the list is written once and each hook keeps its own on/off switch.
SHOULD_RUN=$(python3 -c "
import json, os, sys

config = json.load(open(os.environ['HOOK_CONFIG']))
key = os.environ['HOOK_CONFIG_KEY']
# A config written before this hook had a section of its own must not silently turn it off, so
# an absent section falls back to the biomeLint switch. An explicit enabled=false still wins.
section = config.get(key, config.get('biomeLint', {}) if key != 'biomeLint' else {})
if not section.get('enabled', False):
    print('no')
    sys.exit(0)

default = config.get('biomeLint', {}).get(
    'extensions', ['.ts', '.tsx', '.js', '.jsx', '.json', '.jsonc', '.css']
)
extensions = section.get('extensions', default)
_, ext = os.path.splitext(os.environ['HOOK_FILE_PATH'])
print('yes' if ext in extensions else 'no')
" 2>/dev/null || echo "unreadable-config")

if [ "$SHOULD_RUN" = "unreadable-config" ]; then
  echo "$(date '+%H:%M:%S') [$BIOME_HOOK_CONFIG_KEY] hooks.config.json is missing or unreadable — hook skipped" >&2
  echo '{}'
  exit 0
fi

if [ "$SHOULD_RUN" != "yes" ]; then
  [ -n "${BIOME_HOOK_LOG:-}" ] && echo "$(date '+%H:%M:%S') [$BIOME_HOOK_CONFIG_KEY] SHOULD_RUN=$SHOULD_RUN" >> "$BIOME_HOOK_LOG"
  echo '{}'
  exit 0
fi

if [ ! -s "$FILE_PATH" ]; then
  [ -n "${BIOME_HOOK_LOG:-}" ] && echo "$(date '+%H:%M:%S') [$BIOME_HOOK_CONFIG_KEY] SKIPPED (file empty or missing)" >> "$BIOME_HOOK_LOG"
  echo '{}'
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# The project-pinned Biome (via bun), so a hook enforces exactly what `bun run lint` does
# regardless of any globally-installed Biome.
export PATH="$HOME/.bun/bin:$PATH"
