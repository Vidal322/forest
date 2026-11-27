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

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** Short month names as written in Portugal ("2 nov"); Intl's pt-PT short date is "2/11", not wanted. */
const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2 nov", or "2 nov 2025" when not this year. */
export function formatDay(iso: string, today: string = fieldToday()): string {
  const [y, m, d] = ymd(iso)
  const year = iso.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`
  return `${d} ${SHORT_MONTHS[m]}${year}`
}

/** "22 de novembro", or "22 de novembro de 2025" when not this year. */
export function formatLongDay(iso: string, today: string = fieldToday()): string {
  const [y, m, d] = ymd(iso)
  const year = iso.slice(0, 4) === today.slice(0, 4) ? '' : ` de ${y}`
  return `${d} de ${MONTHS[m]}${year}`
}

/** "hoje", "ontem", "há 5 dias", "amanhã", "daqui a 3 dias", "2 nov". */
export function relativeDay(iso: string, today: string = fieldToday()): string {
  const d = daysBetween(iso, today)
  if (d === 0) return 'hoje'
  if (d === 1) return 'ontem'
  if (d > 1 && d < 14) return `há ${d} dias`
  if (d === -1) return 'amanhã'
  if (d < -1 && d > -14) return `daqui a ${-d} dias`
  return formatDay(iso, today)
}

/** relativeDay to follow a verb: "hoje", "há 5 dias", "a 2 nov" ("feita a 2 nov"). */
export function whenDay(iso: string, today: string = fieldToday()): string {
  const r = relativeDay(iso, today)
  return /^\d/.test(r) ? `a ${r}` : r
}

/** "1 dia", "3 dias". */
export function days(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`
}
