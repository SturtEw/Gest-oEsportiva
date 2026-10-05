import { useCallback, useEffect, useState } from 'react'
import { api, type ActivityChanges, type ActivityInput, type BracketInput, type MatchResultInput, type TeamInput } from '@/lib/api'
import type { ActivitySummary, TeacherActivityClass, TeacherActivityDetail } from '@/lib/types'

const message = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

function summaryOf(detail: TeacherActivityDetail): ActivitySummary {
  const { participantes: _p, alunos_turma: _a, chaveamento: _c, ...summary } = detail
  return summary
}

/**
 * The teacher's activities (all classes) and the one open in the detail pane.
 * Every mutation answers with the fresh detail, so the pane updates without a
 * second request; the list entry is patched from it.
 */
export function useTeacherActivities({ revision }: { revision: number }) {
  const [classes, setClasses] = useState<TeacherActivityClass[]>([])
  const [activities, setActivities] = useState<ActivitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TeacherActivityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [localRevision, setLocalRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.teacherActivities()
      .then((data) => { if (active) { setClasses(data.turmas); setActivities(data.atividades); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(message(cause, 'Não foi possível carregar as atividades.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision, localRevision])

  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(null); return }
    let active = true
    setDetailLoading(true)
    api.teacherActivity(selectedId)
      .then((data) => { if (active) { setDetail(data); setDetailError(null) } })
      .catch((cause: unknown) => { if (active) setDetailError(message(cause, 'Não foi possível abrir a atividade.')) })
      .finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selectedId, revision])

  const apply = useCallback((next: TeacherActivityDetail) => {
    setDetail(next)
    setActivities((current) => {
      const summary = summaryOf(next)
      return current.some((item) => item.id === next.id)
        ? current.map((item) => (item.id === next.id ? summary : item))
        : [summary, ...current]
    })
    return next
  }, [])

  const create = useCallback(async (input: ActivityInput) => {
    const created = apply(await api.createActivity(input))
    setSelectedId(created.id)
    return created
  }, [apply])

  /** Runs a mutation on the open activity and applies the detail it returns. */
  const mutate = useCallback(async (action: (id: string) => Promise<TeacherActivityDetail>) => {
    if (!selectedId) throw new Error('Nenhuma atividade selecionada.')
    return apply(await action(selectedId))
  }, [apply, selectedId])

  const remove = useCallback(async () => {
    if (!selectedId) return
    await api.deleteActivity(selectedId)
    setActivities((current) => current.filter((item) => item.id !== selectedId))
    setSelectedId(null)
    setLocalRevision((value) => value + 1)
  }, [selectedId])

  return {
    classes, activities, loading, error,
    selectedId, select: setSelectedId, detail, detailLoading, detailError,
    create,
    remove,
    update: (changes: ActivityChanges) => mutate((id) => api.updateActivity(id, changes)),
    addParticipants: (ids: string[]) => mutate((id) => api.addActivityParticipants(id, ids)),
    removeParticipant: (alunoId: string) => mutate((id) => api.removeActivityParticipant(id, alunoId)),
    createBracket: (input: BracketInput) => mutate((id) => api.createBracket(id, input)),
    deleteBracket: () => mutate((id) => api.deleteBracket(id)),
    saveTeams: (times: TeamInput[]) => mutate((id) => api.updateBracketTeams(id, times)),
    redrawTeams: () => mutate((id) => api.redrawBracketTeams(id)),
    recordResult: (matchId: string, result: MatchResultInput) => mutate((id) => api.recordMatchResult(id, matchId, result)),
  }
}

export type TeacherActivitiesState = ReturnType<typeof useTeacherActivities>
