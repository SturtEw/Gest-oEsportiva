import { useMemo, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAction } from '@/hooks/useAction'
import type { TeamInput } from '@/lib/api'
import type { ActivityBracket, ActivityParticipant } from '@/lib/types'

const NO_TEAM = 'none'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  bracket: ActivityBracket
  participants: ActivityParticipant[]
  onSave: (teams: TeamInput[]) => Promise<unknown>
}

/** Rename teams and move each participant to a team (or out of all of them). */
export function TeamsEditorDialog({ open, onOpenChange, bracket, participants, onSave }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Editar times</DialogTitle>
          <DialogDescription>As partidas continuam as mesmas: só mudam os nomes e quem joga em cada time.</DialogDescription>
        </DialogHeader>
        <TeamsEditorForm bracket={bracket} participants={participants} onSave={onSave} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function TeamsEditorForm({ bracket, participants, onSave, onDone }: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(bracket.times.map((team) => [team.id, team.nome])))
  const [assignment, setAssignment] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const team of bracket.times) for (const member of team.membros ?? []) initial[member.id] = team.id
    return initial
  })
  const { busy, error, run } = useAction('Não foi possível salvar os times.')

  const teamItems = useMemo(
    () => [...bracket.times.map((team) => ({ value: team.id, label: names[team.id]?.trim() || team.nome })), { value: NO_TEAM, label: 'Sem time' }],
    [bracket.times, names],
  )
  const sizes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const teamId of Object.values(assignment)) counts.set(teamId, (counts.get(teamId) ?? 0) + 1)
    return counts
  }, [assignment])
  const missingName = bracket.times.some((team) => !names[team.id]?.trim())

  const submit = () => {
    if (missingName) return
    const teams: TeamInput[] = bracket.times.map((team) => ({
      id: team.id,
      nome: names[team.id].trim(),
      alunos_ids: participants.filter((student) => assignment[student.id] === team.id).map((student) => student.id),
    }))
    void run(() => onSave(teams)).then((ok) => { if (ok) onDone() })
  }

  return (
    <div className="space-y-5">
      <FieldSet>
        <FieldLegend variant="label">Nomes</FieldLegend>
        <div className="grid gap-2 sm:grid-cols-2">
          {bracket.times.map((team, index) => (
            <div key={team.id} className="flex items-center gap-2">
              <Input
                maxLength={40} value={names[team.id] ?? ''} aria-label={`Nome do time ${index + 1}`}
                aria-invalid={!names[team.id]?.trim()}
                onChange={(event) => setNames((current) => ({ ...current, [team.id]: event.target.value }))}
                className="h-10 rounded-xl"
              />
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{sizes.get(team.id) ?? 0} {(sizes.get(team.id) ?? 0) === 1 ? 'aluno' : 'alunos'}</span>
            </div>
          ))}
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Quem joga onde</FieldLegend>
        {participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ainda não há participantes.</p>
        ) : (
          <ul className="m-0! max-h-72 list-none divide-y divide-border/70 overflow-y-auto p-0!">
            {participants.map((student) => (
              <li key={student.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm font-medium">{student.nome}</span>
                <Select
                  items={teamItems}
                  value={assignment[student.id] ?? NO_TEAM}
                  onValueChange={(value) => setAssignment((current) => ({ ...current, [student.id]: typeof value === 'string' ? value : NO_TEAM }))}
                >
                  <SelectTrigger className="h-9 w-40 shrink-0 rounded-lg sm:w-48" aria-label={`Time de ${student.nome}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{teamItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </FieldSet>

      {(error || missingName) && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error ?? 'Todo time precisa de um nome.'}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={busy}>Cancelar</Button>
        <Button onClick={submit} disabled={busy || missingName}>{busy ? 'Salvando…' : 'Salvar times'}</Button>
      </DialogFooter>
    </div>
  )
}
