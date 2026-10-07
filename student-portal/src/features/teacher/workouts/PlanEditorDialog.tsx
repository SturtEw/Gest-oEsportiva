/**
 * Plan editor dialog: pick a quick-start template (or start blank), adjust the
 * exercise list, choose the recurrence and save. Used for both creating and
 * editing an existing plan (editing the schedule regenerates sessions).
 */

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { PlanInput, RecurrenceRule, WorkoutExercise, WorkoutTemplate } from '@/lib/api'
import { FALLBACK_TEMPLATES, TEMPLATE_ICONS, WEEKDAY_OPTIONS } from './templates'

export interface PlanDraft extends PlanInput {
  id?: string
}
interface Props {
  open: boolean
  studentId: string
  studentName: string
  templates: WorkoutTemplate[]
  editing?: PlanDraft | null
  busy: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: PlanDraft) => void
}

const BLANK_EXERCISE: WorkoutExercise = { nome: '', series: 3, repeticoes: '10', carga: '', descanso_s: 60 }

export function PlanEditorDialog({ open, studentId, studentName, templates, editing, busy, error, onOpenChange, onSubmit }: Props) {
  const [templateId, setTemplateId] = useState('custom')
  const [titulo, setTitulo] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [exercicios, setExercicios] = useState<WorkoutExercise[]>([{ ...BLANK_EXERCISE }])
  const [recurrenceType, setRecurrenceType] = useState<'daily' | 'weekly' | 'custom'>('weekly')
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5])
  const [customDates, setCustomDates] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  // Pre-fill the form whenever the dialog opens (editing an existing plan, or blank).
  useEffect(() => {
    if (!open) return
    if (editing) {
      setTitulo(editing.titulo)
      setObservacoes(editing.observacoes ?? '')
      setExercicios(editing.exercicios.map((item) => ({ ...item, carga: item.carga ?? '' })))
      setRecurrenceType(editing.recorrencia.type)
      setWeekdays(editing.recorrencia.type === 'weekly' ? editing.recorrencia.weekdays : [1, 3, 5])
      setCustomDates(editing.recorrencia.type === 'custom' ? editing.recorrencia.dates.join(', ') : '')
      setDataInicio(editing.data_inicio)
      setDataFim(editing.data_fim)
      setTemplateId(editing.template || 'custom')
    } else {
      setTemplateId('custom')
      setTitulo('')
      setObservacoes('')
      setExercicios([{ ...BLANK_EXERCISE }])
      setRecurrenceType('weekly')
      setWeekdays([1, 3, 5])
      setCustomDates('')
      setDataInicio('')
      setDataFim('')
    }
  }, [open, editing])

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    if (id === 'custom') return
    const template = (templates.length ? templates : FALLBACK_TEMPLATES).find((item) => item.id === id)
    if (!template) return
    if (!titulo.trim()) setTitulo(`${template.nome} · ${studentName.split(' ')[0]}`)
    if (template.exercicios.length) setExercicios(template.exercicios.map((item) => ({ ...item, carga: item.carga ?? '' })))
  }

  const setExercise = (index: number, patch: Partial<WorkoutExercise>) => {
    setExercicios((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const recorrencia = (): RecurrenceRule => {
    if (recurrenceType === 'daily') return { type: 'daily' }
    if (recurrenceType === 'weekly') return { type: 'weekly', weekdays: [...weekdays].sort() }
    const dates = customDates.split(',').map((item) => item.trim()).filter(Boolean)
    return { type: 'custom', dates }
  }

  const valid = titulo.trim().length >= 3
    && studentId
    && dataInicio
    && dataFim
    && exercicios.length > 0
    && exercicios.every((item) => item.nome.trim().length >= 2)
    && (recurrenceType !== 'weekly' || weekdays.length > 0)
    && (recurrenceType !== 'custom' || customDates.split(',').some((item) => item.trim()))

  const submit = () => {
    if (!valid || busy) return
    onSubmit({
      id: editing?.id,
      aluno_id: studentId,
      titulo: titulo.trim(),
      template: templateId,
      observacoes: observacoes.trim() || null,
      exercicios: exercicios.map((item) => ({ ...item, nome: item.nome.trim(), carga: item.carga?.trim() || null })),
      recorrencia: recorrencia(),
      data_inicio: dataInicio,
      data_fim: dataFim,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onOpenChange(false) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{editing ? 'Editar plano de treino' : 'Prescrever treino individual'}</DialogTitle>
          <DialogDescription>{editing ? 'Alterar a frequência regera o calendário de sessões.' : `Monte a rotina de ${studentName}. Escolha um modelo pronto ou monte do zero.`}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel>Modelo rápido</FieldLabel>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => applyTemplate('custom')} aria-pressed={templateId === 'custom'}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${templateId === 'custom' ? 'border-primary bg-secondary font-semibold' : 'hover:bg-muted'}`}>
                ✏️ Do zero
              </button>
              {(templates.length ? templates : FALLBACK_TEMPLATES).map((template) => (
                <button key={template.id} type="button" onClick={() => applyTemplate(template.id)} aria-pressed={templateId === template.id}
                  title={template.descricao}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${templateId === template.id ? 'border-primary bg-secondary font-semibold' : 'hover:bg-muted'}`}>
                  {TEMPLATE_ICONS[template.id] ?? '📋'} {template.nome}
                </button>
              ))}
            </div>
            <FieldDescription>Escolher um modelo preenche os exercícios; você pode ajustar tudo depois.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="plan-title">Título do plano</FieldLabel>
            <Input id="plan-title" value={titulo} onChange={(event) => setTitulo(event.target.value)} maxLength={100} className="mt-1 h-10 rounded-xl" placeholder="Ex.: Hipertrofia — foco superior" />
          </Field>

          <Field>
            <FieldLabel>Exercícios</FieldLabel>
            <div className="mt-2 space-y-2">
              {exercicios.map((exercise, index) => (
                <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-xl border p-3">
                  <div className="col-span-12 sm:col-span-5">
                    <FieldLabel className="text-xs text-muted-foreground">Exercício {index + 1}</FieldLabel>
                    <Input value={exercise.nome} onChange={(event) => setExercise(index, { nome: event.target.value })} maxLength={120} className="mt-1 h-9 rounded-lg" placeholder="Supino reto" />
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    <FieldLabel className="text-xs text-muted-foreground">Séries</FieldLabel>
                    <Input type="number" min={1} max={20} value={exercise.series} onChange={(event) => setExercise(index, { series: Number(event.target.value) })} className="mt-1 h-9 rounded-lg" />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <FieldLabel className="text-xs text-muted-foreground">Reps</FieldLabel>
                    <Input value={exercise.repeticoes} onChange={(event) => setExercise(index, { repeticoes: event.target.value })} maxLength={20} className="mt-1 h-9 rounded-lg" placeholder="10-12" />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <FieldLabel className="text-xs text-muted-foreground">Carga</FieldLabel>
                    <Input value={exercise.carga ?? ''} onChange={(event) => setExercise(index, { carga: event.target.value })} maxLength={20} className="mt-1 h-9 rounded-lg" placeholder="40kg" />
                  </div>
                  <div className="col-span-1 sm:col-span-1">
                    <FieldLabel className="text-xs text-muted-foreground">Desc.</FieldLabel>
                    <Input type="number" min={0} max={1800} value={exercise.descanso_s} onChange={(event) => setExercise(index, { descanso_s: Number(event.target.value) })} className="mt-1 h-9 rounded-lg" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover exercício ${index + 1}`} disabled={exercicios.length === 1}
                      onClick={() => setExercicios((current) => current.filter((_, i) => i !== index))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setExercicios((current) => [...current, { ...BLANK_EXERCISE, nome: '' }])}>
                <Plus className="size-4" /> Adicionar exercício
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel>Frequência</FieldLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['daily', 'weekly', 'custom'] as const).map((type) => (
                <button key={type} type="button" onClick={() => setRecurrenceType(type)} aria-pressed={recurrenceType === type}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${recurrenceType === type ? 'border-primary bg-secondary font-semibold' : 'hover:bg-muted'}`}>
                  {type === 'daily' ? 'Todos os dias' : type === 'weekly' ? 'Dias da semana' : 'Cronograma fechado'}
                </button>
              ))}
            </div>
            {recurrenceType === 'weekly' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEKDAY_OPTIONS.map((day) => {
                  const active = weekdays.includes(day.value)
                  return (
                    <button key={day.value} type="button" aria-pressed={active}
                      onClick={() => setWeekdays((current) => (active ? current.filter((v) => v !== day.value) : [...current, day.value]))}
                      className={`h-9 w-11 rounded-lg border text-sm transition ${active ? 'border-primary bg-secondary font-semibold' : 'hover:bg-muted'}`}>
                      {day.label}
                    </button>
                  )
                })}
              </div>
            )}
            {recurrenceType === 'custom' && (
              <Textarea value={customDates} onChange={(event) => setCustomDates(event.target.value)} rows={2} className="mt-2 rounded-xl"
                placeholder="2026-03-02, 2026-03-05, 2026-03-09" />
            )}
            {recurrenceType === 'custom' && <FieldDescription>Datas separadas por vírgula (AAAA-MM-DD). Cada data vira uma sessão.</FieldDescription>}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="plan-start">Início</FieldLabel>
              <Input id="plan-start" type="date" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} className="mt-1 h-10 rounded-xl" />
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-end">Fim</FieldLabel>
              <Input id="plan-end" type="date" value={dataFim} onChange={(event) => setDataFim(event.target.value)} className="mt-1 h-10 rounded-xl" />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="plan-notes">Observações (opcional)</FieldLabel>
            <Textarea id="plan-notes" value={observacoes} onChange={(event) => setObservacoes(event.target.value)} rows={2} maxLength={500} className="mt-1 rounded-xl" placeholder="Orientações, cuidados, progressão…" />
          </Field>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!valid || busy} onClick={submit}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Prescrever treino'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
