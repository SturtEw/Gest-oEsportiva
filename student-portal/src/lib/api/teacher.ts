/** Teacher endpoints: dashboard, class roster and student replies. */

import { request } from './client'
import type {
  PublicMessage, TeacherClass, TeacherDashboardLayout, TeacherOverview, TeacherScheduleResponse,
} from '@/lib/types'

export interface CreateScheduledClass {
  turma_id: string
  data_aula: string
  hora_inicio: string
  duracao_minutos?: number
  local?: string | null
  observacoes?: string
}

export const teacherApi = {
  dashboard: () => request<{ classes: TeacherClass[] }>('/api/professor/dashboard'),
  // Named roster/studentQuestions, not students/questions: those keys already
  // exist in adminApi/studentApi, and spreading teacherApi last into `api`
  // overwrote them — the student area then called the professor route (403).
  roster: () => request<{ students: Array<{ id: string; nome: string; turma_id: string }> }>('/api/professor/students'),
  studentQuestions: (studentId: string) => request<PublicMessage[]>(`/api/professor/students/${encodeURIComponent(studentId)}/questions`),
  replyToStudent: (studentId: string, texto: string) => request<PublicMessage>(`/api/professor/students/${encodeURIComponent(studentId)}/questions`, { method: 'POST', body: JSON.stringify({ texto }) }),

  // ---- Conquistas ----
  award: (studentId: string, nome: string, pontos: number) =>
    request<void>(`/api/professor/students/${encodeURIComponent(studentId)}/achievements`, {
      method: 'POST',
      body: JSON.stringify({ nome, pontos }),
    }),

  // ---- Edição da turma pelo professor ----
  updateClass: (turmaId: string, payload: { nome?: string; modalidade?: string; capacidade?: number }) =>
    request<{ id: string; changed: boolean }>(`/api/professor/classes/${encodeURIComponent(turmaId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // ---- Agenda de aulas ----
  schedule: (dias = 7) => request<TeacherScheduleResponse>(`/api/professor/agenda?dias=${dias}`),
  overview: (semanas = 8) => request<TeacherOverview>(`/api/professor/visao-geral?semanas=${semanas}`),
  // Named scheduleClass, not createClass: api.createClass already creates a *turma*
  // for the admin, and the two collided when both were spread into the api object.
  scheduleClass: (payload: CreateScheduledClass) => request<{ id: string }>('/api/professor/agenda', { method: 'POST', body: JSON.stringify(payload) }),
  updateScheduledClass: (id: string, payload: Partial<CreateScheduledClass> & { ativo?: boolean }) =>
    request<{ ok: boolean }>(`/api/professor/agenda/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteScheduledClass: (id: string) => request<void>(`/api/professor/agenda/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---- Painel personalizável ----
  // The layout lives on the professor's own document, so it follows the account
  // across devices. It is opaque to the server: the client schema can evolve
  // (new widget kinds) without a backend change.
  getDashboardLayout: () => request<TeacherDashboardLayout>('/api/professor/painel/layout'),
  saveDashboardLayout: (layout: Record<string, unknown>) =>
    request<TeacherDashboardLayout>('/api/professor/painel/layout', { method: 'PUT', body: JSON.stringify({ layout }) }),
}
