/**
 * KPI tiles for the teacher dashboard.
 *
 * Two rules drive this component:
 *
 * 1. A metric with no data is rendered as "—", never 0. "Nenhuma aula registrada" and
 *    "0% de frequência" are different facts; showing 0 for both would make a teacher
 *    chase a problem that does not exist.
 * 2. The number is the loudest thing on the tile and the label is quiet — a coach
 *    scanning a phone between classes reads the figure first.
 *
 * Trend and tone are props rather than derived, so a KPI never invents a comparison
 * it cannot actually support from the data it was given.
 */
import type { ComponentType } from 'react'
import { cn } from 'cn'

export type KpiTone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info'

export interface KpiTile {
  id: string
  label: string
  value: number | null
  /** Optional already-formatted value (e.g. "82%"). When absent, the number is shown raw. */
  display?: string
  suffix?: string
  icon: ComponentType<{ className?: string }>
  tone?: KpiTone
  hint?: string
}

const TONE_RING: Record<KpiTone, string> = {
  neutral: 'ring-border',
  positive: 'ring-[#BFD9A8]',
  warning: 'ring-[#EAD6BA]',
  critical: 'ring-[#F0C4B4]',
  info: 'ring-[#BFD1E6]',
}

const TONE_ICON: Record<KpiTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  positive: 'bg-[#EAF0E5] text-[#4C6B45]',
  warning: 'bg-[#FFF7E8] text-[#8A6524]',
  critical: 'bg-[#FDEEE7] text-[#B7542B]',
  info: 'bg-[#EDF2F8] text-[#3E5C7A]',
}

export function KpiCard({ tile }: { tile: KpiTile }) {
  const tone = tile.tone ?? 'neutral'
  const Icon = tile.icon
  const hasValue = tile.value !== null && tile.value !== undefined
  const shown = tile.display ?? (hasValue ? String(tile.value) : '—')

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 transition-shadow sm:p-5',
        TONE_RING[tone],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{tile.label}</p>
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', TONE_ICON[tone])}>
          <Icon className="size-[18px]" />
        </span>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="font-display text-3xl font-extrabold tabular-nums text-foreground sm:text-[2.1rem]">
          {shown}
        </span>
        {tile.suffix && hasValue ? (
          <span className="text-sm font-semibold text-muted-foreground">{tile.suffix}</span>
        ) : null}
      </div>

      {tile.hint ? (
        <p className="text-xs leading-5 text-muted-foreground">{tile.hint}</p>
      ) : hasValue ? null : (
        // Only when there is no value: "no data" must be said out loud, never
        // impersonated by a zero.
        <p className="text-xs leading-5 text-muted-foreground">Sem dados registrados ainda</p>
      )}
    </div>
  )
}

export function KpiGrid({ tiles }: { tiles: KpiTile[] }) {
  return (
    // 2 columns on phones, 4 from lg up. The wrapper is w-full so the row always spans
    // the free width instead of shrinking around its content.
    <div className="grid w-full grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <KpiCard key={tile.id} tile={tile} />
      ))}
    </div>
  )
}
