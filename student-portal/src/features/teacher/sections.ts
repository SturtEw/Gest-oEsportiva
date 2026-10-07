/**
 * Teacher-area views in their own chunks (docs/code-splitting-plan.md, step 3).
 * The dashboard is the first screen and stays in the area chunk.
 */
import { lazy } from 'react'

const loaders = {
  atividades: () => import('@/features/activities/teacher/TeacherActivitiesView'),
  convites: () => import('./enrollment/TeacherEnrollmentPanel'),
  workouts: () => import('@/features/teacher/workouts/TeacherWorkoutsView'),
  prescribed: () => import('@/features/teacher/workouts/TeacherPrescribedWorkouts'),
  forum: () => import('@/features/forum/ForumView'),
}

export const TeacherActivitiesView = lazy(() => loaders.atividades().then((module) => ({ default: module.TeacherActivitiesView })))
export const TeacherEnrollmentPanel = lazy(() => loaders.convites().then((module) => ({ default: module.TeacherEnrollmentPanel })))
export const TeacherWorkoutsView = lazy(() => loaders.workouts().then((module) => ({ default: module.TeacherWorkoutsView })))
export const TeacherPrescribedWorkouts = lazy(() => loaders.prescribed().then((module) => ({ default: module.TeacherPrescribedWorkouts })))
export const ForumView = lazy(() => loaders.forum().then((module) => ({ default: module.ForumView })))

/** Starts a view's chunk from the menu (hover/focus/press). */
export function prefetchTeacherView(view: string) {
  const load = (loaders as Partial<Record<string, () => Promise<unknown>>>)[view]
  load?.().catch(() => undefined)
}
