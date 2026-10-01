/**
 * Redirect from Firebase's default hosts to the canonical custom domain.
 *
 * Safari (ITP) drops cookies set by an API on a different site. Once the app is
 * served from app.<domain> and the API from api.<domain>, the session cookie is
 * same-site and SameSite=Lax. Visitors still arriving on *.web.app /
 * *.firebaseapp.com would be cross-site again and could never stay signed in,
 * so they are sent to the same path on the canonical origin.
 *
 * Disabled while VITE_CANONICAL_ORIGIN is empty (current state: no custom
 * domain yet). Preview channels (`site--channel-hash.web.app`) are never
 * redirected, so PR previews keep working.
 */

const FIREBASE_DEFAULT_HOST_SUFFIXES = ['.web.app', '.firebaseapp.com']

interface LocationLike {
  origin: string
  hostname: string
  pathname: string
  search: string
  hash: string
}

export function canonicalRedirectTarget(current: LocationLike, canonicalOrigin: string | undefined): string | null {
  const configured = canonicalOrigin?.trim()
  if (!configured) return null

  let canonical: URL
  try {
    canonical = new URL(configured)
  } catch {
    return null
  }

  if (canonical.protocol !== 'https:' || current.origin === canonical.origin) return null

  const host = current.hostname.toLowerCase()
  const isFirebaseDefaultHost = FIREBASE_DEFAULT_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))
  const isPreviewChannel = host.includes('--')
  if (!isFirebaseDefaultHost || isPreviewChannel) return null

  return `${canonical.origin}${current.pathname}${current.search}${current.hash}`
}

/** Returns true when a redirect was started; the caller should skip rendering. */
export function redirectToCanonicalOrigin(): boolean {
  if (typeof window === 'undefined') return false
  const target = canonicalRedirectTarget(window.location, import.meta.env.VITE_CANONICAL_ORIGIN)
  if (!target) return false
  window.location.replace(target)
  return true
}
