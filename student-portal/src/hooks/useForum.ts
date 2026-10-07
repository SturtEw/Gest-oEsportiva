import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { ConnectionStatus, ForumMessage } from '@/lib/types'

const PAGE_SIZE = 50

interface Options {
  turmaId: string | null
  /** Bumped by realtime invalidations of section "forum". */
  revision: number
}

/**
 * Forum chat state for one class.
 *
 * Performance: the first load fetches only the last PAGE_SIZE messages
 * (`?limit=`); "carregar mais" pages the history up with `?before=`. Realtime
 * updates fetch only messages newer than the last known one (`?after=`) —
 * the old history is never re-downloaded.
 */
export function useForum({ turmaId, revision }: Options) {
  const [messages, setMessages] = useState<ForumMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs read inside async callbacks without re-subscribing effects.
  const messagesRef = useRef<ForumMessage[]>([])
  messagesRef.current = messages
  const turmaRef = useRef(turmaId)
  turmaRef.current = turmaId

  const reset = useCallback(() => {
    setMessages([]); setHasMore(false); setError(null)
  }, [])

  // Initial load (or class switch): the latest page only.
  useEffect(() => {
    if (!turmaId) { reset(); return }
    let active = true
    setLoading(true)
    setError(null)
    api.messages(turmaId, { limit: PAGE_SIZE })
      .then((result) => {
        if (!active) return
        setMessages(result.mensagens)
        setHasMore(result.has_more)
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as mensagens.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [turmaId, reset])

  // Realtime/polling refresh: only the delta after the newest known message.
  useEffect(() => {
    if (!turmaId || !revision) return
    const newest = messagesRef.current.at(-1)
    let active = true
    api.messages(turmaId, newest ? { after: newest.criado_em } : { limit: PAGE_SIZE })
      .then((result) => {
        if (!active || !result.mensagens.length) return
        setMessages((current) => {
          const known = new Set(current.map((item) => item.id))
          const fresh = result.mensagens.filter((item) => !known.has(item.id))
          return fresh.length ? [...current, ...fresh] : current
        })
      })
      .catch(() => undefined) // silent: the next invalidation retries
    return () => { active = false }
  }, [turmaId, revision])

  const loadOlder = useCallback(async () => {
    const turma = turmaRef.current
    const oldest = messagesRef.current[0]
    if (!turma || !oldest || loadingOlder) return
    setLoadingOlder(true)
    try {
      const result = await api.messages(turma, { limit: PAGE_SIZE, before: oldest.criado_em })
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id))
        const older = result.mensagens.filter((item) => !known.has(item.id))
        return older.length ? [...older, ...current] : current
      })
      setHasMore(result.has_more)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.')
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder])

  const send = useCallback(async (texto: string) => {
    const turma = turmaRef.current
    if (!turma || !texto.trim() || sending) return
    setSending(true)
    try {
      const message = await api.sendMessage(turma, texto.trim())
      // Optimistic append is unnecessary: the POST returns the saved message and
      // the realtime invalidation would re-fetch it anyway. Appending here makes
      // the sent bubble appear instantly.
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.')
      throw cause
    } finally {
      setSending(false)
    }
  }, [sending])

  return { messages, hasMore, loading, loadingOlder, sending, error, send, loadOlder }
}

export type ForumConnection = ConnectionStatus
