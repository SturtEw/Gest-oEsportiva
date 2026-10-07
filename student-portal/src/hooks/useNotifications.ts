import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AppNotification } from '@/lib/types'

/**
 * Notificações in-app do usuário logado.
 *
 * `revision` sobe a cada invalidação realtime de "notifications" (WebSocket);
 * a listagem refetcha com o sino aberto e o badge sempre que a revisão muda.
 */
export function useNotifications({ revision }: { revision: number }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Silences the effect re-run when revision didn't actually change.
  const lastRevisionRef = useRef<number | null>(null)

  const refresh = useCallback(() => {
    api.list()
      .then((result) => {
        setNotifications(result.notifications)
        setUnread(result.unread)
        setError(null)
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as notificações.') })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (lastRevisionRef.current === revision) return
    lastRevisionRef.current = revision
    refresh()
  }, [revision, refresh])

  const markRead = useCallback(async (id: string) => {
    // Optimistic: o sino responde na hora; o servidor confirma em segundo plano.
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, lida: true } : item)))
    setUnread((count) => Math.max(0, count - 1))
    try { await api.markRead(id) } catch { refresh() }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    setUnread(0)
    setNotifications((current) => current.map((item) => ({ ...item, lida: true })))
    try { await api.markAllRead() } catch { refresh() }
    }, [refresh])

    return { notifications, unread, loading, error, refresh, markRead, markAllRead }
  }
