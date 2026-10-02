import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AvailableClass, JoinedClass, JoinRequest, StudentEnrollmentStatus } from '@/lib/types'

const SEARCH_DEBOUNCE_MS = 300
/**
 * While a request waits for the teacher, re-check its status. Realtime pushes are
 * not guaranteed (a standalone MongoDB runs the hub in single-worker mode and the
 * client drops the socket), so the student would otherwise never see the decision.
 */
const PENDING_POLL_MS = 20000

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/**
 * Data for the "find your class" home of a student without a class: the class
 * search (debounced, cancellable) and the student's own join requests.
 * `revision` comes from realtime invalidations, so a teacher's decision shows up
 * without a manual refresh.
 */
export function useStudentEnrollment({ enabled, revision }: { enabled: boolean; revision: number }) {
  const [query, setQuery] = useState('')
  const [classes, setClasses] = useState<AvailableClass[]>([])
  const [classesLoading, setClassesLoading] = useState(true)
  const [classesError, setClassesError] = useState<string | null>(null)
  const [status, setStatus] = useState<StudentEnrollmentStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [localRevision, setLocalRevision] = useState(0)
  // Status-only refreshes (polling) must not re-run the class search or flash loaders.
  const [statusRevision, setStatusRevision] = useState(0)
  const statusLoadedRef = useRef(false)

  const reload = useCallback(() => setLocalRevision((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) return
    let active = true
    if (!statusLoadedRef.current) setStatusLoading(true)
    api.myJoinRequests()
      .then((next) => { statusLoadedRef.current = true; return next })
      .then((next) => { if (active) { setStatus(next); setStatusError(null) } })
      .catch((cause: unknown) => { if (active) setStatusError(messageOf(cause, 'Não foi possível carregar seus pedidos.')) })
      .finally(() => { if (active) setStatusLoading(false) })
    return () => { active = false }
  }, [enabled, revision, localRevision, statusRevision])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const term = query.trim()
    setClassesLoading(true)
    const timer = window.setTimeout(() => {
      api.availableClasses(term, { signal: controller.signal })
        .then(({ classes: found }) => { setClasses(found); setClassesError(null) })
        .catch((cause: unknown) => { if (!isAbort(cause)) setClassesError(messageOf(cause, 'Não foi possível buscar as turmas.')) })
        .finally(() => { if (!controller.signal.aborted) setClassesLoading(false) })
    }, term ? SEARCH_DEBOUNCE_MS : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [enabled, query, revision, localRevision])

  const requestToJoin = useCallback(async (turmaId: string, mensagem?: string): Promise<JoinRequest> => {
    const created = await api.requestToJoin(turmaId, mensagem)
    reload()
    return created
  }, [reload])

  const cancelRequest = useCallback(async (id: string) => {
    await api.cancelJoinRequest(id)
    reload()
  }, [reload])

  const joinWithCode = useCallback(async (code: string): Promise<JoinedClass> => (await api.joinWithInvite(code)).turma, [])

  const pendingRequest = useMemo(() => status?.requests.find((item) => item.status === 'pendente') ?? null, [status])
  const hasPending = pendingRequest !== null

  useEffect(() => {
    if (!enabled || !hasPending) return
    const recheck = () => { if (document.visibilityState === 'visible') setStatusRevision((value) => value + 1) }
    const timer = window.setInterval(recheck, PENDING_POLL_MS)
    // Coming back to the tab is the moment a student expects fresh news.
    document.addEventListener('visibilitychange', recheck)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', recheck) }
  }, [enabled, hasPending])

  return {
    query, setQuery, classes, classesLoading, classesError,
    status, statusLoading, statusError, pendingRequest,
    requestToJoin, cancelRequest, joinWithCode, reload,
  }
}

export type StudentEnrollment = ReturnType<typeof useStudentEnrollment>
