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
              isSingleWorkerRef.current = true
              window.clearInterval(pingTimer)
              socket?.close()
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
    return () => { stopped = true; window.clearTimeout(reconnectTimer); window.clearInterval(pingTimer); socket?.close() }
  }, [alunoId, audience, enabled])

  return { status, message, lastUpdatedAt }
}
