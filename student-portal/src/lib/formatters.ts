// ─── Timestamp handling ────────────────────────────────────────────────────────
// The API always sends ISO-8601 **with** an offset (BSON dates are UTC, serialised
// by the backend with tz_aware). Two traps used to cascade here:
//
//  1. `new Date('2026-09-26T20:06:35.123')` (no offset) is parsed as **local** time
//     in every engine, shifting the instant by the browser's zone — up to 3h in BRT.
//  2. `formatDate` pinned `timeZone: 'UTC'` while `formatDateTime` used the local
//     zone, so the same record showed two different days depending on the helper.
//
// Fix: parse once, defensively, and treat an offset-less datetime as UTC (matching
// what the server meant). Calendar-only dates ("2026-09-26") are date-only values and
// are never shifted.

/** Parse an API timestamp or calendar date into a real Date, or null if unusable. */
export function parseApiDate(value?: string | null): Date | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  // Date-only: a calendar day, not an instant. Noon UTC keeps the day stable.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T12:00:00Z`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  // A space separator is not valid ISO-8601 for Date; make it explicit.
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const parsed = new Date(hasOffset ? normalized : `${normalized}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Sortable numeric key for mixed date/date-time strings; NaN sorts last. */
export function toSortableTime(value?: string | null): number {
  const parsed = parseApiDate(value)
  return parsed ? parsed.getTime() : Number.NEGATIVE_INFINITY
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const decimalFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatDate(value?: string | null): string {
  const parsed = parseApiDate(value)
  return parsed ? dateFormatter.format(parsed) : 'Não informado'
}

export function formatDateTime(value?: string | null): string {
  const parsed = parseApiDate(value)
  return parsed ? dateTimeFormatter.format(parsed) : 'Não informado'
}

export function formatBimester(value?: string | null): string {
  if (!value) return 'Bimestre não informado'
  const match = /^(\d{4})-Q([1-4])$/.exec(value)
  return match ? `${match[2]}º bimestre de ${match[1]}` : value
}

export function formatScore(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${decimalFormatter.format(value)}/10` : 'Ainda não há avaliação'
}

export function formatPoints(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${new Intl.NumberFormat('pt-BR').format(value)} pontos` : 'Pontuação não informada'
}

export function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value
}

export function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toLocaleUpperCase('pt-BR') || 'GE'
}
