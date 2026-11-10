# Agent instructions

## Layout changes

- Read `TooDope/RECIPE.md` before changing layout or mod code. Treat its
  description and **Done when** section as the acceptance criteria for the
  layout, and keep the recipe up to date when behavior changes.
- Do not consider a layout change finished until the applicable **Done when**
  checks have passed. Run `herdr-app check <mod-folder>` for every affected
  custom mod; when practical, check every custom mod shipped by TooDope and
  verify the layout behavior described in the recipe. Report any manual check
  that could not be performed.
- For UI changes, complete the dev cycle: install the package, open or exercise
  the changed UI in the running Herdr App, inspect it with `herdr-app shot`, and
  keep iterating until the behavior is visibly correct. Do not claim visual
  verification without inspecting a live app capture.

## Check-only artifacts

- `herdr-app check` may use temporary type-checking scaffolding, such as a
  generated `jsconfig.json` or a temporary `gpui-kit` stub/copy. If you create
  such files only to run the check, remove those generated artifacts after the
  check; they are not part of the layout package.
- Remove only artifacts created for the current task. Do not delete source
  imports, real runtime dependencies, pre-existing files, or anything whose
  purpose is unclear. Check `git status` before cleanup and preserve unrelated
  user changes.
- After running `python3 scripts/install.py`, Herdr App hot-reloads the
  installed layout and mod changes. Treat the update as live; do not restart
  Herdr App or herdr-core unless there is evidence hot reload failed.
