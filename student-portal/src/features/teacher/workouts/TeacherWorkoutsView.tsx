/**
 * Teacher side of individual (1-on-1) training: pick a student from the roster,
 * prescribe plans from templates or from scratch, and track which sessions the
 * student marked as completed. Realtime invalidations arrive via `revision`.
 */

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck2, CircleAlert, ClipboardList, Dumbbell, Plus, Trash2, Users } from 'lucide-react'
import { SearchInput, matchesQuery } from '@/components/SearchInput'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type TeacherPlanSummary, type WorkoutTemplate } from '@/lib/api'
import { formatDateTime, initials } from '@/lib/formatters'
import { PlanEditorDialog, type PlanDraft } from './PlanEditorDialog'

interface Student { id: string; nome: string; turma_id: string }

interface Props {
  students: Student[]
  revision: number
  readOnly?: boolean
  onNotice: (message: string) => void
}

export function TeacherWorkoutsView({ students, revision, readOnly, onNotice }: Props) {
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [plans, setPlans] = useState<TeacherPlanSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PlanDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [studentQuery, setStudentQuery] = useState('')

  const visibleStudents = useMemo(
    () => students.filter((student) => matchesQuery(student.nome, studentQuery)),
    [students, studentQuery],
  )

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [students, selectedStudentId],
  )

  // Templates are static: fetch once.
  useEffect(() => {
    let active = true
    api.templates()
      .then((result) => { if (active) setTemplates(result.templates) })
      .catch(() => { /* the editor falls back to local metadata */ })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedStudentId) { setPlans([]); return }
    let active = true
    setLoading(true)
    setError(null)
    api.studentPlansOfTeacher(selectedStudentId)
      .then((result) => { if (active) setPlans(result.plans) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os planos deste aluno.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedStudentId, revision])

  const savePlan = async (draft: PlanDraft) => {
    setBusy(true)
    setError(null)
    try {
      const { id, ...payload } = draft
      if (id) {
        await api.updatePlan(id, payload)
        onNotice('Plano atualizado. O calendário de sessões do aluno foi regenerado.')
      } else {
        const result = await api.createPlan(payload)
        onNotice(`Treino prescrito: ${result.sessoes} sessão(ões) gerada(s) para o período.`)
      }
      setEditorOpen(false)
      setEditing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o plano.')
    } finally {
      setBusy(false)
    }
  }

  const removePlan = async (planId: string) => {
    if (!window.confirm('Excluir este plano de treino? As sessões do aluno também serão removidas.')) return
    setDeletingId(planId)
    try {
      await api.deletePlan(planId)
      onNotice('Plano de treino excluído.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o plano.')
    } finally {
      setDeletingId(null)
    }
  }

  if (students.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center p-10 text-center">
          <Users className="size-8 text-muted-foreground" />
          <h2 className="mt-4 font-display font-bold">Nenhum aluno vinculado</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Prescrever treinos individuais exige alunos nas suas turmas.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {/* Student picker */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><Dumbbell className="size-5" /> Treino individualizado</CardTitle>
          <CardDescription>Escolha um aluno para prescrever e acompanhar a rotina individual dele.</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchInput value={studentQuery} onChange={setStudentQuery} placeholder="Buscar aluno por nome…" label="Filtrar alunos" className="mb-3" />
          <div className="flex flex-wrap gap-2">
            {visibleStudents.map((student) => {
              const active = student.id === selectedStudentId
              return (
                <button key={student.id} type="button" aria-pressed={active}
                  onClick={() => { setSelectedStudentId(student.id); setEditing(null); setEditorOpen(false) }}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${active ? 'border-primary bg-secondary font-semibold' : 'hover:bg-muted'}`}>
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold" aria-hidden="true">{initials(student.nome)}</span>
                  {student.nome}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {selectedStudent && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Planos de {selectedStudent.nome}</h2>
              <p className="text-sm text-muted-foreground">Acompanhe quais sessões foram concluídas pelo aluno.</p>
            </div>
            {!readOnly && (
              <Button className="rounded-xl" onClick={() => { setEditing(null); setEditorOpen(true) }}>
                <Plus className="size-4" /> Prescrever treino
              </Button>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Não foi possível concluir</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : plans.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center p-10 text-center">
                <ClipboardList className="size-8 text-muted-foreground" />
                <h3 className="mt-4 font-display font-bold">Nenhum treino prescrito</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Escolha um modelo rápido (musculação, HIIT…) ou monte a rotina do zero.</p>
                {!readOnly && <Button className="mt-4 rounded-xl" onClick={() => { setEditing(null); setEditorOpen(true) }}><Plus className="size-4" /> Prescrever treino</Button>}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {plans.map((plan) => (
                <PlanTrackingCard
                  key={plan.id}
                  plan={plan}
                  readOnly={readOnly}
                  deleting={deletingId === plan.id}
                  onEdit={() => { setEditing({ ...plan }); setEditorOpen(true) }}
                  onDelete={() => void removePlan(plan.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <PlanEditorDialog
        open={editorOpen}
        studentId={selectedStudent?.id ?? ''}
        studentName={selectedStudent?.nome ?? ''}
        templates={templates}
        editing={editing}
        busy={busy}
        error={error}
        onOpenChange={(open) => { if (!open) { setEditorOpen(false); setEditing(null) } }}
        onSubmit={(draft) => void savePlan(draft)}
      />
    </div>
  )
}

function PlanTrackingCard({ plan, readOnly, deleting, onEdit, onDelete }: {
  plan: TeacherPlanSummary
  readOnly?: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const done = plan.sessoes_concluidas ?? 0
  const total = plan.sessoes_total ?? 0
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-display">{plan.titulo}</CardTitle>
            <CardDescription className="mt-1">
              {plan.recorrencia_label} · {plan.data_inicio} a {plan.data_fim} · {plan.exercicios.length} exercício(s)
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge className="rounded-full" variant={percent === 100 ? 'default' : 'secondary'}>{percent}% concluído</Badge>
            {!readOnly && (
              <>
                <Button variant="outline" size="sm" className="rounded-lg" onClick={onEdit}>Editar</Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Excluir plano ${plan.titulo}`} disabled={deleting} onClick={onDelete}>
                  <Trash2 className="size-4 text-red-700" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{done} de {total} sessões concluídas</p>

        <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setExpanded((value) => !value)}>
          <CalendarCheck2 className="size-4" /> {expanded ? 'Ocultar' : 'Ver'} calendário de sessões
        </Button>

        {expanded && (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(plan.sessoes ?? []).map((session) => (
              <li key={session.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${session.is_completed ? 'border-[#D5E6CE] bg-[#F6FAF2]' : ''}`}>
                <span className="font-medium">{session.data}</span>
                {session.is_completed ? (
                  <span className="text-xs font-semibold text-[#48614C]" title={session.completed_at ? formatDateTime(session.completed_at) : undefined}>
                    ✓ Concluído
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Pendente</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {plan.observacoes && <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">{plan.observacoes}</p>}
      </CardContent>
    </Card>
  )
}
