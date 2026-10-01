/**
 * Public entry point for the API client.
 *
 * The implementation is split per domain under ./api (client transport, auth,
 * student, admin, teacher, trainings). This file merges them into the single
 * `api` object so the existing `import { api } from '@/lib/api'` call sites —
 * and the tests that stub its methods — keep working unchanged.
 */

import { ApiError, request, API_BASE } from './api/client'
import { authApi } from './api/auth'
import { studentApi } from './api/student'
import { adminApi } from './api/admin'
import { teacherApi } from './api/teacher'
import { trainingsApi } from './api/trainings'
import type { TrainingTournament } from '@/lib/types'

export { ApiError, request, API_BASE }
export { teacherApi }
export type { CreateScheduledClass } from './api/teacher'
export type { AccountStatusResponse, RegisterInput } from './api/auth'

export const api = {
  ...authApi,
  ...studentApi,
  ...adminApi,
  ...teacherApi,
  ...trainingsApi,
  // Aliases preserving the previous flat method names used by call sites.
  adminSummary: adminApi.summary,
  adminNotifications: adminApi.notifications,
  adminStudents: adminApi.students,
  adminTeacherWorkspace: adminApi.teacherWorkspace,
  teacherDashboard: teacherApi.dashboard,
  teacherStudents: teacherApi.students,
  teacherQuestions: teacherApi.questions,
  replyToStudent: teacherApi.replyToStudent,
  getTournaments: trainingsApi.getTournaments,
}

export type RealtimeAudience = 'student' | 'teacher' | 'admin'

export function realtimeUrl({ audience = 'student', alunoId }: { audience?: RealtimeAudience; alunoId?: string } = {}): string {
  const base = API_BASE ? new URL(API_BASE, window.location.href) : new URL(window.location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/api/realtime`
  base.search = new URLSearchParams({ audience, ...(alunoId ? { aluno_id: alunoId } : {}) }).toString()
  return base.toString()
}

export type { TrainingTournament }

