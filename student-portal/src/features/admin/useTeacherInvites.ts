import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { CreatedTeacherInvite, TeacherInvite } from '@/lib/types'

export interface NewTeacherInvite {
  email: string
  nome?: string
  turma_id?: string
  validade_dias: number
  enviar_email: boolean
}

/** Root admin's teacher invitation links: list, create (link shown once) and cancel. */
export function useTeacherInvites(revision: number) {
  const [invites, setInvites] = useState<TeacherInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedTeacherInvite | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [localRevision, setLocalRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.adminTeacherInvites()
      .then((result) => { if (active) { setInvites(result.invites); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os convites.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision, localRevision])

  const create = useCallback(async (payload: NewTeacherInvite) => {
    setError(null)
    try {
      const result = await api.createTeacherInvite(payload)
      setCreated(result)
      setLocalRevision((value) => value + 1)
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o convite.')
      return null
    }
  }, [])

  const revoke = useCallback(async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await api.revokeTeacherInvite(id)
      setCreated((current) => (current?.invite.id === id ? null : current))
      setLocalRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar o convite.')
    } finally { setBusyId(null) }
  }, [])

  return { invites, loading, error, created, busyId, create, revoke, dismissCreated: () => setCreated(null) }
}
