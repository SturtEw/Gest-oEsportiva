/**
 * AiChatRoom — conversa privada 1-para-1 com o Assistente Virtual.
 *
 * Chat privado: só as mensagens do usuário (à direita) e da IA (à esquerda).
 * Sem avatares de terceiros. Enquanto o backend processa, mostra o indicador
 * "A IA está digitando…".
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, CircleAlert, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, type IaMessage } from '@/lib/api'

interface Props {
  myUserId: string
  /** Realtime invalidation (não usado para streaming; mantido por paridade). */
  revision: number
}

export function AiChatRoom({ myUserId: _myUserId }: Props) {
  const [messages, setMessages] = useState<IaMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true
    api.iaHistory()
      .then((data) => { if (active) setMessages(data.mensagens) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a conversa.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, thinking])

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const texto = draft.trim()
    if (!texto || thinking) return
    setDraft('')
    setError(null)
    // Otimista: o texto do usuário aparece na hora; o servidor confirma depois.
    const localId = `local-${Date.now()}`
    setMessages((current) => [...current, { id: localId, papel: 'user', texto, criado_em: new Date().toISOString(), fonte: 'user' }])
    setThinking(true)
    try {
      const result = await api.iaAsk(texto)
      setMessages((current) => [
        ...current.filter((item) => item.id !== localId),
        result.pergunta,
        result.resposta,
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível falar com o assistente.')
    } finally {
      setThinking(false)
    }
  }

  const retry = () => {
    const lastUser = [...messages].reverse().find((item) => item.papel === 'user')
    if (lastUser) void send({ preventDefault: () => undefined } as FormEvent)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-soft-2">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4" role="log" aria-live="polite" aria-label="Conversa com o assistente virtual">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-3/4 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg">
              <Sparkles aria-hidden="true" className="size-6" />
            </div>
            <p className="mt-3 font-display font-bold text-heading">Assistente Virtual</p>
            <p className="mt-1 max-w-[240px] text-sm text-muted-foreground">
              Pergunte sobre esportes ou como usar a plataforma. Sua conversa é privada.
            </p>
          </div>
        ) : (
          <ul className="m-0 list-none space-y-3 p-0">
            {messages.map((message) => (
              <li key={message.id} className={message.papel === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ' +
                    (message.papel === 'user'
                      ? 'rounded-br-md bg-gradient-to-br from-violet-600 to-purple-700 text-white'
                      : 'rounded-bl-md bg-card text-card-foreground ring-1 ring-border')
                  }
                >
                  {message.texto}
                </div>
              </li>
            ))}
          </ul>
        )}

        {thinking && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-violet-600 dark:text-violet-300">
            <Bot aria-hidden="true" className="size-4 animate-pulse" />
            A IA está digitando…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="px-3 pb-2">
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="flex items-center justify-between gap-2 text-xs">
              <span>{error}</span>
              <Button variant="outline" size="sm" className="rounded-lg" onClick={retry}>
                <RotateCcw aria-hidden="true" className="size-3.5" /> Tentar
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <form onSubmit={send} className="shrink-0 border-t border-border/70 bg-card p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Pergunte ao assistente…"
            aria-label="Mensagem para o assistente"
            className="min-h-11 flex-1 resize-none rounded-2xl"
          />
          <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-purple-700" disabled={!draft.trim() || thinking} aria-label="Enviar mensagem">
            {thinking ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Send aria-hidden="true" className="size-5" />}
          </Button>
        </div>
      </form>
    </div>
  )
}
