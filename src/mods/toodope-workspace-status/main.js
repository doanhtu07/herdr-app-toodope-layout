import { View, div, svg } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { spaces, agents, shared, theme, run, window, keys } from 'herdr'

export default class WorkspaceStatus extends View {
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
              .gap(6)
              .items_center()
              .tooltip(
                'Terminals with a foreground process; idle shells and non-working agents are excluded',
              )
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
      .child(
        div()
          .id('palette')
          .text_color(t.dim)
          .on_click(() => run('app.palette'))
          .child(this.hint(t)),
      )
  }
}
