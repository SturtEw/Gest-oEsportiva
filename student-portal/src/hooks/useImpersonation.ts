/**
 * Impersonation Context - Manages "View As" state for Root Admin
 * Separated from useSession to avoid circular dependencies and keep concerns clean
 */
import { createContext, createElement, useContext, useState, useCallback, useMemo, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import type { UserRole } from '@/lib/types'
import { setImpersonationGetter } from '@/lib/api/client'

export type ImpersonatedRole = 'professor' | 'aluno' | null
export interface ViewTarget { id: string; nome: string; aluno_id?: string }

interface ImpersonationContextValue {
  impersonatedRole: ImpersonatedRole
  target: ViewTarget | null
  originalRole: UserRole | null
  isImpersonating: boolean
  setViewAs: (role: Exclude<ImpersonatedRole, null>, target: ViewTarget) => void
  clearImpersonation: () => void
  effectiveRole: UserRole
  effectiveIsRootAdmin: boolean
  originalIsRootAdmin: boolean
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null)

interface ImpersonationProviderProps {
  children: ReactNode
  userRole: UserRole | null
  userIsRootAdmin: boolean
  userId: string | null
}

export function ImpersonationProvider({ children, userRole, userIsRootAdmin, userId }: ImpersonationProviderProps) {
  const [view, setView] = useState<{ actorId: string; role: Exclude<ImpersonatedRole, null>; target: ViewTarget } | null>(null)
  const originalIsRootAdmin = userRole === 'admin' && userIsRootAdmin && !!userId
  // Never reuse a view across logout, a changed account, or an expired session.
  const activeView = originalIsRootAdmin && view?.actorId === userId ? view : null
  const impersonatedRole = activeView?.role ?? null
  const target = activeView?.target ?? null
  useLayoutEffect(() => {
    setImpersonationGetter(() => activeView ? { role: activeView.role, targetId: activeView.target.id } : null)
    return () => setImpersonationGetter(() => null)
  }, [activeView])

  const setViewAs = useCallback((role: Exclude<ImpersonatedRole, null>, selected: ViewTarget) => {
    if (!originalIsRootAdmin || !userId || !selected.id || (role === 'aluno' && !selected.aluno_id)) return
    setView({ actorId: userId, role, target: selected })
  }, [originalIsRootAdmin, userId])

  const clearImpersonation = useCallback(() => setView(null), [])

  const effectiveRole = impersonatedRole ?? userRole ?? 'aluno'
  const effectiveIsRootAdmin = originalIsRootAdmin && !impersonatedRole

  const value = useMemo(() => ({
    impersonatedRole,
    target,
    originalRole: userRole,
    isImpersonating: !!impersonatedRole,
    setViewAs,
    clearImpersonation,
    effectiveRole,
    effectiveIsRootAdmin,
    originalIsRootAdmin,
  }), [impersonatedRole, target, userRole, setViewAs, clearImpersonation, effectiveRole, effectiveIsRootAdmin, originalIsRootAdmin])

  return createElement(ImpersonationContext.Provider, { value }, children)
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext)
  if (!context) {
    throw new Error('useImpersonation must be used within an ImpersonationProvider')
  }
  return context
}
