import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleAlert, Loader2, Send, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { MessageBubble } from './MessageBubble'
import { useForum } from '@/hooks/useForum'
import { initials } from '@/lib/formatters'
import type { ForumMessage } from '@/lib/types'

interface Props {
  turmaId: string | null
  turmaNome: string | null
  totalMembros: number | null
  myUserId: string
  myRole: 'professor' | 'aluno'
  live: boolean
  revision: number
}

const DATE_GROUP = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' })

/** Agrupador por dia entre mensagens (como no WhatsApp). */
function dayLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : DATE_GROUP.format(parsed)
}

export function ChatRoom({ turmaId, turmaNome, totalMembros, myUserId, myRole, live, revision }: Props) {
  const forum = useForum({ turmaId, revision })
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  // Track whether the user is reading older messages: auto-scroll only sticks
  // when they are near the bottom (reading the newest page).
  const stickToBottomRef = useRef(true)
  const previousCount = useRef(0)

  const onScroll = () => {
    const node = scrollRef.current
    if (!node) return
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
  }

  // Auto-scroll to the newest message when it arrives (only if pinned to bottom).
  useEffect(() => {
    if (forum.messages.length > previousCount.current && stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    previousCount.current = forum.messages.length
  }, [forum.messages.length])

  // A class switch always jumps to the newest message after the initial load.
  useEffect(() => {
    if (turmaId && !forum.loading) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turmaId, forum.loading])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || forum.sending) return
    setDraft('')
    try { await forum.send(text) } catch { setDraft(text) } // restore draft on failure
  }

  // "showAuthor": nome sobre a bolha quando o autor muda entre mensagens.
  const grouped = useMemo(() => forum.messages.map((message, index) => {
    const previous: ForumMessage | undefined = forum.messages[index - 1]
    const newDay = !previous || dayLabel(previous.criado_em) !== dayLabel(message.criado_em)
    const showAuthor = !previous || previous.autor_id !== message.autor_id || newDay
    return { message, showAuthor, newDay }
  }), [forum.messages])

  if (!turmaId) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center p-10 text-center">
          <Users aria-hidden="true" className="size-8 text-muted-foreground" />
          <h2 className="mt-4 font-display font-bold">Escolha uma turma</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Selecione uma turma no menu para abrir o grupo de conversa dela.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col shadow-none ring-1 ring-border">
      <CardHeader className="border-b border-border/70 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-10 bg-[#EAF0E5]">
            <AvatarFallback className="bg-[#EAF0E5] text-sm font-bold text-[#234E40]">{initials(turmaNome ?? 'T')}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate font-display text-base">{turmaNome ?? 'Turma'}</CardTitle>
            <CardDescription className="truncate">
              Grupo da turma · {totalMembros ?? '—'} membro(s) · {live ? 'conectado em tempo real' : 'atualização periódica'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto bg-[#FAFCF7] px-4 py-4"
        role="log"
        aria-label={`Mensagens da turma ${turmaNome ?? ''}`}
        aria-live="polite"
      >
        {forum.loading ? (
          <div className="space-y-3">
            <Skeleton className="ml-10 h-16 w-2/3 rounded-2xl" />
            <Skeleton className="mr-10 ml-auto h-12 w-1/2 rounded-2xl" />
            <Skeleton className="ml-10 h-16 w-1/2 rounded-2xl" />
          </div>
        ) : forum.error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Não foi possível carregar</AlertTitle>
            <AlertDescription>{forum.error}</AlertDescription>
          </Alert>
        ) : forum.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Users aria-hidden="true" className="size-8 text-muted-foreground" />
            <p className="mt-3 font-display font-bold">Nenhuma mensagem ainda</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Envie a primeira mensagem para a turma.</p>
          </div>
        ) : (
          <>
            {forum.hasMore && (
              <div className="mb-4 flex justify-center">
                <Button variant="outline" size="sm" className="rounded-full" disabled={forum.loadingOlder} onClick={() => void forum.loadOlder()}>
                  {forum.loadingOlder ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  {forum.loadingOlder ? 'Carregando…' : 'Carregar mensagens antigas'}
                </Button>
              </div>
            )}
            <ul className="m-0! list-none space-y-1 p-0!">
              {grouped.map(({ message, showAuthor, newDay }) => (
                <div key={message.id} className="contents">
                  {newDay && (
                    <li className="my-3 flex justify-center" aria-hidden="true">
                      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">{dayLabel(message.criado_em)}</span>
                    </li>
                  )}
                  <MessageBubble message={message} myUserId={myUserId} showAuthor={showAuthor} />
                </div>
              ))}
            </ul>
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border/70 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
            onKeyDown={(event) => {
              // Enter envia (comportamento de chat); Shift+Enter quebra linha.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit(event)
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={myRole === 'professor' ? 'Mensagem para a turma…' : 'Escreva para a turma…'}
            aria-label="Nova mensagem"
            className="min-h-11 flex-1 resize-none rounded-2xl"
          />
          <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" disabled={!draft.trim() || forum.sending} aria-label="Enviar mensagem">
            {forum.sending ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Send aria-hidden="true" className="size-5" />}
          </Button>
        </div>
      </form>
    </Card>
  )
}
