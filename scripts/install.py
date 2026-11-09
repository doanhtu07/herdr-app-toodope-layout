#!/usr/bin/env python3
"""Install or update the TooDope layout in a Herdr app config directory."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "TooDope"
LAYOUT_FILES = ("TooDope.json", "toodope-main.json", "toodope-main-tab-dots.json")
MODS = (
    "toodope-spaces",
    "toodope-space-history",
    "toodope-tabs-active-dot",
    "toodope-workspace-status",
    "toodope-pane-header",
)
SHORTCUT_ACTION = "toodope-workspace-status.recent"
LEGACY_SHORTCUT_ACTION = "toodope-spaces.recent"
SHORTCUT_SECTION = "layout:TooDope"
SHORTCUT_CONTEXTS = ("global", "terminal", SHORTCUT_SECTION)


def shortcut_for_platform(platform: str | None = None) -> tuple[str, str]:
    """Return the Herdr key spelling and friendly label for this OS."""
    platform = platform or sys.platform
    if platform == "darwin":
        return "cmd-shift-j", "Cmd+Shift+J"
    return "ctrl-shift-j", "Ctrl+Shift+J"


def config_candidates() -> list[Path]:
    candidates: list[Path] = []

    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            candidates.append(Path(appdata) / "herdr-app")

    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        candidates.append(Path(xdg) / "herdr-app")

    home = Path.home()
    candidates.append(home / ".config" / "herdr-app")

    # Keep order while removing duplicates.
    return list(dict.fromkeys(p.expanduser() for p in candidates))


def find_config(explicit: str | None) -> Path:
    override = explicit or os.environ.get("HERDR_APP_HOME")

    if override:
        path = Path(override).expanduser().resolve()
        if not path.is_dir():
            raise RuntimeError(f"Herdr config folder does not exist: {path}")
        return path

    for path in config_candidates():
        if path.is_dir():
            return path.resolve()

    tried = "\n  ".join(str(path) for path in config_candidates())

    raise RuntimeError(
        "Could not find an existing Herdr config folder. Set HERDR_APP_HOME or "
        f"pass --config PATH. Searched:\n  {tried}"
    )


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def validate_sources() -> None:
    layout = SOURCE / "layouts" / "TooDope.json"

    if not layout.is_file():
        raise RuntimeError(f"Packaged layout is missing: {layout}")

    for name in MODS:
        folder = SOURCE / "mods" / name
        if not (folder / "main.js").is_file() or not (folder / "mod.json").is_file():
            raise RuntimeError(f"Packaged mod is incomplete: {folder}")


def merge_shortcut(config: Path, platform: str | None = None) -> tuple[str, bool]:
    """Add the recent-spaces shortcut without replacing existing bindings."""
    path = config / "keys.json"
    key, label = shortcut_for_platform(platform)
    try:
        contents = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        if path.is_symlink():
            return (f"Warning: left dangling symlink {path} unchanged.", True)
        contents = None
    except (OSError, UnicodeError) as exc:
        return (
            f"Warning: left {path} unchanged ({exc}); add {label}: "
            f"{SHORTCUT_ACTION} under {SHORTCUT_SECTION!r} in keys.json manually.",
            True,
        )

    if contents is None:
        keys = {}
    else:
        try:
            keys = json.loads(contents)
        except json.JSONDecodeError as exc:
            return (
                f"Warning: left {path} unchanged ({exc}); add {label}: "
                f"{SHORTCUT_ACTION} under {SHORTCUT_SECTION!r} in keys.json manually.",
                True,
            )

    if not isinstance(keys, dict):
        return (f"Warning: left {path} unchanged; expected a JSON object.", True)

    for section_name in SHORTCUT_CONTEXTS:
        bindings = keys.get(section_name, {})
        if not isinstance(bindings, dict):
            return (
                f"Warning: left {path} unchanged; {section_name!r} must be an object.",
                True,
            )
        if key in bindings and bindings[key] != SHORTCUT_ACTION:
            if (
                section_name == SHORTCUT_SECTION
                and bindings[key] == LEGACY_SHORTCUT_ACTION
            ):
                continue

            existing = bindings[key]

            return (
                f"Warning: {label} is already bound to {existing!r} in "
                f"{section_name!r}; left {path} unchanged.",
                True,
            )

    layout_bindings = keys.setdefault(SHORTCUT_SECTION, {})
    if layout_bindings.get(key) == SHORTCUT_ACTION:
        return (f"{label} already opens recent spaces in TooDope.", False)

    migrated = layout_bindings.get(key) == LEGACY_SHORTCUT_ACTION
    layout_bindings[key] = SHORTCUT_ACTION
    write_path = path
    temporary_path: Path | None = None
    try:
        if path.is_symlink():
            write_path = path.resolve(strict=True)
        try:
            mode = stat.S_IMODE(write_path.stat().st_mode)
        except FileNotFoundError:
            mode = 0o600
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{write_path.name}.",
            suffix=".tmp",
            dir=write_path.parent,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(keys, temporary, indent=2, ensure_ascii=False)
            temporary.write("\n")
        os.chmod(temporary_path, mode)
        os.replace(temporary_path, write_path)
    except OSError as exc:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
        return (f"Warning: couldn't add {label} to {path}: {exc}.", True)

    if migrated:
        return (
            f"Updated {label} to open recent spaces in the TooDope layout.",
            False,
        )
    return (f"Added {label} to open recent spaces in the TooDope layout.", False)


def install(config: Path) -> None:
    validate_sources()
    layouts = config / "layouts"
    mods = config / "mods"
    layouts.mkdir(parents=True, exist_ok=True)
    mods.mkdir(parents=True, exist_ok=True)

    # Remove only this package's layout names and module directories.
    for name in LAYOUT_FILES:
        remove_path(layouts / name)
    for name in MODS:
        remove_path(mods / name)

    shutil.copy2(SOURCE / "layouts" / "TooDope.json", layouts / "TooDope.json")
    for name in MODS:
        shutil.copytree(SOURCE / "mods" / name, mods / name)

    message, warning = merge_shortcut(config)
    print(message, file=sys.stderr if warning else sys.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config", help="Herdr config folder (overrides auto-detection)"
    )
    args = parser.parse_args()

    try:
        config = find_config(args.config)
        install(config)
    except (OSError, RuntimeError) as exc:
        print(f"TooDope install failed: {exc}", file=sys.stderr)
        return 1

    print(f"Installed TooDope layout and {len(MODS)} mods into {config}")
    print("Select it in Herdr with: herdr-app do layout.switch --name TooDope")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
