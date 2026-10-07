/**
 * "Treinos prescritos": every individual workout plan this teacher has handed to
 * students, across the whole roster — with a filter by student, title or status.
 */

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck2, ClipboardList, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput, matchesQuery } from '@/components/SearchInput'
import { api, type TeacherPlanSummary } from '@/lib/api'
import { initials } from '@/lib/formatters'

interface Props {
  revision: number
}

type StatusFilter = 'todos' | 'andamento' | 'concluidos'

export function TeacherPrescribedWorkouts({ revision }: Props) {
  const [plans, setPlans] = useState<TeacherPlanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('todos')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.teacherPlans()
      .then((result) => { if (active) { setPlans(result.plans); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os treinos prescritos.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  const visible = useMemo(() => plans.filter((plan) => {
    const done = plan.sessoes_total > 0 && plan.sessoes_concluidas === plan.sessoes_total
    if (status === 'andamento' && done) return false
    if (status === 'concluidos' && !done) return false
    return matchesQuery(plan.titulo, query) || matchesQuery(plan.aluno_nome, query)
  }), [plans, query, status])

  if (loading && plans.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <CalendarCheck2 aria-hidden="true" />
        <AlertTitle>Não foi possível carregar</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (plans.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center p-10 text-center">
          <ClipboardList aria-hidden="true" className="size-8 text-muted-foreground" />
          <h2 className="mt-4 font-display font-bold">Nenhum treino prescrito ainda</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Ao prescrever na aba Treino 1:1, cada plano aparece aqui com o progresso do aluno.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar por aluno ou título do treino…" label="Filtrar treinos prescritos" className="flex-1" />
        <div className="flex shrink-0 gap-1.5" role="group" aria-label="Filtrar por situação">
          {([
            ['todos', 'Todos'],
            ['andamento', 'Em andamento'],
            ['concluidos', 'Concluídos'],
          ] as Array<[StatusFilter, string]>).map(([value, label]) => (
            <Button key={value} size="sm" variant={status === value ? 'default' : 'outline'} className="rounded-lg" aria-pressed={status === value} onClick={() => setStatus(value)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum treino corresponde aos filtros atuais.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((plan) => {
            const done = plan.sessoes_concluidas ?? 0
            const total = plan.sessoes_total ?? 0
            const percent = total > 0 ? Math.round((done / total) * 100) : 0
            const completed = total > 0 && done === total
            const expanded = expandedId === plan.id
            return (
              <Card key={plan.id} className="shadow-none ring-1 ring-border">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" aria-hidden="true">
                        {initials(plan.aluno_nome)}
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="font-display">{plan.titulo}</CardTitle>
                        <CardDescription className="mt-1">
                          {plan.aluno_nome} · {plan.recorrencia_label} · {plan.data_inicio} a {plan.data_fim} · {plan.exercicios.length} exercício(s)
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className="rounded-full" variant={completed ? 'default' : 'secondary'}>{percent}%</Badge>
                      <Button variant="ghost" size="sm" className="rounded-lg" aria-expanded={expanded} onClick={() => setExpandedId((current) => (current === plan.id ? null : plan.id))}>
                        <CalendarCheck2 className="size-4" /> {expanded ? 'Ocultar' : 'Ver'} sessões
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{done} de {total} sessões concluídas</p>
                  {expanded && (
                    <div className="grid gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                      {(plan.exercicios ?? []).map((exercise, index) => (
                        <div key={index} className="rounded-xl border border-border px-3 py-2 text-sm">
                          <p className="truncate font-medium">{exercise.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {exercise.series}x{exercise.repeticoes}{exercise.carga ? ` · ${exercise.carga}` : ''} · descanso {exercise.descanso_s}s
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users aria-hidden="true" className="size-4" />
        {plans.length === 1 ? '1 plano no total' : `${plans.length} planos no total`} — prescritos na aba Treino 1:1.
      </p>
    </div>
  )
}
