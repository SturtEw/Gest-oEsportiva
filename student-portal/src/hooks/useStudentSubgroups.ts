/** Subgrupos da turma do aluno, com check-in / check-out.
 *  `revision` segue as invalidações realtime (seção "subgroups"). */

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { StudentSubgroup } from '@/lib/api/subgroups'

export function useStudentSubgroups(alunoId: string, revision: number) {
  const [subgroups, setSubgroups] = useState<StudentSubgroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.studentSubgroups(alunoId)
      .then((data) => { if (active) { setSubgroups(data.subgrupos); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os subgrupos.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [alunoId, revision, retry])

  const replace = useCallback((next: StudentSubgroup) => {
    setSubgroups((current) => current.map((item) => (item.id === next.id ? next : item)))
  }, [])

  const checkin = useCallback(async (id: string) => {
    const { subgrupo } = await api.checkin(id)
    replace(subgrupo)
  }, [replace])

  const checkout = useCallback(async (id: string) => {
    const { subgrupo } = await api.checkout(id)
    replace(subgrupo)
  }, [replace])

  const reload = useCallback(() => setRetry((value) => value + 1), [])

  return { subgroups, loading, error, checkin, checkout, reload }
}
