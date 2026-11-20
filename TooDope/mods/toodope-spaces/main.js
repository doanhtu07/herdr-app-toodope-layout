// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. The second row shows active
// processes and changed files; Git details are in its info tooltip. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, image, svg } from 'gpui-kit'
import { v_flex, h_flex } from 'gpui-base'
import {
  spaces,
  machines,
  panes,
  agents,
  run,
  openOverlay,
  exec,
  hc,
  home,
  notify,
  theme,
  shared,
  setShared,
  watchFolder,
  window,
  layout,
  props,
} from 'herdr'

const HISTORY_KEY = 'space.navigation'
const HISTORY_LIMIT = 40
const SPACE_DRAG_DELAY = 200
const SPACE_DRAG_DISTANCE = 6

function find(node, id) {
  if (node?.id === id) return node

  for (const child of node?.children ?? []) {
    const found = find(child, id)
    if (found) return found
  }

  return null
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), 'sidebar')?.size?.px ?? Infinity) < 160

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id))
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder
}

const rowHeight = ({ tree }) => (tree ? 40 : 44)
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)])
const base = (path) => path.replace(/\/+$/, '').split('/').pop()

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

// Where a drag would put its space: the same rule the tab bar uses, so the
// drop line and the move agree on which side of the middle the pointer is on.
function spaceMoveIndex(order, sourceID, targetID, after) {
  const from = order.findIndex((s) => s.id === sourceID)
  const target = order.findIndex((s) => s.id === targetID)
  if (from < 0 || target < 0) return null

  const boundary = target + (after ? 1 : 0)
  const destination = boundary - (from < boundary ? 1 : 0)
  return destination === from ? null : destination + 1
}

function afterMiddleY(event) {
  const y =
    event.local_position?.y ?? (event.position?.y ?? 0) - (event.bounds?.y ?? 0)
  return y > (event.bounds?.height ?? Infinity) / 2
}

function contains(bounds, point) {
  return (
    bounds &&
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}

function readHistory() {
  try {
    const sharedHistory = shared(HISTORY_KEY)
    const stored =
      sharedHistory && typeof sharedHistory === 'object'
        ? sharedHistory
        : JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null')

    const entries = Array.isArray(stored?.entries)
      ? stored.entries.filter((id) => typeof id === 'string')
      : []

    const requestedIndex = Number.isInteger(stored?.index)
      ? stored.index
      : entries.length - 1

    const index = entries.length
      ? Math.max(0, Math.min(requestedIndex, entries.length - 1))
      : -1

    const recent =
      Array.isArray(stored?.recent) && stored.recent.length
        ? stored.recent.filter((id) => typeof id === 'string')
        : entries.slice().reverse()

    return { entries, index, recent: [...new Set(recent)].slice(0, 20) }
  } catch {
    return { entries: [], index: -1, recent: [] }
  }
}

function metadataHint(active, g) {
  const parts = [`${active} active terminal${active === 1 ? '' : 's'}`]
  if (!g) return parts.join(' · ')

  parts.push(`${g.changed} changed file${g.changed === 1 ? '' : 's'}`)
  parts.push(`Repo: ${g.name}`)
  parts.push(`Branch: ${g.branch ?? 'detached'}`)

  if (g.ahead) parts.push(`${g.ahead} ahead`)
  if (g.behind) parts.push(`${g.behind} behind`)

  return parts.join(' · ')
}

// Changes made outside Herdr (an editor's save, a commit in another app): look
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = {
  ansi6: '#22a99a',
  ansi3: '#e3814f',
  ansi4: '#5b8def',
  ansi5: '#8b7cf6',
  ansi2: '#3fae6a',
  ansi1: '#d9649a',
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === 'blocked' || status === 'done' ? '●' : '·'
}

export function tone(t, status) {
  return t[status] ?? t.unknown
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {} // where() -> { name, branch, ahead, behind, changed, repo, linked }, null: not a repo
    this.checked = {} // where() -> when it was last looked at
    this.unsure = new Set() // where()s git couldn't answer for (a machine away)
    this.pending = new Set() // where()s to look at next

    this.busy = {} // pane -> an agent working or a program in front of its shell
    this.ready = {} // machine -> its layout was readable at the last look
    this.at = {} // space -> its where() at the last look

    this.watching = new Set() // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id))
    this.born = {}
    this.drag = null

    this.history = readHistory()
    // Share navigation with the status bar, which stays visible when this
    // sidebar mod is hidden. The localStorage fallback above imports old data.
    setShared(HISTORY_KEY, this.history)
    const active = spaces().find((s) => s.active)?.id
    if (!this.recordActive(active) && this.touchRecent(active))
      this.saveHistory()

    this.machines = []
    this.reconnecting = JSON.parse(
      localStorage.getItem('machines.reconnecting') ?? '{}',
    )
    for (const state of Object.values(this.reconnecting)) state.busy = false
    this.folded = new Set(
      JSON.parse(localStorage.getItem('machines.folded') ?? '[]'),
    )

    this.refreshMachines(cx)
    cx.timer.every(15000, (cx) => this.refreshMachines(cx))
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx))
  }

  checkNew(cx) {
    const now = Date.now()
    const sp = spaces()
    const historyChanged = this.recordActive(sp.find((s) => s.active)?.id)
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now

    const due = this.due(now, sp, panes())
    if (due.size) this.refreshGit(due, cx)

    if (
      historyChanged ||
      sp.some((s) => !this.shown.has(s.id)) ||
      this.orderingDue(now)
    )
      cx.notify()
  }

  saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history))
    setShared(HISTORY_KEY, this.history)
  }

  recordActive(id) {
    if (!id) return false
    if (this.history.entries[this.history.index] === id) return false

    const entries = this.history.entries.slice(0, this.history.index + 1)
    entries.push(id)
    if (entries.length > HISTORY_LIMIT)
      entries.splice(0, entries.length - HISTORY_LIMIT)

    this.touchRecent(id)
    this.history = {
      entries,
      index: entries.length - 1,
      recent: this.history.recent,
    }
    this.saveHistory()
    return true
  }

  touchRecent(id) {
    if (!id) return false
    const recent = [id, ...this.history.recent.filter((space) => space !== id)]
    const next = recent.slice(0, 20)
    if (JSON.stringify(next) === JSON.stringify(this.history.recent))
      return false
    this.history.recent = next
    return true
  }

  historyTarget(delta) {
    const ids = new Set(spaces().map((s) => s.id))
    for (
      let index = this.history.index + delta;
      index >= 0 && index < this.history.entries.length;
      index += delta
    )
      if (ids.has(this.history.entries[index])) return index
    return null
  }

  moveHistory(delta, cx) {
    const index = this.historyTarget(delta)
    if (index === null) return

    this.history.index = index
    const id = this.history.entries[index]
    this.touchRecent(id)
    this.saveHistory()
    run('space.select', { id })
    cx.notify()
  }

  openHistory() {
    const ids = this.history.recent
      .filter((id) => spaces().some((s) => s.id === id))
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

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {}
    for (const s of sp) at[s.id] = where(s, ps)

    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]))
    const due = new Set([...keys].filter((k) => !(k in this.git)))
    for (const [id, k] of Object.entries(at))
      if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k)

    this.at = at
    const spaceOf = {}
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s

    const busy = {}
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue
      busy[p.pane] =
        p.status === 'working' || !(p.program?.shell || p.program?.agent)
      if (this.busy[p.pane] && !busy[p.pane])
        this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k))
    }
    this.busy = busy
    for (const m of machines()) {
      const ready = m.layout === 'ready'
      if (ready && this.ready[m.name] === false)
        for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k)
      this.ready[m.name] = ready
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k)
        if (
          asks &&
          !this.folded.has(JSON.parse(k)[0]) &&
          now - (this.checked[k] ?? 0) > FALLBACK
        )
          due.add(k)
      }
    }
    return due
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo
    return [
      key,
      ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : []),
    ]
  }

  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(['machine', 'ls', '--json'])
        if (r.code === 0)
          this.machines = (JSON.parse(r.stdout).machines ?? []).filter(
            (m) => !m.temporary,
          )
      } catch {}
      cx.notify()
    })
  }

  rebuilt(machine) {
    return (
      machine?.state === 'unreachable' &&
      /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? '')
    )
  }

  reconnect(machine, cx) {
    const name = machine.name
    if (this.reconnecting[name]?.busy) return
    const state = (this.reconnecting[name] ??= { machine, removed: false })
    state.busy = true
    state.error = null
    localStorage.setItem(
      'machines.reconnecting',
      JSON.stringify(this.reconnecting),
    )
    cx.notify()
    cx.spawn(async (cx) => {
      try {
        const ask = async (args) => {
          const r = await hc([...args, '--json'])
          if (r.code !== 0) {
            let error
            try {
              error = JSON.parse(r.stdout || r.stderr).error?.message
            } catch {}
            throw new Error(
              error || r.stderr || r.stdout || "Couldn't connect.",
            )
          }
        }
        if (!state.removed) {
          await ask(['machine', 'rm', name])
          state.removed = true
          localStorage.setItem(
            'machines.reconnecting',
            JSON.stringify(this.reconnecting),
          )
        }
        const args = ['machine', 'add']
        if (machine.via) args.push('--via', machine.target)
        else args.push(machine.target)
        args.push('--name', name)
        if (machine.session) args.push('--session', machine.session)
        if (machine.temporary) args.push('--temp')
        await ask(args)
        this.folded.delete(name)
        localStorage.setItem(
          'machines.folded',
          JSON.stringify([...this.folded]),
        )
        delete this.reconnecting[name]
      } catch (e) {
        state.error = String(e.message ?? e)
        state.busy = false
      }
      localStorage.setItem(
        'machines.reconnecting',
        JSON.stringify(this.reconnecting),
      )
      this.refreshMachines(cx)
      cx.notify()
    })
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k)
    if (this.refreshing) return
    this.refreshing = true
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending]
        this.pending.clear()
        for (const key of keys) await this.check(key, cx)
      }
      const used = new Set(
        Object.values(this.git)
          .filter(Boolean)
          .map((g) => JSON.parse(g.repo))
          .filter(([on]) => !on)
          .map(([, repo]) => repo),
      )
      for (const repo of this.watching)
        if (!used.has(repo)) this.watching.delete(repo)
      this.refreshing = false
      cx.notify()
    })
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key)
    this.checked[key] = Date.now()
    this.unsure.delete(key)
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec(
        'git',
        [
          '--no-optional-locks',
          '-c',
          'core.fsmonitor=false',
          'status',
          '--porcelain=v2',
          '--branch',
          '--untracked-files=all',
        ],
        { cwd, on },
      )
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key)
        this.git[key] = null
        return
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        on,
      })
      const common = await exec(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd, on },
      )
      const repo = common.stdout.trim()
      const name = repo.endsWith('/.git')
        ? base(repo.slice(0, -5))
        : base(repo).replace(/\.git$/, '')
      const changed = r.stdout
        .split('\n')
        .filter((line) => /^(?:1 |2 |u |\? )/.test(line)).length
      const info = {
        name,
        branch: null,
        ahead: 0,
        behind: 0,
        changed,
        repo: JSON.stringify([on, repo]),
        linked: repo !== `${top.stdout.trim()}/.git`,
      }
      for (const line of r.stdout.split('\n')) {
        if (line.startsWith('# branch.head ')) info.branch = line.slice(14)
        else if (line.startsWith('# branch.ab ')) {
          const [a, b] = line.slice(12).split(' ')
          info.ahead = Math.abs(parseInt(a, 10)) || 0
          info.behind = Math.abs(parseInt(b, 10)) || 0
        }
      }
      this.git[key] = info
      if (!on) this.watch(repo, cx)
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null
      this.unsure.add(key)
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return
    this.watching.add(repo)
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo)
          const mine = JSON.stringify([null, repo])
          if (this.watching.has(repo))
            this.refreshGit(
              Object.keys(this.git).filter((k) => this.git[k]?.repo === mine),
              cx,
            )
        }
      } catch {
        this.watching.delete(repo)
      }
    })
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({
      mod: 'menu',
      kind: 'popup',
      width: 200,
      height: 260,
      props: { tab: 'space', target: { id: w.id } },
    })
  }

  openProject(w, cx) {
    const cwd = place(w, panes())
    if (!cwd || w.name === '~' || isHome(cwd)) return
    cx.spawn(async () => {
      try {
        let args = ['--new-window']
        let options = { cwd }

        if (w.machine) {
          const r = await hc(['machine', 'ls', '--json'])
          if (r.code !== 0)
            throw new Error(r.stderr || r.stdout || 'Could not list machines.')

          const machine = (JSON.parse(r.stdout).machines ?? []).find(
            (m) => m.name === w.machine,
          )
          if (!machine?.target)
            throw new Error(
              `No SSH target is configured for machine ${w.machine}.`,
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
        if (result.code !== 0) {
          notify({
            title: "Couldn't open project in VS Code",
            body:
              result.stderr ||
              result.stdout ||
              `VS Code exited with code ${result.code}.`,
            level: 'error',
          })
        }
      } catch (error) {
        notify({
          title: "Couldn't open project in VS Code",
          body: String(error.message ?? error),
          level: 'error',
        })
      }
    })
  }

  copyPath(cwd, cx) {
    if (!cwd) return
    cx.write_to_clipboard(cwd)
    notify({ title: 'Copied absolute path', body: cwd, level: 'success' })
  }

  orderingDue(now) {
    return (
      this.ordering &&
      now - this.ordering.at >= 1000 &&
      this.ordering.machines.every((name) =>
        machines().some((m) => m.name === name && m.layout === 'ready'),
      )
    )
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered(activeCounts, agentCounts) {
    const sp = spaces(),
      ps = panes()

    const ready = (w) =>
      this.shown.has(w.id) ||
      where(w, ps) in this.git ||
      Date.now() - (this.born[w.id] ??= Date.now()) > 1500
    for (const w of sp)
      if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id)

    const list = sp.map((w, i) => ({
      w,
      i,
      g: this.git[where(w, ps)] ?? null,
      active: activeCounts.get(w.id) ?? 0,
      agentCount: agentCounts.get(w.id) ?? 0,
    }))

    const mains = new Set(
      list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo),
    )
    const nested = (r) => r.g?.linked && mains.has(r.g.repo)

    const out = []
    const placed = new Set() // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue
      out.push({ ...r, tree: null })
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue
      placed.add(r.g.repo)
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo)
      kids.forEach((k, n) =>
        out.push({ ...k, tree: n === kids.length - 1 ? '└─' : '├─' }),
      )
    }

    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map((w) => w.id)
    const target = out.map((r) => r.w.id)
    const key = JSON.stringify([order, target, machines()])
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set()
      this.ordering = { key, at: Date.now(), machines: [] }
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id)
        if (from === i) continue
        run('space.move', { id: out[i].w.id, index: i + 1 })
        moved.add(out[i].w.machine ?? null)
        order.splice(i, 0, order.splice(from, 1)[0])
      }
      this.ordering.machines = [...moved]
    }

    return out.filter((r) => this.shown.has(r.w.id))
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed, activeCounts, agentCounts) {
    const rows = this.ordered(activeCounts, agentCounts)
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t))

    const remote = [
      ...new Set([
        ...rows.map((r) => r.w.machine).filter(Boolean),
        ...this.machines.map((m) => m.name),
        ...Object.keys(this.reconnecting),
      ]),
    ].sort()

    const loading = (m) => {
      const layout = machines().find((k) => k.name === m)?.layout
      return (
        layout === 'loading' ||
        (!layout &&
          this.machines.some((k) => k.name === m && k.state === 'connected')) ||
        spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id))
      )
    }

    const loadingRow = (m) =>
      div()
        .id(`machine-loading-${m ?? 'local'}`)
        .h(28)
        .flex_none()
        .px(8)
        .text_size(12)
        .text_color(t.dim)
        .child(collapsed ? '…' : 'Loading…')

    if (!remote.length)
      return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw)

    const machineNames = [null, ...remote]
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m)
      const repair = this.reconnecting[m]
      const machine = this.machines.find((k) => k.name === m) ?? repair?.machine
      const connected = !m || machine?.state === 'connected'
      const rebuilt = this.rebuilt(machine) || !!repair
      const folded = this.folded.has(m)

      const head = h_flex()
        .id(`machine-${m ?? 'local'}`)
        .h(26)
        .flex_none()
        .px(collapsed ? 2 : 8)
        .rounded(7)
        .gap(7)
        .items_center()
        .text_size(11)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) =>
          s
            .bg(t.input)
            .border(1)
            .border_color(t.accent)
            .text_color(t.foreground),
        )
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m)
          localStorage.setItem(
            'machines.folded',
            JSON.stringify([...this.folded]),
          )
          cx.notify()
        })
        .child(
          svg(`mods/workspace-chrome/${m ? 'server' : 'monitor'}.svg`)
            .size(13)
            .flex_none(),
        )
        .when(!collapsed, (el) =>
          el
            .child(
              div()
                .flex_1()
                .truncate()
                .child(m ?? 'This computer'),
            )
            .when(!connected && !rebuilt, (el) =>
              el.child(
                div()
                  .flex_none()
                  .child((machine?.state ?? 'asleep').replace(/_/g, ' ')),
              ),
            )
            .when(rebuilt, (el) =>
              el.child(
                h_flex()
                  .flex_none()
                  .gap(3)
                  .items_center()
                  .child(
                    div()
                      .max_w(140)
                      .truncate()
                      .child(repair?.error || 'rebuilt ·'),
                  )
                  .child(
                    div()
                      .id(`machine-connect-${m}`)
                      .text_color(repair?.error ? t.blocked : t.muted)
                      .rounded(4)
                      .hover((s) =>
                        s
                          .bg(t.input)
                          .border(1)
                          .border_color(t.accent)
                          .text_color(t.foreground),
                      )
                      .tooltip(
                        repair?.error ||
                          'This machine was rebuilt or replaced. Click to connect to the new one.',
                      )
                      .on_click((_e, cx) => {
                        cx.stop_propagation()
                        this.reconnect(machine, cx)
                      })
                      .child(repair?.busy ? 'Connecting…' : 'Connect'),
                  ),
              ),
            )
            .when(connected, (el) =>
              el.child(
                div()
                  .id(`machine-add-${m ?? 'local'}`)
                  .flex_none()
                  .px(4)
                  .rounded(4)
                  .hover((s) =>
                    s
                      .bg(t.input)
                      .border(1)
                      .border_color(t.accent)
                      .text_color(t.foreground),
                  )
                  .on_click((_e, cx) => {
                    cx.stop_propagation()
                    run('space.new', { machine: m ?? '' })
                  })
                  .child('+'),
              ),
            )
            .child(
              div()
                .size(6)
                .rounded(3)
                .flex_none()
                .bg(connected ? t.ansi2 : t.dim),
            )
            .child(
              svg(
                `mods/workspace-chrome/chevron-${folded ? 'right' : 'down'}.svg`,
              )
                .size(11)
                .flex_none(),
            ),
        )

      const empty = h_flex()
        .id(`machine-new-${m ?? 'local'}`)
        .h(28)
        .flex_none()
        .px(8)
        .gap(7)
        .items_center()
        .rounded(7)
        .text_size(12)
        .text_color(t.dim)
        .hover((s) =>
          s
            .bg(t.input)
            .border(1)
            .border_color(t.accent)
            .text_color(t.foreground),
        )
        .on_click(() => run('space.new', { machine: m ?? '' }))
        .child(svg('mods/workspace-chrome/plus.svg').size(12))
        .when(!collapsed, (el) => el.child('New space there'))

      if (!collapsed && rebuilt) return [head]
      return [
        head,
        ...(folded
          ? []
          : mine.length
            ? mine.map(draw)
            : [loading(m) ? loadingRow(m) : empty]),
      ]
    })
  }

  beginSpaceDrag(space, event) {
    const point = event.position ?? { x: 0, y: 0 }
    this.drag = {
      id: space.id,
      start: point,
      point,
      pressedAt: Date.now(),
      active: false,
      target: null,
    }
  }

  spaceDragReady(drag, point) {
    const distance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y)
    return (
      Date.now() - drag.pressedAt >= SPACE_DRAG_DELAY &&
      distance >= SPACE_DRAG_DISTANCE
    )
  }

  hoverSpace(space, event, cx) {
    const drag = this.drag
    if (!drag) return

    const point = event.position ?? drag.point
    drag.point = point
    drag.active ||= this.spaceDragReady(drag, point)
    if (!drag.active) return

    // Only spaces on the dragged space's machine share an order.
    const source = spaces().find((s) => s.id === drag.id)
    const same = source && (source.machine ?? null) === (space.machine ?? null)
    const target = same
      ? {
          id: space.id,
          after: afterMiddleY(event),
          bounds: event.bounds,
        }
      : null

    if (
      target?.id !== drag.target?.id ||
      target?.after !== drag.target?.after
    ) {
      drag.target = target
      cx.notify()
    } else drag.target = target
  }

  moveSpacePointer(event, cx) {
    const drag = this.drag
    if (!drag?.active || !drag.target?.bounds) return

    const point = event.position ?? drag.point
    drag.point = point
    if (!contains(drag.target.bounds, point)) {
      drag.target = null
      cx.notify()
    }
  }

  finishSpaceDrag(space, event, cx) {
    const drag = this.drag
    if (!drag) return
    cx.stop_propagation()
    this.hoverSpace(space, event, cx)
    this.commitSpaceDrag(space.id, cx)
  }

  commitSpaceDrag(clickedID, cx) {
    const drag = this.drag
    this.drag = null
    if (!drag) return

    if (drag.active && drag.target && drag.target.id !== drag.id) {
      const index = spaceMoveIndex(
        spaces(),
        drag.id,
        drag.target.id,
        drag.target.after,
      )
      if (index !== null) run('space.move', { id: drag.id, index })
    } else if (!drag.active && drag.id === clickedID) {
      run('space.select', { id: drag.id })
    }

    cx?.notify()
  }

  cancelSpaceDrag(cx) {
    if (!this.drag) return
    this.drag = null
    cx?.notify()
  }

  row({ w, g, tree, active, agentCount }, t) {
    const on = w.active
    const cwd = place(w, panes())
    const project = Boolean(cwd) && w.name !== '~' && !isHome(cwd)
    const colors = shared('space.colors') ?? {}
    const color = colors[w.id] ?? 'ansi6'
    const fill = color.startsWith('#') ? color : (MARK[color] ?? t[color])

    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .gap(1)
      .rounded(8)

      .when(on, (el) => el.bg(t.selected).border(1).border_color(t.accent))
      .when(!on && !this.drag?.active, (el) =>
        el.hover((s) =>
          s
            .bg(t.input)
            .border(1)
            .border_color(t.accent)
            .text_color(t.foreground),
        ),
      )

      .when(this.drag?.active && this.drag.id === w.id, (el) =>
        el.opacity(0.35),
      )
      .when(
        this.drag?.active &&
          this.drag.target?.id === w.id &&
          this.drag.id !== w.id,
        (el) =>
          el.child(
            div()
              .absolute()
              .left(8)
              .right(8)
              .h(2)
              .rounded(1)
              .bg(t.accent)
              .when(this.drag.target.after, (line) => line.bottom(0))
              .when(!this.drag.target.after, (line) => line.top(0)),
          ),
      )

      .on_mouse_down('left', (event) => this.beginSpaceDrag(w, event))
      .on_mouse_move((event, cx) => this.hoverSpace(w, event, cx))
      .on_mouse_up('left', (event, cx) => this.finishSpaceDrag(w, event, cx))
      .on_mouse_down('right', () => this.menu(w))

      .child(
        v_flex()
          .size_full()
          .justify_center()
          .gap(1)
          .child(
            h_flex()
              .h(18)
              .flex_none()
              .gap(9)
              .items_center()
              .when(Boolean(tree), (el) =>
                el
                  .pl(22)
                  .child(
                    svg('mods/workspace-chrome/branch.svg')
                      .size(13)
                      .text_color(t.dim),
                  ),
              )
              .when(!tree, (el) =>
                el.child(
                  h_flex()
                    .size(18)
                    .flex_none()
                    .rounded(5)
                    .bg(fill)
                    .items_center()
                    .justify_center()
                    .text_size(10.5)
                    .font_bold()
                    .text_color('#ffffff')
                    .child([...w.name][0]?.toUpperCase() ?? '?'),
                ),
              )
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .max_w(220)
                  .truncate()
                  .text_color(t.foreground)
                  .child(w.name),
              ),
          )

          .child(
            h_flex()
              .h(15)
              .flex_none()
              .gap(6)
              .items_center()
              .pl(tree ? 44 : 27)
              .text_size(10.5)
              .text_color(t.muted)
              .when(active > 0, (el) =>
                el.child(
                  h_flex()
                    .flex_none()
                    .gap(3)
                    .items_center()
                    .tooltip(
                      `${active} active terminal${active === 1 ? '' : 's'}; idle shells are excluded`,
                    )
                    .text_color(t.ansi2)
                    .child(svg('mods/workspace-chrome/terminal.svg').size(12))
                    .child(String(active)),
                ),
              )
              .when(agentCount > 0, (el) =>
                el.child(
                  h_flex()
                    .flex_none()
                    .gap(3)
                    .items_center()
                    .text_color(t.ansi5)
                    .tooltip(
                      `${agentCount} agent${agentCount === 1 ? '' : 's'} in this space`,
                    )
                    .child(svg('mods/toodope-spaces/agent.svg').size(12))
                    .child(String(agentCount)),
                ),
              )
              .when(g?.changed > 0, (el) =>
                el.child(
                  h_flex()
                    .flex_none()
                    .gap(3)
                    .items_center()
                    .text_color(t.ansi3)
                    .tooltip(
                      `${g.changed} changed file${g.changed === 1 ? '' : 's'}`,
                    )
                    .child(svg('mods/workspace-chrome/file-text.svg').size(12))
                    .child(String(g.changed)),
                ),
              )
              .child(div().flex_1())
              .when(Boolean(cwd), (el) =>
                el.child(
                  div()
                    .id(`space-copy-path-${w.id}`)
                    .size(17)
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(5)
                    .cursor_pointer()
                    .text_color(t.dim)
                    .hover((s) =>
                      s
                        .bg(t.input)
                        .border(1)
                        .border_color(t.accent)
                        .text_color(t.foreground),
                    )
                    .tooltip('Copy absolute path')
                    .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
                    .on_click((_e, cx) => {
                      cx.stop_propagation()
                      this.copyPath(cwd, cx)
                    })
                    .child(svg('mods/toodope-spaces/copy.svg').size(13)),
                ),
              )
              .when(project, (el) =>
                el.child(
                  div()
                    .id(`space-open-vscode-${w.id}`)
                    .size(17)
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(5)
                    .cursor_pointer()
                    .text_color(t.dim)
                    .hover((s) =>
                      s
                        .bg(t.input)
                        .border(1)
                        .border_color(t.accent)
                        .text_color(t.foreground),
                    )
                    .tooltip('Open project in VS Code')
                    .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
                    .on_click((_e, cx) => {
                      cx.stop_propagation()
                      this.openProject(w, cx)
                    })
                    .child(image('mods/toodope-spaces/vscode.svg').size(13)),
                ),
              )
              .when(Boolean(g), (el) =>
                el.child(
                  div()
                    .size(17)
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(5)
                    .text_color(t.dim)
                    .hover((s) =>
                      s
                        .bg(t.input)
                        .border(1)
                        .border_color(t.accent)
                        .text_color(t.foreground),
                    )
                    .tooltip(metadataHint(active, g))
                    .child(svg('mods/toodope-spaces/info.svg').size(13)),
                ),
              ),
          ),
      )
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) =>
        el.bg(t.selected).border(1).border_color(t.accent),
      )
      .rounded(6)
      .when(!this.drag?.active, (el) =>
        el.hover((s) =>
          s
            .bg(t.input)
            .border(1)
            .border_color(t.accent)
            .text_color(t.foreground),
        ),
      )
      .on_click(() => run('space.select', { id: w.id }))
      .child(
        div()
          .text_color(w.active ? t.foreground : t.muted)
          .child(String(i + 1)),
      )
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)))
  }

  render() {
    const t = theme()
    const collapsed = narrow()
    const compactMac = collapsed && window()?.platform === 'macos'
    const stop = (_e, cx) => cx.stop_propagation()
    const expandSidebar = () =>
      run('layout.resize', {
        id: 'sidebar',
        px: shared('sidebar.width') ?? 268,
      })

    const navButton = (id, icon, label, enabled, action) =>
      div()
        .id(id)
        .size(collapsed ? 20 : 22)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_color(t.dim)
        .when(enabled, (el) =>
          el.hover((s) =>
            s
              .bg(t.input)
              .border(1)
              .border_color(t.accent)
              .text_color(t.foreground),
          ),
        )
        .when(!enabled, (el) => el.opacity(0.38))
        .tooltip(label)
        .on_mouse_down('left', stop)
        .on_click((_e, cx) => {
          if (enabled) action(cx)
        })
        .child(svg(icon).size(13))

    const palette = ['ansi6', 'ansi3', 'ansi4', 'ansi5', 'ansi2', 'ansi1']
    const sp = spaces()
    const ps = panes()

    const activeCounts = new Map(
      Object.entries(shared('space.activeTerminalCounts') ?? {}),
    )
    const agentCounts = new Map(sp.map((space) => [space.id, 0]))
    for (const agent of agents()) {
      if (agentCounts.has(agent.space))
        agentCounts.set(agent.space, agentCounts.get(agent.space) + 1)
    }

    const changeCounts = {}
    for (const s of sp) {
      const key = where(s, ps)
      if (Object.prototype.hasOwnProperty.call(this.git, key))
        changeCounts[s.id] = this.git[key]?.changed ?? null
    }

    if (
      JSON.stringify(shared('space.changeCounts') ?? {}) !==
      JSON.stringify(changeCounts)
    )
      setShared('space.changeCounts', changeCounts)

    const ids = new Set(sp.map((p) => p.id))
    const kept = Object.fromEntries(
      Object.entries(shared('space.colors') ?? {}).filter(([id]) =>
        ids.has(id),
      ),
    )
    let changed =
      Object.keys(kept).length !==
      Object.keys(shared('space.colors') ?? {}).length
    for (const p of sp) {
      if (kept[p.id] || p.name === '~') continue
      const uses = (c) => Object.values(kept).filter((v) => v === c).length
      kept[p.id] = palette.reduce((best, c) =>
        uses(c) < uses(best) ? c : best,
      )
      changed = true
    }
    if (changed) setShared('space.colors', kept)
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(
        h_flex()
          .h(31)
          .pl(collapsed ? 2 : 16)
          .pr(collapsed ? 2 : 10)
          .items_center()
          .justify_between()
          .when(props()?.tabbed, (el) => el.justify_end())
          .text_size(11.5)
          .text_color(t.dim)
          .when(!collapsed && !props()?.tabbed, (el) => el.child('Spaces'))
          .child(
            h_flex()
              .gap(collapsed ? 0 : 2)
              .items_center()
              .children([
                ...(!collapsed
                  ? [
                      navButton(
                        'space-history-back',
                        'mods/workspace-chrome/chevron-left.svg',
                        'Back to previous space',
                        this.historyTarget(-1) !== null,
                        (cx) => this.moveHistory(-1, cx),
                      ),
                      navButton(
                        'space-history-forward',
                        'mods/workspace-chrome/chevron-right.svg',
                        'Forward to next space',
                        this.historyTarget(1) !== null,
                        (cx) => this.moveHistory(1, cx),
                      ),
                    ]
                  : []),
                compactMac
                  ? navButton(
                      'sidebar-expand',
                      'mods/workspace-chrome/chevron-right.svg',
                      'Expand sidebar',
                      true,
                      expandSidebar,
                    )
                  : navButton(
                      'space-history-open',
                      'mods/workspace-chrome/clock.svg',
                      'Recent spaces',
                      this.history.entries.length > 0,
                      () => this.openHistory(),
                    ),
                div()
                  .id('space-new')
                  .size(collapsed ? 20 : 22)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .hover((s) =>
                    s
                      .bg(t.input)
                      .border(1)
                      .border_color(t.accent)
                      .text_color(t.foreground),
                  )
                  .on_mouse_down('left', stop)
                  .on_click(() => run('toodope-workspace-status.new-space'))
                  .tooltip('New space')
                  .child(svg('mods/workspace-chrome/plus.svg').size(14)),
              ]),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(8)
          .pb(14)
          .overflow_y_scrollbar()
          .mode('always')
          .on_mouse_move((event, cx) => this.moveSpacePointer(event, cx))
          .on_mouse_up('left', (_e, cx) => this.commitSpaceDrag(null, cx))
          .on_hover((hovered, cx) => {
            if (!hovered) this.cancelSpaceDrag(cx)
          })
          .children(this.grouped(t, collapsed, activeCounts, agentCounts)),
      )
  }
}
