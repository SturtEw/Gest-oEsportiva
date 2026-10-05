import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useAction } from '@/hooks/useAction'
import type { MatchResultInput } from '@/lib/api'
import { roundLabel } from '@/lib/bracket'
import type { ActivityBracket, BracketMatch } from '@/lib/types'

interface Props {
  match: BracketMatch | null
  bracket: ActivityBracket
  onOpenChange: (open: boolean) => void
  onSave: (matchId: string, result: MatchResultInput) => Promise<unknown>
}

/** Score of one match; a knockout draw asks who advances. */
export function MatchResultDialog({ match, bracket, onOpenChange, onSave }: Props) {
  return (
    <Dialog open={Boolean(match)} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        {match && <MatchResultForm key={match.id} match={match} bracket={bracket} onSave={onSave} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

const MAX_SCORE = 999

function MatchResultForm({ match, bracket, onSave, onDone }: { match: BracketMatch; bracket: ActivityBracket; onSave: Props['onSave']; onDone: () => void }) {
  const nameOf = (id: string | null) => bracket.times.find((team) => team.id === id)?.nome ?? 'A definir'
  const [scoreA, setScoreA] = useState(match.placar_a === null ? '' : String(match.placar_a))
  const [scoreB, setScoreB] = useState(match.placar_b === null ? '' : String(match.placar_b))
  const [winner, setWinner] = useState<string | null>(match.vencedor_id)
  const { busy, error, run } = useAction('Não foi possível salvar o placar.')

  const parse = (text: string) => (text === '' ? null : Number(text))
  const a = parse(scoreA)
  const b = parse(scoreB)
  const valid = [a, b].every((value) => value !== null && Number.isInteger(value) && value >= 0 && value <= MAX_SCORE)
  const knockoutDraw = bracket.formato === 'mata_mata' && valid && a === b
  const ready = valid && (!knockoutDraw || Boolean(winner))
  const finished = match.status === 'finalizada'

  const save = (result: MatchResultInput) => void run(() => onSave(match.id, result)).then((ok) => { if (ok) onDone() })
  const submit = () => {
    if (!ready || a === null || b === null) return
    save({ placar_a: a, placar_b: b, vencedor_id: knockoutDraw ? winner : null })
  }

  const scoreInput = (id: string, label: string, value: string, onChange: (value: string) => void) => (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0 truncate text-sm font-semibold">{label}</label>
      <Input
        id={id} type="number" inputMode="numeric" min={0} max={MAX_SCORE} value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-20 shrink-0 rounded-xl text-center font-display text-lg font-bold tabular-nums"
      />
    </div>
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-lg font-bold">{finished ? 'Alterar placar' : 'Registrar placar'}</DialogTitle>
        <DialogDescription>
          {roundLabel(match.rodada, bracket.total_rodadas, bracket.formato)}
          {bracket.formato === 'mata_mata' ? ' · o vencedor avança sozinho para a próxima fase.' : ' · vitória vale 3 pontos, empate 1.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 rounded-xl bg-muted/60 p-4">
        {scoreInput('match-score-a', nameOf(match.time_a_id), scoreA, setScoreA)}
        {scoreInput('match-score-b', nameOf(match.time_b_id), scoreB, setScoreB)}
      </div>

      {knockoutDraw && (
        <FieldSet>
          <FieldLegend variant="label">Empate: quem avança? <span className="font-normal text-muted-foreground">(pênaltis, desempate)</span></FieldLegend>
          <RadioGroup value={winner} onValueChange={(value) => setWinner(typeof value === 'string' ? value : null)}>
            {[match.time_a_id, match.time_b_id].map((teamId) => teamId && (
              <label key={teamId} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted/70">
                <RadioGroupItem value={teamId} />
                <span className="text-sm">{nameOf(teamId)}</span>
              </label>
            ))}
          </RadioGroup>
        </FieldSet>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter className="sm:justify-between">
        {finished ? (
          <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => save({ placar_a: null, placar_b: null })}>
            Desfazer resultado
          </Button>
        ) : <span className="hidden sm:block" />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={onDone} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !ready}>{busy ? 'Salvando…' : 'Salvar placar'}</Button>
        </div>
      </DialogFooter>
    </>
  )
}
