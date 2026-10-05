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
import { enrollmentApi } from './api/enrollment'
import { activitiesApi } from './api/activities'
import type { TrainingTournament } from '@/lib/types'

export { ApiError, request, API_BASE }
/** Domain modules merged into `api`. Keys must be unique across them (see api.test.ts). */
export const apiModules = { authApi, studentApi, adminApi, teacherApi, trainingsApi, enrollmentApi, activitiesApi }
export { teacherApi, enrollmentApi, activitiesApi }
export type { CreateScheduledClass } from './api/teacher'
export type { ActivityChanges, ActivityInput, BracketInput, MatchResultInput, TeamInput } from './api/activities'
export type { AccountStatusResponse, RegisterInput, RegisterResponse, TeacherRegisterInput, TeacherRegisterResponse } from './api/auth'
export type { JoinRequestScope } from './api/enrollment'

export const api = {
  ...authApi,
  ...studentApi,
  ...adminApi,
  ...teacherApi,
  ...trainingsApi,
  ...enrollmentApi,
  ...activitiesApi,
  // Aliases preserving the previous flat method names used by call sites.
  adminSummary: adminApi.summary,
  adminNotifications: adminApi.notifications,
  adminStudents: adminApi.students,
  adminTeacherWorkspace: adminApi.teacherWorkspace,
  teacherDashboard: teacherApi.dashboard,
  teacherStudents: teacherApi.roster,
  teacherQuestions: teacherApi.studentQuestions,
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

