#!/usr/bin/env python3
"""Install or update the TooDope layout in a Herdr app config directory."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "TooDope"
LAYOUT_FILES = ("TooDope.json", "toodope-main.json", "toodope-main-tab-dots.json")
MODS = (
    "toodope-spaces",
    "toodope-tabs-active-dot",
    "toodope-workspace-status",
    "toodope-pane-header",
)


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
