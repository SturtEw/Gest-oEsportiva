/**
 * Invite codes: 8 characters from an alphabet without 0/O/1/I (mirrors
 * backend/services/class_enrollment.py). Shown as "ABCD-EFGH" for reading aloud,
 * accepted in any case and with or without the dash.
 */

export const INVITE_CODE_LENGTH = 8
export const INVITE_QUERY_PARAM = 'convite'

/** Strip separators and case so "abcd-efgh" and "ABCDEFGH" are the same code. */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, INVITE_CODE_LENGTH)
}

/** "ABCDEFGH" → "ABCD-EFGH"; partial input is grouped as it is typed. */
export function formatInviteCode(raw: string): string {
  const code = normalizeInviteCode(raw)
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export function isCompleteInviteCode(raw: string): boolean {
  return normalizeInviteCode(raw).length === INVITE_CODE_LENGTH
}

/** Signup link that pre-fills the code: `https://app/?convite=ABCDEFGH`. */
export function inviteLink(code: string, origin = typeof window === 'undefined' ? '' : window.location.origin): string {
  const url = new URL('/', origin || 'http://localhost')
  url.searchParams.set(INVITE_QUERY_PARAM, normalizeInviteCode(code))
  return url.toString()
}

/** Code carried by the current URL (`?convite=`), or '' when absent/invalid. */
export function inviteCodeFromLocation(search = typeof window === 'undefined' ? '' : window.location.search): string {
  const code = normalizeInviteCode(new URLSearchParams(search).get(INVITE_QUERY_PARAM) ?? '')
  return code.length === INVITE_CODE_LENGTH ? code : ''
}

/** Drop `?convite=` after use, so a reload or a shared screenshot does not reuse it. */
export function clearInviteFromLocation(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(INVITE_QUERY_PARAM)) return
  url.searchParams.delete(INVITE_QUERY_PARAM)
  window.history.replaceState(window.history.state, '', url.toString())
}

/** Copy to the clipboard; resolves false when the browser refuses (http, permissions). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
