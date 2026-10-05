/**
 * Teacher invitation links: `/convite-professor?token=...` (mirrors
 * backend/services/teacher_invites.py). The token is random and single use;
 * the server stores only its hash.
 */

export const TEACHER_INVITE_PATH = '/convite-professor'
const TOKEN_PARAM = 'token'
/** `secrets.token_urlsafe(32)` gives 43 characters; anything this short is a truncated copy. */
const MIN_TOKEN_LENGTH = 20

const currentLocation = () => (typeof window === 'undefined' ? null : window.location)

export function isTeacherInvitePath(pathname = currentLocation()?.pathname ?? ''): boolean {
  return pathname.replace(/\/+$/, '').toLowerCase().endsWith(TEACHER_INVITE_PATH)
}

/** Token from the current URL, or '' when absent/too short to be valid. */
export function teacherInviteTokenFromLocation(search = currentLocation()?.search ?? ''): string {
  const token = (new URLSearchParams(search).get(TOKEN_PARAM) ?? '').trim()
  return token.length >= MIN_TOKEN_LENGTH ? token : ''
}

/** Full link to share, built on this app's origin (the admin is already on it). */
export function teacherInviteLink(token: string, origin = currentLocation()?.origin ?? ''): string {
  const url = new URL(TEACHER_INVITE_PATH, origin || 'http://localhost')
  url.searchParams.set(TOKEN_PARAM, token)
  return url.toString()
}

/** Leave the invite URL once it is used, so a reload does not reopen the signup. */
export function leaveTeacherInvitePath(): void {
  if (typeof window === 'undefined' || !isTeacherInvitePath()) return
  window.history.replaceState(window.history.state, '', '/')
}
