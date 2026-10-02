import { useState, type FormEvent } from 'react'
import { Dumbbell, RefreshCw, Search, Send, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { AvailableClass, JoinRequest } from '@/lib/types'

const MESSAGE_LIMIT = 300

interface Props {
  query: string
  onQueryChange: (value: string) => void
  classes: AvailableClass[]
  loading: boolean
  error: string | null
  onRetry: () => void
  /** Another class already has a pending request: one request at a time. */
  pendingRequest: JoinRequest | null
  onRequest: (turmaId: string, mensagem?: string) => Promise<JoinRequest>
  onRequested: (request: JoinRequest) => void
  readOnly?: boolean
}

export function ClassSearchList({ query, onQueryChange, classes, loading, error, onRetry, pendingRequest, onRequest, onRequested, readOnly }: Props) {
  const [target, setTarget] = useState<AvailableClass | null>(null)

  return (
    <Card className="shadow-none ring-1 ring-border">
      <CardHeader className="border-b border-border/70">
        <CardTitle className="font-display text-lg font-bold">Turmas disponíveis</CardTitle>
        <CardDescription className="leading-6">Escolha uma turma e peça para participar. Você pode ter um pedido em análise por vez.</CardDescription>
        <div className="relative mt-3">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nome ou modalidade"
            aria-label="Buscar turma por nome ou modalidade"
            maxLength={60}
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        {pendingRequest && (
          <p className="mt-1 rounded-xl border border-notice-border bg-notice px-3 py-2 text-xs leading-5 text-notice-foreground">
            Seu pedido para <strong>{pendingRequest.turma_nome}</strong> está em análise. Para escolher outra turma, cancele esse pedido primeiro.
          </p>
        )}

        {loading && classes.length === 0 ? (
          <div className="space-y-3 py-3" aria-label="Carregando turmas">
            <Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" />
          </div>
        ) : error ? (
          <Alert variant="destructive" className="my-3">
            <AlertDescription className="flex items-center justify-between gap-3">
              {error}
              <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw data-icon="inline-start" />Tentar novamente</Button>
            </AlertDescription>
          </Alert>
        ) : classes.length === 0 ? (
          <div className="py-10 text-center">
            <Users aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-display font-bold">{query.trim() ? 'Nenhuma turma encontrada' : 'Ainda não há turmas abertas'}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {query.trim() ? 'Tente outro nome ou a modalidade, como “futsal” ou “vôlei”.' : 'Quando um professor tiver uma turma, ela aparece aqui.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/70 ps-0! mb-0!" aria-busy={loading}>
            {classes.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground" aria-hidden="true">
                  <Dumbbell className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{item.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[item.modalidade, item.ano, item.professor_nome && `Prof. ${item.professor_nome}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge variant="outline" className={item.lotada ? 'rounded-full border-transparent bg-danger-soft text-danger-soft-foreground' : 'rounded-full text-muted-foreground'}>
                  {item.lotada ? 'Lotada' : `${item.vagas} ${item.vagas === 1 ? 'vaga' : 'vagas'}`}
                </Badge>
                {!readOnly && (
                  item.solicitacao_pendente ? (
                    <Button size="sm" variant="secondary" className="rounded-lg" disabled>Pedido enviado</Button>
                  ) : (
                    <Button
                      size="sm"
                      className="rounded-lg"
                      disabled={item.lotada || Boolean(pendingRequest)}
                      onClick={() => setTarget(item)}
                      aria-label={`Pedir para entrar em ${item.nome}`}
                    >
                      Pedir para entrar
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <JoinRequestDialog
        target={target}
        onClose={() => setTarget(null)}
        onSubmit={async (mensagem) => {
          if (!target) return
          const created = await onRequest(target.id, mensagem)
          setTarget(null)
          onRequested(created)
        }}
      />
    </Card>
  )
}

function JoinRequestDialog({ target, onClose, onSubmit }: { target: AvailableClass | null; onClose: () => void; onSubmit: (mensagem?: string) => Promise<void> }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setMessage('')
    setError(null)
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(message.trim() || undefined)
      setMessage('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o pedido.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Pedir para entrar em {target?.nome}</DialogTitle>
          <DialogDescription>
            {target?.professor_nome ? `${target.professor_nome} recebe` : 'O professor recebe'} seu pedido e decide se você entra na turma.
          </DialogDescription>
        </DialogHeader>
        <form id="join-request-form" onSubmit={(event) => void submit(event)} className="space-y-2">
          <Field>
            <FieldLabel htmlFor="join-request-message">Mensagem para o professor (opcional)</FieldLabel>
            <Textarea
              id="join-request-message"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_LIMIT))}
              rows={3}
              maxLength={MESSAGE_LIMIT}
              placeholder="Ex.: Jogo desde os 10 anos e treino às terças."
              className="rounded-xl"
              aria-describedby="join-request-count"
            />
            <FieldDescription id="join-request-count" className="text-right text-xs tabular-nums">{message.length}/{MESSAGE_LIMIT}</FieldDescription>
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>Cancelar</Button>
          <Button form="join-request-form" type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar pedido'}
            <Send data-icon="inline-end" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
