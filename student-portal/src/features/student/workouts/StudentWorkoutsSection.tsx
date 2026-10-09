/**
 * Student side of individual training: shows the plans prescribed to this
 * student, organized by date, with a clear "Marcar como concluído" toggle per
 * session. Completion records the timestamp and reaches the professor in
 * realtime (the server publishes the invalidation event).
 */

import { useEffect, useState } from 'react'
import { CalendarCheck2, CheckCircle2, Circle, CircleAlert, Dumbbell, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type StudentPlanView } from '@/lib/api'
import { formatDateTime } from '@/lib/formatters'

interface Props {
  alunoId: string
  revision: number
  canExecute: boolean
  onNotice: (message: string) => void
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Skeletons live at MODULE SCOPE (outside the component body).
 *
 * Why: JSX declared inside a component body is rebuilt on every render — a new
 * element tree each time, so React cannot bail out and reconciliation re-runs
 * for a subtree that never changes. A module-level constant (or its own
 * component in a separate file) is a stable reference React can skip entirely.
 */
const WorkoutsLoading = (
  <div className="space-y-5" aria-busy="true" aria-label="Carregando treinos">
    <Skeleton className="h-40 rounded-2xl" />
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  </div>
)

function labelForDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  const weekday = WEEKDAY_LABELS[date.getDay()]
  return `${weekday}, ${iso.split('-').reverse().join('/')}`
}

export function StudentWorkoutsSection({ alunoId, revision, canExecute, onNotice }: Props) {
  const [plans, setPlans] = useState<StudentPlanView[]>([])
  const [hoje, setHoje] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busySession, setBusySession] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api.studentPlans(alunoId)
      .then((result) => { if (active) { setPlans(result.plans); setHoje(result.hoje) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus treinos.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [alunoId, revision])

  const toggleSession = async (session: { id: string; is_completed: boolean }, completed: boolean) => {
    if (!canExecute || busySession === session.id) return
    setBusySession(session.id)
    try {
      const result = completed ? await api.completeSession(alunoId, session.id) : await api.reopenSession(alunoId, session.id)
      // Optimistic-free update with the server's authoritative timestamp.
      setPlans((current) => current.map((plan) => ({
        ...plan,
        sessoes: plan.sessoes.map((item) => (item.id === session.id
          ? { ...item, is_completed: result.is_completed, completed_at: result.completed_at ?? null }
          : item)),
        sessoes_concluidas: plan.sessoes.reduce((acc, item) => acc + (item.id === session.id ? (result.is_completed ? 1 : 0) : (item.is_completed ? 1 : 0)), 0),
      })))
      onNotice(result.is_completed ? 'Sessão marcada como concluída. Seu professor já pode ver.' : 'Sessão reaberta.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a sessão.')
    } finally {
      setBusySession(null)
    }
  }

  if (loading) return WorkoutsLoading

  return (
    <div className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => setRevisionBump()}><RefreshCw className="size-4" /> Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      )}

      {plans.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center p-10 text-center">
            <Dumbbell className="size-8 text-muted-foreground" />
            <h2 className="mt-4 font-display font-bold">Nenhum treino individual no momento</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Quando seu professor prescrever uma rotina personalizada, ela aparece aqui.</p>
          </CardContent>
        </Card>
      ) : plans.map((plan) => (
        <PlanExecutionCard key={plan.id} plan={plan} hoje={hoje} canExecute={canExecute} busySession={busySession} onToggle={toggleSession} />
      ))}
    </div>
  )

  function setRevisionBump() {
    // Re-fetch: bumping `revision` from the parent is the established pattern;
    // locally we simply retry by triggering the effect via a state poke.
    setLoading(true)
    api.studentPlans(alunoId)
      .then((result) => { setPlans(result.plans); setHoje(result.hoje); setError(null) })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus treinos.'))
      .finally(() => setLoading(false))
  }
}

function PlanExecutionCard({ plan, hoje, canExecute, busySession, onToggle }: {
  plan: StudentPlanView
  hoje: string
  canExecute: boolean
  busySession: string | null
  onToggle: (session: { id: string; is_completed: boolean }, completed: boolean) => Promise<void>
}) {
  const done = plan.sessoes_concluidas
  const total = plan.sessoes_total
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const [showExercises, setShowExercises] = useState(true)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display flex items-center gap-2"><CalendarCheck2 className="size-5" /> {plan.titulo}</CardTitle>
            <CardDescription className="mt-1">{plan.recorrencia_label} · {plan.data_inicio} a {plan.data_fim}</CardDescription>
          </div>
          <Badge className="rounded-full" variant={percent === 100 ? 'default' : 'secondary'}>{percent}% concluído</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>

        <ul className="space-y-2">
          {plan.sessoes.map((session) => {
            const isToday = session.data === hoje
            return (
              <li key={session.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${session.is_completed ? 'border-[#D5E6CE] bg-surface-tint' : isToday ? 'border-primary/40 bg-secondary/40' : ''}`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{labelForDate(session.data)}{isToday ? ' · hoje' : ''}</p>
                  {session.is_completed && session.completed_at && (
                    <p className="text-xs text-muted-foreground">Concluído em {formatDateTime(session.completed_at)}</p>
                  )}
                </div>
                {canExecute ? (
                  <Button
                    variant={session.is_completed ? 'secondary' : 'default'}
                    size="sm"
                    className="rounded-xl"
                    disabled={busySession === session.id}
                    onClick={() => void onToggle(session, !session.is_completed)}
                    aria-pressed={session.is_completed}
                  >
                    {session.is_completed ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                    {busySession === session.id ? 'Atualizando…' : session.is_completed ? 'Reabrir' : 'Marcar como concluído'}
                  </Button>
                ) : (
                  <span className={`text-xs font-semibold ${session.is_completed ? 'text-on-soft' : 'text-muted-foreground'}`}>
                    {session.is_completed ? '✓ Concluído' : 'Pendente'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setShowExercises((value) => !value)}>
          {showExercises ? 'Ocultar' : 'Ver'} exercícios ({plan.exercicios.length})
        </Button>

        {showExercises && (
          <ul className="overflow-hidden rounded-xl border">
            {plan.exercicios.map((exercise, index) => (
              <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2 text-sm last:border-b-0">
                <span className="font-medium">{exercise.nome}</span>
                <span className="text-xs text-muted-foreground">
                  {exercise.series} séries · {exercise.repeticoes}{exercise.carga ? ` · ${exercise.carga}` : ''} · descanso {exercise.descanso_s}s
                </span>
              </li>
            ))}
          </ul>
        )}

        {plan.observacoes && <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">{plan.observacoes}</p>}
      </CardContent>
    </Card>
  )
}
