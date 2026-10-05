import { useMemo, useState, type FormEvent } from 'react'
import { Check, CircleAlert, Copy, Link2, MailCheck, MailX, RotateCw, Send, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatDate } from '@/lib/formatters'
import { copyToClipboard } from '@/lib/invite-code'
import { teacherInviteLink } from '@/lib/teacher-invite'
import type { AdminClass, TeacherInvite, TeacherInviteStatus } from '@/lib/types'
import { useTeacherInvites, type NewTeacherInvite } from './useTeacherInvites'

const NO_CLASS = 'none'
const VALIDITY_OPTIONS = [
  { value: '3', label: '3 dias' },
  { value: '7', label: '7 dias' },
  { value: '14', label: '14 dias' },
  { value: '30', label: '30 dias' },
]

const STATUS: Record<TeacherInviteStatus, { label: string; className: string }> = {
  pendente: { label: 'Aguardando cadastro', className: 'bg-notice text-notice-foreground ring-1 ring-notice-border' },
  usado: { label: 'Cadastro concluído', className: 'bg-secondary text-primary' },
  expirado: { label: 'Expirado', className: 'bg-muted text-muted-foreground' },
  revogado: { label: 'Cancelado', className: 'bg-danger-soft text-danger-soft-foreground' },
}

/**
 * "Professores" tab: the root admin invites a teacher by e-mail and gets a one-time
 * link. Opening it leads to the signup screen; the new account is an active teacher.
 */
export function TeacherInvitesPanel({ classes, revision }: { classes: AdminClass[]; revision: number }) {
  const { invites, loading, error, created, busyId, create, revoke, dismissCreated } = useTeacherInvites(revision)
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [turmaId, setTurmaId] = useState(NO_CLASS)
  const [validity, setValidity] = useState('7')
  const [sendEmail, setSendEmail] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Only classes without a teacher can be handed to a new one.
  const freeClasses = useMemo(() => classes.filter((item) => !item.professor_id), [classes])
  const classItems = useMemo(() => [{ value: NO_CLASS, label: 'Sem turma por enquanto' }, ...freeClasses.map((item) => ({ value: item.id, label: `${item.nome} · ${item.modalidade}` }))], [freeClasses])
  const link = created ? teacherInviteLink(created.token) : ''

  const submit = async (payload: NewTeacherInvite) => {
    setSubmitting(true)
    setCopied(false)
    const result = await create(payload)
    setSubmitting(false)
    if (result) { setEmail(''); setNome(''); setTurmaId(NO_CLASS) }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit({
      email: email.trim(),
      ...(nome.trim() ? { nome: nome.trim() } : {}),
      ...(turmaId !== NO_CLASS ? { turma_id: turmaId } : {}),
      validade_dias: Number(validity),
      enviar_email: sendEmail,
    })
  }

  // "Novo link": same person, fresh token. The previous link stops working.
  const reissue = (invite: TeacherInvite) => void submit({
    email: invite.email,
    ...(invite.nome ? { nome: invite.nome } : {}),
    ...(invite.turma && freeClasses.some((item) => item.id === invite.turma?.id) ? { turma_id: invite.turma.id } : {}),
    validade_dias: Number(validity),
    enviar_email: sendEmail,
  })

  const copy = async () => {
    const ok = await copyToClipboard(link)
    setCopied(ok)
    if (!ok) window.prompt('Copie o link do convite:', link)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">Convidar professor</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Gere um link de cadastro para o e-mail do professor. Quem abrir o link cria a própria senha e já entra como professor, sem passar por aprovação.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display"><Send aria-hidden="true" className="size-4 text-success" />Novo convite</CardTitle>
            <CardDescription>O link vale uma única vez e expira no prazo escolhido.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="invite-email">E-mail do professor</FieldLabel>
                <Input id="invite-email" type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@escola.com.br" className="h-11 rounded-xl bg-white" />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-name">Nome (opcional)</FieldLabel>
                <Input id="invite-name" maxLength={120} value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Aparece no convite" className="h-11 rounded-xl bg-white" />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-validity">Validade do link</FieldLabel>
                <Select items={VALIDITY_OPTIONS} value={validity} onValueChange={(value) => { if (typeof value === 'string') setValidity(value) }}>
                  <SelectTrigger id="invite-validity" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{VALIDITY_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="invite-class">Turma (opcional)</FieldLabel>
                <Select items={classItems} value={turmaId} onValueChange={(value) => setTurmaId(typeof value === 'string' ? value : NO_CLASS)}>
                  <SelectTrigger id="invite-class" className="h-11 w-full rounded-xl bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{classItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
                <FieldDescription>Só aparecem turmas sem professor. O professor assume a turma ao concluir o cadastro.</FieldDescription>
              </Field>
              <label htmlFor="invite-send-email" className="flex items-center gap-3 text-sm sm:col-span-2">
                <Switch id="invite-send-email" checked={sendEmail} onCheckedChange={(checked) => setSendEmail(Boolean(checked))} />
                Enviar o link também por e-mail
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" className="h-11 rounded-xl" disabled={submitting || !email.trim()}>
                  <Link2 aria-hidden="true" />
                  {submitting ? 'Gerando…' : 'Gerar link de convite'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {created ? (
          <Card className="border-0 bg-[#F6FAF2] shadow-none ring-1 ring-[#D5E6CE]" aria-live="polite">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display"><Check aria-hidden="true" className="size-4 text-success" />Link pronto para {created.invite.email}</CardTitle>
              <CardDescription>
                {created.invite.turma ? `Turma: ${created.invite.turma.nome}. ` : ''}
                Válido até {created.invite.expira_em ? formatDate(created.invite.expira_em) : '—'}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={link} aria-label="Link do convite" onFocus={(event) => event.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-xl bg-white font-mono text-xs" />
                <Button type="button" variant={copied ? 'secondary' : 'default'} className="h-11 shrink-0 rounded-xl" onClick={() => void copy()}>
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? 'Copiado' : 'Copiar link'}
                </Button>
              </div>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                {created.email_enviado
                  ? <><MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />Também enviamos o link para o e-mail do professor.</>
                  : <><MailX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-notice-foreground" />O e-mail não foi enviado. Copie o link e mande por WhatsApp ou pelo seu e-mail.</>}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                Este link aparece só agora: o portal guarda apenas uma versão cifrada dele. Se perder, use “Novo link” na lista; o link anterior deixa de valer.
              </p>
              <Button type="button" variant="ghost" size="sm" className="rounded-lg" onClick={dismissCreated}><X aria-hidden="true" />Fechar</Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed bg-white/70 shadow-none ring-1 ring-border">
            <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Como funciona</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Informe o e-mail do professor e gere o link.</li>
                <li>Envie o link (o portal tenta mandar por e-mail também).</li>
                <li>O professor abre o link, preenche os dados e cria a senha ou usa o Google.</li>
                <li>A conta já nasce ativa, com a turma escolhida, se houver.</li>
              </ol>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="border-0 shadow-none ring-1 ring-border">
        <CardHeader>
          <CardTitle className="font-display">Convites enviados</CardTitle>
          <CardDescription>Os 100 mais recentes. Cancele um link pendente se ele foi para a pessoa errada.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && invites.length === 0 ? (
            <div className="space-y-2"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /></div>
          ) : invites.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum convite gerado ainda.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {invites.map((invite) => (
                <li key={invite.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">{invite.nome ?? invite.email}</p>
                      <Badge className={`rounded-full ${STATUS[invite.status].className}`}>{STATUS[invite.status].label}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[invite.nome ? invite.email : null, invite.turma?.nome, inviteDateLine(invite)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {(invite.status === 'pendente' || invite.status === 'expirado') && (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" className="rounded-lg" disabled={submitting} onClick={() => reissue(invite)}>
                        <RotateCw aria-hidden="true" />Novo link
                      </Button>
                      {invite.status === 'pendente' && (
                        <Button type="button" variant="outline" size="sm" className="rounded-lg border-red-200 text-red-800 hover:bg-red-50" disabled={busyId === invite.id} onClick={() => void revoke(invite.id)}>
                          <X aria-hidden="true" />{busyId === invite.id ? 'Cancelando…' : 'Cancelar'}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function inviteDateLine(invite: TeacherInvite): string {
  if (invite.status === 'usado' && invite.usado_em) return `cadastro em ${formatDate(invite.usado_em)}`
  if (invite.status === 'pendente' && invite.expira_em) return `vale até ${formatDate(invite.expira_em)}`
  if (invite.status === 'expirado' && invite.expira_em) return `expirou em ${formatDate(invite.expira_em)}`
  return `criado em ${formatDate(invite.criado_em)}`
}
