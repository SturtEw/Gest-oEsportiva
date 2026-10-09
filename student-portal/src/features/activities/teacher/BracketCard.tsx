import { useMemo, useState } from 'react'
import { CircleAlert, Pencil, Shuffle, Trash2, Trophy } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { BracketInput, MatchResultInput, TeamInput } from '@/lib/api'
import { FORMAT_LABELS } from '@/lib/bracket'
import type { BracketMatch, TeacherActivityDetail } from '@/lib/types'
import { BracketView } from '../bracket/BracketView'
import { BracketSetupDialog } from './BracketSetupDialog'
import { MatchResultDialog } from './MatchResultDialog'
import { TeamsEditorDialog } from './TeamsEditorDialog'

interface Props {
  detail: TeacherActivityDetail
  readOnly: boolean
  onCreate: (input: BracketInput) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onSaveTeams: (teams: TeamInput[]) => Promise<unknown>
  onRedraw: () => Promise<unknown>
  onRecordResult: (matchId: string, result: MatchResultInput) => Promise<unknown>
}

type Confirm = 'redraw' | 'delete' | null

export function BracketCard({ detail, readOnly, onCreate, onDelete, onSaveTeams, onRedraw, onRecordResult }: Props) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [match, setMatch] = useState<BracketMatch | null>(null)
  const bracket = detail.chaveamento

  const withoutTeam = useMemo(() => {
    if (!bracket) return 0
    const placed = new Set(bracket.times.flatMap((team) => (team.membros ?? []).map((member) => member.id)))
    return detail.participantes.filter((student) => !placed.has(student.id)).length
  }, [bracket, detail.participantes])

  if (!bracket) {
    return (
      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardContent className="flex flex-col items-center px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <Trophy aria-hidden="true" className="size-6" />
          </span>
          <h3 className="mt-4 font-display text-base font-bold">Vai ter competição?</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            Escolha mata-mata ou pontos corridos e quantos times. Os participantes são sorteados entre eles.
          </p>
          {!readOnly && (
            <Button className="mt-5 rounded-xl" onClick={() => setSetupOpen(true)}>
              <Shuffle aria-hidden="true" />
              Montar chaveamento
            </Button>
          )}
        </CardContent>
        <BracketSetupDialog open={setupOpen} onOpenChange={setSetupOpen} participants={detail.total_participantes} onCreate={onCreate} />
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-none ring-1 ring-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="font-display text-base font-bold">Chaveamento</CardTitle>
          <CardDescription className="mt-1">
            {FORMAT_LABELS[bracket.formato]} · {bracket.times.length} times
            {!readOnly && ' · toque numa partida para registrar o placar'}
          </CardDescription>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setTeamsOpen(true)}><Pencil aria-hidden="true" />Editar times</Button>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setConfirm('redraw')}><Shuffle aria-hidden="true" />Sortear de novo</Button>
            <Button variant="ghost" size="sm" className="rounded-lg text-destructive hover:text-destructive" onClick={() => setConfirm('delete')}><Trash2 aria-hidden="true" />Excluir</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {withoutTeam > 0 && (
          <Alert className="border-[#E9E1CC] bg-surface-warm">
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              {withoutTeam === 1 ? '1 participante entrou depois do sorteio e está sem time.' : `${withoutTeam} participantes entraram depois do sorteio e estão sem time.`}
              {!readOnly && <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setTeamsOpen(true)}>Colocar em um time</Button>}
            </AlertDescription>
          </Alert>
        )}

        <ul className="m-0! grid list-none gap-3 p-0! sm:grid-cols-2 xl:grid-cols-3" aria-label="Times">
          {bracket.times.map((team) => (
            <li key={team.id} className="rounded-xl bg-muted/50 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-bold text-heading">{team.nome}</p>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{team.total_membros} {team.total_membros === 1 ? 'aluno' : 'alunos'}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {(team.membros ?? []).map((member) => member.nome).join(', ') || 'Sem alunos'}
              </p>
            </li>
          ))}
        </ul>

        <BracketView bracket={bracket} onSelectMatch={readOnly ? undefined : setMatch} />
      </CardContent>

      <TeamsEditorDialog open={teamsOpen} onOpenChange={setTeamsOpen} bracket={bracket} participants={detail.participantes} onSave={onSaveTeams} />
      <MatchResultDialog match={match} bracket={bracket} onOpenChange={(open) => { if (!open) setMatch(null) }} onSave={onRecordResult} />
      <ConfirmDialog
        open={confirm === 'redraw'}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title="Sortear os times de novo?"
        description="Os participantes são redistribuídos entre os mesmos times. Nomes, partidas e placares continuam."
        confirmLabel="Sortear de novo"
        onConfirm={onRedraw}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title="Excluir o chaveamento?"
        description="Times, partidas e placares são apagados. Os participantes continuam inscritos e você pode montar outro chaveamento."
        confirmLabel="Excluir chaveamento"
        destructive
        onConfirm={onDelete}
      />
    </Card>
  )
}
