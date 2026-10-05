/**
 * Student-area sections in their own chunks (docs/code-splitting-plan.md, step 3).
 * HomeDashboard stays in the area chunk: it is the first screen. The others load
 * on first visit, and are prefetched when the pointer/focus reaches their menu item.
 */
import { lazy } from 'react'
import type { PortalSection } from '@/lib/types'

const loaders = {
  turma: () => import('@/features/class/ClassSummary'),
  presencas: () => import('@/features/attendance/AttendanceSection'),
  avaliacoes: () => import('@/features/assessments/AssessmentSection'),
  conquistas: () => import('@/features/achievements/AchievementSection'),
  atividades: () => import('@/features/activities/student/StudentActivitiesSection'),
  treinamentos: () => import('@/features/treinamentos/TreinamentosSection'),
  registros: () => import('@/features/records/RecordsSection'),
  comunicados: () => import('@/features/announcements/AnnouncementsSection'),
  duvidas: () => import('@/features/questions/QuestionThread'),
  enrollment: () => import('@/features/enrollment/EnrollmentHome'),
} satisfies Partial<Record<PortalSection | 'enrollment', () => Promise<unknown>>>

export const ClassSummary = lazy(() => loaders.turma().then((module) => ({ default: module.ClassSummary })))
export const AttendanceSection = lazy(() => loaders.presencas().then((module) => ({ default: module.AttendanceSection })))
export const AssessmentSection = lazy(() => loaders.avaliacoes().then((module) => ({ default: module.AssessmentSection })))
export const AchievementSection = lazy(() => loaders.conquistas().then((module) => ({ default: module.AchievementSection })))
export const StudentActivitiesSection = lazy(() => loaders.atividades().then((module) => ({ default: module.StudentActivitiesSection })))
export const TreinamentosSection = lazy(() => loaders.treinamentos().then((module) => ({ default: module.TreinamentosSection })))
export const RecordsSection = lazy(() => loaders.registros().then((module) => ({ default: module.RecordsSection })))
export const AnnouncementsSection = lazy(() => loaders.comunicados().then((module) => ({ default: module.AnnouncementsSection })))
export const QuestionThread = lazy(() => loaders.duvidas().then((module) => ({ default: module.QuestionThread })))
export const EnrollmentHome = lazy(() => loaders.enrollment().then((module) => ({ default: module.EnrollmentHome })))

/** Starts a section's chunk (menu hover/focus). Errors surface when it renders. */
export function prefetchStudentSection(section: PortalSection | 'enrollment') {
  const load = (loaders as Partial<Record<string, () => Promise<unknown>>>)[section]
  load?.().catch(() => undefined)
}
