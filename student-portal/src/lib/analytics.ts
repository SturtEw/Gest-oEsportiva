/**
 * Firebase Analytics off the critical path (docs/code-splitting-plan.md, step 2).
 * The SDK (~40 kB gz) is only used for analytics, so it loads when the browser
 * is idle after the first render, and only in production builds: dev and test
 * runs no longer send page views.
 */
export function scheduleAnalytics() {
  if (!import.meta.env.PROD || typeof window === 'undefined') return
  const start = () => { import('./firebase').catch(() => undefined) }
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5000 })
  else globalThis.setTimeout(start, 3000)
}
