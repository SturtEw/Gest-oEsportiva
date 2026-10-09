/**
 * The widget bodies.
 *
 * Each one is a pure function of the `TeacherOverview` it is handed: no fetching, no
 * local state that matters across layouts. That keeps two placements of the same widget
 * (a professor may place "Próximas aulas" twice) trivially consistent, and means moving
 * a card never refetches anything.
 *
 * These were lifted out of the old monolithic TeacherDashboard; the markup is unchanged
 * so the panel looks the same — it is only *where* each block lives that became dynamic.
 */
import {
  Activity, CalendarDays, CalendarPlus, ClipboardList, Dumbbell, Flag, MessagesSquare, TrendingUp, UserPlus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelativeDay } from '@/lib/date-labels'
import type { TeacherOverview } from '@/lib/types'
import { StudentOverviewTable } from '../StudentOverviewTable'
import { UpcomingClasses } from '../UpcomingClasses'
import { WidgetEmpty } from './WidgetShell'

/** "Aulas de hoje" — with the Agendar action, which is why it takes a callback. */
export function AulasHojeWidget({
  overview,
  onSchedule,
}: {
  overview: TeacherOverview | null
  onSchedule: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {overview?.hoje ? formatRelativeDay(overview.hoje, overview.hoje) : 'Sem agenda'}
        </p>
        <Button size="sm" onClick={onSchedule} disabled={!overview?.turmas.length}>
          <CalendarPlus className="size-4" />
          Agendar
        </Button>
      </div>

      {overview && overview.aulas_hoje.length > 0 ? (
        <UpcomingClasses aulas={overview.aulas_hoje} emptyHint="Nenhuma aula para hoje." />
      ) : (
        <WidgetEmpty
          icon={CalendarDays}
          title="Nenhuma aula hoje"
          hint="Aproveite para agendar as aulas da próxima semana."
        />
      )}
    </div>
  )
}

export function ProximasAulasWidget({ overview }: { overview: TeacherOverview | null }) {
  const total = overview?.proximas_aulas.length ?? 0
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Sua agenda à frente</p>
        {total > 0 ? (
          <Badge className="rounded-full bg-muted text-muted-foreground">{total}</Badge>
        ) : null}
      </div>
      <UpcomingClasses
        aulas={overview?.proximas_aulas ?? []}
        emptyHint="Nenhuma aula agendada. Crie a primeira para organizar sua semana."
      />
    </div>
  )
}

/** Occupancy per class — the "modalidades/subgrupos" view. */
export function ModalidadesWidget({ overview }: { overview: TeacherOverview | null }) {
  const turmas = overview?.turmas ?? []
  if (turmas.length === 0) {
    return <WidgetEmpty icon={TrendingUp} title="Sem turmas" hint="Assim que você tiver turmas, a ocupação aparece aqui." />
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {turmas.map((turma) => (
        <div key={turma.id} className="rounded-xl bg-muted/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{turma.nome}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[turma.modalidade, turma.ano].filter(Boolean).join(' · ')}
              </p>
            </div>
            {/* text-foreground: the default variant's white text was invisible on bg-card. */}
            <Badge className="shrink-0 rounded-full bg-card text-foreground ring-1 ring-border">
              {turma.total_alunos}/{turma.capacidade || '—'}
            </Badge>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, turma.ocupacao_percentual ?? 0)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
              {turma.ocupacao_percentual === null ? '—' : `${turma.ocupacao_percentual}%`}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Same grid as Modalidades but without the occupancy bars — a lighter variant. */
export function TurmasWidget({ overview }: { overview: TeacherOverview | null }) {
  return <ModalidadesWidget overview={overview} />
}

export function AlunosWidget({
  overview,
  onOpenStudent,
}: {
  overview: TeacherOverview | null
  onOpenStudent?: (id: string) => void
}) {
  return (
    <StudentOverviewTable
      alunos={overview?.alunos ?? []}
      onOpenStudent={onOpenStudent ? (row) => onOpenStudent(row.id) : undefined}
    />
  )
}

/**
 * "Precisam de atenção" — dúvidas sem resposta or frequency under 70%.
 * Returns null when nobody qualifies, so the card disappears instead of showing an
 * empty warning box: a permanent "attention" panel that is always empty trains the
 * professor to ignore it.
 */
export function AtencaoWidget({
  overview,
  onOpenStudent,
}: {
  overview: TeacherOverview | null
  onOpenStudent?: (id: string) => void
}) {
  const atRisk = (overview?.alunos ?? [])
    .filter((row) => row.duvidas_pendentes > 0 || (row.frequencia_percentual !== null && row.frequencia_percentual < 70))
    .sort((a, b) => (b.duvidas_pendentes - a.duvidas_pendentes) || ((a.frequencia_percentual ?? 101) - (b.frequencia_percentual ?? 101)))
    .slice(0, 6)

  if (atRisk.length === 0) {
    return <WidgetEmpty icon={Activity} title="Ninguém em atenção" hint="Sem dúvidas abertas e frequência saudável nas suas turmas." />
  }

  return (
    <ul className="grid gap-2">
      {atRisk.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onOpenStudent?.(row.id)}
            className="flex w-full items-center gap-3 rounded-xl bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold ring-1 ring-border">
              {row.nome.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{row.nome}</span>
              <span className="block truncate text-xs text-muted-foreground">{row.turma_nome}</span>
            </span>
            <span className="shrink-0 text-right">
              {row.duvidas_pendentes > 0 && (
                <Badge className="mb-0.5 block rounded-full bg-[#FFF7E8] text-[#8A6524] dark:bg-[#3a2e14] dark:text-[#E0BE73]">
                  {row.duvidas_pendentes} dúvida(s)
                </Badge>
              )}
              {row.frequencia_percentual !== null && row.frequencia_percentual < 70 && (
                <span className="block text-xs font-semibold text-[#B7542B] dark:text-[#F0A588]">{row.frequencia_percentual}%</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Quick navigation to the sections a coach opens most often. */
export function AtalhosWidget({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const shortcuts: Array<{ id: string; label: string; icon: typeof Dumbbell }> = [
    { id: 'aulas', label: 'Check-in', icon: ClipboardList },
    { id: 'turmas', label: 'Turmas', icon: Dumbbell },
    { id: 'convites', label: 'Convites', icon: UserPlus },
    { id: 'atividades', label: 'Atividades', icon: Flag },
    { id: 'forum', label: 'Fórum', icon: MessagesSquare },
  ]

  return (
    <div className="grid grid-cols-2 gap-2">
      {shortcuts.map((shortcut) => {
        const Icon = shortcut.icon
        return (
          <button
            key={shortcut.id}
            type="button"
            onClick={() => onNavigate?.(shortcut.id)}
            className="flex flex-col items-center gap-2 rounded-xl bg-muted/40 p-3 text-center transition-colors hover:bg-muted"
          >
            <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs font-semibold">{shortcut.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * "Lembretes" — a to-do extraction of the overview. Same source as AtencaoWidget but
 * phrased as actions rather than people, because that is the question a to-do answers.
 */
export function LembretesWidget({
  overview,
  onNavigate,
}: {
  overview: TeacherOverview | null
  onNavigate?: (view: string) => void
}) {
  const k = overview?.kpis
  const items: Array<{ id: string; icon: typeof Dumbbell; text: string; view: string; tone: 'warning' | 'neutral' }> = []

  if ((k?.duvidas_pendentes ?? 0) > 0) {
    items.push({ id: 'duvidas', icon: MessagesSquare, text: `Responder ${k?.duvidas_pendentes} dúvida(s) pendente(s)`, view: 'turmas', tone: 'warning' })
  }
  if (!overview || overview.proximas_aulas.length === 0) {
    items.push({ id: 'agendar', icon: CalendarPlus, text: 'Agendar as aulas da próxima semana', view: 'agenda', tone: 'neutral' })
  }
  if ((k?.alunos_sem_turma ?? 0) > 0) {
    items.push({ id: 'sem-turma', icon: UserPlus, text: `${k?.alunos_sem_turma} aluno(s) sem turma`, view: 'convites', tone: 'warning' })
  }

  if (items.length === 0) {
    return <WidgetEmpty icon={Activity} title="Tudo em ordem" hint="Nenhuma pendência nas suas turmas agora." />
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onNavigate?.(item.view)}
              className="flex w-full items-center gap-3 rounded-xl bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-sm">{item.text}</span>
              {item.tone === 'warning' ? (
                <Badge className="shrink-0 rounded-full bg-[#FFF7E8] text-[#8A6524] dark:bg-[#3a2e14] dark:text-[#E0BE73]">ação</Badge>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
