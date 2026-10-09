/**
 * Customizable teacher panel — a fixed metrics header over a grid of movable widgets.
 *
 * The two halves are deliberately different:
 *
 *   - The metrics header is FIXED. Alunos / aulas hoje / frequência / ocupação are the
 *     shared vocabulary of the product; a panel that could drop them would stop being
 *     comparable between teachers. It is *collapsible* instead (see MetricsHeaderPanel).
 *   - Everything below is the professor's. It starts as a deliberately bare panel —
 *     Aulas de hoje, Próximas aulas, Atalhos — and grows as they add widgets. "Cru"
 *     first, richer on demand, which is the whole point of the feature.
 *
 * Edit mode is a single boolean that changes three things: cards become draggable and
 * resizable, each card grows a remove button, and the "Componentes disponíveis" drawer
 * becomes reachable. Outside edit mode the grid is static, so a stray drag can never
 * rearrange someone's panel by accident.
 */
import { useCallback, useMemo, useState } from 'react'
// v2 of react-grid-layout dropped the WidthProvider HOC in favour of a hook that
// observes the container with a ResizeObserver; the grid no longer measures itself.
import { Responsive as ResponsiveGridLayout, useContainerWidth, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Check, CalendarDays, LayoutGrid, Plus, RotateCcw, Settings2, TrendingUp, UserCheck, Users, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from 'cn'
import type { TeacherOverview } from '@/lib/types'
import type { WidgetInstance, WidgetKind, WidgetLayout } from './layout-types'
import { BREAKPOINT_COLS, packLayout } from './layout-derive'
import { MetricsHeaderPanel } from './MetricsHeaderPanel'
import type { KpiTile } from './KpiCard'
import { useDashboardLayout } from './useDashboardLayout'
import { WIDGET_CATALOG, widgetDefinition } from './widget-catalog'
import { renderWidgetBody } from './widgets/WidgetRenderer'
import { WidgetShell } from './widgets/WidgetShell'

/**
 * Breakpoints are the pixel widths at which the grid switches column count. The counts
 * themselves live in BREAKPOINT_COLS (`layout-derive`) so the grid and the derivation
 * that feeds it can never disagree.
 */
const BREAKPOINTS = { lg: 1024, md: 768, sm: 0 }
const ROW_HEIGHT = 44
// Gaps eat a phone's width disproportionately: 16px gutters on a 360px screen is nearly
// a tenth of the row. The narrow breakpoints get tighter margins for that reason.
const MARGIN = { lg: [16, 16] as const, md: [12, 12] as const, sm: [10, 10] as const }
const CONTAINER_PADDING = { lg: [0, 0] as const, md: [0, 0] as const, sm: [0, 0] as const }

export function CustomizableDashboard({
  overview,
  loading,
  onOpenStudent,
  onSchedule,
  onNavigate,
}: {
  overview: TeacherOverview | null
  loading: boolean
  onOpenStudent?: (id: string) => void
  /** Opens the "agendar aula" dialog, owned by the parent. */
  onSchedule: () => void
  /** Routes the Atalhos/Lembretes widgets to another section. */
  onNavigate?: (view: string) => void
}) {
  const dashboard = useDashboardLayout(true)
  const { layout } = dashboard
  const [editing, setEditing] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { width, containerRef, mounted } = useContainerWidth()

  const kpis = useMemo<KpiTile[]>(() => buildKpis(overview), [overview])

  /**
   * The grid needs one entry per breakpoint. `lg` is the professor's own arrangement;
   * `md`/`sm` are repacked from it with `packLayout` rather than copied verbatim,
   * because the desktop coordinates do not fit the narrower column counts (a card at
   * x:6 overflows a 4-column phone grid and renders past the right edge of the screen).
   */
  const gridLayouts = useMemo(() => {
    const toGrid = (entries: Array<{ id: string; layout: WidgetLayout }>): Layout =>
      entries.map(({ id, layout }) => ({ i: id, x: layout.x, y: layout.y, w: layout.w, h: layout.h }))

    // lg keeps its stored coordinates exactly, so the desktop layout is untouched.
    const desktop: Array<{ id: string; layout: WidgetLayout }> = layout.widgets.map((widget) => ({
      id: widget.id,
      layout: widget.layouts.lg ?? { x: 0, y: 0, w: BREAKPOINT_COLS.lg, h: 4 },
    }))

    return {
      lg: toGrid(desktop),
      md: toGrid(packLayout(layout.widgets, BREAKPOINT_COLS.md)),
      sm: toGrid(packLayout(layout.widgets, BREAKPOINT_COLS.sm)),
    }
    // `layout.widgets` identity changes on every mutation, which is exactly when the
    // grid must be rebuilt.
  }, [layout.widgets])

  const handleLayoutChange = useCallback((_current: Layout, all: Partial<Record<string, Layout>>) => {
    // The grid fires this once on mount too, and compacting can nudge positions on a
    // plain page view. Persisting only while editing keeps a read from rewriting the
    // professor's saved arrangement.
    if (!editing) return
    // Only the desktop arrangement is persisted as the master: moving a card on a phone
    // must not rewrite the desktop layout the professor arranged at home.
    const master = all.lg ?? []
    dashboard.moveWidgets(master.map((item) => ({
      id: item.i,
      layout: { x: item.x, y: item.y, w: item.w, h: item.h },
    })))
  }, [dashboard, editing])

  const activeKinds = useMemo(() => new Set(layout.widgets.map((widget) => widget.kind)), [layout.widgets])

  if (loading && !overview) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-14 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      <MetricsHeaderPanel
        tiles={kpis}
        expanded={Boolean(layout.metricsExpanded)}
        onToggle={dashboard.setMetricsExpanded}
        busy={overview ? overview.kpis.aulas_hoje > 0 ? `${overview.kpis.aulas_hoje} aula(s) hoje` : 'Sem aulas hoje' : null}
      />

      {dashboard.error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            {dashboard.error}
            <Button variant="outline" size="sm" onClick={() => dashboard.resetLayout()}>
              <RotateCcw className="size-4" />
              Restaurar padrão
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-extrabold">Meu painel</h2>
          {dashboard.saving ? <span className="text-xs text-muted-foreground">Salvando…</span> : null}
        </div>

        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDrawerOpen(true)}>
                <Plus className="size-4" />
                Adicionar widget
              </Button>
              <Button variant="outline" size="sm" onClick={() => dashboard.resetLayout()}>
                <RotateCcw className="size-4" />
                Padrão
              </Button>
              <Button size="sm" onClick={() => { setEditing(false); setDrawerOpen(false) }}>
                <Check className="size-4" />
                Concluir
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Settings2 className="size-4" />
              Personalizar Painel
            </Button>
          )}
        </div>
      </div>

      {layout.widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <LayoutGrid className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-4 font-display font-bold">Seu painel está vazio</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Adicione os componentes que combinam com seu dia — aulas, turmas, lembretes.
          </p>
          <Button className="mt-4" onClick={() => { setEditing(true); setDrawerOpen(true) }}>
            <Plus className="size-4" />
            Adicionar widget
          </Button>
        </div>
      ) : (
        // The measured container: `useContainerWidth` observes this div and hands the
        // grid a pixel width, which is what react-grid-layout v2 expects.
        <div ref={containerRef}>
          {mounted ? (
            <ResponsiveGridLayout
              width={width}
              className={cn('w-full', editing && 'rounded-2xl bg-muted/30 p-2 ring-1 ring-dashed ring-border')}
              layouts={gridLayouts}
              breakpoints={BREAKPOINTS}
              cols={BREAKPOINT_COLS}
              rowHeight={ROW_HEIGHT}
              margin={MARGIN}
              containerPadding={CONTAINER_PADDING}
              // Outside edit mode the only interaction left is clicking links inside the
              // cards, which is why drag and resize are switched off together.
              dragConfig={{ enabled: editing, handle: '.widget-drag-handle', cancel: 'button, a', threshold: 3, bounded: false }}
              resizeConfig={{ enabled: editing, handles: ['se'] }}
              onLayoutChange={handleLayoutChange}
            >
              {layout.widgets.map((widget) => (
                <div key={widget.id}>
                  <WidgetInstanceView
                    widget={widget}
                    overview={overview}
                    editing={editing}
                    onRemove={() => dashboard.removeWidget(widget.id)}
                    onOpenStudent={onOpenStudent}
                    onSchedule={onSchedule}
                    onNavigate={onNavigate}
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          ) : null}
        </div>
      )}

      {drawerOpen ? (
        <WidgetDrawer
          activeKinds={activeKinds}
          onAdd={(kind) => { dashboard.addWidget(kind); setDrawerOpen(false) }}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** Resolves one placed widget to its shell + body. */
function WidgetInstanceView({
  widget,
  overview,
  editing,
  onRemove,
  onOpenStudent,
  onSchedule,
  onNavigate,
}: {
  widget: WidgetInstance
  overview: TeacherOverview | null
  editing: boolean
  onRemove: () => void
  onOpenStudent?: (id: string) => void
  onSchedule: () => void
  onNavigate?: (view: string) => void
}) {
  const definition = widgetDefinition(widget.kind)
  if (!definition) return null

  return (
    <WidgetShell
      title={definition.title}
      description={definition.description}
      icon={definition.icon}
      editing={editing}
      onRemove={onRemove}
    >
      {renderWidgetBody(widget.kind, { overview, onOpenStudent, onSchedule, onNavigate })}
    </WidgetShell>
  )
}

/**
 * Slide-over with the catalog. It stays open while adding (the professor usually adds
 * more than one widget in a sitting), and already-placed kinds are shown as such
 * instead of hidden — hiding them makes the list jump around as you click.
 */
function WidgetDrawer({
  activeKinds,
  onAdd,
  onClose,
}: {
  activeKinds: Set<WidgetKind>
  onAdd: (kind: WidgetKind) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Fechar componentes disponíveis"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label="Componentes disponíveis"
        className="relative flex h-full w-full max-w-sm flex-col overflow-hidden bg-card shadow-2xl ring-1 ring-border sm:rounded-l-3xl sm:border-l"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border/70 p-5">
          <div>
            <h2 className="font-display font-extrabold">Componentes disponíveis</h2>
            <p className="text-xs text-muted-foreground">Toque para adicionar ao seu painel</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-5">
          {WIDGET_CATALOG.map((definition) => {
            const Icon = definition.icon
            const active = activeKinds.has(definition.kind)
            return (
              <button
                key={definition.kind}
                type="button"
                onClick={() => onAdd(definition.kind)}
                className="flex w-full items-start gap-3 rounded-xl bg-muted/40 p-3 text-left transition-colors hover:bg-muted"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card ring-1 ring-border">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{definition.title}</span>
                    {active ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        No painel
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{definition.description}</span>
                </span>
                <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

/** The four vital signs. Kept beside the panel so the header and its data stay together. */
function buildKpis(overview: TeacherOverview | null): KpiTile[] {
  const k = overview?.kpis
  const frequencyTone = (value: number | null): KpiTile['tone'] => {
    if (value === null) return 'neutral'
    if (value >= 85) return 'positive'
    if (value >= 70) return 'warning'
    return 'critical'
  }

  return [
    {
      id: 'alunos', label: 'Alunos', value: k?.total_alunos ?? null, icon: Users, tone: 'info',
      hint: `${k?.total_turmas ?? 0} ${(k?.total_turmas ?? 0) === 1 ? 'turma' : 'turmas'}`,
    },
    {
      id: 'hoje', label: 'Aulas hoje', value: k?.aulas_hoje ?? null, icon: CalendarDays,
      tone: (k?.aulas_hoje ?? 0) > 0 ? 'positive' : 'neutral',
      hint: `${k?.aulas_semana ?? 0} nesta semana`,
    },
    {
      id: 'frequencia', label: 'Frequência média', value: k?.frequencia_media ?? null,
      display: k?.frequencia_media === null || k?.frequencia_media === undefined ? '—' : `${k.frequencia_media}%`,
      icon: UserCheck, tone: frequencyTone(k?.frequencia_media ?? null),
      hint: k?.frequencia_media === null || k?.frequencia_media === undefined ? 'Nenhuma chamada registrada' : 'Presenças sobre registros',
    },
    {
      id: 'ocupacao', label: 'Ocupação', value: k?.ocupacao_percentual ?? null,
      display: k?.ocupacao_percentual === null || k?.ocupacao_percentual === undefined ? '—' : `${k.ocupacao_percentual}%`,
      icon: TrendingUp,
      tone: (k?.ocupacao_percentual ?? 0) >= 90 ? 'warning' : 'neutral',
      hint: k?.alunos_sem_turma ? `${k.alunos_sem_turma} aluno(s) sem turma` : 'Das vagas preenchidas',
    },
  ]
}
