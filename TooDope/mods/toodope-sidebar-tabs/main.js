import { View, div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { agents, layout, run, setShared, shared, theme } from 'herdr'

function find(node, id) {
  if (node?.id === id) return node

  for (const child of node?.children ?? []) {
    const found = find(child, id)
    if (found) return found
  }

  return null
}

export default class SidebarTabs extends View {
  render() {
    const t = theme()
    const root = layout()
    const sidebar = find(root, 'sidebar')
    const active = find(root, 'sidebar-lists')?.active ?? 'spaces'
    const collapsed = (sidebar?.size?.px ?? Infinity) < 160
    const width = sidebar?.size?.px

    if (!collapsed && width != null && shared('sidebar.width') !== width)
      setShared('sidebar.width', width)
    if (shared('sidebar.collapsed') !== collapsed)
      setShared('sidebar.collapsed', collapsed)

    const expand = () => {
      run('layout.resize', {
        id: 'sidebar',
        px: shared('sidebar.width') ?? 268,
      })
    }

    const tab = (id, label, shortLabel, count = null) =>
      h_flex()
        .id(`sidebar-tab-${id}`)
        .h(28)
        .py(2)
        .flex_none()
        .px(collapsed ? 2 : 10)
        .gap(collapsed ? 0 : 5)
        .items_center()
        .justify_center()
        .rounded(6)
        .cursor_pointer()
        .text_size(11.5)
        .font_medium()
        .text_color(active === id ? t.foreground : t.dim)
        .when(active === id, (el) =>
          el.bg(t.selected).border(1).border_color(t.accent),
        )
        .when(active !== id, (el) =>
          el.hover((s) =>
            s
              .bg(t.input)
              .border(1)
              .border_color(t.accent)
              .text_color(t.foreground),
          ),
        )
        .on_click((_e, cx) => {
          cx.stop_propagation()
          run('layout.select', { stack: 'sidebar-lists', child: id })
        })
        .child(collapsed ? shortLabel : label)
        .when(count !== null && !collapsed, (el) =>
          el.child(
            div()
              .flex_none()
              .px(5)
              .py(1)
              .rounded(4)
              .border(1)
              .border_color(t.ansi5)
              .text_size(10)
              .font_medium()
              .text_color(t.ansi5)
              .child(String(count)),
          ),
        )

    return h_flex()
      .id('toodope-sidebar-tabs')
      .w_full()
      .h(38)
      .flex_none()
      .px(collapsed ? 1 : 8)
      .gap(collapsed ? 2 : 3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(collapsed ? 1 : 3)
          .child(tab('spaces', 'Spaces', 'S'))
          .child(tab('agents', 'Agents', 'A', agents().length)),
      )
      .when(collapsed, (el) =>
        el.child(
          div()
            .id('sidebar-expand')
            .w(14)
            .h(24)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(6)
            .cursor_pointer()
            .text_size(13)
            .text_color(t.dim)
            .hover((s) =>
              s
                .bg(t.input)
                .border(1)
                .border_color(t.accent)
                .text_color(t.foreground),
            )
            .tooltip('Expand sidebar')
            .on_click((_e, cx) => {
              cx.stop_propagation()
              expand()
            })
            .child('»'),
        ),
      )
  }
}
