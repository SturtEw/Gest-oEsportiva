/** Class activities and their competition brackets (teacher manages, students join). */

import { request } from './client'
import type { BracketFormat, StudentActivity, TeacherActivities, TeacherActivityDetail } from '@/lib/types'

export interface ActivityInput {
  turma_id: string
  titulo: string
  descricao?: string | null
  data?: string | null
  horario?: string | null
  local?: string | null
  vagas?: number | null
  inscricoes_abertas?: boolean
}
export type ActivityChanges = Partial<Omit<ActivityInput, 'turma_id'>>

export interface BracketInput { formato: BracketFormat; quantidade_times: number; nomes_times?: string[] }
export interface TeamInput { id: string; nome: string; alunos_ids: string[] }
export interface MatchResultInput { placar_a: number | null; placar_b: number | null; vencedor_id?: string | null }

const teacherPath = (id: string, suffix = '') => `/api/atividades/professor/${encodeURIComponent(id)}${suffix}`
const json = (method: string, body?: unknown): { method: string; body?: string } =>
  ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

// Keys are distinct from every other API module (see api.test.ts).
export const activitiesApi = {
  // ---- Professor ----
  teacherActivities: () => request<TeacherActivities>('/api/atividades/professor'),
  teacherActivity: (id: string) => request<TeacherActivityDetail>(teacherPath(id)),
  createActivity: (payload: ActivityInput) => request<TeacherActivityDetail>('/api/atividades/professor', json('POST', payload)),
  updateActivity: (id: string, changes: ActivityChanges) => request<TeacherActivityDetail>(teacherPath(id), json('PATCH', changes)),
  deleteActivity: (id: string) => request<void>(teacherPath(id), json('DELETE')),
  addActivityParticipants: (id: string, alunos_ids: string[]) =>
    request<TeacherActivityDetail>(teacherPath(id, '/participantes'), json('POST', { alunos_ids })),
  removeActivityParticipant: (id: string, alunoId: string) =>
    request<TeacherActivityDetail>(teacherPath(id, `/participantes/${encodeURIComponent(alunoId)}`), json('DELETE')),
  createBracket: (id: string, payload: BracketInput) => request<TeacherActivityDetail>(teacherPath(id, '/chaveamento'), json('POST', payload)),
  deleteBracket: (id: string) => request<TeacherActivityDetail>(teacherPath(id, '/chaveamento'), json('DELETE')),
  updateBracketTeams: (id: string, times: TeamInput[]) =>
    request<TeacherActivityDetail>(teacherPath(id, '/chaveamento/times'), json('PUT', { times })),
  redrawBracketTeams: (id: string) => request<TeacherActivityDetail>(teacherPath(id, '/chaveamento/sortear'), json('POST')),
  recordMatchResult: (id: string, partidaId: string, result: MatchResultInput) =>
    request<TeacherActivityDetail>(teacherPath(id, `/chaveamento/partidas/${encodeURIComponent(partidaId)}`), json('PATCH', result)),

  // ---- Aluno ----
  studentActivities: (alunoId: string) => request<{ atividades: StudentActivity[] }>(`/api/atividades/aluno/${encodeURIComponent(alunoId)}`),
  joinActivity: (id: string) => request<StudentActivity>(`/api/atividades/aluno/${encodeURIComponent(id)}/interesse`, json('POST')),
  leaveActivity: (id: string) => request<StudentActivity>(`/api/atividades/aluno/${encodeURIComponent(id)}/interesse`, json('DELETE')),
}
