/**
 * Regression tests for the mobile layout derivation.
 *
 * The bug these lock down: the stored desktop coordinates used to be copied verbatim
 * into the `sm`/`md` grids. A card at `x: 6, w: 6` is valid in a 12-column grid but
 * `x: 6` is outside a 4-column one, so phones rendered cards past the right edge of the
 * screen. `packLayout` repacks instead of copying, and these tests assert the invariant
 * that actually matters: **every card fits inside the grid**.
 */
import { describe, expect, it } from 'vitest'
import { BREAKPOINT_COLS, packLayout } from './layout-derive'
import type { WidgetInstance } from './layout-types'

function widget(id: string, w: number, h: number): WidgetInstance {
  return { id, kind: 'aulas_hoje', layouts: { lg: { x: 0, y: 0, w, h } } }
}

describe('packLayout', () => {
  it('keeps every widget inside the grid at each breakpoint', () => {
    // A realistic panel: the widths a professor would end up with on a wide screen.
    const widgets = [
      widget('a', 6, 7),
      widget('b', 6, 7),
      widget('c', 12, 5),
      widget('d', 4, 4),
      widget('e', 4, 5),
    ]

    for (const cols of Object.values(BREAKPOINT_COLS)) {
      for (const { id, layout } of packLayout(widgets, cols)) {
        expect(layout.w, `${id} width at ${cols} cols`).toBeLessThanOrEqual(cols)
        expect(layout.x, `${id} x at ${cols} cols`).toBeGreaterThanOrEqual(0)
        // The actual overflow condition: the right edge must not pass the last column.
        expect(layout.x + layout.w, `${id} right edge at ${cols} cols`).toBeLessThanOrEqual(cols)
      }
    }
  })

  it('gives a phone-width grid full-width cards for the desktop half-width ones', () => {
    // w:6 of 12 columns is half the desktop; on a 4-column phone it must become the full
    // width rather than staying half (which would be unreadably narrow).
    const packed = packLayout([widget('a', 6, 7), widget('b', 6, 7)], BREAKPOINT_COLS.sm)
    expect(packed.every((entry) => entry.layout.w === BREAKPOINT_COLS.sm)).toBe(true)
  })

  it('preserves the professor order and stacks cards that no longer fit side by side', () => {
    const packed = packLayout([widget('a', 6, 4), widget('b', 6, 4)], BREAKPOINT_COLS.sm)
    expect(packed.map((entry) => entry.id)).toEqual(['a', 'b'])
    // Each takes a full phone row, so the second starts below the first.
    expect(packed[0].layout.y).toBe(0)
    expect(packed[1].layout.y).toBe(packed[0].layout.h)
  })

  it('places two half-width cards side by side when the grid is wide enough', () => {
    const packed = packLayout([widget('a', 6, 4), widget('b', 6, 4)], BREAKPOINT_COLS.lg)
    expect(packed[0].layout).toMatchObject({ x: 0, y: 0, w: 6 })
    expect(packed[1].layout).toMatchObject({ x: 6, y: 0, w: 6 })
  })

  it('never produces a zero-width card, even from a corrupt stored width', () => {
    const packed = packLayout([widget('a', 0, 4), widget('b', -3, 4)], BREAKPOINT_COLS.sm)
    expect(packed.every((entry) => entry.layout.w >= 1)).toBe(true)
  })

  it('clamps a card wider than the grid instead of overflowing it', () => {
    const packed = packLayout([widget('a', 99, 4)], BREAKPOINT_COLS.sm)
    expect(packed[0].layout.w).toBe(BREAKPOINT_COLS.sm)
  })

  it('preserves each widget height so the vertical rhythm of the panel survives', () => {
    const packed = packLayout([widget('a', 6, 7)], BREAKPOINT_COLS.sm)
    expect(packed[0].layout.h).toBe(7)
  })
})
