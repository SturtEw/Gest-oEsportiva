import { describe, expect, it } from 'vitest'
import { formatInviteCode, inviteCodeFromLocation, inviteLink, isCompleteInviteCode, normalizeInviteCode } from './invite-code'

describe('invite codes', () => {
  it('normalizes what people type', () => {
    expect(normalizeInviteCode(' abcd-ef 23 ')).toBe('ABCDEF23')
    expect(normalizeInviteCode('ABCDEFGH-XYZ')).toBe('ABCDEFGH')
  })

  it('groups the code for reading', () => {
    expect(formatInviteCode('abcdefgh')).toBe('ABCD-EFGH')
    expect(formatInviteCode('abc')).toBe('ABC')
    expect(formatInviteCode('abcde')).toBe('ABCD-E')
  })

  it('only treats 8 characters as a complete code', () => {
    expect(isCompleteInviteCode('ABCD-EFGH')).toBe(true)
    expect(isCompleteInviteCode('ABCD-EFG')).toBe(false)
  })

  it('builds and reads the signup link', () => {
    const link = inviteLink('abcd-efgh', 'https://app.example.com')
    expect(link).toBe('https://app.example.com/?convite=ABCDEFGH')
    expect(inviteCodeFromLocation(new URL(link).search)).toBe('ABCDEFGH')
    expect(inviteCodeFromLocation('?convite=abc')).toBe('')
    expect(inviteCodeFromLocation('')).toBe('')
  })
})
