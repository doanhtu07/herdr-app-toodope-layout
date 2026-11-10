import { View, div, image, svg } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import {
  spaces,
  panes,
  terminals,
  agents,
  shared,
  setShared,
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

function hasActiveProcess(info, terminal, foregroundActive) {
  const program = info?.program ?? terminal?.program

  if (program?.agent) return (info?.status ?? terminal?.status) === 'working'
  if (program?.shell === false) return true

  // A shell stays the reported program while it runs a foreground script.
  // Core exposes that process group's leader separately from the shell PID.
  if (
    Number.isInteger(terminal?.pid) &&
    Number.isInteger(terminal?.foreground?.pid) &&
    terminal.foreground.pid !== terminal.pid
  )
    return true

  return foregroundActive?.[terminal?.address] === true
}

// Count foreground processes, not shells waiting at a prompt. Agents count
// only while working; other non-shell foreground programs count as active.
function activeTerminalCounts(
  sp,
  ps,
  all,
  foregroundActive,
  tabCounts,
  activeBySpace,
) {
  const tabSpace = new Map()
  for (const s of sp) for (const tab of s.tabs ?? []) tabSpace.set(tab.id, s.id)

  const owner = new Map()
  const tabOwner = new Map()
  const paneByAddress = new Map()

  for (const p of ps)
    if (p.terminal && tabSpace.has(p.tab)) {
      owner.set(p.terminal, tabSpace.get(p.tab))
      tabOwner.set(p.terminal, p.tab)
    }

  for (const p of ps) if (p.terminal) paneByAddress.set(p.terminal, p)

  let grew = true

  while (grew) {
    grew = false

    for (const terminal of all) {
      if (
        terminal.parent &&
        owner.has(terminal.parent) &&
        !owner.has(terminal.address)
      ) {
        owner.set(terminal.address, owner.get(terminal.parent))
        tabOwner.set(terminal.address, tabOwner.get(terminal.parent))
        grew = true
      }
    }
  }

  const byAddress = new Map(all.map((terminal) => [terminal.address, terminal]))
  const counts = new Map(sp.map((s) => [s.id, 0]))

  for (const [address, space] of owner) {
    const terminal = byAddress.get(address)

    if (
      terminal?.state === 'live' &&
      hasActiveProcess(paneByAddress.get(address), terminal, foregroundActive)
    ) {
      counts.set(space, (counts.get(space) ?? 0) + 1)
      const tab = tabOwner.get(address)
      if (tab) tabCounts.set(tab, (tabCounts.get(tab) ?? 0) + 1)

      const pane = paneByAddress.get(address)
      const program = pane?.program ?? terminal.program
      activeBySpace[space] ??= []
      activeBySpace[space].push({
        terminal: address,
        pane: pane?.pane,
        tab,
        name: pane?.title || program?.name || 'Terminal',
        directory: pane?.cwd || terminal.cwd,
      })
    }
  }

  return counts
}

export default class WorkspaceStatus extends View {
  // The status view stays mounted when the sidebar is hidden, so the
  // recent-spaces shortcut remains available in that state.
  init(_props, cx) {
    this.foregroundActive = {}
    this.foregroundRefreshing = false
    this.refreshForeground(cx)
    cx.timer.every(5000, (cx) => this.refreshForeground(cx))

    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand()
        if (command === 'recent') this.openHistory()
      }
    })
  }

  refreshForeground(cx) {
    if (this.foregroundRefreshing) return

    const all = terminals()
    const panesByAddress = new Map(
      panes()
        .filter((p) => p.terminal)
        .map((p) => [p.terminal, p]),
    )
    const candidates = all.filter((terminal) => {
      if (terminal.state !== 'live') return false
      const info = panesByAddress.get(terminal.address) ?? terminal
      const program = info.program ?? terminal.program
      return !program?.agent && program?.shell !== false
    })
    const live = new Set(
      all
        .filter((terminal) => terminal.state === 'live')
        .map((terminal) => terminal.address),
    )

    this.foregroundRefreshing = true
    cx.spawn(async (cx) => {
      const next = { ...this.foregroundActive }

      try {
        for (const address of Object.keys(next))
          if (!live.has(address)) delete next[address]

        const results = await Promise.all(
          candidates.map(async (terminal) => {
            try {
              const result = await hc(['get', terminal.address, '--json'])
              if (result.code !== 0) return null

              const current = JSON.parse(result.stdout)
              return [
                terminal.address,
                Number.isInteger(current.pid) &&
                  Number.isInteger(current.foreground?.pid) &&
                  current.foreground.pid !== current.pid,
              ]
            } catch {
              return null
            }
          }),
        )

        for (const result of results) if (result) next[result[0]] = result[1]

        if (JSON.stringify(next) !== JSON.stringify(this.foregroundActive)) {
          this.foregroundActive = next
          cx.notify()
        }
      } finally {
        this.foregroundRefreshing = false
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
    const sp = spaces()
    const ps = panes()
    const activeTabCounts = new Map()
    const activeBySpace = {}
    const activeCounts = activeTerminalCounts(
      sp,
      ps,
      terminals(),
      this.foregroundActive,
      activeTabCounts,
      activeBySpace,
    )
    const sharedActiveCounts = Object.fromEntries(activeCounts)
    if (
      JSON.stringify(shared('space.activeTerminalCounts') ?? {}) !==
      JSON.stringify(sharedActiveCounts)
    )
      setShared('space.activeTerminalCounts', sharedActiveCounts)
    if (
      JSON.stringify(shared('space.activeTerminals') ?? {}) !==
      JSON.stringify(activeBySpace)
    )
      setShared('space.activeTerminals', activeBySpace)

    const sharedActiveTabCounts = Object.fromEntries(activeTabCounts)
    if (
      JSON.stringify(shared('space.activeTabTerminalCounts') ?? {}) !==
      JSON.stringify(sharedActiveTabCounts)
    )
      setShared('space.activeTabTerminalCounts', sharedActiveTabCounts)

    const active = [...activeCounts.values()].reduce(
      (total, count) => total + count,
      0,
    )
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
