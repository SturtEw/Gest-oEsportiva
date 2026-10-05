import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useAction } from '@/hooks/useAction'
import type { BracketInput } from '@/lib/api'
import { FORMAT_HINTS, FORMAT_LABELS, TEAM_LIMITS, teamSizeHint } from '@/lib/bracket'
import type { BracketFormat } from '@/lib/types'
import { cn } from 'cn'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  participants: number
  onCreate: (input: BracketInput) => Promise<unknown>
}

const FORMATS: BracketFormat[] = ['mata_mata', 'pontos_corridos']

/** Format + number of teams; the server deals the participants among the teams. */
export function BracketSetupDialog({ open, onOpenChange, participants, onCreate }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Montar chaveamento</DialogTitle>
          <DialogDescription>Os {participants} participantes são sorteados entre os times. Depois você pode trocar alunos de time e renomear.</DialogDescription>
        </DialogHeader>
        <BracketSetupForm participants={participants} onCreate={onCreate} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function BracketSetupForm({ participants, onCreate, onDone }: { participants: number; onCreate: Props['onCreate']; onDone: () => void }) {
  const [formato, setFormato] = useState<BracketFormat>('mata_mata')
  const [countText, setCountText] = useState(String(Math.min(Math.max(2, Math.floor(participants / 4) || 2), TEAM_LIMITS.mata_mata.max)))
  const [names, setNames] = useState<string[]>([])
  const { busy, error, run } = useAction('Não foi possível montar o chaveamento.')

  const limits = TEAM_LIMITS[formato]
  const count = Number(countText)
  const validCount = Number.isInteger(count) && count >= limits.min && count <= limits.max

  const submit = () => {
    if (!validCount) return
    // Array.from, not names.map: unedited inputs are holes, which JSON sends as null.
    const nomes_times = Array.from({ length: count }, (_, index) => (names[index] ?? '').trim())
    void run(() => onCreate({ formato, quantidade_times: count, ...(nomes_times.some(Boolean) ? { nomes_times } : {}) }))
      .then((ok) => { if (ok) onDone() })
  }

  return (
    <div className="space-y-5">
      <FieldSet>
        <FieldLegend variant="label">Formato</FieldLegend>
        <RadioGroup value={formato} onValueChange={(value) => setFormato(value as BracketFormat)} className="gap-2">
          {FORMATS.map((item) => (
            <label
              key={item}
              className={cn('flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-border transition-colors', formato === item && 'bg-accent/35 ring-2 ring-primary/50')}
            >
              <RadioGroupItem value={item} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{FORMAT_LABELS[item]}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{FORMAT_HINTS[item]}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </FieldSet>

      <Field>
        <FieldLabel htmlFor="bracket-team-count">Quantidade de times</FieldLabel>
        <Input
          id="bracket-team-count" type="number" inputMode="numeric" min={limits.min} max={limits.max}
          value={countText} onChange={(event) => setCountText(event.target.value)}
          aria-invalid={!validCount} className="h-11 w-32 rounded-xl"
        />
        <FieldDescription className={cn('text-xs', !validCount && 'text-destructive')}>
          {validCount ? teamSizeHint(participants, count) : `Escolha entre ${limits.min} e ${limits.max} times.`}
        </FieldDescription>
      </Field>

      {validCount && (
        <FieldSet>
          <FieldLegend variant="label">Nomes dos times <span className="font-normal text-muted-foreground">(opcional)</span></FieldLegend>
          <div className="grid max-h-56 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
            {Array.from({ length: count }, (_, index) => (
              <Input
                key={index} maxLength={40} value={names[index] ?? ''}
                onChange={(event) => setNames((current) => { const next = [...current]; next[index] = event.target.value; return next })}
                placeholder={`Time ${index + 1}`} aria-label={`Nome do time ${index + 1}`} className="h-10 rounded-xl"
              />
            ))}
          </div>
        </FieldSet>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={busy}>Cancelar</Button>
        <Button onClick={submit} disabled={busy || !validCount}>{busy ? 'Sorteando…' : 'Sortear times'}</Button>
      </DialogFooter>
    </div>
  )
}
