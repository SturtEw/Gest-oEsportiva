/**
 * Shape of the professor's customizable dashboard layout.
 *
 * The layout is a plain, serialisable object so it can round-trip to the professor's
 * document in Mongo untouched. Two rules keep it honest across releases:
 *
 * 1. `version` is bumped whenever the meaning of a stored field changes, so an old
 *    document can be migrated instead of silently rendering wrong boxes.
 * 2. A widget instance carries only *presentation* (where, how big, which config). All
 *    the data a widget shows is fetched at render time, so a stale layout can never
 *    show a stale number.
 */

/** Inclusive set of widget kinds a professor can place on the panel. */
export type WidgetKind =
  | 'aulas_hoje'
  | 'proximas_aulas'
  | 'modalidades'
  | 'atalhos'
  | 'lembretes'
  | 'turmas'
  | 'alunos'
  | 'atencao'

/** Grid breakpoints. `lg` is the reference layout; the others are derived/kept. */
export type LayoutBreakpoint = 'lg' | 'md' | 'sm'

/** Position and size of one widget, in grid units (react-grid-layout vocabulary). */
export interface WidgetLayout {
  x: number
  y: number
  w: number
  h: number
  /** Below this width (in grid columns) the widget is not shown. 0 = always. */
  minW?: number
  minH?: number
}

/** One placed widget: which catalog entry, and where it sits at each breakpoint. */
export interface WidgetInstance {
  /** Stable id for this placement (a professor may place the same kind twice). */
  id: string
  kind: WidgetKind
  /** Per-breakpoint position. `lg` is required; the others fall back to it. */
  layouts: Partial<Record<LayoutBreakpoint, WidgetLayout>>
  /** Free-form, widget-specific options (kept small and serialisable). */
  config?: Record<string, unknown>
}

export interface DashboardLayoutConfig {
  /** Bump when a stored field's meaning changes; see migrateLayout. */
  version: number
  /** Ordered list of placed widgets. Order is a tiebreaker only — x/y wins. */
  widgets: WidgetInstance[]
  /** Whether the fixed metrics header starts expanded. */
  metricsExpanded?: boolean
}

export const DASHBOARD_LAYOUT_VERSION = 1

export function emptyLayout(): DashboardLayoutConfig {
  return { version: DASHBOARD_LAYOUT_VERSION, widgets: [] }
}
