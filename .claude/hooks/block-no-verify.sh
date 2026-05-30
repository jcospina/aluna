#!/usr/bin/env bash
set -euo pipefail

# Blocks any `git` invocation that tries to skip pre-commit hooks or signing:
#   --no-verify
#   --no-gpg-sign
#   -c commit.gpgsign=false   (and variants)
#
# These flags bypass lint-staged + signing guarantees, so without this hook
# Claude can silently land malformed or unsigned commits (incident: commit
# 0a83283 landed an unformatted CSS file because --no-verify skipped biome).

PAYLOAD=$(cat)

export HOOK_PAYLOAD="$PAYLOAD"
python3 << 'PYEOF'
import json
import os
import shlex
import sys

try:
    payload = json.loads(os.environ['HOOK_PAYLOAD'])
except Exception:
    print('{}')
    sys.exit(0)

command = payload.get('tool_input', {}).get('command', '')
if not command:
    print('{}')
    sys.exit(0)

# Only police git invocations — other CLIs may have an unrelated --no-verify.
if 'git' not in command:
    print('{}')
    sys.exit(0)

try:
    tokens = shlex.split(command)
except ValueError:
    # Malformed quoting — let it through; Bash will reject it on its own.
    print('{}')
    sys.exit(0)

# Find each `git` invocation (handles compound commands like
# `git fetch && git commit ...`) and inspect ONLY its arguments — never the
# contents of quoted strings such as commit messages.
violations = []
i = 0
while i < len(tokens):
    if tokens[i] == 'git' or tokens[i].endswith('/git'):
        j = i + 1
        while j < len(tokens) and tokens[j] not in ('&&', '||', ';', '|'):
            tok = tokens[j]
            if tok in ('--no-verify', '--no-gpg-sign'):
                violations.append(tok)
            elif tok == '-c' and j + 1 < len(tokens):
                next_tok = tokens[j + 1]
                if next_tok.replace(' ', '').lower().startswith(
                    'commit.gpgsign=false',
                ):
                    violations.append(f'-c {next_tok}')
            j += 1
        i = j
    else:
        i += 1

if not violations:
    print('{}')
    sys.exit(0)

reason = (
    'Blocked: this git command tries to bypass commit guardrails via '
    + ', '.join(sorted(set(violations)))
    + '. Re-run without the flag(s). If a pre-commit hook fails, fix the '
    'underlying issue and make a NEW commit — do not skip the hook. If the '
    'user has explicitly authorized the bypass in this turn, ask them to '
    'confirm again so the intent is on record before re-running.'
)

result = {
    'decision': 'block',
    'reason': reason,
    'hookSpecificOutput': {'hookEventName': 'PreToolUse'},
}
print(json.dumps(result))
PYEOF
