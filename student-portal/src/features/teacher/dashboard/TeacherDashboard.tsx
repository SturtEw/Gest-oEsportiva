
/**
 * Teacher dashboard — the "command centre" a coach checks on the way to the court.
 *
 * This component owns the *data*: one fetch of `teacherApi.overview()`, the realtime
 * invalidation, and the "Agendar aula" dialog. What is *displayed* is now the professor's
 * choice, so the rendering lives in CustomizableDashboard: a fixed, collapsible metrics
 * header over a grid of widgets they add, remove and arrange.
 *
 * Splitting the two is what makes the panel personal while keeping every figure derived
 * server-side from the same collections that back the roster and the attendance record,
 * so a KPI can never disagree with the table below it.
 */
import { useCallback, useEffect, useState } from 'react'
import { CircleHelp, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { teacherApi } from '@/lib/api'
import { isValidTime } from '@/lib/date-labels'
import type { TeacherOverview } from '@/lib/types'
import { CustomizableDashboard } from './CustomizableDashboard'

type CreateScheduledClass = {
  turma_id: string
  data_aula: string
  hora_inicio: string
  duracao_minutos?: number
  local?: string | null
  observacoes?: string
}

export function TeacherDashboard({
  onOpenStudent,
  onNavigate,
}: {
  onOpenStudent?: (id: string) => void
  /** Lets the Atalhos/Lembretes widgets route to another teacher section. */
  onNavigate?: (view: string) => void
}) {
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

      {/* Data lives here; presentation (which widgets, in what order) lives inside. */}
      <CustomizableDashboard
        overview={overview}
        loading={loading}
        onOpenStudent={onOpenStudent}
        onSchedule={openCreate}
        onNavigate={onNavigate}
      />

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
