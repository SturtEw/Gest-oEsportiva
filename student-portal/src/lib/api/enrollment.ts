/** Class enrollment: invite codes (teacher) and join requests (student ↔ teacher). */

import { request } from './client'
import type {
  AvailableClass, ClassInvite, JoinedClass, JoinRequest, StudentEnrollmentStatus, TeacherInviteClass, TeacherJoinRequests,
} from '@/lib/types'

export type JoinRequestScope = 'pendentes' | 'historico'

// Keys are distinct from every other API module (see api.test.ts): `classes`
// already belongs to the admin, so the student search is `availableClasses`.
export const enrollmentApi = {
  // ---- Aluno sem turma ----
  availableClasses: (q = '', options?: { signal?: AbortSignal }) =>
    request<{ classes: AvailableClass[] }>(`/api/enrollment/classes?q=${encodeURIComponent(q)}`, options),
  myJoinRequests: () => request<StudentEnrollmentStatus>('/api/enrollment/requests/me'),
  requestToJoin: (turma_id: string, mensagem?: string) =>
    request<JoinRequest>('/api/enrollment/requests', { method: 'POST', body: JSON.stringify({ turma_id, ...(mensagem ? { mensagem } : {}) }) }),
  cancelJoinRequest: (id: string) => request<void>(`/api/enrollment/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Multi-turmas: sai de UMA turma, preservando as demais. */
  leaveClass: (turmaId: string) =>
    request<{ turmas_restantes: string[]; turma_id: string | null; turma: JoinedClass | null }>(
      `/api/enrollment/classes/${encodeURIComponent(turmaId)}`,
      { method: 'DELETE' },
    ),
  joinWithInvite: (codigo: string) =>
    request<{ turma: JoinedClass }>('/api/enrollment/join', { method: 'POST', body: JSON.stringify({ codigo }) }),

  // ---- Professor ----
  teacherInvites: () => request<{ classes: TeacherInviteClass[] }>('/api/enrollment/teacher/invites'),
  createInvite: (turmaId: string, validade_dias: number | null) =>
    request<ClassInvite>(`/api/enrollment/teacher/classes/${encodeURIComponent(turmaId)}/invite`, { method: 'POST', body: JSON.stringify({ validade_dias }) }),
  revokeInvite: (inviteId: string) => request<void>(`/api/enrollment/teacher/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }),
  teacherJoinRequests: (escopo: JoinRequestScope = 'pendentes') =>
    request<TeacherJoinRequests>(`/api/enrollment/teacher/requests?escopo=${escopo}`),
  decideJoinRequest: (id: string, aprovar: boolean, motivo?: string) =>
    request<JoinRequest>(`/api/enrollment/teacher/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ aprovar, ...(motivo ? { motivo } : {}) }) }),
}
