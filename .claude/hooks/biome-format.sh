#!/usr/bin/env bash
set -euo pipefail

BIOME_HOOK_CONFIG_KEY=biomeFormat
# shellcheck source=./biome-hook-common.sh
source "$(cd "$(dirname "$0")" && pwd)/biome-hook-common.sh"

# Formatter only — does not apply lint fixes or organize imports.
bunx biome format --write --no-errors-on-unmatched "$FILE_PATH" > /dev/null 2>&1 || true

echo '{}'
