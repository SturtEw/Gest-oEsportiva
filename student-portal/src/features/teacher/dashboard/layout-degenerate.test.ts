/**
 * A widget saved without an `lg` entry — the shape a document can be left in if an earlier
 * build wrote only `sm`/`md`, or if a save raced and persisted a partial object.
 *
 * Both `gridLayouts` (for lg) and `packLayout` (for md/sm) read `layouts.lg`, so a widget
 * with no `lg` is the one shape that can render in a broken cell.
 */
import { describe, expect, it } from 'vitest'
import { BREAKPOINT_COLS, packLayout } from './layout-derive'
import type { WidgetInstance } from './layout-types'

describe('widgets saved without an lg entry', () => {
  it('still gets a usable cell at every breakpoint', () => {
    const broken: WidgetInstance[] = [
      { id: 'only-sm', kind: 'aulas_hoje', layouts: { sm: { x: 0, y: 0, w: 1, h: 7 } } },
      { id: 'no-layouts', kind: 'atalhos', layouts: {} },
    ]

    for (const bp of ['sm', 'md'] as const) {
      const packed = packLayout(broken, BREAKPOINT_COLS[bp])
      for (const entry of packed) {
        expect(entry.layout.w, `${entry.id} width at ${bp}`).toBeGreaterThan(0)
        expect(entry.layout.h, `${entry.id} height at ${bp}`).toBeGreaterThan(0)
        expect(entry.layout.x + entry.layout.w, `${entry.id} right edge at ${bp}`).toBeLessThanOrEqual(BREAKPOINT_COLS[bp])
      }
    }
  })

  it('falls back to a full-width card when the widget has no lg at all', () => {
    const packed = packLayout([{ id: 'no-layouts', kind: 'atalhos', layouts: {} }], BREAKPOINT_COLS.md)
    // A widget with nothing stored must still claim a real cell, not a zero-width one.
    expect(packed[0].layout.w).toBeGreaterThan(0)
    expect(packed[0].layout.h).toBeGreaterThan(0)
  })
})
