#!/usr/bin/env python3
"""Extract Biome-eligible project files from a Codex hook payload."""

from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Iterable

PATCH_PATH = re.compile(
    r"(?:^|\\n)\*\*\* (?:Add|Delete|Update) File: ([^\r\n\\]*?)(?=\\[rn]|\r?$)",
    re.MULTILINE,
)
MOVE_PATH = re.compile(
    r"(?:^|\\n)\*\*\* Move to: ([^\r\n\\]*?)(?=\\[rn]|\r?$)", re.MULTILINE
)
DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".css"]


def strings(value: object) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                yield item


def patch_texts(payload: dict[str, object], tool_input: object) -> Iterable[str]:
    if isinstance(tool_input, str):
        yield tool_input
    elif isinstance(tool_input, dict):
        for key in ("patch", "input", "command"):
            yield from strings(tool_input.get(key))

    for key in ("patch", "input"):
        yield from strings(payload.get(key))


def candidate_paths(payload: dict[str, object]) -> Iterable[str]:
    tool_input = payload.get("tool_input", {})
    if isinstance(tool_input, dict):
        for key in ("file_path", "path", "file_paths", "paths"):
            yield from strings(tool_input.get(key))

    for patch in patch_texts(payload, tool_input):
        yield from PATCH_PATH.findall(patch)
        yield from MOVE_PATH.findall(patch)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: biome-files.py PROJECT_DIR CONFIG")

    project_dir = os.path.realpath(sys.argv[1])
    with open(sys.argv[2], encoding="utf-8") as config_file:
        biome_config = json.load(config_file).get("biomeLint", {})

    if not biome_config.get("enabled", False):
        return

    extensions = set(biome_config.get("extensions", DEFAULT_EXTENSIONS))
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return

    if not isinstance(payload, dict):
        return

    seen: set[str] = set()
    for candidate in candidate_paths(payload):
        path = candidate.strip()
        if not path:
            continue
        absolute = os.path.realpath(
            path if os.path.isabs(path) else os.path.join(project_dir, path)
        )
        try:
            in_project = os.path.commonpath((project_dir, absolute)) == project_dir
        except ValueError:
            in_project = False
        if (
            in_project
            and absolute not in seen
            and os.path.splitext(absolute)[1] in extensions
            and os.path.isfile(absolute)
            and os.path.getsize(absolute) > 0
        ):
            seen.add(absolute)
            print(absolute)


if __name__ == "__main__":
    main()
