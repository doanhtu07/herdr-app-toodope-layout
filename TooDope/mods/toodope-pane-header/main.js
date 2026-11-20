import { View, div, svg, image } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { panes, props, run, theme, home, spaces, notify } from 'herdr'

function icon(p, size, color) {
  if (!p?.icon) return null

  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none()
}

function folder(cwd) {
  if (!cwd) return ''

  const h = home()
  return cwd === h
    ? '~'
    : cwd.startsWith(h + '/')
      ? '~' + cwd.slice(h.length)
      : cwd
}

function agentInstructions(address, pane, space, tab, cwd) {
  const context = [
    `pane ${pane}`,
    space?.name && `space "${space.name}"`,
    tab?.name && `tab "${tab.name}"`,
    cwd && `directory ${cwd}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return [
    `This session runs in a herdr-core terminal. Your hc address is \`${address}\` (\`$HC_TERMINAL_ID\`); helpers report back with \`hc send ${address} ...\`. The Herdr app shows it as a pane, and terminals you start with \`hc run\` appear under you in its sidebar, where the user can peek at them.`,
    '',
    `You are in ${context}.`,
    '',
    'Before your first `hc` command this session, load the /hc skill (it has you read `hc --skill`, the manual for this version). Preferences:',
    '',
    '- Delegate work to helper agents in hc terminals (`hc run --bg --name <name> --cwd <dir> claude "<task>"`), not built-in subagents, so the user can watch and steer them. Use a folder the helper already trusts (the repo, or your own cwd) so it does not stall on the trust prompt. Keep built-in subagents for quick lookups.',
    "- Run dev servers, watchers and other long-running processes with `hc run --bg --name <name> --cwd <repo> -- <command>`, never your shell tool's background mode, so the user can see them.",
    '- Run slow builds, test suites and CI watches the same way and wait with `hc wait`, not sleep or polling.',
    '- Name each terminal after what it runs. Leave dev servers running; remove finished one-off terminals once you have their result. Clean up only terminals you started.',
    '- For the Herdr window itself (layouts, keys, mods), read `herdr-app --skill`.',
  ].join('\n')
}

export default class PaneHeader extends View {
  init() {
    this.hovered = false
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane)
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) =>
        s.bg(t.input).border(1).border_color(t.accent).text_color(t.foreground),
      )
      .on_click((_e, cx) => {
        cx.stop_propagation()
        run(command, args)
      })
      .child(svg(`mods/pane/${icon}.svg`).size(14))
  }

  copyButton(t, id, icon, label, onClick) {
    return div()
      .id(id)
      .flex_none()
      .w(20)
      .h(20)
      .flex()
      .items_center()
      .justify_center()
      .rounded(5)
      .text_color(t.dim)
      .tooltip(label)
      .cursor_pointer()
      .hover((s) =>
        s.bg(t.input).border(1).border_color(t.accent).text_color(t.foreground),
      )
      .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation()
        onClick(cx)
      })
      .child(svg(`mods/toodope-pane-header/${icon}.svg`).size(12))
  }

  render() {
    const t = theme()
    const p = this.me()
    if (!p) return div()

    const name =
      ((p.program?.agent || p.program?.shell) && p.program.name) ||
      p.title ||
      p.program?.name ||
      'shell'
    const pic = icon(p.program, 14, t.dim)
    const st = p.status
    const pane = p.pane
    const terminal = p.terminal
    const identifier = terminal ?? pane
    const space = spaces().find((s) => s.tabs?.some((tab) => tab.id === p.tab))
    const tab = space?.tabs?.find((item) => item.id === p.tab)
    const details = [
      ['Terminal ID', terminal],
      ['Pane ID', pane],
      ['Tab ID', p.tab],
      ['Tab', tab?.name],
      ['Space ID', space?.id],
      ['Space', space?.name],
      ['Program', p.program?.name],
      ['App', p.app],
      ['Directory', p.cwd],
      ['Branch', p.branch],
      ['Status', p.status],
    ]
      .filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      )
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n')
    const identifierHint = terminal
      ? `Terminal ID: ${terminal}\nPane ID: ${pane}\nClick to copy all details`
      : `Pane ID: ${pane}\nClick to copy all details`

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => {
        this.hovered = hovered
        cx.notify()
      })
      .on_click(() => run('pane.focus', { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(
        div()
          .flex_none()
          .truncate()
          .max_w(260)
          .font_medium()
          .text_color(t.foreground)
          .child(name),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(t.dim)
          .child(folder(p.cwd)),
      )
      .when(st === 'working', (el) =>
        el.child(
          svg('mods/workspace-chrome/spinner.svg')
            .size(12)
            .flex_none()
            .text_color(t.working)
            .spin(900),
        ),
      )
      .when(st === 'blocked', (el) =>
        el.child(
          div()
            .flex_none()
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .rounded(5)
            .bg(t.blocked + '26')
            .text_size(10.5)
            .font_semibold()
            .text_color(t.blocked)
            .child('Needs you'),
        ),
      )
      .when(st === 'done', (el) =>
        el.child(div().size(7).flex_none().rounded(4).bg(t.done)),
      )
      .when(this.hovered, (el) =>
        el
          .child(
            this.button(t, `ph-r-${pane}`, 'split-right', 'pane.split', {
              direction: 'right',
              pane,
            }),
          )
          .child(
            this.button(t, `ph-d-${pane}`, 'split-down', 'pane.split', {
              direction: 'down',
              pane,
            }),
          )
          .child(
            this.button(
              t,
              `ph-z-${pane}`,
              p.zoomed ? 'unzoom' : 'zoom',
              'pane.zoom',
              {
                pane,
              },
            ),
          )
          .child(
            this.button(t, `ph-x-${pane}`, 'close', 'pane.close', { pane }),
          ),
      )
      .when(Boolean(terminal), (el) =>
        el.child(
          this.copyButton(
            t,
            `ph-instr-${pane}`,
            'agent-prompt',
            'Copy agent instructions',
            (cx) => {
              cx.write_to_clipboard(
                agentInstructions(terminal, pane, space, tab, p.cwd),
              )
              notify({
                title: 'Copied agent instructions',
                body: identifier,
                level: 'success',
              })
            },
          ),
        ),
      )
      .child(
        div()
          .id(`pane-id-${pane}`)
          .flex_none()
          .px(6)
          .h(20)
          .flex()
          .items_center()
          .rounded(5)
          .bg(t.selected)
          .text_size(10.5)
          .font_semibold()
          .text_color(t.foreground)
          .tooltip(identifierHint)
          .cursor_pointer()
          .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation()
            cx.write_to_clipboard(details)
            notify({
              title: 'Copied pane details',
              body: identifier,
              level: 'success',
            })
          })
          .child(identifier),
      )
  }
}
