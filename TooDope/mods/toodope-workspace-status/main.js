import { View, div, image, svg } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import {
  spaces,
  panes,
  agents,
  shared,
  theme,
  run,
  window,
  keys,
  nextCommand,
  openOverlay,
  exec,
  hc,
  home,
  notify,
} from 'herdr'

const HISTORY_KEY = 'space.navigation'

function place(space, ps) {
  const tabs = new Set((space.tabs ?? []).map((tab) => tab.id))
  return ps.find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder
}

const isWindowsPath = (path) => /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path)
const powershellQuote = (value) => `'${String(value).replace(/'/g, "''")}'`

async function launchCode(args, options) {
  if (!isWindowsPath(home())) return exec('code', args, options)

  const command = `& 'code' ${args.map(powershellQuote).join(' ')}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`

  return exec(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    options,
  )
}

const isHome = (path) =>
  path?.replace(/\/+$/, '') === home().replace(/\/+$/, '')

export default class WorkspaceStatus extends View {
  // The status view stays mounted when the sidebar is hidden, so the
  // recent-spaces shortcut remains available in that state.
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand()
        if (command === 'recent') this.openHistory()
      }
    })
  }

  openHistory() {
    const stored = shared(HISTORY_KEY)
    const entries = Array.isArray(stored?.entries)
      ? stored.entries.filter((id) => typeof id === 'string')
      : []
    const recent =
      Array.isArray(stored?.recent) && stored.recent.length
        ? stored.recent.filter((id) => typeof id === 'string')
        : entries.slice().reverse()

    const ids = recent
      .filter((id) => spaces().some((space) => space.id === id))
      .slice(0, 10)

    openOverlay({
      mod: 'toodope-space-history',
      kind: 'dialog',
      width: 480,
      height: Math.min(
        620,
        Math.max(220, 160 + Math.min(ids.length * 53, 420)),
      ),
      props: { spaceIds: ids },
    })
  }

  openActiveTerminals() {
    const active = shared('space.activeTerminals') ?? {}
    const byId = new Map(spaces().map((space) => [space.id, space]))
    const groups = Object.entries(active)
      .filter(([, terminals]) => Array.isArray(terminals) && terminals.length)
      .map(([id, terminals]) => {
        const space = byId.get(id)
        return {
          space: {
            id,
            name: space?.name ?? id,
            machine: space?.machine,
            tabs: space?.tabs?.map(({ id: tabId, name }) => ({
              id: tabId,
              name,
            })),
          },
          terminals,
        }
      })
    const total = groups.reduce(
      (count, group) => count + group.terminals.length,
      0,
    )
    const listHeight = Math.min(420, total * 56 + groups.length * 34)

    openOverlay({
      mod: 'toodope-active-terminals',
      kind: 'dialog',
      width: 520,
      height: Math.min(620, Math.max(210, 170 + listHeight)),
      props: { groups },
    })
  }

  copyPath(cwd, cx) {
    if (!cwd) return
    cx.write_to_clipboard(cwd)
    notify({ title: 'Copied absolute path', body: cwd, level: 'success' })
  }

  openProject(space, cwd, cx) {
    if (!cwd || space.name === '~' || isHome(cwd)) return

    cx.spawn(async () => {
      try {
        const args = ['--new-window']
        let options = { cwd }

        if (space.machine) {
          const result = await hc(['machine', 'ls', '--json'])
          if (result.code !== 0)
            throw new Error(
              result.stderr || result.stdout || 'Could not list machines.',
            )

          const machine = (JSON.parse(result.stdout).machines ?? []).find(
            (item) => item.name === space.machine,
          )
          if (!machine?.target)
            throw new Error(
              `No SSH target is configured for machine ${space.machine}.`,
            )
          if (machine.via)
            throw new Error(
              'This machine uses a Herdr via connection; configure an equivalent SSH host for VS Code Remote-SSH.',
            )

          args.push('--remote', `ssh-remote+${machine.target}`, cwd)
          options = { cwd: home() }
        } else {
          args.push(cwd)
        }

        const result = await launchCode(args, options)
        if (result.code !== 0)
          throw new Error(
            result.stderr ||
              result.stdout ||
              `VS Code exited with code ${result.code}.`,
          )
      } catch (error) {
        notify({
          title: "Couldn't open project in VS Code",
          body: String(error.message ?? error),
          level: 'error',
        })
      }
    })
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === 'macos'

    const mod = {
      cmd: mac ? '⌘' : 'Ctrl+',
      ctrl: mac ? '⌃' : 'Ctrl+',
      shift: mac ? '⇧' : 'Shift+',
      alt: mac ? '⌥' : 'Alt+',
      option: mac ? '⌥' : 'Alt+',
    }

    const b = keys().find(
      (k) => k.section === 'global' && k.action === 'app.palette',
    )

    const parts =
      b && b.keys.endsWith('--')
        ? [...b.keys.slice(0, -2).split('-'), '-']
        : b?.keys.split('-')

    const key =
      parts &&
      parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join('')

    return key ? `${key}  commands` : 'commands'
  }

  render() {
    const t = theme()
    const space = spaces().find((s) => s.active)
    const cwd = space ? place(space, panes()) : null
    const project = Boolean(cwd) && space.name !== '~' && !isHome(cwd)
    const list = agents()
    const needs = list.filter((a) => a.status === 'blocked').length
    const active = Object.values(
      shared('space.activeTerminalCounts') ?? {},
    ).reduce((total, count) => total + count, 0)
    const changed = space ? shared('space.changeCounts')?.[space.id] : undefined

    const label = (icon, text) =>
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
        .child(text)

    return h_flex()
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .child(
        label(
          space?.machine ? 'server' : 'monitor',
          space?.machine ?? 'This computer',
        ),
      )
      .child(
        h_flex()
          .gap(12)
          .items_center()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().size(6).rounded(3).bg(t.dim))
              .child(`${list.length} agents`)
              .when(needs > 0, (el) =>
                el.child(
                  div().text_color(t.blocked).child(`· ${needs} needs you`),
                ),
              ),
          )
          .child(
            h_flex()
              .id('status-active-terminals')
              .gap(6)
              .items_center()
              .cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .tooltip(
                'View active terminals by space; idle shells and non-working agents are excluded',
              )
              .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => {
                cx.stop_propagation()
                this.openActiveTerminals()
              })
              .child(svg('mods/workspace-chrome/terminal.svg').size(13))
              .child(`${active} active`),
          ),
      )
      .when(Boolean(space?.branch) || typeof changed === 'number', (el) =>
        el.child(div().w(1).h(14).flex_none().bg(t.border)).child(
          h_flex()
            .gap(12)
            .items_center()
            .when(Boolean(space?.branch), (el) =>
              el.child(label('branch', space.branch)),
            )
            .when(typeof changed === 'number', (el) =>
              el.child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .tooltip(`${changed} changed files in the active space`)
                  .child(svg('mods/workspace-chrome/file-text.svg').size(13))
                  .child(`${changed} changed`),
              ),
            ),
        ),
      )
      .child(div().flex_1())
      .when(Boolean(cwd), (el) =>
        el.child(
          h_flex()
            .gap(2)
            .items_center()
            .child(
              div()
                .id('status-copy-path')
                .size(23)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(5)
                .cursor_pointer()
                .text_color(t.dim)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .tooltip('Copy absolute path')
                .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => {
                  cx.stop_propagation()
                  this.copyPath(cwd, cx)
                })
                .child(svg('mods/toodope-spaces/copy.svg').size(16)),
            )
            .when(project, (controls) =>
              controls.child(
                div()
                  .id('status-open-vscode')
                  .size(23)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(5)
                  .cursor_pointer()
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip('Open project in VS Code')
                  .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
                  .on_click((_e, cx) => {
                    cx.stop_propagation()
                    this.openProject(space, cwd, cx)
                  })
                  .child(image('mods/toodope-spaces/vscode.svg').size(16)),
              ),
            ),
        ),
      )
      .child(
        div()
          .id('palette')
          .text_color(t.dim)
          .on_click(() => run('app.palette'))
          .child(this.hint(t)),
      )
  }
}
