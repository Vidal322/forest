/** Dates are ISO "YYYY-MM-DD" strings in the field's own day (Europe/Lisbon), like the server's field_today(). */

export const FIELD_TIME_ZONE = 'Europe/Lisbon'

/** Today in the field, whatever timezone the phone is set to. */
export function fieldToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: FIELD_TIME_ZONE }).format(now)
}

/** Whole days from a to b (b later → positive). Both are calendar dates, so no DST surprises. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86_400_000)
}

export function addDays(iso: string, n: number): string {
  const d = new Date(Date.UTC(...ymd(iso)) + n * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y!, m! - 1, d!]
}

/** "28 Sep", or "28 Sep 2025" when not this year. */
export function formatDay(iso: string, today: string = fieldToday()): string {
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(...ymd(iso))))
}

/** "today", "yesterday", "5 days ago", "28 Sep". */
export function relativeDay(iso: string, today: string = fieldToday()): string {
  const d = daysBetween(iso, today)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d > 1 && d < 14) return `${d} days ago`
  if (d === -1) return 'tomorrow'
  if (d < -1 && d > -14) return `in ${-d} days`
  return formatDay(iso, today)
}
