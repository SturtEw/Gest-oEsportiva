const RELOAD_KEY = 'ge:chunk-reload-at'
const RELOAD_COOLDOWN_MS = 60_000

/**
 * After a deploy, a tab opened on the previous version asks for chunk hashes
 * that no longer exist. Vite reports it as `vite:preloadError`; reloading once
 * fetches the new index.html and its new chunks. The cooldown avoids a reload
 * loop when the chunk is missing for another reason (offline, CDN outage): the
 * error then reaches SectionErrorBoundary, which offers "Recarregar".
 */
export function recoverFromStaleChunks() {
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) } catch { /* storage blocked */ }
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked */ }
    event.preventDefault()
    window.location.reload()
  })
}
