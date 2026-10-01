/**
 * "Próximas aulas" list.
 *
 * Sessions are grouped by calendar day, and today is called out explicitly: a coach
 * standing on the court needs "what is happening right now" far more than a date
 * heading. Concluded sessions (attendance already recorded) are dimmed rather than
 * hidden, so the day reads as a timeline instead of a to-do list that forgets itself.
 */
import { CalendarClock, CheckCircle2, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from 'cn'
import { formatWeekdayLabel, formatShortDate } from '@/lib/date-labels'
import type { ScheduledClass } from '@/lib/types'

function dayHeading(date: string, isToday: boolean) {
  if (isToday) return 'Hoje'
  return `${formatWeekdayLabel(date)}, ${formatShortDate(date)}`
}

export function UpcomingClasses({
  aulas,
  emptyHint = 'Nenhuma aula agendada. Crie a primeira para organizar sua semana.',
}: {
  aulas: ScheduledClass[]
  emptyHint?: string
}) {
  if (aulas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <CalendarClock className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold">Agenda vazia</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    )
  }

  const groups = new Map<string, ScheduledClass[]>()
  for (const aula of aulas) {
    const list = groups.get(aula.data_aula) ?? []
    list.push(aula)
    groups.set(aula.data_aula, list)
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([date, items]) => {
        const isToday = items.some((item) => item.hoje)
        return (
          <section key={date}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="font-display text-sm font-extrabold text-foreground">{dayHeading(date, isToday)}</h3>
              {isToday ? (
                <Badge className="rounded-full bg-accent text-accent-foreground">Hoje</Badge>
              ) : null}
            </div>
            <ul className="space-y-2">
              {items.map((aula) => (
                <li
                  key={aula.id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl bg-card p-3 ring-1 transition-shadow',
                    aula.hoje ? 'ring-2 ring-accent' : 'ring-border',
                    aula.concluida && 'opacity-65',
                  )}
                >
                  <div className="flex w-14 shrink-0 flex-col items-center">
                    <span className="font-display text-base font-extrabold tabular-nums text-foreground">
                      {aula.hora_inicio}
                    </span>
                    <span className="text-[10px] font-semibold text-muted-foreground">{aula.duracao_minutos}min</span>
                  </div>

                  <div className="min-w-0 flex-1 border-l border-border pl-3">
                    <p className="truncate text-sm font-semibold text-foreground">{aula.turma_nome}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {aula.modalidade ? <span>{aula.modalidade}</span> : null}
                      {aula.local ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {aula.local}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  {aula.concluida ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#4C6B45]">
                      <CheckCircle2 className="size-4" />
                      <span className="hidden sm:inline">Concluída</span>
                    </span>
                  ) : aula.hoje ? (
                    <Badge className="shrink-0 rounded-full bg-primary text-primary-foreground">Próxima</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
