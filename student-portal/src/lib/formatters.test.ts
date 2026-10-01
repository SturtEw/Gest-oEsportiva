import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, parseApiDate, toSortableTime } from '@/lib/formatters'

/**
 * The backend stores aware-UTC instants, but legacy rows and the realtime feed can
 * still hand us offset-less strings. These tests pin the two behaviours that caused
 * the cascading shifts: an offset-less timestamp must be read as UTC (not browser
 * local time), and a date-only value must never slide to the neighbouring day.
 */
describe('parseApiDate', () => {
  it('reads an offset-less datetime as UTC instead of browser-local', () => {
    const parsed = parseApiDate('2026-09-26T20:06:35.798')
    expect(parsed?.toISOString()).toBe('2026-09-26T20:06:35.798Z')
  })

  it('keeps an explicit offset', () => {
    const parsed = parseApiDate('2026-09-26T17:06:35-03:00')
    expect(parsed?.toISOString()).toBe('2026-09-26T20:06:35.000Z')
  })

  it('accepts the Z suffix', () => {
    expect(parseApiDate('2026-09-26T20:06:35.798Z')?.toISOString()).toBe('2026-09-26T20:06:35.798Z')
  })

  it('normalises a space-separated datetime', () => {
    expect(parseApiDate('2026-09-26 20:06:35')?.toISOString()).toBe('2026-09-26T20:06:35.000Z')
  })

  it('anchors a date-only value at noon so the day cannot shift', () => {
    expect(parseApiDate('2026-09-26')?.toISOString()).toBe('2026-09-26T12:00:00.000Z')
  })

  it('returns null for missing or unusable values', () => {
    expect(parseApiDate(null)).toBeNull()
    expect(parseApiDate(undefined)).toBeNull()
    expect(parseApiDate('')).toBeNull()
    expect(parseApiDate('   ')).toBeNull()
    expect(parseApiDate('amanhã')).toBeNull()
  })
})

describe('formatters', () => {
  it('formats a date-only value as the same calendar day', () => {
    // No timeZone pin: the value is a calendar day, not an instant.
    expect(formatDate('2026-09-26')).toBe('26 de set. de 2026')
  })

  it('does not shift a date-only value into the previous day', () => {
    expect(formatDate('2026-01-01')).toBe('1 de jan. de 2026')
  })

  it('reports missing values instead of rendering "Invalid Date"', () => {
    expect(formatDate(null)).toBe('Não informado')
    expect(formatDateTime(null)).toBe('Não informado')
    expect(formatDateTime('lixo')).toBe('Não informado')
  })
})

describe('toSortableTime', () => {
  it('orders real instants chronologically, not lexicographically', () => {
    // Lexicographic compare agrees here, but only because ISO prefixes match; the
    // offset-less case below is the one that used to break.
    expect(toSortableTime('2026-09-26T20:00:00Z')).toBeGreaterThan(toSortableTime('2026-09-26T10:00:00Z'))
  })

  it('agrees between offset and offset-less representations of the same instant', () => {
    expect(toSortableTime('2026-09-26T20:06:35Z')).toBe(toSortableTime('2026-09-26T17:06:35-03:00'))
  })

  it('sorts unusable values last', () => {
    expect(toSortableTime(null)).toBe(Number.NEGATIVE_INFINITY)
    expect(toSortableTime('nope')).toBeLessThan(toSortableTime('2026-09-26T20:00:00Z'))
  })
})
