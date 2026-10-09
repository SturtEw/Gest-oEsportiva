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

export const BREAKPOINT_COLS: Record<LayoutBreakpoint, number> = { lg: 12, md: 8, sm: 4 }

/** Grid gutter and inset per breakpoint. Consumed by the grid itself. */
export const BREAKPOINT_MARGIN: Record<LayoutBreakpoint, number> = { lg: 16, md: 12, sm: 10 }

/**
 * The inset the metrics tiles above the grid sit on (`MetricsHeaderPanel`'s `p-4`).
 * Whatever the grid does, a card in column 0 must start here so the two columns line up.
 */
export const CONTENT_INSET = 16

/**
 * react-grid-layout computes a column as
 *   colWidth = (width - margin*(cols-1) - containerPadding*2) / cols
 * so `containerPadding` is the only knob that insets the grid *and* narrows its columns.
 * `margin` does not: it is added inside the column maths and partly cancelled by the
 * `x*(colWidth + margin)` positioning term, so raising the margin alone leaves a
 * full-width card spanning the whole container.
 *
 * That is why this returns the full content inset rather than `inset - margin`: with it,
 * a card in column 0 starts on the tiles' `p-4` line *and* a full-width card ends on the
 * opposite one, so the two columns above and below the fold agree.
 *
 * The consequence to remember: `containerPadding` and `margin` are independent, and only
 * this one insets the grid. Setting it to 0 (the first version) made every widget 16px
 * wider and further left than the metrics row, at every breakpoint — not only on phones.
 */
export function containerPaddingFor(_breakpoint: LayoutBreakpoint): number {
  return CONTENT_INSET
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
