/** Contagem de tempo decorrido desde `startedAt` (ISO), atualizada a cada segundo.
 *  Exibição apenas: a verdade do tempo é sempre o servidor. */

import { useEffect, useState } from 'react'

export function useElapsedTimer(startedAt: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const mm = String(Math.floor(seconds / 60) % 60).padStart(2, '0')
  const hh = Math.floor(seconds / 3600)
  const ss = String(seconds % 60).padStart(2, '0')
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}
