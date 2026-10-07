/** Individual 1-on-1 training: professor prescribes, student executes. */

import { request } from './client'

// ---------- Shared shapes ----------
export interface WorkoutExercise { nome: string; series: number; repeticoes: string; carga: string | null; descanso_s: number }
export type RecurrenceRule = { type: 'daily' } | { type: 'weekly'; weekdays: number[] } | { type: 'custom'; dates: string[] }

export interface WorkoutSession {
  id: string
  plan_id: string
  data: string
  is_completed: boolean
  completed_at: string | null
}

export interface WorkoutPlan {
  id: string
  professor_id: string
  aluno_id: string
  titulo: string
  template: string
  observacoes: string | null
  exercicios: WorkoutExercise[]
  recorrencia: RecurrenceRule
  recorrencia_label?: string
  data_inicio: string
  data_fim: string
  criado_em?: string
}

export interface WorkoutTemplate { id: string; nome: string; descricao: string; exercicios: WorkoutExercise[] }

// ---------- Professor ----------
export interface TeacherPlanSummary extends WorkoutPlan {
  aluno_nome: string
  sessoes_total: number
  sessoes_concluidas: number
  sessoes?: WorkoutSession[]
}

export interface PlanInput {
  aluno_id: string
  titulo: string
  template: string
  observacoes?: string | null
  exercicios: WorkoutExercise[]
  recorrencia: RecurrenceRule
  data_inicio: string
  data_fim: string
}

// ---------- Student ----------
export interface StudentPlanView extends WorkoutPlan {
  sessoes: WorkoutSession[]
  sessoes_total: number
  sessoes_concluidas: number
}

const profPath = (id: string, suffix = '') => `/api/treinos-individuais/professor/${encodeURIComponent(id)}${suffix}`

export const individualWorkoutsApi = {
  templates: () => request<{ templates: WorkoutTemplate[] }>('/api/treinos-individuais/templates'),

  // Teacher
  teacherPlans: () => request<{ plans: TeacherPlanSummary[] }>('/api/treinos-individuais/professor'),
  studentPlansOfTeacher: (alunoId: string) =>
    request<{ aluno: { id: string; nome: string }; plans: TeacherPlanSummary[] }>(`/api/treinos-individuais/professor/aluno/${encodeURIComponent(alunoId)}`),
  planDetail: (id: string) =>
    request<{ plan: WorkoutPlan; aluno: { id: string; nome: string; turma_id: string } | null; sessoes: WorkoutSession[]; hoje: string }>(profPath(id)),
  createPlan: (payload: PlanInput) => request<{ plan: WorkoutPlan; sessoes: number }>('/api/treinos-individuais/professor', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlan: (id: string, payload: Partial<PlanInput>) => request<{ plan: WorkoutPlan; sessoes: number }>(profPath(id), { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePlan: (id: string) => request<{ id: string; status: 'excluido' }>(profPath(id), { method: 'DELETE' }),

  // Student / guardian
  studentPlans: (alunoId: string) => request<{ hoje: string; plans: StudentPlanView[] }>(`/api/treinos-individuais/aluno/${encodeURIComponent(alunoId)}`),
  completeSession: (alunoId: string, sessionId: string) =>
    request<{ id: string; is_completed: true; completed_at: string }>(`/api/treinos-individuais/aluno/${encodeURIComponent(alunoId)}/sessoes/${encodeURIComponent(sessionId)}/concluir`, { method: 'POST' }),
  reopenSession: (alunoId: string, sessionId: string) =>
    request<{ id: string; is_completed: false; completed_at: null }>(`/api/treinos-individuais/aluno/${encodeURIComponent(alunoId)}/sessoes/${encodeURIComponent(sessionId)}/reabrir`, { method: 'POST' }),
}
