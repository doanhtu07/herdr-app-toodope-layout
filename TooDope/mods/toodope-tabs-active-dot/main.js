import { View, div, svg, image } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import {
  spaces,
  panes,
  run,
  openOverlay,
  theme,
  window,
  shared,
  layout,
  settings,
} from 'herdr'

const TAB_DRAG_DELAY = 400
const TAB_DRAG_DISTANCE = 12
const TAB_GAP = 6

function tabMoveIndex(tabs, sourceID, targetID, after) {
  const from = tabs.findIndex((tab) => tab.id === sourceID)
  const target = tabs.findIndex((tab) => tab.id === targetID)
  if (from < 0 || target < 0) return null

  const boundary = target + (after ? 1 : 0)
  const destination = boundary - (from < boundary ? 1 : 0)
  return destination === from ? null : destination + 1
}

function afterMiddle(event) {
  const x =
    event.local_position?.x ?? (event.position?.x ?? 0) - (event.bounds?.x ?? 0)
  return x > (event.bounds?.width ?? Infinity) / 2
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

function lead(panes, tab) {
  const mine = panes.filter((pane) => pane.tab === tab)
  return (
    mine.find((pane) => pane.focused) ??
    mine.find((pane) => pane.program?.agent) ??
    mine[0]
  )
}

function programTile(t, program, status) {
  const statusColor = status && status !== 'idle' ? t[status] : null

  return div()
    .relative()
    .flex_none()
    .w(22)
    .h(22)
    .rounded(6)
    .border(1)
    .border_color('#ffffff14')
    .bg(program?.tile ?? t.surface)
    .flex()
    .items_center()
    .justify_center()
    .when(Boolean(program?.icon), (el) =>
      el.child(
        program.tint
          ? svg(program.icon)
              .size(13)
              .text_color(program.color ?? t.foreground)
          : image(program.icon).w(13).h(13),
      ),
    )
    .when(Boolean(statusColor), (el) =>
      el.child(
        div()
          .absolute()
          .top(-3)
          .right(-3)
          .w(9)
          .h(9)
          .rounded_full()
          .border(2)
          .border_color(t.chrome)
          .bg(statusColor),
      ),
    )
}

function find(node, id) {
  if (node?.id === id) return node

  for (const child of node?.children ?? []) {
    const found = find(child, id)
    if (found) return found
  }

  return null
}

export default class Tabs extends View {
  init() {
    this.drag = null
    this.ignoreClickUntil = 0
    this.panels = JSON.parse(localStorage.getItem('panels') ?? '{}')
  }

  beginTabDrag(tab, event, cx) {
    cx.stop_propagation()

    if (event.click_count === 2) {
      this.drag = null
      this.ignoreClickUntil = Date.now() + 300
      run('tab.rename', { id: tab.id })
      return
    }

    const point = event.position ?? { x: 0, y: 0 }
    this.drag = {
      id: tab.id,
      start: point,
      point,
      pressedAt: Date.now(),
      active: false,
      target: null,
    }
  }

  dragReady(drag, point) {
    const distance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y)
    return (
      Date.now() - drag.pressedAt >= TAB_DRAG_DELAY &&
      distance >= TAB_DRAG_DISTANCE
    )
  }

  hoverTab(tab, event, cx) {
    if (!this.drag) return

    const point = event.position ?? this.drag.point
    this.drag.point = point
    this.drag.active ||= this.dragReady(this.drag, point)

    if (this.drag.active) {
      this.drag.target = {
        id: tab.id,
        after: afterMiddle(event),
        bounds: event.bounds,
      }
      cx.notify()
    }
  }

  finishTabDrag(tab, event, cx) {
    if (!this.drag) return
    cx.stop_propagation()
    this.hoverTab(tab, event, cx)
    this.commitTabDrag(tab.id, cx)
  }

  commitTabDrag(clickedID, cx) {
    const drag = this.drag
    this.drag = null
    if (!drag) return

    const space = spaces().find((item) => item.active)
    if (space && drag.active && drag.target) {
      const index = tabMoveIndex(
        space.tabs ?? [],
        drag.id,
        drag.target.id,
        drag.target.after,
      )
      if (index !== null) run('tab.move', { id: drag.id, index })
      this.ignoreClickUntil = Date.now() + 300
    } else if (!drag.active && drag.id === clickedID) {
      run('tab.select', { id: clickedID })
    }

    cx?.notify()
  }

  cancelTabDrag(cx) {
    if (!this.drag) return
    this.drag = null
    this.ignoreClickUntil = Date.now() + 300
    cx?.notify()
  }

  movePointer(event, cx) {
    if (!this.drag) return

    const point = event.position ?? this.drag.point
    this.drag.point = point
    this.drag.active ||= this.dragReady(this.drag, point)

    if (
      this.drag.active &&
      this.drag.target?.bounds &&
      !contains(this.drag.target.bounds, point)
    ) {
      this.drag.target = null
      cx.notify()
    } else if (this.drag.active) cx.notify()
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return

    const now = panel.hidden ? null : (body?.active ?? null)

    if (space.id !== this.space) {
      const first = this.space === undefined
      this.space = space.id
      this.pending = null

      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null,
          want = enabled.includes(stored) ? stored : null

        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 }

          if (want) {
            run('layout.select', { stack: 'panel-body', child: want })
            run('layout.show', { id: 'panel' })
          } else run('layout.hide', { id: 'panel' })

          return
        }
      }
    }

    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return
      this.pending = null
    }

    if (this.panels[space.id] === now) return
    this.panels[space.id] = now

    localStorage.setItem('panels', JSON.stringify(this.panels))
  }

  render() {
    const t = theme()
    const space = spaces().find((p) => p.active)
    const shown = space?.tabs ?? []
    const allPanes = panes()
    const activeCounts = shared('space.activeTabTerminalCounts') ?? {}

    const stop = (_e, cx) => cx.stop_propagation()

    const button = (id, label, action, dropLast = false) =>
      div()
        .id(id)
        .size(26)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down('left', stop)
        .on_mouse_move((event, cx) => {
          if (dropLast && shown.length)
            this.hoverTab(
              shown.at(-1),
              { ...event, local_position: { x: Infinity } },
              cx,
            )
        })
        .on_mouse_up('left', (event, cx) => {
          if (!this.drag) return
          if (dropLast && shown.length) {
            const last = shown.at(-1)
            this.hoverTab(
              last,
              { ...event, local_position: { x: Infinity } },
              cx,
            )
            this.commitTabDrag(last.id, cx)
          } else this.cancelTabDrag(cx)
        })
        .on_click((event, cx) => {
          cx.stop_propagation()
          if (Date.now() < this.ignoreClickUntil) return
          action(event, cx)
        })
        .when(
          dropLast &&
            this.drag?.active &&
            this.drag.target?.id === shown.at(-1)?.id &&
            this.drag.target.after,
          (el) => el.border(1).border_color(t.accent),
        )
        .child(label)

    const item = (c) => {
      const program = lead(allPanes, c.id)?.program

      const name = /^tb\d+$/.test(c.name)
        ? (program?.name ?? 'Terminal')
        : c.name

      return h_flex()
        .id(`tab-${c.id}`)
        .relative()
        .h(29)
        .px(10)
        .gap(7)
        .rounded(7)
        .items_center()
        .flex_none()
        .text_size(12.8)
        .border(1)
        .border_color(c.active ? t.border : t.chrome)
        .bg(c.active ? t.raised : t.chrome)
        .text_color(c.active ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .when(this.drag?.active && this.drag.id === c.id, (el) =>
          el.opacity(0.35),
        )
        .on_mouse_down('left', (e, cx) => {
          this.beginTabDrag(c, e, cx)
        })
        .on_mouse_move((e, cx) => this.hoverTab(c, e, cx))
        .on_mouse_up('left', (e, cx) => this.finishTabDrag(c, e, cx))
        .on_mouse_down('right', (_e, cx) => {
          cx.stop_propagation()
          this.cancelTabDrag(cx)

          openOverlay({
            mod: 'menu',
            kind: 'popup',
            width: 200,
            props: { tab: 'tab', target: { id: c.id, space: space.id } },
          })
        })
        .when((activeCounts[c.id] ?? 0) > 0, (el) =>
          el.child(
            div()
              .id(`active-terminal-${c.id}`)
              .size(6)
              .flex_none()
              .rounded(3)
              .bg(t.ansi2)
              .tooltip(
                `${activeCounts[c.id]} active terminal${activeCounts[c.id] === 1 ? '' : 's'}`,
              ),
          ),
        )
        .child(programTile(t, program, c.status))
        .child(
          div()
            .max_w(170)
            .truncate()
            .child(c.zoomed ? `${name} Z` : name),
        )
        .when(c.active, (el) =>
          el.child(
            div()
              .id(`close-${c.id}`)
              .text_color(t.dim)
              .on_mouse_down('left', stop)
              .on_mouse_up('left', (_e, cx) => this.cancelTabDrag(cx))
              .on_click((_e, cx) => {
                cx.stop_propagation()
                if (Date.now() < this.ignoreClickUntil) return
                run('tab.close', { id: c.id })
              })
              .child(svg('mods/pane/close.svg').size(12)),
          ),
        )
        .when(this.drag?.active && this.drag.target?.id === c.id, (el) =>
          el.child(
            div()
              .id(`drop-indicator-${c.id}`)
              .absolute()
              .top(2)
              .bottom(2)
              .w(2)
              .rounded(1)
              .bg(t.accent)
              .when(this.drag.target.after, (line) => line.right(-4))
              .when(!this.drag.target.after, (line) => line.left(-4)),
          ),
        )
    }

    const root = layout(),
      sidebar = find(root, 'sidebar'),
      w = window()

    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding =
      w?.platform === 'macos' &&
      w.titlebar === 'none' &&
      !w.fullscreen &&
      root?.traffic_lights
        ? Math.max(
            10,
            (root.traffic_lights[0] + 64) / settings().zoom -
              (sidebar?.hidden ? 0 : (sidebar?.size?.px ?? 0)),
          )
        : 10

    const panel = find(root, 'panel'),
      body = find(root, 'panel-body')

    const enabled = shared('workspace.panels') ?? ['files', 'changes']

    this.syncPanel(space, panel, body, enabled)

    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id

      return h_flex()
        .id(`panel-${id}`)
        .h(26)
        .px(8)
        .gap(5)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down('left', stop)
        .on_mouse_up('left', (_e, cx) => this.cancelTabDrag(cx))
        .on_click(() => {
          if (Date.now() < this.ignoreClickUntil) return
          if (on) run('layout.hide', { id: 'panel' })
          else {
            run('layout.select', { stack: 'panel-body', child: id })
            run('layout.show', { id: 'panel' })
          }
        })
        .child(svg(icon).size(14))
        .child(label)
    }

    return h_flex()
      .size_full()
      .min_w(0)
      .px(10)
      .pl(lightsPadding)
      .gap(3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_move((event, cx) => this.movePointer(event, cx))
      .on_mouse_up('left', (_event, cx) => this.commitTabDrag(null, cx))
      .on_hover((hovered, cx) => {
        if (!hovered) this.cancelTabDrag(cx)
      })
      .on_scroll_wheel((e) => {
        if (Math.abs(e.delta.y) >= 1)
          run(e.delta.y > 0 ? 'tab.prev' : 'tab.next')
      })
      .child(
        h_flex()
          .id('tab-scroll')
          .flex_1()
          .min_w(0)
          .h_full()
          .pl(4)
          .items_center()
          .gap(TAB_GAP)
          .overflow_x_scrollbar()
          .children(shown.map(item)),
      )
      .child(
        button(
          'tab-new',
          '+',
          () =>
            openOverlay({
              mod: 'new-menu',
              kind: 'popup',
              width: 250,
              height: 512,
            }),
          true,
        ),
      )
      .when(enabled.includes('files'), (el) =>
        el.child(panelButton('files', 'Files', 'mods/files/file.svg')),
      )
      .when(enabled.includes('changes'), (el) =>
        el.child(panelButton('changes', 'Changes', 'mods/changes/changes.svg')),
      )
      .when(w?.buttons, (el) =>
        el
          .child(
            button(
              'minimize',
              w.platform === 'windows'
                ? svg('mods/toodope-tabs-active-dot/win-min.svg').size(16)
                : '−',
              () => run('window.minimize'),
            ),
          )
          .child(
            button(
              'maximize',
              w.platform === 'windows'
                ? svg(
                    `mods/toodope-tabs-active-dot/${w.maximized ? 'win-restore' : 'win-max'}.svg`,
                  ).size(16)
                : '□',
              () => run('window.maximize'),
            ),
          )
          .child(
            button(
              'close-window',
              w.platform === 'windows'
                ? svg('mods/toodope-tabs-active-dot/win-close.svg').size(16)
                : svg('mods/pane/close.svg').size(13),
              () => run('window.close'),
            ),
          ),
      )
  }
}
