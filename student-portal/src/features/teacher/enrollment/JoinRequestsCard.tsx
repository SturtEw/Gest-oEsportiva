import { useState, type FormEvent } from 'react'
import { Check, Inbox, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { SearchInput, matchesQuery } from '@/components/SearchInput'
import { RequestStatusBadge } from '@/features/enrollment/RequestStatusBadge'
import { firstName, formatDateTime, initials } from '@/lib/formatters'
import type { JoinRequest } from '@/lib/types'

const REASON_LIMIT = 300

interface Props {
  pending: JoinRequest[]
  history: JoinRequest[]
  pendingCount: number
  onDecide: (id: string, aprovar: boolean, motivo?: string) => Promise<JoinRequest>
  readOnly?: boolean
}

export function JoinRequestsCard({ pending, history, pendingCount, onDecide, readOnly }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<JoinRequest | null>(null)
  const [query, setQuery] = useState('')
  const visiblePending = pending.filter((item) => matchesQuery(item.aluno_nome, query) || matchesQuery(item.turma_nome, query))
  const visibleHistory = history.filter((item) => matchesQuery(item.aluno_nome, query) || matchesQuery(item.turma_nome, query))

  const decide = async (item: JoinRequest, aprovar: boolean, motivo?: string) => {
    setBusyId(item.id)
    try {
      await onDecide(item.id, aprovar, motivo)
      toast.success(aprovar ? `${firstName(item.aluno_nome)} agora faz parte de ${item.turma_nome}.` : `Pedido de ${firstName(item.aluno_nome)} recusado.`)
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Não foi possível registrar a decisão.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="shadow-none ring-1 ring-border">
      <CardHeader>
        <CardTitle className="font-display text-lg font-bold">Solicitações de entrada</CardTitle>
        <CardDescription className="leading-6">Alunos que pediram para entrar nas suas turmas. Aprovar coloca o aluno na turma na hora.</CardDescription>
      </CardHeader>
      <CardContent>
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar por aluno ou turma…" label="Filtrar solicitações" className="mb-3" />
        {/* flex-col explicitly: the primitive's data-horizontal variant does not match Base UI's data-orientation. */}
        <Tabs defaultValue="pendentes" className="flex-col">
          <TabsList className="h-9">
            <TabsTrigger value="pendentes" className="px-3">
              Pendentes
              {pendingCount > 0 && <span className="ml-1 rounded-full bg-notice px-1.5 text-[11px] font-bold text-notice-foreground tabular-nums">{pendingCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="historico" className="px-3">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="pendentes">
            {visiblePending.length === 0 ? (
              <EmptyQueue title={query.trim() ? 'Nada corresponde à busca' : 'Nenhuma solicitação pendente'} message={query.trim() ? 'Tente outro nome ou limpe a busca.' : 'Quando um aluno pedir para entrar em uma turma sua, o pedido aparece aqui.'} />
            ) : (
              <ul className="divide-y divide-border/70 ps-0! mb-0!">
                {visiblePending.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" aria-hidden="true">
                      {initials(item.aluno_nome)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.aluno_nome}</p>
                      <p className="text-xs text-muted-foreground">
                        Quer entrar em <span className="font-semibold text-foreground">{item.turma_nome}</span> · {formatDateTime(item.dataSolicitacao)}
                      </p>
                      {item.mensagem && (
                        <blockquote className="mt-2 rounded-xl bg-muted px-3 py-2 text-sm leading-6 text-foreground/80">“{item.mensagem}”</blockquote>
                      )}
                    </div>
                    {!readOnly && (
                      <div className="flex shrink-0 gap-2 sm:pt-0.5">
                        <Button variant="outline" size="sm" className="rounded-lg" disabled={busyId === item.id} onClick={() => setRejecting(item)} aria-label={`Recusar pedido de ${item.aluno_nome}`}>
                          <X data-icon="inline-start" />Recusar
                        </Button>
                        <Button size="sm" className="rounded-lg" disabled={busyId === item.id} onClick={() => void decide(item, true)} aria-label={`Aprovar pedido de ${item.aluno_nome}`}>
                          <Check data-icon="inline-start" />{busyId === item.id ? 'Salvando…' : 'Aprovar'}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="historico">
            {visibleHistory.length === 0 ? (
              <EmptyQueue title={query.trim() ? 'Nada corresponde à busca' : 'Nenhuma decisão ainda'} message={query.trim() ? 'Tente outro nome ou limpe a busca.' : 'Pedidos aprovados e recusados ficam registrados aqui.'} />
            ) : (
              <ul className="divide-y divide-border/70 ps-0! mb-0!">
                {visibleHistory.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.aluno_nome}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.turma_nome} · {formatDateTime(item.dataDecisao ?? item.dataSolicitacao)}</p>
                      {item.status === 'rejeitada' && item.motivo_rejeicao && <p className="mt-1 text-xs text-muted-foreground">Motivo: {item.motivo_rejeicao}</p>}
                    </div>
                    <RequestStatusBadge status={item.status} />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <RejectDialog
        target={rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={async (motivo) => {
          if (rejecting && await decide(rejecting, false, motivo)) setRejecting(null)
        }}
      />
    </Card>
  )
}

function EmptyQueue({ title, message }: { title: string; message: string }) {
  return (
    <div className="py-10 text-center">
      <Inbox aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 font-display font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function RejectDialog({ target, onClose, onConfirm }: { target: JoinRequest | null; onClose: () => void; onConfirm: (motivo?: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try { await onConfirm(reason.trim() || undefined); setReason('') }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) { setReason(''); onClose() } }}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Recusar pedido de {target ? firstName(target.aluno_nome) : ''}</DialogTitle>
          <DialogDescription>O aluno vê que o pedido para {target?.turma_nome} não foi aprovado e pode procurar outra turma.</DialogDescription>
        </DialogHeader>
        <form id="reject-request-form" onSubmit={(event) => void submit(event)}>
          <Field>
            <FieldLabel htmlFor="reject-reason">Motivo (opcional, visível para o aluno)</FieldLabel>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, REASON_LIMIT))}
              rows={3}
              maxLength={REASON_LIMIT}
              placeholder="Ex.: Esta turma é para a categoria sub-15."
              className="rounded-xl"
              aria-describedby="reject-reason-count"
            />
            <FieldDescription id="reject-reason-count" className="text-right text-xs tabular-nums">{reason.length}/{REASON_LIMIT}</FieldDescription>
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(''); onClose() }} disabled={busy}>Voltar</Button>
          <Button form="reject-request-form" type="submit" variant="destructive" disabled={busy}>{busy ? 'Recusando…' : 'Recusar pedido'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
