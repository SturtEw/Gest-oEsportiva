import { useCallback, useState } from 'react'

/** Busy flag + error message around one async action (a form submit, a confirm button). */
export function useAction(fallback = 'Algo deu errado. Tente de novo.') {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Resolves true when the action succeeded; the error stays in `error` otherwise. */
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback)
      return false
    } finally {
      setBusy(false)
    }
  }, [fallback])

  const clearError = useCallback(() => setError(null), [])

  return { busy, error, run, clearError }
}
