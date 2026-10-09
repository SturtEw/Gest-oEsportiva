/**
 * Manual harness: proves the derived phone layout fits a 390px viewport.
 *
 * The panel needs an authenticated teacher to open in the app, so the browser cannot
 * exercise it directly. This reproduces react-grid-layout's own positioning maths over
 * the exact layout `packLayout` produces, which is the part that was overflowing.
 *
 * Run: node student-portal/scripts/check-mobile-layout.mjs
 */
import { BREAKPOINT_COLS, packLayout } from '../src/features/teacher/dashboard/layout-derive.ts'

const VIEWPORT = 390
const CONTAINER = VIEWPORT // the shell's content column at phone width
const ROW_HEIGHT = 44

// react-grid-layout: columnWidth = (width - margin*(cols+1)) / cols, and every item's
// left offset is x*(colWidth + margin). Reproducing it here is what lets us assert the
// right edge, not just the grid units.
function positions(entries, cols, margin) {
  const colWidth = (CONTAINER - margin * (cols + 1)) / cols
  return entries.map(({ id, layout }) => {
    const left = margin + layout.x * (colWidth + margin)
    const width = layout.w * colWidth + (layout.w - 1) * margin
    return { id, left, width, right: left + width, height: layout.h * ROW_HEIGHT + (layout.h - 1) * margin }
  })
}

const widgets = [
  { id: 'aulas', kind: 'aulas_hoje', layouts: { lg: { x: 0, y: 0, w: 6, h: 7 } } },
  { id: 'proximas', kind: 'proximas_aulas', layouts: { lg: { x: 6, y: 0, w: 6, h: 7 } } },
  { id: 'atalhos', kind: 'atalhos', layouts: { lg: { x: 0, y: 7, w: 4, h: 4 } } },
]

let failed = false
for (const cols of [BREAKPOINT_COLS.sm, BREAKPOINT_COLS.md, BREAKPOINT_COLS.lg]) {
  const margin = cols === BREAKPOINT_COLS.lg ? 16 : cols === BREAKPOINT_COLS.md ? 12 : 10
  const boxes = positions(packLayout(widgets, cols), cols, margin)
  console.log(`\n${cols} columns (margin ${margin}px):`)
  for (const box of boxes) {
    const overflow = box.right > CONTAINER + 0.5
    if (overflow) failed = true
    console.log(
      `  ${box.id.padEnd(10)} left ${box.left.toFixed(0).padStart(4)}  width ${box.width.toFixed(0).padStart(4)}  right ${box.right.toFixed(0).padStart(4)}  ${overflow ? '<<< OVERFLOWS' : 'ok'}`,
    )
  }
}

console.log(failed ? '\nFAIL: a widget overflows the viewport.' : `\nPASS: every widget fits within ${CONTAINER}px.`)
process.exit(failed ? 1 : 0)
