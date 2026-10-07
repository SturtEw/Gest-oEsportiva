/** Root-admin endpoints: summary metrics, notifications, classes and teachers. */

import { request } from './client'
import type {
  AdminClass,
  AdminNotification,
  AdminTeacher,
  CreatedTeacherInvite,
  StudentPortalSnapshot,
  TeacherInvite,
  TeacherApplication,
  UnassignedStudent,
} from '@/lib/types'

export const adminApi = {
  summary: () => request<{ professores_pendentes: number; notificacoes_pendentes: number; alunos_sem_turma: number; turmas: number }>('/api/admin/summary'),
  notifications: (unreadOnly = true) => request<{ notifications: AdminNotification[] }>(`/api/admin/notifications?unread_only=${unreadOnly}`),
  markNotificationRead: (id: string) => request<{ id: string; status: string; dataLeitura: string }>(`/api/admin/notifications/${encodeURIComponent(id)}`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<{ modified_count: number; dataLeitura: string }>('/api/admin/notifications/read-all', { method: 'POST' }),
  teacherApplications: () => request<{ applications: TeacherApplication[] }>('/api/admin/teacher-applications'),
  decideTeacher: (id: string, aprovado: boolean, motivo?: string) => request<{ id: string; status: string }>(`/api/admin/teacher-applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ aprovado, ...(motivo ? { motivo } : {}) }) }),
  students: (q = '', unassigned = true) => request<{ students: UnassignedStudent[] }>(`/api/admin/students?unassigned=${unassigned}&q=${encodeURIComponent(q)}`),
  classes: () => request<{ classes: AdminClass[] }>('/api/admin/classes'),
  approvedTeachers: () => request<{ teachers: AdminTeacher[] }>('/api/admin/teachers'),
  setClassTeacher: (classId: string, teacherId?: string) => request(`/api/admin/classes/${encodeURIComponent(classId)}/teacher${teacherId ? `?teacher_id=${encodeURIComponent(teacherId)}` : ''}`, { method: 'PATCH' }),
  teacherWorkspace: () => request<{ classes: Array<{ id: string; nome: string; modalidade: string; ano: number; professor_nome: string; alunos: Array<{ id: string; nome: string }> }> }>('/api/admin/teacher-workspace'),
  createClass: (payload: { nome: string; modalidade: string; ano: number; capacidade: number; professor_id?: string }) => request('/api/admin/classes', { method: 'POST', body: JSON.stringify(payload) }),
  deleteClass: (classId: string) => request<{ id: string; nome: string; status: 'excluida'; students_unlinked: number }>(`/api/admin/classes/${encodeURIComponent(classId)}`, { method: 'DELETE' }),
  assignClass: (alunoId: string, turmaId: string) => request(`/api/admin/students/${encodeURIComponent(alunoId)}/class`, { method: 'PATCH', body: JSON.stringify({ turma_id: turmaId }) }),
  inspectStudent: (alunoId: string) => request<{ read_only: true; inspected_by: string; student_portal: StudentPortalSnapshot }>(`/api/admin/students/${encodeURIComponent(alunoId)}/portal`),
  // Teacher invitation links (`enrollmentApi.teacherInvites` is the class-code list).
  adminTeacherInvites: () => request<{ invites: TeacherInvite[] }>('/api/admin/teacher-invites'),
  createTeacherInvite: (payload: { email: string; nome?: string; turma_id?: string; validade_dias: number; enviar_email: boolean }) =>
    request<CreatedTeacherInvite>('/api/admin/teacher-invites', { method: 'POST', body: JSON.stringify(payload) }),
  revokeTeacherInvite: (id: string) => request<{ id: string; status: 'revogado' }>(`/api/admin/teacher-invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
