import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { PublicMessage } from '@/lib/types'

export function useQuestionThread(alunoId?: string) {
  const [messages, setMessages] = useState<PublicMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let alive = true
    setMessages([])
    setLoading(true)
    setError(null)
    if (!alunoId) {
      setLoading(false)
      return
    }
    api.questions(alunoId)
      .then((items) => { if (alive) setMessages(items.map((item) => ({ ...item, localStatus: 'sent' }))) })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as dúvidas.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [alunoId, revision])

  const send = useCallback(async (text: string) => {
    if (!alunoId) throw new Error('Escolha um aluno vinculado antes de enviar uma dúvida.')
    const optimisticId = `local-${crypto.randomUUID()}`
    const optimistic: PublicMessage = {
      id: optimisticId,
      autor_nome: 'Você',
      autor_tipo: 'aluno',
      texto: text,
      dataEnvio: new Date().toISOString(),
      localStatus: 'sending',
    }
    setMessages((current) => [...current, optimistic])
    try {
      const saved = await api.askQuestion(alunoId, text)
      setMessages((current) => current.map((message) => message.id === optimisticId ? { ...saved, localStatus: 'sent' } : message))
    } catch (cause) {
      setMessages((current) => current.map((message) => message.id === optimisticId ? { ...message, localStatus: 'failed' } : message))
      throw cause
    }
  }, [alunoId])

  const retry = useCallback(async (message: PublicMessage) => {
    setMessages((current) => current.filter((item) => item.id !== message.id))
    await send(message.texto)
  }, [send])

  return { messages, loading, error, refresh, send, retry }
}
