import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { StudentActivity } from '@/lib/types'

/** Activities of the student's class, with join / leave. `revision` follows realtime invalidations. */
export function useStudentActivities(alunoId: string, revision: number) {
  const [activities, setActivities] = useState<StudentActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.studentActivities(alunoId)
      .then((data) => { if (active) { setActivities(data.atividades); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as atividades.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [alunoId, revision, retry])

  const replace = useCallback((next: StudentActivity) => {
    setActivities((current) => current.map((item) => (item.id === next.id ? next : item)))
    return next
  }, [])

  const join = useCallback(async (id: string) => replace(await api.joinActivity(id)), [replace])
  const leave = useCallback(async (id: string) => replace(await api.leaveActivity(id)), [replace])
  const reload = useCallback(() => setRetry((value) => value + 1), [])

  return { activities, loading, error, join, leave, reload }
}
