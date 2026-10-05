import { useMemo, useState } from 'react'
import { CircleAlert, Hand, UserMinus, UserPlus, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAction } from '@/hooks/useAction'
import { seatsLabel } from '@/lib/bracket'
import { initials } from '@/lib/formatters'
import type { TeacherActivityDetail } from '@/lib/types'

interface Props {
  detail: TeacherActivityDetail
  readOnly: boolean
  onAdd: (ids: string[]) => Promise<unknown>
  onRemove: (alunoId: string) => Promise<unknown>
}

/** Who takes part: students who marked interest plus the ones the teacher added. */
export function ParticipantsCard({ detail, readOnly, onAdd, onRemove }: Props) {
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const { error, run } = useAction('Não foi possível remover o aluno.')
  const participantIds = useMemo(() => new Set(detail.participantes.map((item) => item.id)), [detail.participantes])
  const available = detail.alunos_turma.filter((student) => !participantIds.has(student.id))
  const full = detail.vagas !== null && detail.total_participantes >= detail.vagas

  const remove = (alunoId: string) => {
    setRemovingId(alunoId)
    void run(() => onRemove(alunoId)).finally(() => setRemovingId(null))
  }

  return (
    <Card className="border-0 shadow-none ring-1 ring-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="font-display text-base font-bold">Participantes</CardTitle>
          <CardDescription className="mt-1">{seatsLabel(detail)}{detail.vagas_restantes !== null && ` · ${detail.vagas_restantes} ${detail.vagas_restantes === 1 ? 'vaga restante' : 'vagas restantes'}`}</CardDescription>
        </div>
        {!readOnly && (
          <Button variant="outline" size="sm" className="rounded-lg" disabled={available.length === 0 || full} onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" />
            Adicionar alunos
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {detail.participantes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <Users aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold">Ninguém inscrito ainda</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              {detail.inscricoes_abertas ? 'Os alunos da turma podem marcar "Tenho interesse". Você também pode adicioná-los.' : 'As inscrições estão fechadas: adicione os alunos que vão participar.'}
            </p>
          </div>
        ) : (
          <ul className="m-0! list-none divide-y divide-border/70 p-0!">
            {detail.participantes.map((student) => (
              <li key={student.id} className="flex items-center gap-3 py-2.5">
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground">{initials(student.nome)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{student.nome}</span>
                {student.origem === 'interesse' && (
                  <Badge variant="secondary" className="hidden rounded-full sm:inline-flex"><Hand aria-hidden="true" />Tem interesse</Badge>
                )}
                {!readOnly && (
                  <Button
                    variant="ghost" size="icon-sm" aria-label={`Remover ${student.nome} da atividade`}
                    disabled={removingId !== null} onClick={() => remove(student.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <UserMinus aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {detail.tem_chaveamento && detail.participantes.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">Quem você remove sai também do time. Quem entra depois do sorteio fica sem time até você editar os times.</p>
        )}
      </CardContent>

      <AddParticipantsDialog
        open={adding}
        onOpenChange={setAdding}
        students={available}
        remaining={detail.vagas_restantes}
        onAdd={onAdd}
      />
    </Card>
  )
}

interface AddProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  students: Array<{ id: string; nome: string }>
  remaining: number | null
  onAdd: (ids: string[]) => Promise<unknown>
}

function AddParticipantsDialog({ open, onOpenChange, students, remaining, onAdd }: AddProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const { busy, error, run, clearError } = useAction('Não foi possível adicionar os alunos.')
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR')
    return needle ? students.filter((student) => student.nome.toLocaleLowerCase('pt-BR').includes(needle)) : students
  }, [query, students])
  const overLimit = remaining !== null && selected.size > remaining

  const toggle = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })

  const close = (next: boolean) => {
    if (busy) return
    if (!next) { setSelected(new Set()); setQuery(''); clearError() }
    onOpenChange(next)
  }

  const submit = () => void run(() => onAdd([...selected])).then((ok) => { if (ok) close(false) })

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Adicionar alunos</DialogTitle>
          <DialogDescription>
            Alunos da turma que ainda não participam.{remaining !== null && ` Restam ${remaining} ${remaining === 1 ? 'vaga' : 'vagas'}.`}
          </DialogDescription>
        </DialogHeader>
        {students.length > 6 && (
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar aluno" aria-label="Buscar aluno" className="h-10 rounded-xl" />
        )}
        <ul className="m-0! max-h-72 list-none space-y-0.5 overflow-y-auto p-0!" aria-label="Alunos da turma">
          {visible.map((student) => (
            <li key={student.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted/70">
                <Checkbox checked={selected.has(student.id)} onCheckedChange={(checked) => toggle(student.id, checked)} />
                <span className="min-w-0 truncate text-sm">{student.nome}</span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nenhum aluno encontrado.</li>}
        </ul>
        {(error || overLimit) && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error ?? `Selecione no máximo ${remaining} ${remaining === 1 ? 'aluno' : 'alunos'}.`}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || selected.size === 0 || overLimit}>
            {busy ? 'Adicionando…' : selected.size > 1 ? `Adicionar ${selected.size} alunos` : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
