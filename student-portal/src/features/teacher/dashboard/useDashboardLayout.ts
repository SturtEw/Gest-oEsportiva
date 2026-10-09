/**
 * State + persistence for the professor's customizable panel.
 *
 * The layout is the single source of truth for what is on screen. It is loaded once
 * from the server and every mutation (add, remove, move) goes through the reducer-ish
 * helpers below, so the persisted object can never drift from what is rendered.
 *
 * Saving is debounced and coalesced: dragging a card fires dozens of layout changes,
 * and a request per change would hammer the API and race each other. Only the last
 * layout of a burst is sent, and an in-flight guard keeps two saves from overlapping.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { teacherApi } from '@/lib/api'
import {
  DASHBOARD_LAYOUT_VERSION,
  type DashboardLayoutConfig,
  type WidgetInstance,
  type WidgetKind,
  type WidgetLayout,
} from './layout-types'
import { starterLayout, widgetDefinition } from './widget-catalog'

const SAVE_DEBOUNCE_MS = 800

let instanceCounter = 0
function nextInstanceId(kind: WidgetKind): string {
  instanceCounter += 1
  return `${kind}-${Date.now().toString(36)}-${instanceCounter.toString(36)}`
}

/**
 * A skipped widget from the catalog is `undefined`, not a crash. Unknown kinds are
 * dropped on load instead of rendered as an empty box, so a layout authored against a
 * newer catalog degrades gracefully on an older client.
 */
function sanitize(raw: unknown): DashboardLayoutConfig {
  if (!raw || typeof raw !== 'object') return defaultLayout()
  const candidate = raw as Partial<DashboardLayoutConfig>

  const widgets = Array.isArray(candidate.widgets)
    ? candidate.widgets.filter((widget): widget is WidgetInstance => {
      if (!widget || typeof widget !== 'object') return false
      const instance = widget as Partial<WidgetInstance>
      return typeof instance.id === 'string' && typeof instance.kind === 'string' && Boolean(widgetDefinition(instance.kind as WidgetKind))
    })
    : []

  return {
    version: typeof candidate.version === 'number' ? candidate.version : DASHBOARD_LAYOUT_VERSION,
    widgets: widgets.map((widget) => ({
      id: widget.id,
      kind: widget.kind,
      layouts: widget.layouts && typeof widget.layouts === 'object' ? widget.layouts : {},
      ...(widget.config ? { config: widget.config } : {}),
    })),
    metricsExpanded: Boolean(candidate.metricsExpanded),
  }
}

/** A fresh panel: the four "starter" widgets laid out in two columns. */
function defaultLayout(): DashboardLayoutConfig {
  const widgets: WidgetInstance[] = []
  let cursorY = 0
  for (const kind of starterLayout()) {
    const definition = widgetDefinition(kind)
    if (!definition) continue
    const { w, h } = definition.defaultSize
    const x = widgets.length % 2 === 0 ? 0 : 6
    if (widgets.length % 2 === 0 && widgets.length > 0) cursorY += h
    widgets.push({ id: nextInstanceId(kind), kind, layouts: { lg: { x, y: cursorY, w, h } } })
  }
  return { version: DASHBOARD_LAYOUT_VERSION, widgets, metricsExpanded: false }
}

/** Finds the first free row so a new card lands below everything already placed. */
function nextFreeSlot(widgets: WidgetInstance[], span: number): WidgetLayout {
  const bottom = widgets.reduce((max, widget) => {
    const placed = widget.layouts.lg
    return placed ? Math.max(max, placed.y + placed.h) : max
  }, 0)
  return { x: 0, y: bottom, w: span, h: 4 }
}

export interface DashboardLayoutApi {
  layout: DashboardLayoutConfig
  ready: boolean
  saving: boolean
  error: string | null
  addWidget: (kind: WidgetKind) => void
  removeWidget: (id: string) => void
  /** Persists a drag/resize. Receives the full new arrangement from the grid. */
  moveWidgets: (arrangement: Array<{ id: string; layout: WidgetLayout }>) => void
  setMetricsExpanded: (expanded: boolean) => void
  resetLayout: () => void
}

export function useDashboardLayout(enabled: boolean): DashboardLayoutApi {
  const [layout, setLayout] = useState<DashboardLayoutConfig>(() => defaultLayout())
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The layout that the timer will flush. A ref (not state) because the debounce
  // callback must read the latest value without re-creating the timer each render.
  const pendingRef = useRef<DashboardLayoutConfig | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Marks the last value we know is on the server, so a no-op change (e.g. a re-render
  // that produces the same layout) does not trigger a pointless write.
  const savedRef = useRef<string>('')
  // False until the first GET settles. Guards every write: before it flips, the layout in
  // state is this component's default, not the professor's, and persisting it would
  // destroy their saved panel.
  const loadedRef = useRef(false)

  const flush = useCallback(async () => {
    const payload = pendingRef.current
    if (!payload) return
    // Never write before the first load has come back. React StrictMode mounts, unmounts
    // and remounts in development, so the unmount flush below would otherwise race the
    // in-flight GET and persist this component's default starter layout over whatever the
    // professor had actually saved. `loadedRef` is the gate that makes that impossible.
    if (!loadedRef.current) return
    pendingRef.current = null
    const serialised = JSON.stringify(payload)
    if (serialised === savedRef.current) return
    setSaving(true)
    setError(null)
    try {
      await teacherApi.saveDashboardLayout(payload as unknown as Record<string, unknown>)
      savedRef.current = serialised
    } catch (cause) {
      // Non-fatal: the panel stays usable and the next change retries. Surfacing a
      // toast here would fire on every drag, so the hook reports it instead.
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar seu painel.')
    } finally {
      setSaving(false)
    }
  }, [])

  const schedule = useCallback((next: DashboardLayoutConfig) => {
    setLayout(next)
    pendingRef.current = next
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
  }, [flush])

  // Initial load. A server returning null (never customised) keeps the starter layout.
  useEffect(() => {
    if (!enabled) return
    let active = true
    setReady(false)
    teacherApi.getDashboardLayout()
      .then((result) => {
        if (!active) return
        // The `layout` column is `Record<string, unknown> | null`; sanitize narrows it
        // back into the typed config and drops anything the current catalog lost.
        const parsed = result.layout ? sanitize(result.layout) : defaultLayout()
        const hasWidgets = parsed.widgets.length > 0
        const resolved = hasWidgets ? parsed : defaultLayout()
        setLayout(resolved)
        savedRef.current = result.layout ? JSON.stringify(resolved) : ''
      })
      .catch(() => { if (active) setLayout(defaultLayout()) })
      .finally(() => {
        if (!active) return
        // Only now may anything be written back: from here on the layout in state is the
        // professor's (or a deliberate default), never a placeholder racing the request.
        loadedRef.current = true
        setReady(true)
      })
    return () => { active = false }
  }, [enabled])

  // Flush any pending save when the panel unmounts (navigating away), so a drag made
  // right before leaving is not lost.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    void flush()
  }, [flush])

  const addWidget = useCallback((kind: WidgetKind) => {
    const definition = widgetDefinition(kind)
    if (!definition) return
    setLayout((current) => {
      const slot = nextFreeSlot(current.widgets, definition.defaultSize.w)
      const instance: WidgetInstance = {
        id: nextInstanceId(kind),
        kind,
        layouts: { lg: { ...slot, h: definition.defaultSize.h } },
      }
      const next = { ...current, widgets: [...current.widgets, instance] }
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
      return next
    })
  }, [flush])

  const removeWidget = useCallback((id: string) => {
    setLayout((current) => {
      const next = { ...current, widgets: current.widgets.filter((widget) => widget.id !== id) }
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
      return next
    })
  }, [flush])

  const moveWidgets = useCallback((arrangement: Array<{ id: string; layout: WidgetLayout }>) => {
    setLayout((current) => {
      const byId = new Map(arrangement.map((entry) => [entry.id, entry.layout]))
      const next: DashboardLayoutConfig = {
        ...current,
        widgets: current.widgets.map((widget) => {
          const moved = byId.get(widget.id)
          if (!moved) return widget
          return { ...widget, layouts: { ...widget.layouts, lg: moved } }
        }),
      }
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
      return next
    })
  }, [flush])

  const setMetricsExpanded = useCallback((expanded: boolean) => {
    setLayout((current) => {
      const next = { ...current, metricsExpanded: expanded }
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
      return next
    })
  }, [flush])

  const resetLayout = useCallback(() => {
    schedule(defaultLayout())
  }, [schedule])

  return useMemo(
    () => ({ layout, ready, saving, error, addWidget, removeWidget, moveWidgets, setMetricsExpanded, resetLayout }),
    [layout, ready, saving, error, addWidget, removeWidget, moveWidgets, setMetricsExpanded, resetLayout],
  )
}
