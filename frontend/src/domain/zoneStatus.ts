import { daysBetween } from './dates'

/** What a zone's colour on the map means (same legend as the mockups). */
export type ZoneStatus = 'needs-water' | 'watered' | 'planted' | 'sown' | 'unsown' | 'path'

export const STATUS_LABEL: Record<ZoneStatus, string> = {
  'needs-water': 'Needs water',
  watered: 'Watered',
  planted: 'Planted',
  sown: 'Sown',
  unsown: 'Nothing yet',
  path: 'Path / other',
}

/** "Watered recently" = within this many days. */
export const RECENTLY_WATERED_DAYS = 7

export interface ZoneState {
  kind: 'cultivation' | 'path' | 'other'
  last_sown_on: string | null
  last_planted_on: string | null
  last_watered_on: string | null
  current_interval_days: number
}

const latest = (...dates: (string | null)[]) =>
  dates.reduce<string | null>((a, b) => (b !== null && (a === null || b > a) ? b : a), null)

/**
 * Same rule as the zone_status view, recomputed on the phone so the map stays
 * right offline and as days pass: a cultivation zone needs water when nothing was
 * watered, sown or planted there for the interval in effect.
 *
 * The interval is the server's (current_interval_days, for the day it answered):
 * offline across a change of season the phone keeps the old one until it syncs.
 */
export function needsWater(z: ZoneState, today: string): boolean | null {
  if (z.kind !== 'cultivation') return null
  const last = latest(z.last_watered_on, z.last_sown_on, z.last_planted_on)
  if (last === null) return false
  return daysBetween(last, today) >= z.current_interval_days
}

/** Days since the zone last got water (watering, sowing or planting); null when it never did. */
export function daysDry(z: ZoneState, today: string): number | null {
  const last = latest(z.last_watered_on, z.last_sown_on, z.last_planted_on)
  return last === null ? null : daysBetween(last, today)
}

export function zoneStatus(z: ZoneState, today: string): ZoneStatus {
  if (z.kind !== 'cultivation') return 'path'
  if (latest(z.last_watered_on, z.last_sown_on, z.last_planted_on) === null) return 'unsown'
  if (needsWater(z, today)) return 'needs-water'
  if (z.last_watered_on && daysBetween(z.last_watered_on, today) <= RECENTLY_WATERED_DAYS) return 'watered'
  // within the interval, no recent watering: say what is there
  if (z.last_planted_on) return 'planted'
  if (z.last_sown_on) return 'sown'
  return 'watered' // only ever watered (e.g. an existing planting): watered within the interval
}

/** What the zone list's order means, in one line. */
export const NEED_ORDER_HINT = 'Most urgent first: dry longest, then unsown or with open tasks.'

/**
 * How urgent a zone is, for sorting (lower = sooner), from the derived status:
 * needs water (longest overdue first), then needs attention (nothing sown yet, or
 * open tasks), then fine. Ties keep the caller's order (sort is stable).
 */
export function needRank(z: ZoneState & { open_task_count: number }, today: string): [number, number] {
  const s = zoneStatus(z, today)
  if (s === 'needs-water') {
    const last = latest(z.last_watered_on, z.last_sown_on, z.last_planted_on)!
    return [0, -(daysBetween(last, today) - z.current_interval_days)]
  }
  if (s === 'unsown' || z.open_task_count > 0) return [1, 0]
  return [2, 0]
}

export function byNeed(today: string) {
  return (a: ZoneState & { open_task_count: number }, b: ZoneState & { open_task_count: number }) => {
    const [ra, da] = needRank(a, today)
    const [rb, db] = needRank(b, today)
    return ra - rb || da - db
  }
}
