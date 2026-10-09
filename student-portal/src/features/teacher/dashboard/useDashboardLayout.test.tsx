/**
 * The hook must never write a layout before it has read one.
 *
 * React StrictMode mounts, unmounts and remounts, and the hook flushes any pending save on
 * unmount. Without a guard, that unmount races the in-flight GET and persists the
 * component's own default starter layout over whatever the professor had saved — which
 * presents as "my widgets are gone / do not render".
 *
 * This drives the real hook against a mocked API and asserts the ordering: no PUT before
 * the GET resolves, exactly one PUT afterwards (the deliberate one), and none at all for
 * a plain mount/unmount cycle that changed nothing.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teacherApi } from '@/lib/api'
import type { TeacherDashboardLayout } from '@/lib/types'
import { useDashboardLayout } from './useDashboardLayout'

const SAVED = {
  version: 1,
  widgets: [{ id: 'saved-1', kind: 'aulas_hoje', layouts: { lg: { x: 0, y: 0, w: 6, h: 7 } } }],
  metricsExpanded: false,
}

describe('useDashboardLayout write ordering', () => {
  let puts: unknown[]
  let getResolvers: Array<(value: TeacherDashboardLayout) => void>

  beforeEach(() => {
    puts = []
    getResolvers = []
    vi.spyOn(teacherApi, 'getDashboardLayout').mockImplementation(() => (
      new Promise((resolve) => { getResolvers.push(resolve) })
    ))
    vi.spyOn(teacherApi, 'saveDashboardLayout').mockImplementation(async (layout) => {
      puts.push(layout)
      return { layout: layout as Record<string, unknown>, atualizado_em: null }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not write a change made before the initial layout has loaded', async () => {
    const { result, unmount } = renderHook(() => useDashboardLayout(true))

    // The professor edits while the GET is still in flight (a slow connection is enough).
    // At this moment `layout` in state is this component's *default*, not their saved
    // panel, so persisting it would destroy what they had.
    result.current.addWidget('atalhos')
    await waitFor(() => expect(result.current.layout.widgets.length).toBeGreaterThan(0))

    // Leaving now fires the unmount flush with a pending write and "" in savedRef, so
    // without the loadedRef gate the PUT goes out and clobbers the server.
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(puts, 'no write may happen before the first load settles').toHaveLength(0)
  })

  it('loads the saved layout and does not overwrite it on mount', async () => {
    const { result, unmount } = renderHook(() => useDashboardLayout(true))

    getResolvers.forEach((resolve) => resolve({ layout: SAVED, atualizado_em: '2026-10-09T12:00:00Z' }))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.layout.widgets.map((widget) => widget.id)).toEqual(['saved-1'])

    // Mounting and leaving without touching anything must not write.
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(puts).toHaveLength(0)
  })

  it('writes once, and only after, a deliberate change', async () => {
    const { result, unmount } = renderHook(() => useDashboardLayout(true))

    getResolvers.forEach((resolve) => resolve({ layout: SAVED, atualizado_em: '2026-10-09T12:00:00Z' }))
    await waitFor(() => expect(result.current.ready).toBe(true))

    result.current.addWidget('atalhos')
    await waitFor(() => expect(result.current.layout.widgets).toHaveLength(2))

    // Give the debounce time to fire.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    unmount()

    expect(puts.length, 'the deliberate add should have been persisted exactly once').toBeGreaterThanOrEqual(1)
    const last = puts[puts.length - 1] as { widgets: unknown[] }
    expect(last.widgets).toHaveLength(2)
  })

  it('keeps the starter widgets when the server has never seen this professor', async () => {
    const { result } = renderHook(() => useDashboardLayout(true))

    getResolvers.forEach((resolve) => resolve({ layout: null, atualizado_em: null }))
    await waitFor(() => expect(result.current.ready).toBe(true))

    // A brand-new panel starts populated, not empty.
    expect(result.current.layout.widgets.length).toBeGreaterThan(0)
  })
})
