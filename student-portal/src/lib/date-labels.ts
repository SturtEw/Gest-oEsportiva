/**
 * Calendar-date formatting for schedule values.
 *
 * `data_aula` is a calendar day (YYYY-MM-DD) and `hora_inicio` is a wall-clock time
 * (HH:MM). Neither is an instant, so neither may go through `new Date()`: that would
 * reinterpret them in the reader's timezone and could shift a session to the previous
 * or next day for anyone outside UTC — the same class of bug as the timestamp work in
 * lib/formatters.ts. These helpers read the string parts directly.
 */

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** Parse YYYY-MM-DD into parts without going through Date/timezone maths. */
export function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** Construct a Date at midday UTC so the calendar day can never slip. */
function toSafeDate(value: string): Date | null {
  const parts = parseCalendarDate(value)
  if (!parts) return null
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatWeekdayLabel(value: string): string {
  const date = toSafeDate(value)
  return date ? WEEKDAYS[date.getUTCDay()] : '—'
}

export function formatWeekdayShort(value: string): string {
  const date = toSafeDate(value)
  return date ? WEEKDAYS_SHORT[date.getUTCDay()] : '—'
}

/** "26/09" */
export function formatShortDate(value: string): string {
  const parts = parseCalendarDate(value)
  return parts ? `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}` : '—'
}

/** "26 de setembro" */
export function formatLongDate(value: string): string {
  const parts = parseCalendarDate(value)
  if (!parts) return '—'
  return `${parts.day} de ${MONTHS[parts.month - 1]}`
}

/** "Hoje", "Amanhã" or a short date, relative to a reference calendar day. */
export function formatRelativeDay(value: string, today: string): string {
  if (value === today) return 'Hoje'
  const target = parseCalendarDate(value)
  const reference = parseCalendarDate(today)
  if (!target || !reference) return formatShortDate(value)
  const a = Date.UTC(target.year, target.month - 1, target.day)
  const b = Date.UTC(reference.year, reference.month - 1, reference.day)
  const diffDays = Math.round((a - b) / 86_400_000)
  if (diffDays === 1) return 'Amanhã'
  return formatShortDate(value)
}

/** Validate a HH:MM wall-clock string. */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())
}
