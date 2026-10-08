import { useEffect, useRef, useState } from 'react'
import { realtimeUrl, type RealtimeAudience } from '@/lib/api'
import type { ConnectionStatus, RealtimeEvent } from '@/lib/types'

interface RealtimeSyncOptions {
  audience?: RealtimeAudience
  alunoId?: string
  enabled?: boolean
  onInvalidate: (event: RealtimeEvent) => void
}

export function useRealtimeSync({ audience = 'student', alunoId, enabled = true, onInvalidate }: RealtimeSyncOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [message, setMessage] = useState('Conectando ao serviço de atualização…')
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const onInvalidateRef = useRef(onInvalidate)
  const isSingleWorkerRef = useRef(false)
  onInvalidateRef.current = onInvalidate

  useEffect(() => {
    if (!enabled || (audience === 'student' && !alunoId)) {
      setStatus('offline')
      setMessage('Nenhuma inscrição em tempo real disponível.')
      return
    }
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let pingTimer = 0
    let fallbackTimer = 0
    let retryLiveTimer = 0
    let attempt = 0
    const connect = () => {
      if (stopped || isSingleWorkerRef.current) return
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      socket = new WebSocket(realtimeUrl({ audience, alunoId }))
      socket.onopen = () => {
        attempt = 0
        pingTimer = window.setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })) }, 30000)
      }
      socket.onmessage = (messageEvent) => {
        try {
          const payload = JSON.parse(messageEvent.data) as { type: string; status?: ConnectionStatus; message?: string; section?: string; updatedAt?: string; mode?: ConnectionStatus }
          if (payload.type === 'connection' && payload.status) {
            setStatus(payload.status)
            setMessage(payload.message ?? 'Conexão atualizada')
            if (payload.status === 'single_worker') {
              // MongoDB sem change stream: em vez de desistir para sempre,
              // degrada para polling de fallback (invalida todas as seções a
              // cada 30s) e re-tenta o WebSocket a cada minuto — se o servidor
              // voltar ao modo live, o cliente acompanha sem F5.
              isSingleWorkerRef.current = true
              window.clearInterval(pingTimer)
              socket?.close()
              fallbackTimer = window.setInterval(() => {
                onInvalidateRef.current({ type: 'invalidate', section: '*', updatedAt: new Date().toISOString(), mode: 'single_worker' })
              }, 30000)
              retryLiveTimer = window.setInterval(() => { isSingleWorkerRef.current = false; connect() }, 60000)
              return
            }
            return
          }
          if (payload.type === 'invalidate' && payload.section && payload.updatedAt) {
            const event = payload as RealtimeEvent
            setLastUpdatedAt(event.updatedAt)
            onInvalidateRef.current(event)
          }
        } catch { /* Ignore unknown websocket control messages. */ }
      }
      socket.onclose = (event) => {
        window.clearInterval(pingTimer)
        if (stopped || isSingleWorkerRef.current) return
        if (event.code === 4401 || event.code === 4403) {
          setStatus('offline')
          setMessage('Sua sessão não autoriza esta inscrição. Entre novamente.')
          return
        }
        setStatus('reconnecting')
        setMessage('Reconectando para atualizar os registros…')
        attempt += 1
        reconnectTimer = window.setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempt, 5), 20000))
      }
      socket.onerror = () => setStatus('reconnecting')
    }
    connect()
    // Suspensão do SO e troca de rede deixam o socket "zumbi" (readyState OPEN
    // mas morto) sem disparar onclose. Ao voltar a aba ou recuperar a conexão,
    // força um reconnect imediato se o socket não estiver de fato aberto.
    const revive = () => {
      if (stopped || isSingleWorkerRef.current) return
      if (document.visibilityState !== 'visible') return
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
      window.clearTimeout(reconnectTimer)
      attempt = 0
      isSingleWorkerRef.current = false
      window.clearInterval(fallbackTimer)
      window.clearInterval(retryLiveTimer)
      connect()
    }
    window.addEventListener('online', revive)
    document.addEventListener('visibilitychange', revive)
    return () => {
      stopped = true
      window.removeEventListener('online', revive)
      document.removeEventListener('visibilitychange', revive)
      window.clearTimeout(reconnectTimer)
      window.clearInterval(pingTimer)
      window.clearInterval(fallbackTimer)
      window.clearInterval(retryLiveTimer)
      socket?.close()
    }
  }, [alunoId, audience, enabled])

  return { status, message, lastUpdatedAt }
}
