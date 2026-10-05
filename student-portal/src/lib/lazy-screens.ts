/**
 * Top-level screens, each in its own chunk (docs/code-splitting-plan.md, step 1).
 * A visitor downloads only the login, or only the area of their role.
 *
 * The loaders are kept separate from the `lazy()` wrappers so the same import
 * can be started early (prefetch) and then reused by React: a module promise is
 * cached by the bundler, so prefetch + render costs a single request.
 */
import { lazy } from 'react'
import type { SessionUser } from '@/lib/types'

const loaders = {
  login: () => import('@/components/LoginScreen'),
  teacherInvite: () => import('@/components/TeacherInviteScreen'),
  resetPassword: () => import('@/screens/ResetPasswordScreen'),
  pendingApproval: () => import('@/screens/PendingApproval'),
  accountUnavailable: () => import('@/screens/AccountUnavailable'),
  admin: () => import('@/features/admin/AdminWorkspace'),
  teacher: () => import('@/features/teacher/TeacherArea'),
  student: () => import('@/features/student/StudentArea'),
}

export const LoginScreen = lazy(() => loaders.login().then((module) => ({ default: module.LoginScreen })))
export const TeacherInviteScreen = lazy(() => loaders.teacherInvite().then((module) => ({ default: module.TeacherInviteScreen })))
export const ResetPasswordScreen = lazy(() => loaders.resetPassword().then((module) => ({ default: module.ResetPasswordScreen })))
export const PendingApproval = lazy(() => loaders.pendingApproval().then((module) => ({ default: module.PendingApproval })))
export const AccountUnavailable = lazy(() => loaders.accountUnavailable().then((module) => ({ default: module.AccountUnavailable })))
export const AdminWorkspace = lazy(() => loaders.admin().then((module) => ({ default: module.AdminWorkspace })))
export const TeacherArea = lazy(() => loaders.teacher().then((module) => ({ default: module.TeacherArea })))
export const StudentArea = lazy(() => loaders.student().then((module) => ({ default: module.StudentArea })))

/** Starts downloading a chunk without rendering it. A failure is left to the render, which shows "Recarregar". */
function prefetch(load: () => Promise<unknown>) {
  load().catch(() => undefined)
}

type Role = SessionUser['tipo']

/**
 * The area chunk for a session, started as soon as the role is known (sign-in
 * answered, /api/auth/me answered, "view as" switched) instead of when React
 * gets to render it.
 */
export function prefetchAreaFor(role: Role | null | undefined, options: { isRootAdmin?: boolean; status?: SessionUser['status'] } = {}) {
  if (!role) return
  if (role === 'admin') {
    if (options.isRootAdmin) prefetch(loaders.admin)
    return
  }
  if (role === 'professor') {
    prefetch(options.status === 'pendente' ? loaders.pendingApproval : loaders.teacher)
    return
  }
  if (role === 'aluno' || role === 'responsavel') prefetch(loaders.student)
}
