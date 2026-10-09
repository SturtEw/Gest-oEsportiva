/**
 * Layout derivation for the narrower breakpoints.
 *
 * The professor arranges the panel once, on the desktop, and that arrangement is stored
 * as `lg`. Copying those coordinates down to `md`/`sm` does not work: a card at `x: 6`
 * with `w: 6` is a valid half-width card in a 12-column grid, but in the 4-column phone
 * grid `x: 6` is *outside* the grid entirely — which is exactly how cards end up
 * rendered past the right edge of the screen.
 *
 * So `md`/`sm` are *derived* by repacking: every widget is re-laid-out into the narrower
 * column count in the professor's original order, clamping each width to what fits. The
 * stored `lg` is never modified, so the desktop arrangement is preserved exactly.
 */
import type { LayoutBreakpoint, WidgetInstance, WidgetLayout } from './layout-types'

export const BREAKPOINT_COLS: Record<LayoutBreakpoint, number> = { lg: 12, md: 8, sm: 1 }

/**
 * Grid gutter per breakpoint (horizontal and vertical).
 *
 * `sm` is 0 horizontally because the phone grid is a single full-width column: there is
 * no neighbour to leave a gutter for, and any margin would only make every card narrower
 * than the tiles above it. The vertical gap on phones comes from `space-y` spacing on the
 * stack instead.
 */
export const BREAKPOINT_MARGIN_X: Record<LayoutBreakpoint, number> = { lg: 16, md: 12, sm: 0 }
export const BREAKPOINT_MARGIN_Y: Record<LayoutBreakpoint, number> = { lg: 16, md: 12, sm: 12 }

/**
 * The inset the metrics tiles above the grid sit on (`MetricsHeaderPanel`'s `p-4`).
 * Whatever the grid does, a card in column 0 must start here so the two columns line up.
 */
export const CONTENT_INSET = 16

/**
 * react-grid-layout computes a column as
 *   colWidth = (width - margin*(cols-1) - containerPadding*2) / cols
 * and places column 0 at `containerPadding + margin`. So the leading edge of a card is
 * `containerPadding + margin`, and the trailing edge of a full-width card is that plus
 * `colWidth*cols`, i.e. the container width less `containerPadding`. Both agree with the
 * tiles' `p-4` inset only when `containerPadding + margin` equals `CONTENT_INSET`... *and*
 * `containerPadding` equals it too, since the two edges are not symmetric.
 *
 * Hence `containerPadding = CONTENT_INSET - margin(x)`: it makes the leading edge land on
 * the tiles' line, and because the trailing edge is measured from `containerPadding`
 * alone, a full-width card ends on the opposite one.
 *
 * Setting this to 0 (an earlier version) made every widget sit 16px left of and 32px
 * wider than the metrics row, at every breakpoint — the size mismatch the professor saw.
 */
export function containerPaddingFor(breakpoint: LayoutBreakpoint): number {
  return Math.max(0, CONTENT_INSET - BREAKPOINT_MARGIN_X[breakpoint])
}

/**
 * The width react-grid-layout gives a full-width card, given the measured container.
 * Mirrors the library's own maths so a test can assert it fits rather than eyeballing it.
 */
export function fullWidthCardWidth(containerWidth: number, cols: number, margin: number, containerPadding: number): number {
  const colWidth = (containerWidth - margin * (cols - 1) - containerPadding * 2) / cols
  return colWidth * cols + (cols - 1) * margin
}

/**
 * Repacks a list of widgets into `cols` columns.
 *
 * Widths shrink proportionally to the narrower grid and never drop below 1 column, so a
 * 6-wide card lands 4-wide on a 4-column phone (full width) rather than overflowing.
 * Widgets are placed left-to-right and wrap to a new row, which is the predictable thing
 * to do with an arrangement the professor only ever made on a wide screen.
 */
export function packLayout(widgets: WidgetInstance[], cols: number): Array<{ id: string; layout: WidgetLayout }> {
  const packed: Array<{ id: string; layout: WidgetLayout }> = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const widget of widgets) {
    const source = widget.layouts.lg ?? widget.layouts.md ?? { x: 0, y: 0, w: cols, h: 4 }

    // Never wider than the grid; never narrower than one usable column.
    const width = Math.max(1, Math.min(cols, Math.round(source.w)))
    const height = source.h

    // Wrap when this card would not fit on the current row.
    if (cursorX + width > cols) {
      cursorX = 0
      cursorY += rowHeight
      rowHeight = 0
    }

    packed.push({ id: widget.id, layout: { x: cursorX, y: cursorY, w: width, h: height } })

    cursorX += width
    rowHeight = Math.max(rowHeight, height)
  }

  return packed
}
