import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ClassInvite, JoinRequest, TeacherInviteClass } from '@/lib/types'

interface Options {
  /** Bumped by realtime invalidations in the teacher area. */
  revision: number
  /** Called after a mutation; the teacher area bumps `revision`, which also reloads the roster. */
  onChanged?: () => void
}

/** Invite codes per class and the join-request queue for the signed-in teacher. */
export function useTeacherEnrollment({ revision, onChanged }: Options) {
  const [inviteClasses, setInviteClasses] = useState<TeacherInviteClass[]>([])
  const [pending, setPending] = useState<JoinRequest[]>([])
  const [history, setHistory] = useState<JoinRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [localRevision, setLocalRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.teacherInvites(), api.teacherJoinRequests('pendentes'), api.teacherJoinRequests('historico')])
      .then(([invites, open, decided]) => {
        if (!active) return
        setInviteClasses(invites.classes)
        setPending(open.requests)
        setPendingCount(open.pendentes)
        setHistory(decided.requests)
        setError(null)
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar convites e solicitações.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision, localRevision])

  const changed = useCallback(() => {
    if (onChanged) onChanged()
    else setLocalRevision((value) => value + 1)
  }, [onChanged])

  const generateInvite = useCallback(async (turmaId: string, validadeDias: number | null): Promise<ClassInvite> => {
    const invite = await api.createInvite(turmaId, validadeDias)
    changed()
    return invite
  }, [changed])

  const revokeInvite = useCallback(async (inviteId: string) => {
    await api.revokeInvite(inviteId)
    changed()
  }, [changed])

  const decide = useCallback(async (requestId: string, aprovar: boolean, motivo?: string): Promise<JoinRequest> => {
    // Optimistic removal keeps a double click from firing twice; reload restores truth.
    setPending((current) => current.filter((item) => item.id !== requestId))
    setPendingCount((count) => Math.max(0, count - 1))
    try {
      return await api.decideJoinRequest(requestId, aprovar, motivo)
    } finally {
      changed()
    }
  }, [changed])

  return { inviteClasses, pending, history, pendingCount, loading, error, generateInvite, revokeInvite, decide }
}

export type TeacherEnrollment = ReturnType<typeof useTeacherEnrollment>
