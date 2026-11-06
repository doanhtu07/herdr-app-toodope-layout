# herdr-app-toodope-layout

TooDope layout for Herdr App.

## Development

Install the repository's development tools and Git hooks with:

```sh
pnpm install
```

Husky runs `lint-staged` before commits and Commitlint checks Conventional Commit
messages. Prettier formats/checks JavaScript, JSON, Markdown, YAML, SVG, and
other supported text files with `pnpm format` and `pnpm format:check`.
Prettier does not format Python; after installing Ruff, run
`ruff format scripts/install.py`.

## Install or update

Requires Python 3.10 or newer. Run from this repository root:

```sh
python3 scripts/install.py
```

On Windows, use `py -3 scripts/install.py` if `python3` is not on PATH.

The installer checks `HERDR_APP_HOME`, `XDG_CONFIG_HOME/herdr-app`, and the
usual `~/.config/herdr-app` location (plus `%APPDATA%/herdr-app` on Windows).
To choose a config folder explicitly:

```sh
python3 scripts/install.py --config "/path/to/herdr-app"
```

It replaces only `layouts/TooDope.json` and the three `mods/toodope-*`
folders owned by this package. It does not touch other layouts, mods, settings,
keys, or Herdr-managed layout click state. After installation, select it with:

```sh
herdr-app do layout.switch --name TooDope
```

The packaged files are in `src/`. `preview.png` is included with the space list,
tab labels, and terminal contents blurred. The installer has no third-party Python
dependencies and makes no network requests. The `toodope-spaces` mod runs
`hc`, `git`, and `code` commands and reads Git metadata from the workspaces it
shows; these operations are part of its active-process, repository-status, and
open-in-VS-Code features.
