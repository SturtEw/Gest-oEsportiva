import { useState } from 'react'
import { ClipboardList, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/formatters'
import type { JoinRequest } from '@/lib/types'
import { RequestStatusBadge } from './RequestStatusBadge'

interface Props {
  requests: JoinRequest[]
  loading: boolean
  error: string | null
  onCancel: (id: string) => Promise<void>
  readOnly?: boolean
}

const HEADLINE: Record<JoinRequest['status'], string> = {
  pendente: 'Pedido em análise',
  aprovada: 'Pedido aprovado',
  rejeitada: 'Pedido não aprovado',
  cancelada: 'Pedido cancelado',
}

/** The student's latest request front and centre, older ones as a short history. */
export function JoinRequestStatusCard({ requests, loading, error, onCancel, readOnly }: Props) {
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [latest, ...older] = requests

  const cancel = async () => {
    if (!latest) return
    setCancelling(true)
    setCancelError(null)
    try { await onCancel(latest.id) }
    catch (cause) { setCancelError(cause instanceof Error ? cause.message : 'Não foi possível cancelar o pedido.') }
    finally { setCancelling(false) }
  }

  return (
    <Card className="shadow-none ring-1 ring-border" aria-live="polite">
      <CardHeader>
        <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground" aria-hidden="true">
          <ClipboardList className="size-5" />
        </span>
        <CardTitle className="mt-3 font-display text-base font-bold">Meus pedidos</CardTitle>
        <CardDescription className="leading-6">Acompanhe aqui a resposta do professor.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !latest ? (
          <Skeleton className="h-28 rounded-xl" />
        ) : error ? (
          <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger-soft-foreground">{error}</p>
        ) : !latest ? (
          <p className="rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
            Você ainda não pediu para entrar em nenhuma turma. Escolha uma na lista e envie seu pedido.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-muted/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-heading">{HEADLINE[latest.status]}</p>
              <RequestStatusBadge status={latest.status} />
            </div>
            <p className="mt-2 text-sm text-foreground">{latest.turma_nome}</p>
            <p className="text-xs text-muted-foreground">
              {[latest.modalidade, latest.professor_nome && `Prof. ${latest.professor_nome}`].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Enviado em {formatDateTime(latest.dataSolicitacao)}</p>
            {latest.status === 'rejeitada' && (
              <p className="mt-3 flex gap-2 rounded-lg bg-white p-3 text-xs leading-5 text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {latest.motivo_rejeicao ? <>Motivo: <span className="text-foreground">{latest.motivo_rejeicao}</span>. </> : null}
                  Você pode pedir para entrar em outra turma.
                </span>
              </p>
            )}
            {latest.status === 'pendente' && (
              <>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  O professor já recebeu seu pedido. Assim que ele responder, esta tela é atualizada.
                </p>
                {!readOnly && (
                  <Button variant="outline" size="sm" className="mt-3 rounded-lg" disabled={cancelling} onClick={() => void cancel()}>
                    {cancelling ? 'Cancelando…' : 'Cancelar pedido'}
                  </Button>
                )}
                {cancelError && <p role="alert" className="mt-2 text-xs text-destructive">{cancelError}</p>}
              </>
            )}
          </div>
        )}

        {older.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Pedidos anteriores</p>
            <ul className="mt-2 divide-y divide-border/70 ps-0! mb-0!">
              {older.slice(0, 4).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.turma_nome}</span>
                    <span className="block text-xs text-muted-foreground">{formatDateTime(item.dataDecisao ?? item.dataSolicitacao)}</span>
                  </span>
                  <RequestStatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
