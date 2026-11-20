#!/usr/bin/env python3
"""Uninstall the TooDope layout and its package-owned mods."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from install import (
    LEGACY_SHORTCUT_ACTION,
    NEW_SPACE_ACTION,
    RETIRED_MODS,
    SHORTCUT_ACTION,
    SHORTCUT_SECTION,
    find_config,
    read_keys,
    remove_path,
    validate_sources,
    write_keys,
)


def remove_keybindings(config: Path) -> int:
    """Remove only keybindings that still point to TooDope-owned actions."""
    path = config / "keys.json"
    keys, problem = read_keys(path)
    if problem:
        raise RuntimeError(f"Cannot safely remove TooDope keybindings: {problem}")
    if keys is None:
        return 0

    for section in ("global", "terminal", SHORTCUT_SECTION):
        if section in keys and not isinstance(keys[section], dict):
            raise RuntimeError(
                f"Cannot safely remove TooDope keybindings: {section!r} must be an object."
            )

    actions = {
        SHORTCUT_ACTION,
        LEGACY_SHORTCUT_ACTION,
        NEW_SPACE_ACTION,
    }
    removed = 0
    for section, bindings in list(keys.items()):
        if not isinstance(bindings, dict):
            continue
        for chord, action in list(bindings.items()):
            if any(action == candidate for candidate in actions):
                del bindings[chord]
                removed += 1
        if section == SHORTCUT_SECTION and not bindings:
            del keys[section]

    if removed:
        error = write_keys(path, keys)
        if error:
            raise RuntimeError(f"Couldn't update {path}: {error}.")
    return removed


def uninstall(config: Path) -> tuple[int, int, int]:
    """Remove the packaged TooDope layout, mods, and owned keybindings."""
    layout_names, mod_names = validate_sources()
    removed_keys = remove_keybindings(config)

    layouts = config / "layouts"
    mods = config / "mods"
    removed_layouts = 0
    removed_mods = 0

    for name in layout_names:
        path = layouts / name
        existed = path.exists() or path.is_symlink()
        remove_path(path)
        removed_layouts += int(existed)

    for name in (*mod_names, *RETIRED_MODS):
        path = mods / name
        existed = path.exists() or path.is_symlink()
        remove_path(path)
        removed_mods += int(existed)

    return removed_layouts, removed_mods, removed_keys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config", help="Herdr config folder (overrides auto-detection)"
    )
    args = parser.parse_args()

    try:
        config = find_config(args.config)
        removed_layouts, removed_mods, removed_keys = uninstall(config)
    except (OSError, RuntimeError) as exc:
        print(f"TooDope uninstall failed: {exc}", file=sys.stderr)
        return 1

    print(
        f"Removed {removed_layouts} TooDope layouts and {removed_mods} mod folders "
        f"from {config}"
    )
    if removed_keys:
        print(
            f"Removed {removed_keys} TooDope keybindings; "
            "unrelated bindings were preserved"
        )
    else:
        print("No TooDope keybindings found; unrelated bindings were preserved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
