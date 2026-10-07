import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { StudentPortalSnapshot } from '@/lib/types'

export function useStudentPortal(alunoId?: string) {
  const [snapshot, setSnapshot] = useState<StudentPortalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  // The fetch currently driving the view. `refresh()` kicks one off immediately
  // (so callers can await it) and the effect adopts it instead of re-fetching.
  const inflightRef = useRef<Promise<void> | null>(null)
  // Once the first snapshot lands, later fetches refresh silently in place —
  // they must not flip `loading` back on (that was the reported screen flash).
  const hasLoadedRef = useRef(false)

  const refresh = useCallback(() => {
    const promise = api.portal(alunoId)
      .then((data) => { setSnapshot(data) })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus dados.') })
    inflightRef.current = promise
    setRevision((value) => value + 1)
    return promise
  }, [alunoId])

  useEffect(() => {
    let alive = true
    // First fetch for THIS student: full skeleton. Later fetches (realtime
    // invalidation, manual refresh, ranking toggle) revalidate in place —
    // swapping the whole section tree for skeletons was the "screen flash"
    // users saw after every action. Stale data stays visible until fresh
    // data arrives. Switching to a different student (guardian with several
    // children) resets the state so the old child's data never lingers on
    // screen as if it were the new one's.
    if (!hasLoadedRef.current) setLoading(true)
    setError(null)

    // A refresh() that just fired already owns this round-trip; adopt it rather
    // than issuing a duplicate request.
    const active = inflightRef.current ?? api.portal(alunoId)
      .then((data) => {
        if (alive) {
          hasLoadedRef.current = true
          setSnapshot(data)
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seus dados.')
      })
    inflightRef.current = null

    void active.finally(() => {
      if (alive) setLoading(false)
    })

    return () => {
      alive = false
    }
  }, [alunoId, revision])

  // A guardian switching children must see a fresh load, not the previous
  // child's data. Reset both the flag and the snapshot on identity change.
  const previousAlunoId = useRef(alunoId)
  useEffect(() => {
    if (previousAlunoId.current !== alunoId) {
      previousAlunoId.current = alunoId
      hasLoadedRef.current = false
      setSnapshot(null)
      setLoading(true)
    }
  }, [alunoId])

  const setRankingPreference = useCallback(async (participaRanking: boolean) => {
    // Optimistic update
    setSnapshot((current) => current ? {
      ...current,
      aluno: {
        ...current.aluno,
        participa_ranking: participaRanking,
      },
    } : current)
    try {
      const result = await api.setRankingPreference(participaRanking)
      // Update with server response (includes atualizado_em)
      setSnapshot((current) => current ? {
        ...current,
        aluno: {
          ...current.aluno,
          participa_ranking: result.participa_ranking,
          consentimentoRankingAtualizadoEm: result.atualizado_em,
        },
      } : current)
      return result
    } catch (e) {
      // Rollback on error
      setSnapshot((current) => current ? {
        ...current,
        aluno: {
          ...current.aluno,
          participa_ranking: !participaRanking,
        },
      } : current)
      throw e
    }
  }, [])

  return { snapshot, loading, error, refresh, setRankingPreference }
}
