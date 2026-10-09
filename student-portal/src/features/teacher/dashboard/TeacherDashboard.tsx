
/**
 * Teacher dashboard — the "command centre" a coach checks on the way to the court.
 *
 * Information order is deliberate, answering the questions in the order they arise:
 *   1. What is happening right now?          (KPI row + "Aulas de hoje")
 *   2. What comes next, and who needs me?    ("Próximas aulas" + at-risk students)
 *   3. How is everyone doing overall?        (class occupancy + full student table)
 *
 * Every figure is derived server-side from the same collections that back the roster
 * and the attendance record, so a KPI can never disagree with the table below it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, CalendarDays, CalendarPlus, CircleHelp, TrendingUp, UserCheck, Users, X,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { teacherApi } from '@/lib/api'
import { formatRelativeDay, isValidTime } from '@/lib/date-labels'
import type { TeacherOverview } from '@/lib/types'
import { KpiGrid, type KpiTile } from './KpiCard'
import { StudentOverviewTable } from './StudentOverviewTable'
import { UpcomingClasses } from './UpcomingClasses'

type CreateScheduledClass = {
  turma_id: string
  data_aula: string
  hora_inicio: string
  duracao_minutos?: number
  local?: string | null
  observacoes?: string
}

function frequencyTone(value: number | null): KpiTile['tone'] {
  if (value === null) return 'neutral'
  if (value >= 85) return 'positive'
  if (value >= 70) return 'warning'
  return 'critical'
}

export function TeacherDashboard({ onOpenStudent }: { onOpenStudent?: (id: string) => void }) {
  const [overview, setOverview] = useState<TeacherOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  // Creating: the dialog is open and we are collecting a new session.
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<CreateScheduledClass>({ turma_id: '', data_aula: '', hora_inicio: '08:00' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const onInvalidate = useCallback(() => setRevision((value) => value + 1), [])
  useRealtimeSync({ audience: 'teacher', enabled: true, onInvalidate })

  useEffect(() => {
    let active = true
    setLoading(true)
    teacherApi.overview()
      .then((data) => { if (active) { setOverview(data); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o painel.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  // Students needing attention: unresolved questions first, then lowest frequency.
  const atRisk = useMemo(() => {
    if (!overview) return []
    return [...overview.alunos]
      .filter((row) => row.duvidas_pendentes > 0 || (row.frequencia_percentual !== null && row.frequencia_percentual < 70))
      .sort((a, b) => (b.duvidas_pendentes - a.duvidas_pendentes) || ((a.frequencia_percentual ?? 101) - (b.frequencia_percentual ?? 101)))
      .slice(0, 4)
  }, [overview])

  const kpis: KpiTile[] = useMemo(() => {
    const k = overview?.kpis
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
  }, [overview])

  const openCreate = () => {
    setFormError(null)
    setDraft({ turma_id: overview?.turmas[0]?.id ?? '', data_aula: overview?.hoje ?? '', hora_inicio: '08:00' })
    setCreateOpen(true)
  }

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    if (!draft.turma_id) { setFormError('Selecione a turma.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.data_aula)) { setFormError('Informe uma data válida.'); return }
    if (!isValidTime(draft.hora_inicio)) { setFormError('Informe um horário válido (HH:MM).'); return }

    setSaving(true)
    try {
      await teacherApi.scheduleClass(draft)
      setCreateOpen(false)
      setNotice('Aula agendada com sucesso.')
      setRevision((value) => value + 1)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Não foi possível agendar a aula.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    // w-full lets the column expand to all the free width next to the sidebar. Without
    // it a grid child can settle narrower than the container and leave dead space on
    // the right, which is exactly the "wasted right side" complaint.
    <div className="w-full space-y-6">
      {notice && (
        <Alert className="border-[#D5E6CE] bg-surface-tint">
          <AlertDescription className="flex items-center justify-between gap-3">
            {notice}
            <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso" className="rounded p-1 hover:bg-black/5">
              <X className="size-4" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleHelp aria-hidden="true" />
          <AlertDescription className="flex items-center justify-between gap-3">
            {error}
            <Button variant="outline" size="sm" onClick={() => { setError(null); setRevision((value) => value + 1) }}>
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <KpiGrid tiles={kpis} />

      {/* Two-up on desktop, stacked on smaller screens. min-w-0 on the cards keeps
          long class names from forcing a column wider than its track. */}
      <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <Card className="min-w-0 ring-1 ring-border">
          {/* CardHeader is a grid: CardAction puts the button beside the title
              (flex-row had no effect, so it wrapped under the description). */}
          <CardHeader>
            <CardTitle className="font-display">Aulas de hoje</CardTitle>
            <CardDescription className="mt-1">
              {overview?.hoje ? formatRelativeDay(overview.hoje, overview.hoje) : 'Sem agenda'}
            </CardDescription>
            <CardAction>
              <Button onClick={openCreate} disabled={!overview?.turmas.length}>
                <CalendarPlus className="size-4" />
                Agendar
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {overview && overview.aulas_hoje.length > 0
              ? <UpcomingClasses aulas={overview.aulas_hoje} emptyHint="Nenhuma aula para hoje." />
              : (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <CalendarDays className="mx-auto size-7 text-muted-foreground" />
                  <p className="mt-3 text-sm font-semibold">Nenhuma aula hoje</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                    Aproveite para agendar as aulas da próxima semana.
                  </p>
                </div>
              )}
          </CardContent>
        </Card>

        <Card className="min-w-0 ring-1 ring-border">
          <CardHeader>
            <CardTitle className="font-display">Próximas aulas</CardTitle>
            <CardDescription className="mt-1">Sua agenda à frente</CardDescription>
            {overview && overview.proximas_aulas.length > 0 ? (
              <CardAction>
                <Badge className="rounded-full bg-muted text-muted-foreground">
                  {overview.proximas_aulas.length}
                </Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <UpcomingClasses
              aulas={overview?.proximas_aulas ?? []}
              emptyHint="Nenhuma aula agendada. Crie a primeira para organizar sua semana."
            />
          </CardContent>
        </Card>
      </div>

      {atRisk.length > 0 && (
        <Card className="ring-1 ring-[#EAD6BA]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display">
              <Activity className="size-5 text-[#B7542B]" />
              Precisam de atenção
            </CardTitle>
            <CardDescription className="mt-1">Dúvidas sem resposta ou frequência abaixo de 70%</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
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
                        <Badge className="mb-0.5 block rounded-full bg-[#FFF7E8] text-[#8A6524]">
                          {row.duvidas_pendentes} dúvida(s)
                        </Badge>
                      )}
                      {row.frequencia_percentual !== null && row.frequencia_percentual < 70 && (
                        <span className="block text-xs font-semibold text-[#B7542B]">{row.frequencia_percentual}%</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {overview && overview.turmas.length > 0 && (
        <Card className="ring-1 ring-border">
          <CardHeader>
            <CardTitle className="font-display">Suas turmas</CardTitle>
            <CardDescription className="mt-1">Ocupação e vagas disponíveis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {overview.turmas.map((turma) => (
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
          </CardContent>
        </Card>
      )}

      <Card className="ring-1 ring-border">
        <CardHeader>
          <CardTitle className="font-display">Visão geral de alunos</CardTitle>
          <CardDescription className="mt-1">Clique nos cabeçalhos para ordenar e encontrar quem precisa de atenção</CardDescription>
        </CardHeader>
        <CardContent>
          <StudentOverviewTable
            alunos={overview?.alunos ?? []}
            onOpenStudent={onOpenStudent ? (row) => onOpenStudent(row.id) : undefined}
          />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open && !saving) setCreateOpen(false) }}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Agendar aula</DialogTitle>
            <DialogDescription>
              Uma aula por turma por dia. A data é o dia da aula, independente de fuso horário.
            </DialogDescription>
          </DialogHeader>
          <form id="teacher-create-class" onSubmit={(event) => void submitCreate(event)} className="space-y-4">
            <Field>
              <FieldLabel htmlFor="class-turma">Turma</FieldLabel>
              {/* items: without it Select.Value renders the raw value — the class UUID. */}
              <Select
                items={(overview?.turmas ?? []).map((turma) => ({ value: turma.id, label: turma.nome }))}
                value={draft.turma_id}
                onValueChange={(value) => setDraft((current) => ({ ...current, turma_id: value ?? '' }))}
              >
                <SelectTrigger id="class-turma" className="mt-2 h-11 w-full rounded-xl">
                  <SelectValue placeholder="Selecione a turma" />
                </SelectTrigger>
                <SelectContent>
                  {(overview?.turmas ?? []).map((turma) => (
                    <SelectItem key={turma.id} value={turma.id}>{turma.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="class-date">Data</FieldLabel>
                <Input
                  id="class-date" type="date" required className="mt-2 h-11 rounded-xl"
                  value={draft.data_aula}
                  onChange={(event) => setDraft((current) => ({ ...current, data_aula: event.target.value }))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="class-time">Horário</FieldLabel>
                <Input
                  id="class-time" type="time" required className="mt-2 h-11 rounded-xl"
                  value={draft.hora_inicio}
                  onChange={(event) => setDraft((current) => ({ ...current, hora_inicio: event.target.value }))}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="class-duration">Duração (minutos)</FieldLabel>
              <Input
                id="class-duration" type="number" min={15} max={480} step={5} className="mt-2 h-11 rounded-xl"
                value={draft.duracao_minutos ?? 60}
                onChange={(event) => setDraft((current) => ({ ...current, duracao_minutos: Number(event.target.value) }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="class-place">Local (opcional)</FieldLabel>
              <Input
                id="class-place" className="mt-2 h-11 rounded-xl" placeholder="Ex.: Ginásio 1"
                value={draft.local ?? ''}
                onChange={(event) => setDraft((current) => ({ ...current, local: event.target.value || null }))}
              />
            </Field>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button form="teacher-create-class" type="submit" disabled={saving}>
              {saving ? 'Agendando…' : 'Agendar aula'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
