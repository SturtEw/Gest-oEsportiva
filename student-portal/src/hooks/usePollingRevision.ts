import { useEffect, useState } from 'react'

const DEFAULT_INTERVAL_MS = 20000

/**
 * A counter that ticks every `intervalMs` while the tab is visible, and when the
 * user comes back to the tab. Feed it into a data hook's revision as a fallback
 * for when realtime is not live (single-server mode closes the socket).
 */
export function usePollingRevision(enabled: boolean, intervalMs = DEFAULT_INTERVAL_MS) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const recheck = () => { if (document.visibilityState === 'visible') setTick((value) => value + 1) }
    const timer = window.setInterval(recheck, intervalMs)
    document.addEventListener('visibilitychange', recheck)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', recheck) }
  }, [enabled, intervalMs])

  return tick
}
