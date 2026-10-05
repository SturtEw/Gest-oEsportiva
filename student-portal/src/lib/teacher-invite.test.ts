import { afterEach, describe, expect, it } from 'vitest'
import { isTeacherInvitePath, leaveTeacherInvitePath, teacherInviteLink, teacherInviteTokenFromLocation } from './teacher-invite'

const TOKEN = 'k3Jx9vQe2Lr8pT0aYz5mWn7cB1dF4gH6sU-_iOoPqRs'

describe('teacher invite links', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('builds a link on the given origin and reads the token back', () => {
    const link = teacherInviteLink(TOKEN, 'https://portal.escola.com.br')
    expect(link).toBe(`https://portal.escola.com.br/convite-professor?token=${TOKEN}`)
    expect(teacherInviteTokenFromLocation(new URL(link).search)).toBe(TOKEN)
  })

  it('ignores missing or truncated tokens', () => {
    expect(teacherInviteTokenFromLocation('')).toBe('')
    expect(teacherInviteTokenFromLocation('?token=abc')).toBe('')
    expect(teacherInviteTokenFromLocation(`?token=%20${TOKEN}%20`)).toBe(TOKEN)
  })

  it('recognises the invite path with or without a trailing slash', () => {
    expect(isTeacherInvitePath('/convite-professor')).toBe(true)
    expect(isTeacherInvitePath('/convite-professor/')).toBe(true)
    expect(isTeacherInvitePath('/reset-senha')).toBe(false)
  })

  it('leaves the invite URL after use', () => {
    window.history.replaceState(null, '', `/convite-professor?token=${TOKEN}`)
    leaveTeacherInvitePath()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('')
  })
})
