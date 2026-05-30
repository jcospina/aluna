#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/hooks.config.json"
PAYLOAD=$(cat)

ENABLED=$(python3 -c "import json; c=json.load(open('$CONFIG')); print(c.get('enforcePackageManager',{}).get('enabled',False))" 2>/dev/null || echo "False")
if [ "$ENABLED" != "True" ]; then
  echo '{}'
  exit 0
fi

export HOOK_CONFIG="$CONFIG"
export HOOK_PAYLOAD="$PAYLOAD"
python3 -c "
import json, sys, os

try:
    payload = json.loads(os.environ['HOOK_PAYLOAD'])
    config = json.load(open(os.environ['HOOK_CONFIG']))
except Exception:
    print('{}')
    sys.exit(0)

pm_config = config.get('enforcePackageManager', {})
allowed = pm_config.get('allowed', 'bun')
alternatives = pm_config.get('alternatives', {})
command = payload.get('tool_input', {}).get('command', '').lstrip()

if not command:
    print('{}')
    sys.exit(0)

for manager, alt in alternatives.items():
    for blocked in alt.get('commands', []):
        if command.startswith(blocked):
            replacement = alt.get('replacements', {}).get(blocked, allowed)
            result = {
                'hookSpecificOutput': {
                    'hookEventName': 'PreToolUse',
                    'permissionDecision': 'deny',
                    'permissionDecisionReason': f'This project uses {allowed}, not {manager}. Retry the command now using \`{replacement}\` instead of \`{blocked}\`. Do not ask the user for confirmation — the substitution is pre-approved. Continue with the original task after the replacement runs successfully.'
                }
            }
            print(json.dumps(result))
            sys.exit(0)

print('{}')
"
