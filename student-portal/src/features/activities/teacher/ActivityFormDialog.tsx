import { useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAction } from '@/hooks/useAction'
import type { ActivityInput } from '@/lib/api'
import type { ActivitySummary, TeacherActivityClass } from '@/lib/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: TeacherActivityClass[]
  /** Editing this activity; creating a new one when absent. */
  activity?: ActivitySummary | null
  /** Receives every field: cleared optional fields go as null so the server clears them. */
  onSubmit: (input: ActivityInput) => Promise<unknown>
}

export function ActivityFormDialog({ open, onOpenChange, classes, activity, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">{activity ? 'Editar atividade' : 'Nova atividade'}</DialogTitle>
          <DialogDescription>
            {activity ? 'As mudanças aparecem na hora para os alunos da turma.' : 'Os alunos da turma veem a atividade e podem marcar "Tenho interesse".'}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts from the activity's current values. */}
        <ActivityForm classes={classes} activity={activity} onSubmit={onSubmit} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ActivityForm({ classes, activity, onSubmit, onDone, onCancel }: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void; onCancel: () => void }) {
  const [turmaId, setTurmaId] = useState<string | undefined>(activity?.turma_id ?? (classes.length === 1 ? classes[0].id : undefined))
  const [titulo, setTitulo] = useState(activity?.titulo ?? '')
  const [descricao, setDescricao] = useState(activity?.descricao ?? '')
  const [data, setData] = useState(activity?.data ?? '')
  const [horario, setHorario] = useState(activity?.horario ?? '')
  const [local, setLocal] = useState(activity?.local ?? '')
  const [vagas, setVagas] = useState(activity?.vagas ? String(activity.vagas) : '')
  const [abertas, setAbertas] = useState(activity?.inscricoes_abertas ?? true)
  const { busy, error, run } = useAction('Não foi possível salvar a atividade.')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!turmaId || titulo.trim().length < 3) return
    void run(() => onSubmit({
      turma_id: turmaId,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      data: data || null,
      horario: horario || null,
      local: local.trim() || null,
      vagas: vagas ? Number(vagas) : null,
      inscricoes_abertas: abertas,
    })).then((ok) => { if (ok) onDone() })
  }

  const classItems = classes.map((item) => ({ value: item.id, label: [item.nome, item.modalidade].filter(Boolean).join(' · ') || 'Turma' }))

  return (
    <form onSubmit={submit} className="space-y-4">
      {!activity && (
        <Field>
          <FieldLabel htmlFor="activity-class">Turma</FieldLabel>
          <Select items={classItems} value={turmaId ?? null} onValueChange={(value) => setTurmaId(typeof value === 'string' ? value : undefined)}>
            <SelectTrigger id="activity-class" className="h-11 w-full rounded-xl"><SelectValue placeholder="Escolha a turma" /></SelectTrigger>
            <SelectContent>{classItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="activity-title">Título</FieldLabel>
        <Input id="activity-title" required minLength={3} maxLength={80} value={titulo} onChange={(event) => setTitulo(event.target.value)} placeholder="Ex.: Torneio relâmpago de futsal" className="h-11 rounded-xl" />
      </Field>
      <Field>
        <FieldLabel htmlFor="activity-description">Descrição <span className="font-normal text-muted-foreground">(opcional)</span></FieldLabel>
        <Textarea id="activity-description" rows={3} maxLength={500} value={descricao} onChange={(event) => setDescricao(event.target.value)} placeholder="O que vai acontecer, o que levar…" className="rounded-xl" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="activity-date">Data</FieldLabel>
          <Input id="activity-date" type="date" value={data} onChange={(event) => setData(event.target.value)} className="h-11 rounded-xl" />
        </Field>
        <Field>
          <FieldLabel htmlFor="activity-time">Horário</FieldLabel>
          <Input id="activity-time" type="time" value={horario} onChange={(event) => setHorario(event.target.value)} className="h-11 rounded-xl" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field>
          <FieldLabel htmlFor="activity-place">Local</FieldLabel>
          <Input id="activity-place" maxLength={80} value={local} onChange={(event) => setLocal(event.target.value)} placeholder="Quadra coberta" className="h-11 rounded-xl" />
        </Field>
        <Field>
          <FieldLabel htmlFor="activity-seats">Vagas</FieldLabel>
          <Input id="activity-seats" type="number" inputMode="numeric" min={2} max={200} value={vagas} onChange={(event) => setVagas(event.target.value)} placeholder="Sem limite" className="h-11 rounded-xl" />
        </Field>
      </div>
      <Field orientation="horizontal" className="items-center justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3">
        <div className="min-w-0">
          <FieldLabel htmlFor="activity-open">Inscrições abertas</FieldLabel>
          <FieldDescription className="text-xs">Com as inscrições fechadas, só você adiciona participantes.</FieldDescription>
        </div>
        <Switch id="activity-open" checked={abertas} onCheckedChange={setAbertas} />
      </Field>
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy || !turmaId || titulo.trim().length < 3}>
          {busy ? 'Salvando…' : activity ? 'Salvar alterações' : 'Criar atividade'}
        </Button>
      </DialogFooter>
    </form>
  )
}
