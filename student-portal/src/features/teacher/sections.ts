/**
 * Teacher-area views in their own chunks (docs/code-splitting-plan.md, step 3).
 * The dashboard is the first screen and stays in the area chunk.
 */
import { lazy } from 'react'

const loaders = {
  atividades: () => import('@/features/activities/teacher/TeacherActivitiesView'),
  convites: () => import('./enrollment/TeacherEnrollmentPanel'),
}

export const TeacherActivitiesView = lazy(() => loaders.atividades().then((module) => ({ default: module.TeacherActivitiesView })))
export const TeacherEnrollmentPanel = lazy(() => loaders.convites().then((module) => ({ default: module.TeacherEnrollmentPanel })))

/** Starts a view's chunk from the menu (hover/focus/press). */
export function prefetchTeacherView(view: string) {
  const load = (loaders as Partial<Record<string, () => Promise<unknown>>>)[view]
  load?.().catch(() => undefined)
}
