# TooDope

A Herdr layout with a fixed left workspace rail, active-dot tab bar, framed terminal panes, an optional Files/Changes panel, and a compact workspace status footer. The Spaces mod groups worktrees under their main checkout and shows activity and Git changes.

![TooDope](preview.png)

## What you see

- A 268px left rail with a 46px top brand/header block, equally weighted Spaces and Agents lists (each at least 90px), and a 69px footer.
- A 42px top tab bar with active-tab indicator, tab status, a new-tab menu, Files/Changes buttons, and window controls where the platform draws them.
- The main workspace uses 8px outer padding and gaps. Each pane has a 30px header with its short terminal ID pinned at the far right; clicking it copies terminal, pane, tab, and space details. Panes have 10px rounded corners, a border/focus treatment, and 14×12px terminal padding. The optional right panel is 368px wide (minimum 280px), starts hidden, and switches between Files and Changes.
- A 28px status footer shows the current machine, agent counts, active terminals, branch/change counts when available, and the command-palette shortcut.

## How it behaves

- Select a space; right-click opens its menu. Back/Forward in the Spaces header follows navigation history. The clock button or Cmd+Shift+J on macOS (Ctrl+Shift+J on Windows/Linux) opens a centered dialog of recent spaces; use ↑/↓ and Enter or click a row to switch, and Esc to close. Drag spaces to reorder within their machine. Worktrees are nested below their main checkout when Git metadata identifies the relationship.
- Space rows show active terminal and changed-file counts; hover the info icon for repo/branch/ahead/behind details. Path and VS Code buttons copy the active folder or open it in VS Code.
- Tabs can be selected, dragged to reorder, double-clicked to rename, right-clicked for their menu, and closed with the active tab's close button. Working tabs show a spinner; blocked and done tabs show a status marker; idle tabs have no status marker. Active tabs with a foreground process show a green dot. In the compact space rail, blocked/done use a solid dot and working/idle use a small dot colored by status.
- The Files and Changes buttons show/hide the panel and switch its contents. That choice is remembered per space.
- Agent and workspace status colors follow the current Herdr theme. Space avatar colors are saved in shared Herdr state.

## Built from

- `layouts/TooDope.json`: root row, fixed sidebar, tab bar, active-tab workspace, hidden Files/Changes stack, and status footer.
- `toodope-spaces`: workspace list, navigation history, Back/Forward and recent-space dialog controls, Git/worktree grouping, active-terminal and changed-file counts, copy-path and VS Code actions. Uses `spaces`, `machines`, `panes`, `terminals`, `hc`, `exec`, `watchFolder`, `nextCommand`, local storage, shared state, overlays, and `space.select`/`space.move`/`space.new` commands. It runs `hc`, `git`, and `code` and reads Git metadata in displayed workspaces; it does not make network requests.
- `toodope-space-history`: centered dialog listing recently visited spaces, opened by the clock button in the Spaces header.
- `toodope-tabs-active-dot`: tab bar, panel controls, tab interactions, and platform window buttons. Uses shared state, layout/window data, overlays, and tab/layout/window commands.
- `toodope-workspace-status`: machine, agent, activity, Git status, and palette-key summary.
- `toodope-pane-header`: the shipped pane header controls and status, plus a visible terminal ID that copies pane context when clicked.
- Shipped Herdr mods used by the layout: `workspace-chrome`, `agents`, `pane`, `files`, and `changes`; the tab bar opens shipped `menu` and `new-menu` overlays.
- Custom mod assets are included alongside their code under `mods/`.

## Watch out

- `preview.png` blurs the space list, tab labels, and terminal contents while leaving the layout chrome visible.
- The layout depends on the named shipped Herdr mods and commands being available in the installed Herdr version.
- Git status and foreground-process details depend on `git` and `hc`; Open in VS Code additionally depends on the `code` command being installed and available in the relevant machine's PATH.
- Git status refreshes on file changes where supported, with a slower fallback. Remote machines must be reachable for their data to update.
- The installer replaces only the package's layout filename and named mod folders. It leaves Herdr's generated `.state` data, settings, keys, and unrelated files alone.

## Done when

- `herdr-app check` passes for all four custom mods (substitute the installed config path).
- The layout appears as `TooDope` and `herdr-app do layout.switch --name TooDope` opens the layout.
- Selecting spaces/tabs, toggling Files/Changes, and viewing pane headers/footer work without a mod error.
