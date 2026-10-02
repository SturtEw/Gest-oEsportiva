import { useState, type FormEvent } from 'react'
import { ArrowRight, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatInviteCode, isCompleteInviteCode, normalizeInviteCode } from '@/lib/invite-code'
import type { JoinedClass } from '@/lib/types'

interface Props {
  onJoin: (code: string) => Promise<JoinedClass>
  onJoined: (turma: JoinedClass) => void
  disabled?: boolean
}

/** "Tenho um código": the direct path into a class, no teacher approval needed. */
export function InviteCodeForm({ onJoin, onJoined, disabled }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = isCompleteInviteCode(code)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    try {
      onJoined(await onJoin(code))
      setCode('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível usar este código.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="shadow-none ring-1 ring-border">
      <CardHeader>
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground" aria-hidden="true">
          <Ticket className="size-5" />
        </span>
        <CardTitle className="mt-3 font-display text-base font-bold">Tenho um código de convite</CardTitle>
        <CardDescription className="leading-6">Digite o código que seu professor compartilhou e entre na turma na hora.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
          <Field data-invalid={error ? 'true' : undefined}>
            <FieldLabel htmlFor="enrollment-invite-code">Código de convite</FieldLabel>
            <Input
              id="enrollment-invite-code"
              value={formatInviteCode(code)}
              onChange={(event) => { setCode(normalizeInviteCode(event.target.value)); setError(null) }}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={9}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'enrollment-invite-error' : 'enrollment-invite-help'}
              className="h-12 rounded-xl bg-white text-center font-mono text-lg font-bold tracking-[0.22em] uppercase"
            />
            {error
              ? <FieldError id="enrollment-invite-error">{error}</FieldError>
              : <FieldDescription id="enrollment-invite-help" className="text-xs">8 letras e números, com ou sem o traço.</FieldDescription>}
          </Field>
          <Button type="submit" className="h-11 w-full rounded-xl" disabled={disabled || !complete || busy}>
            {busy ? 'Entrando…' : 'Entrar na turma'}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
