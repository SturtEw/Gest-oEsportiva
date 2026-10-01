import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { SessionUser } from '@/lib/types'

export type SessionState = 'loading' | 'authenticated' | 'anonymous'

function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some((c) => c.startsWith('gesp_session='))
}

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [status, setStatus] = useState<SessionState>(() => (hasSessionCookie() ? 'loading' : 'anonymous'))
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const refreshSession = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await api.session({ signal: controller.signal })
      // Check if this request was superseded
      if (controller.signal.aborted) return
      // Guard against a malformed/empty payload instead of dereferencing blindly.
      if (!result || !result.user) {
        setUser(null)
        setStatus('anonymous')
        setError('Não foi possível verificar sua sessão.')
        return
      }
      setUser(result.user)
      setStatus('authenticated')
      setError(null)
    } catch (cause) {
      // Ignore aborted requests
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (controller.signal.aborted) return
      // Detect 401 by shape, not by `instanceof ApiError`: across the wire the
      // error may be a plain object/rehydrated error that fails the check.
      const status = (cause as { status?: unknown })?.status
      if (status === 401) {
        setUser(null)
        setStatus('anonymous')
        setError(null)
        return
      }
      setStatus('anonymous')
      setError(cause instanceof Error ? cause.message : 'Não foi possível verificar sua sessão.')
    }
  }, [])

  useEffect(() => {
    void refreshSession()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [refreshSession])

  const login = useCallback(async (loginValue: string, senha: string) => {
    setError(null)
    try {
      const result = await api.login(loginValue, senha)
      setUser(result.user)
      setStatus('authenticated')
      setError(null)
      return result.user
    } catch (cause) {
      // Surface the failure in the shared error channel so callers that only
      // await the promise (without their own try/catch) still see the reason.
      setStatus('anonymous')
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.')
      throw cause
    }
  }, [])

  const loginGoogle = useCallback(async (credential: string) => {
    setError(null)
    try {
      const result = await api.googleLogin(credential)
      setUser(result.user)
      setStatus('authenticated')
      setError(null)
      return result.user
    } catch (cause) {
      setStatus('anonymous')
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar com Google.')
      throw cause
    }
  }, [])

  const acceptRegistration = useCallback((newUser: SessionUser) => {
    setUser(newUser)
    setStatus('authenticated')
    setError(null)
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } finally { setUser(null); setStatus('anonymous'); setError(null) }
  }, [])

  // Clear children error when user changes (used by App.tsx)
  const clearChildrenError = useCallback(() => {
    // This is a placeholder - actual clearing happens in App.tsx useEffect
  }, [])

  return { user, status, error, setError, setUser, login, loginGoogle, acceptRegistration, logout, refreshSession, clearChildrenError }
}
