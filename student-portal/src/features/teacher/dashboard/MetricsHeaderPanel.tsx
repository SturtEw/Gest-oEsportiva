/**
 * Fixed, collapsible metrics header — the four vital signs of the panel.
 *
 * Design decisions:
 *
 * 1. It starts collapsed. The professor's first question is "what do I do now?", and a
 *    wall of numbers pushes that answer below the fold on a phone. The figures are one
 *    tap away, and the collapsed bar still summarises the day ("3 aulas hoje").
 * 2. It is *fixed*: unlike the widgets below, no professor can remove it. These four
 *    numbers (alunos, aulas hoje, frequência, ocupação) are the shared vocabulary of the
 *    product; a panel without them stops being comparable between teachers.
 * 3. The open/closed state persists with the layout, so the professor's choice survives
 *    the next login.
 *
 * The tiles themselves are the existing KpiCard, so tone and the "—" for unknown data
 * behave exactly as before.
 */
import { ChevronDown, Gauge } from 'lucide-react'
import { cn } from 'cn'
import { KpiCard, type KpiTile } from './KpiCard'

export function MetricsHeaderPanel({
  tiles,
  expanded,
  onToggle,
  busy,
}: {
  tiles: KpiTile[]
  expanded: boolean
  onToggle: (expanded: boolean) => void
  /** Number of classes today; shown in the collapsed bar so it is never fully silent. */
  busy?: string | null
}) {
  return (
    <section
      // The whole header reads as one unit: a single ring wraps bar + tiles, so the
      // expanded state looks like a panel opening rather than a card appearing.
      className="w-full overflow-hidden rounded-2xl bg-card ring-1 ring-border"
      aria-label="Visão geral"
    >
      <button
        type="button"
        onClick={() => onToggle(!expanded)}
        aria-expanded={expanded}
        aria-controls="metrics-panel-body"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:px-5"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Gauge className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-extrabold text-foreground">Visão Geral</span>
          <span className="block truncate text-xs text-muted-foreground">
            {busy ?? 'Alunos, aulas de hoje, frequência e ocupação'}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-5 shrink-0 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* grid-rows trick: animating max-height needs a magic number; 0fr → 1fr
          animates to the content's real height without measuring it. */}
      <div
        id="metrics-panel-body"
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          {/* 2 columns on phones, 4 from lg up — unchanged from the static grid. */}
          <div className="grid grid-cols-2 gap-3 p-4 pt-0 sm:gap-4 sm:p-5 sm:pt-0 lg:grid-cols-4">
            {tiles.map((tile) => <KpiCard key={tile.id} tile={tile} />)}
          </div>
        </div>
      </div>
    </section>
  )
}
