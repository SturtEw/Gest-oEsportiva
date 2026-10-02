import { useState } from 'react'
import { Copy, KeyRound, Link2, RefreshCw, Ticket, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate } from '@/lib/formatters'
import { copyToClipboard, formatInviteCode, inviteLink } from '@/lib/invite-code'
import type { ClassInvite, TeacherInviteClass } from '@/lib/types'
import { cn } from 'cn'

const VALIDITY_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: 'Sem prazo', days: null },
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
]

interface Props {
  classes: TeacherInviteClass[]
  onGenerate: (turmaId: string, validadeDias: number | null) => Promise<ClassInvite>
  onRevoke: (inviteId: string) => Promise<void>
  readOnly?: boolean
}

export function InviteCodesCard({ classes, onGenerate, onRevoke, readOnly }: Props) {
  const [generating, setGenerating] = useState<TeacherInviteClass | null>(null)
  const [revoking, setRevoking] = useState<TeacherInviteClass | null>(null)

  return (
    <Card className="shadow-none ring-1 ring-border">
      <CardHeader>
        <CardTitle className="font-display text-lg font-bold">Códigos de convite</CardTitle>
        <CardDescription className="leading-6">
          Cada turma tem um código próprio. O aluno que usar o código no cadastro entra direto, sem precisar de aprovação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {classes.length === 0 ? (
          <div className="py-10 text-center">
            <Ticket aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-display font-bold">Nenhuma turma vinculada</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">A administração precisa vincular uma turma a você para gerar convites.</p>
          </div>
        ) : (
          <ul className="grid gap-3 ps-0! mb-0!">
            {classes.map((item) => (
              <ClassInviteItem
                key={item.turma_id}
                item={item}
                readOnly={readOnly}
                onGenerate={() => setGenerating(item)}
                onRevoke={() => setRevoking(item)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <GenerateInviteDialog
        target={generating}
        onClose={() => setGenerating(null)}
        onConfirm={async (days) => {
          if (!generating) return
          const invite = await onGenerate(generating.turma_id, days)
          setGenerating(null)
          toast.success(`Novo código para ${generating.turma_nome}: ${formatInviteCode(invite.codigo)}`)
        }}
      />

      <Dialog open={Boolean(revoking)} onOpenChange={(open) => { if (!open) setRevoking(null) }}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Desativar o código?</DialogTitle>
            <DialogDescription>
              {revoking?.convite ? `${formatInviteCode(revoking.convite.codigo)} deixa de funcionar imediatamente.` : ''} Quem já entrou continua na turma.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>Manter</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!revoking?.convite) return
                try {
                  await onRevoke(revoking.convite.id)
                  toast(`Código de ${revoking.turma_nome} desativado.`)
                  setRevoking(null)
                } catch (cause) {
                  toast.error(cause instanceof Error ? cause.message : 'Não foi possível desativar o código.')
                }
              }}
            >
              Desativar código
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ClassInviteItem({ item, readOnly, onGenerate, onRevoke }: { item: TeacherInviteClass; readOnly?: boolean; onGenerate: () => void; onRevoke: () => void }) {
  const invite = item.convite
  const usable = invite && !invite.expirado

  const copy = async (text: string, what: string) => {
    if (await copyToClipboard(text)) toast.success(`${what} copiado.`)
    else toast.error('O navegador não permitiu copiar. Selecione e copie manualmente.')
  }

  return (
    <li className="flex flex-col rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{item.turma_nome}</p>
          <p className="truncate text-xs text-muted-foreground">{[item.modalidade, item.ano].filter(Boolean).join(' · ')}</p>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-full text-muted-foreground tabular-nums" aria-label={`${item.total_alunos} de ${item.capacidade} vagas ocupadas`}>
          {item.total_alunos}/{item.capacidade}
        </Badge>
      </div>

      {usable ? (
        <div className="mt-4 rounded-xl bg-accent/45 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent-foreground/70">Código da turma</p>
          <p className="mt-1 select-all whitespace-nowrap font-mono text-2xl font-bold tracking-[0.18em] text-accent-foreground">{formatInviteCode(invite.codigo)}</p>
          <p className="mt-1 text-xs text-accent-foreground/75">
            {invite.usos === 1 ? '1 aluno entrou' : `${invite.usos} alunos entraram`} · {invite.expira_em ? `válido até ${formatDate(invite.expira_em)}` : 'sem prazo de validade'}
          </p>
        </div>
      ) : (
        <div className={cn('mt-4 flex gap-2 rounded-xl px-4 py-3 text-xs leading-5', invite?.expirado ? 'bg-notice text-notice-foreground' : 'bg-muted text-muted-foreground')}>
          {invite?.expirado ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          {invite?.expirado ? `O código ${formatInviteCode(invite.codigo)} expirou. Gere um novo para continuar convidando.` : 'Nenhum código ativo. Gere um para os alunos entrarem direto nesta turma.'}
        </div>
      )}

      {!readOnly && (
        <div className="mt-3 flex flex-wrap gap-2">
          {usable ? (
            <>
              <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => void copy(formatInviteCode(invite.codigo), 'Código')}>
                <Copy data-icon="inline-start" />Copiar código
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={() => void copy(inviteLink(invite.codigo), 'Link de cadastro')}>
                <Link2 data-icon="inline-start" />Copiar link
              </Button>
              <Button size="sm" variant="ghost" className="rounded-lg" onClick={onGenerate}>
                <RefreshCw data-icon="inline-start" />Gerar novo
              </Button>
              <Button size="sm" variant="ghost" className="rounded-lg text-destructive hover:text-destructive" onClick={onRevoke}>
                Desativar
              </Button>
            </>
          ) : (
            <Button size="sm" className="rounded-lg" onClick={onGenerate}>
              <Ticket data-icon="inline-start" />Gerar código
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function GenerateInviteDialog({ target, onClose, onConfirm }: { target: TeacherInviteClass | null; onClose: () => void; onConfirm: (days: number | null) => Promise<void> }) {
  const [days, setDays] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = target?.convite && !target.convite.expirado ? target.convite : null

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try { await onConfirm(days); setDays(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o código.') }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) { setError(null); onClose() } }}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Gerar código para {target?.turma_nome}</DialogTitle>
          <DialogDescription>Compartilhe o código ou o link com os alunos desta turma.</DialogDescription>
        </DialogHeader>
        {current && (
          <p className="flex gap-2 rounded-xl border border-notice-border bg-notice px-3 py-2 text-xs leading-5 text-notice-foreground">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            O código atual, {formatInviteCode(current.codigo)}, deixa de funcionar assim que o novo for gerado.
          </p>
        )}
        <fieldset>
          <legend className="text-sm font-medium">Validade</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VALIDITY_OPTIONS.map((option) => (
              <Button
                key={option.label}
                type="button"
                variant={days === option.days ? 'default' : 'outline'}
                className="h-9 rounded-lg"
                aria-pressed={days === option.days}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void confirm()} disabled={busy}>{busy ? 'Gerando…' : 'Gerar código'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
