import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertCircle, ArrowUpRight, Check, Clock3, MessageCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { PublicMessage, SessionUser, StudentClass } from '@/lib/types'
import { formatDateTime, initials } from '@/lib/formatters'

interface Props {
  alunoId: string
  turma: StudentClass | null
  professorNome: string | null
  sessionUser: SessionUser
  messages: PublicMessage[]
  loading: boolean
  error: string | null
  onSend: (text: string) => Promise<void>
  onRetry: (message: PublicMessage) => Promise<void>
  onRefresh: () => void
}

export function QuestionThread({ alunoId, turma, professorNome, sessionUser, messages, loading, error, onSend, onRetry, onRefresh }: Props) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const isOwnMessage = (message: PublicMessage) => message.autor_tipo === sessionUser.tipo

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length])

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setDraft('')
    try {
      await onSend(text)
    } catch {
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.7fr)]" aria-labelledby="questions-title">
      <Card className="overflow-hidden border-0 shadow-none ring-1 ring-border">
        <CardHeader className="border-b border-border/70 bg-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface-soft text-primary"><MessageCircle aria-hidden="true" className="size-5" /></span>
            <div className="min-w-0">
              <CardTitle id="questions-title" className="font-display text-xl font-bold">Dúvidas com o professor</CardTitle>
              <CardDescription className="mt-1">{turma?.nome ?? 'Sua turma'}{professorNome ? ` · ${professorNome}` : ''}</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="icon" className="ml-auto shrink-0" aria-label="Atualizar conversa" onClick={onRefresh}><RefreshCw aria-hidden="true" /></Button>
          </div>
        </CardHeader>

        {!professorNome ? (
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><MessageCircle aria-hidden="true" /></div>
            <p className="mt-4 font-semibold">Sua turma ainda não tem um professor vinculado para receber dúvidas</p>
            <p className="mt-1 text-sm text-muted-foreground">Quando houver um professor responsável, este espaço ficará disponível.</p>
          </CardContent>
        ) : (
          <>
            <ScrollArea className="h-[min(54vh,560px)] min-h-[300px] bg-[#FBFCF9] p-4 sm:p-6">
              <div ref={listRef} className="flex h-full flex-col gap-4" aria-live="polite" aria-label="Mensagens da conversa">
                {loading ? <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4 animate-pulse" />Carregando suas dúvidas…</div> : null}
                {!loading && messages.length === 0 ? (
                  <div className="m-auto max-w-sm py-10 text-center">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#FFF5DB] text-[#9B6D2B]"><MessageCircle aria-hidden="true" className="size-6" /></div>
                    <p className="mt-4 font-semibold">Pode perguntar!</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Escreva sua dúvida para o professor. Ele responderá quando puder.</p>
                  </div>
                ) : null}
                {messages.map((message) => {
                  const own = isOwnMessage(message)
                  return (
                    <div key={message.id} className={`flex items-end gap-2 ${own ? 'justify-end' : 'justify-start'}`}>
                      {!own && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[10px] font-bold text-primary" aria-hidden="true">{initials(message.autor_nome)}</span>}
                      <article className={`max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[78%] ${own ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card text-foreground'}`}>
                        <div className="mb-1 flex items-center gap-2 text-[11px] opacity-75">
                          <span className="font-semibold">{own ? (message.autor_tipo === 'responsavel' ? 'Você · responsável' : 'Você') : `${message.autor_nome}${message.autor_tipo === 'professor' ? ' · professor' : ''}`}</span>
                          <time dateTime={message.dataEnvio}>{formatDateTime(message.dataEnvio)}</time>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.texto}</p>
                        {message.localStatus === 'sending' && <p className="mt-1 flex items-center gap-1 text-[10px] opacity-70"><Clock3 className="size-3" />Enviando</p>}
                        {message.localStatus === 'sent' && <p className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70"><Check className="size-3" />Enviada</p>}
                        {message.localStatus === 'failed' && <div className="mt-2 flex items-center justify-between gap-2 text-[11px]"><span className="flex items-center gap-1 text-red-700"><AlertCircle className="size-3" />Não enviada</span><Button type="button" variant="outline" size="xs" onClick={() => void onRetry(message)}>Tentar enviar novamente</Button></div>}
                      </article>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>

            {error && <div role="alert" className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:mx-6"><span>{error}</span><Button type="button" variant="outline" size="sm" onClick={onRefresh}>Tentar novamente</Button></div>}

            <form className="border-t border-border/70 bg-card p-4 sm:p-6" onSubmit={(event) => void submit(event)}>
              <Field>
                <FieldLabel htmlFor={`question-${alunoId}`} className="text-sm font-semibold">Escreva sua dúvida para o professor</FieldLabel>
                <Textarea
                  id={`question-${alunoId}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                  onKeyDown={onComposerKeyDown}
                  maxLength={2000}
                  rows={3}
                  placeholder="Conte o que você gostaria de saber…"
                  disabled={sending}
                  aria-describedby={`question-help-${alunoId}`}
                  className="mt-2 min-h-24 resize-y rounded-xl bg-[#FCFDFB]"
                />
                <FieldDescription id={`question-help-${alunoId}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>Enter para enviar · Shift+Enter para quebrar linha</span>
                  <span>{draft.length}/2000</span>
                </FieldDescription>
              </Field>
              <div className="mt-3 flex flex-col-reverse items-start justify-between gap-3 sm:flex-row sm:items-center">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-[#668C5D]" />Conversa visível apenas para quem está vinculado a este aluno e ao professor.</p>
                <Button type="submit" disabled={!draft.trim() || sending} className="h-11 w-full rounded-xl px-5 sm:w-auto">
                  <span>{sending ? 'Enviando…' : 'Enviar dúvida'}</span><Send aria-hidden="true" />
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>

      <aside className="space-y-4">
        <Card className="border-0 bg-surface-soft shadow-none ring-0">
          <CardContent className="p-5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-card text-muted-strong"><ShieldCheck aria-hidden="true" className="size-5" /></div>
            <h2 className="mt-4 font-display text-lg font-bold text-primary">Uma conversa respeitosa</h2>
            <p className="mt-2 text-sm leading-6 text-[#52645A]">Não compartilhe senhas ou informações pessoais. Seu professor responderá assim que estiver disponível.</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardContent className="p-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Assunto</p>
            <p className="mt-2 font-semibold">{turma?.nome ?? 'Turma não informada'}</p>
            <p className="mt-1 text-sm text-muted-foreground">Dúvidas e orientações sobre sua experiência esportiva.</p>
            <p className="mt-4 flex items-center gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground"><ArrowUpRight className="size-4" />Você pode voltar a esta conversa quando quiser.</p>
          </CardContent>
        </Card>
      </aside>
    </section>
  )
}
