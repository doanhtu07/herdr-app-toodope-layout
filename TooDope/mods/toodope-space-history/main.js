import { View, div, svg } from 'gpui-kit'
import {
  h_flex,
  v_flex,
  Scrollbar,
  VirtualListScrollHandle,
  v_virtual_list,
} from 'gpui-base'
import { spaces, run, theme, props, closeOverlay, shared } from 'herdr'

const MARK = {
  ansi6: '#22a99a',
  ansi3: '#e3814f',
  ansi4: '#5b8def',
  ansi5: '#8b7cf6',
  ansi2: '#3fae6a',
  ansi1: '#d9649a',
}

function spaceColor(t, space) {
  const color = (shared('space.colors') ?? {})[space.id] ?? 'ansi6'
  return color.startsWith('#') ? color : (MARK[color] ?? t[color] ?? t.accent)
}

export default class SpaceHistory extends View {
  init(_props, cx) {
    const ids = props()?.spaceIds ?? shared('space.navigation')?.recent ?? []
    const active = spaces().find((space) => space.active)?.id
    this.at = Math.max(0, ids.indexOf(active))
    this.scroll = VirtualListScrollHandle.new()
    if (ids.length) this.scroll.scroll_to_item(this.at, 'center')
    this.handle = cx.focus_handle()
    this.handle.focus()
  }

  choose(space) {
    if (!space) return
    closeOverlay(props()?.overlay)
    if (!space.active) run('space.select', { id: space.id })
  }

  render() {
    const t = theme()
    const current = spaces()
    const byId = new Map(current.map((space) => [space.id, space]))
    const ids = [
      ...new Set(props()?.spaceIds ?? shared('space.navigation')?.recent ?? []),
    ]
    const recent = ids.map((id) => byId.get(id)).filter(Boolean)
    this.at = Math.max(0, Math.min(this.at, recent.length - 1))
    const listHeight = Math.min(420, recent.length * 53)

    const keycap = (key, label) =>
      h_flex()
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

    return v_flex()
      .id('space-history')
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') closeOverlay(props()?.overlay)
        else if (e.key === 'enter') this.choose(recent[this.at])
        else if (recent.length && e.key === 'down') {
          this.at = (this.at + 1) % recent.length
          this.scroll.scroll_to_item(this.at, 'center')
        } else if (recent.length && e.key === 'up') {
          this.at = (this.at + recent.length - 1) % recent.length
          this.scroll.scroll_to_item(this.at, 'center')
        } else if (recent.length && e.key === 'home') {
          this.at = 0
          this.scroll.scroll_to_item(this.at, 'center')
        } else if (recent.length && e.key === 'end') {
          this.at = recent.length - 1
          this.scroll.scroll_to_item(this.at, 'center')
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
              .child(svg('mods/workspace-chrome/clock.svg').size(17)),
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
                  .child('Recent spaces'),
              )
              .child(
                div()
                  .text_size(11.5)
                  .text_color(t.dim)
                  .child('Pick up where you left off'),
              ),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(
                div()
                  .px(7)
                  .py(4)
                  .rounded(5)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.raised)
                  .text_size(10.5)
                  .text_color(t.dim)
                  .child('Esc'),
              )
              .child(
                div()
                  .id('space-history-close')
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
          ),
      )
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        recent.length
          ? div()
              .relative()
              .h(listHeight)
              .flex_none()
              .child(
                v_virtual_list(
                  'space-history-list',
                  recent.length,
                  53,
                  (index) => recent[index].id,
                  (range) =>
                    recent
                      .slice(range.start, range.end)
                      .map((space, offset) => {
                        const index = range.start + offset
                        const detail = [space.branch, space.machine]
                          .filter(Boolean)
                          .join(' · ')
                        const selected = index === this.at
                        const color = spaceColor(t, space)

                        return h_flex()
                          .id(`space-history-${space.id}`)
                          .h(48)
                          .flex_none()
                          .px(10)
                          .gap(11)
                          .items_center()
                          .rounded(9)
                          .cursor_pointer()
                          .border_1()
                          .border_color(selected ? t.accent : t.border)
                          .bg(selected ? t.selected : t.background)
                          .hover((s) => s.bg(t.hover))
                          .child(
                            div()
                              .size(27)
                              .flex_none()
                              .flex()
                              .items_center()
                              .justify_center()
                              .rounded(7)
                              .bg(color)
                              .text_size(12)
                              .font_bold()
                              .text_color('#ffffff')
                              .child([...space.name][0]?.toUpperCase() ?? '?'),
                          )
                          .child(
                            v_flex()
                              .flex_1()
                              .min_w(0)
                              .gap(3)
                              .child(
                                div()
                                  .truncate()
                                  .text_size(12.8)
                                  .font_medium()
                                  .text_color(t.foreground)
                                  .child(space.name),
                              )
                              .when(Boolean(detail), (el) =>
                                el.child(
                                  div()
                                    .truncate()
                                    .text_size(11)
                                    .text_color(t.dim)
                                    .child(detail),
                                ),
                              ),
                          )
                          .child(
                            h_flex()
                              .gap(5)
                              .items_center()
                              .when(Boolean(space.status), (el) =>
                                el.child(
                                  div()
                                    .size(7)
                                    .rounded(4)
                                    .bg(t[space.status] ?? t.dim),
                                ),
                              )
                              .when(space.active, (el) =>
                                el.child(
                                  div()
                                    .px(7)
                                    .py(3)
                                    .rounded(5)
                                    .bg(t.raised)
                                    .text_size(9.5)
                                    .font_semibold()
                                    .text_color(t.accent)
                                    .child('CURRENT'),
                                ),
                              ),
                          )
                      }),
                )
                  .track_scroll(this.scroll)
                  .on_item_click((id, cx) => {
                    const space = byId.get(id)
                    if (!space) return
                    cx.stop_propagation()
                    this.choose(space)
                  }),
              )
              .child(
                Scrollbar.vertical('space-history-list').absolute().inset_0(),
              )
          : div()
              .py(20)
              .rounded(9)
              .bg(t.background)
              .text_color(t.dim)
              .text_center()
              .child('No recent spaces yet'),
      )
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        h_flex()
          .gap(16)
          .items_center()
          .text_size(11)
          .children([
            keycap('↑ ↓', 'Navigate'),
            keycap('Enter', 'Open space'),
            keycap('Esc', 'Close'),
          ]),
      )
  }
}
