/**
 * Student-area sections in their own chunks (docs/code-splitting-plan.md, step 3).
 * HomeDashboard stays in the area chunk: it is the first screen. The others load
 * on first visit, and are prefetched when the pointer/focus reaches their menu item.
 */
import { lazy } from 'react'
import type { PortalSection } from '@/lib/types'

const loaders = {
  turma: () => import('@/features/class/ClassSummary'),
  'minhas-turmas': () => import('@/features/enrollment/MyClassesSection'),
  presencas: () => import('@/features/attendance/AttendanceSection'),
  avaliacoes: () => import('@/features/assessments/AssessmentSection'),
  conquistas: () => import('@/features/achievements/AchievementSection'),
  atividades: () => import('@/features/activities/student/StudentActivitiesSection'),
  aulas: () => import('@/features/subgroups/StudentCheckIn'),
  'meu-treino': () => import('@/features/student/workouts/StudentWorkoutsSection'),
  treinamentos: () => import('@/features/treinamentos/TreinamentosSection'),
  registros: () => import('@/features/records/RecordsSection'),
  comunicados: () => import('@/features/announcements/AnnouncementsSection'),
  duvidas: () => import('@/features/questions/QuestionThread'),
  forum: () => import('@/features/forum/ForumView'),
  enrollment: () => import('@/features/enrollment/EnrollmentHome'),
} satisfies Partial<Record<PortalSection | 'enrollment', () => Promise<unknown>>>

export const ClassSummary = lazy(() => loaders.turma().then((module) => ({ default: module.ClassSummary })))
export const MyClassesSection = lazy(() => loaders['minhas-turmas']().then((module) => ({ default: module.MyClassesSection })))
export const AttendanceSection = lazy(() => loaders.presencas().then((module) => ({ default: module.AttendanceSection })))
export const AssessmentSection = lazy(() => loaders.avaliacoes().then((module) => ({ default: module.AssessmentSection })))
export const AchievementSection = lazy(() => loaders.conquistas().then((module) => ({ default: module.AchievementSection })))
export const StudentActivitiesSection = lazy(() => loaders.atividades().then((module) => ({ default: module.StudentActivitiesSection })))
export const StudentCheckIn = lazy(() => loaders.aulas().then((module) => ({ default: module.StudentCheckIn })))
export const StudentWorkoutsSection = lazy(() => loaders['meu-treino']().then((module) => ({ default: module.StudentWorkoutsSection })))
export const TreinamentosSection = lazy(() => loaders.treinamentos().then((module) => ({ default: module.TreinamentosSection })))
export const RecordsSection = lazy(() => loaders.registros().then((module) => ({ default: module.RecordsSection })))
export const AnnouncementsSection = lazy(() => loaders.comunicados().then((module) => ({ default: module.AnnouncementsSection })))
export const QuestionThread = lazy(() => loaders.duvidas().then((module) => ({ default: module.QuestionThread })))
export const ForumView = lazy(() => loaders.forum().then((module) => ({ default: module.ForumView })))
export const EnrollmentHome = lazy(() => loaders.enrollment().then((module) => ({ default: module.EnrollmentHome })))

/** Starts a section's chunk (menu hover/focus). Errors surface when it renders. */
export function prefetchStudentSection(section: PortalSection | 'enrollment') {
  const load = (loaders as Partial<Record<string, () => Promise<unknown>>>)[section]
  load?.().catch(() => undefined)
}
