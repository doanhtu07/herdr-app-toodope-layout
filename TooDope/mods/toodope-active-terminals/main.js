import { View, div, svg } from 'gpui-kit'
import {
  h_flex,
  v_flex,
  Scrollbar,
  VirtualListScrollHandle,
  v_virtual_list,
} from 'gpui-base'
import { spaces, run, theme, props, closeOverlay, shared } from 'herdr'

export default class ActiveTerminals extends View {
  init(_props, cx) {
    this.at = 0
    this.scroll = VirtualListScrollHandle.new()
    this.handle = cx.focus_handle()
    this.handle.focus()
  }

  choose(space, terminal) {
    closeOverlay(props()?.overlay)
    if (!space || !terminal) return

    if (!space.active) run('space.select', { id: space.id })
    if (terminal.tab) run('tab.select', { id: terminal.tab })
    if (terminal.pane) run('pane.focus', { pane: terminal.pane })
  }

  render() {
    const t = theme()
    const current = new Map(spaces().map((space) => [space.id, space]))
    const active = shared('space.activeTerminals') ?? {}
    const groups =
      props()?.groups ??
      Object.entries(active)
        .filter(([, terminals]) => Array.isArray(terminals) && terminals.length)
        .map(([id, terminals]) => ({
          space: current.get(id) ?? { id, name: id },
          terminals,
        }))
    const entries = groups.flatMap(({ space, terminals }) =>
      terminals.map((terminal) => ({ space, terminal })),
    )
    this.at = Math.max(0, Math.min(this.at, entries.length - 1))
    const rows = []
    const entryRows = []

    for (const { space, terminals } of groups) {
      rows.push({
        type: 'space',
        key: `space-${space.id}`,
        size: 34,
        space,
        count: terminals.length,
      })

      for (const terminal of terminals) {
        entryRows.push(rows.length)
        rows.push({
          type: 'terminal',
          key: `terminal-${space.id}-${terminal.terminal}`,
          size: 56,
          space,
          terminal,
          entryIndex: entryRows.length - 1,
        })
      }
    }

    const listHeight = Math.min(
      420,
      rows.reduce((total, row) => total + row.size, 0),
    )
    const renderRow = (row) => {
      if (row.type === 'space')
        return h_flex()
          .id(row.key)
          .h(29)
          .flex_none()
          .items_center()
          .gap(7)
          .child(
            div()
              .text_size(12)
              .font_semibold()
              .text_color(t.foreground)
              .child(row.space.name),
          )
          .child(
            div()
              .text_size(10.5)
              .text_color(t.dim)
              .child(`${row.count} active`),
          )
          .when(Boolean(row.space.machine), (el) =>
            el.child(
              div()
                .text_size(10.5)
                .text_color(t.dim)
                .child(`· ${row.space.machine}`),
            ),
          )

      const { space, terminal, entryIndex } = row
      const selected = entryIndex === this.at
      const tabIndex =
        space.tabs?.findIndex((item) => item.id === terminal.tab) ?? -1
      const tab = tabIndex >= 0 ? space.tabs[tabIndex] : undefined
      const tabLabel =
        tab?.name || (tabIndex >= 0 ? `Tab ${tabIndex + 1}` : 'Tab')

      return h_flex()
        .id(row.key)
        .h(48)
        .flex_none()
        .px(10)
        .gap(10)
        .items_center()
        .rounded(8)
        .cursor_pointer()
        .border_1()
        .border_color(selected ? t.accent : t.background)
        .bg(selected ? t.selected : t.background)
        .hover((s) => s.bg(t.hover))
        .child(
          svg('mods/workspace-chrome/terminal.svg')
            .size(14)
            .flex_none()
            .text_color(t.ansi2),
        )
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_size(12.5)
            .font_medium()
            .text_color(t.foreground)
            .child(tabLabel),
        )
    }

    return v_flex()
      .id('active-terminals')
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') closeOverlay(props()?.overlay)
        else if (e.key === 'enter')
          this.choose(entries[this.at]?.space, entries[this.at]?.terminal)
        else if (entries.length && e.key === 'down') {
          this.at = (this.at + 1) % entries.length
          this.scroll.scroll_to_item(entryRows[this.at], 'center')
        } else if (entries.length && e.key === 'up') {
          this.at = (this.at + entries.length - 1) % entries.length
          this.scroll.scroll_to_item(entryRows[this.at], 'center')
        } else if (entries.length && e.key === 'home') {
          this.at = 0
          this.scroll.scroll_to_item(entryRows[this.at], 'center')
        } else if (entries.length && e.key === 'end') {
          this.at = entries.length - 1
          this.scroll.scroll_to_item(entryRows[this.at], 'center')
        } else return

        cx.stop_propagation()
        cx.notify()
      })
      .child(
        h_flex()
          .min_h(42)
          .flex_none()
          .gap(12)
          .items_center()
          .child(
            div()
              .size(34)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(9)
              .bg(t.raised)
              .text_color(t.accent)
              .child(svg('mods/workspace-chrome/terminal.svg').size(17)),
          )
          .child(
            v_flex()
              .flex_1()
              .gap(3)
              .child(
                div()
                  .text_size(16)
                  .font_semibold()
                  .text_color(t.foreground)
                  .child('Active terminals'),
              )
              .child(
                div()
                  .text_size(11.5)
                  .text_color(t.dim)
                  .child('Grouped by space · select a terminal to jump to it'),
              ),
          )
          .child(
            div()
              .id('active-terminals-close')
              .size(28)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(7)
              .text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => closeOverlay(props()?.overlay))
              .child(svg('mods/workspace-chrome/x.svg').size(13)),
          ),
      )
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        groups.length
          ? div()
              .id('active-terminals-list')
              .relative()
              .h(listHeight)
              .flex_none()
              .pb(8)
              .child(
                v_virtual_list(
                  'active-terminal-rows',
                  rows.length,
                  rows.map((row) => row.size),
                  (index) => rows[index].key,
                  (range) => rows.slice(range.start, range.end).map(renderRow),
                )
                  .track_scroll(this.scroll)
                  .on_item_click((key, cx) => {
                    const row = rows.find((item) => item.key === key)
                    if (row?.type !== 'terminal') return

                    cx.stop_propagation()
                    this.at = row.entryIndex
                    this.choose(row.space, row.terminal)
                  }),
              )
              .child(
                Scrollbar.vertical('active-terminal-rows').absolute().inset_0(),
              )
          : div()
              .py(20)
              .text_center()
              .text_color(t.dim)
              .child('No active terminals'),
      )
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        h_flex()
          .gap(16)
          .items_center()
          .text_size(11)
          .text_color(t.dim)
          .children([
            this.keycap(t, '↑ ↓', 'Navigate'),
            this.keycap(t, 'Enter', 'Open terminal'),
            this.keycap(t, 'Esc', 'Close'),
          ]),
      )
  }

  keycap(t, key, label) {
    return h_flex()
      .gap(6)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .child(
        div()
          .px(6)
          .py(3)
          .rounded(5)
          .border_1()
          .border_color(t.border)
          .bg(t.raised)
          .text_color(t.muted)
          .child(key),
      )
      .child(label)
  }
}
