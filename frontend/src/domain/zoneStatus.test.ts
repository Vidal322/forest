import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, fieldToday, formatDay, relativeDay } from './dates'
import { needsWater, zoneStatus, type ZoneState } from './zoneStatus'

const base: ZoneState = {
  kind: 'cultivation',
  last_sown_on: null,
  last_planted_on: null,
  last_watered_on: null,
  current_interval_days: 7,
}
const today = '2026-11-22'

describe('zoneStatus', () => {
  it('paths are never watered', () => {
    expect(zoneStatus({ ...base, kind: 'path', last_sown_on: '2026-01-01' }, today)).toBe('path')
    expect(needsWater({ ...base, kind: 'other' }, today)).toBeNull()
  })

  it('a zone with nothing yet does not need water', () => {
    expect(zoneStatus(base, today)).toBe('unsown')
    expect(needsWater(base, today)).toBe(false)
  })

  it('needs water once the interval has passed since the last watering, sowing or planting', () => {
    const z = { ...base, last_sown_on: '2026-11-15' }
    expect(zoneStatus(z, today)).toBe('needs-water') // 7 days, interval 7
    expect(zoneStatus(z, '2026-11-21')).toBe('sown')
    expect(zoneStatus({ ...z, last_planted_on: '2026-11-20' }, today)).toBe('planted')
  })

  it('shows recent watering over planting', () => {
    const z = { ...base, last_planted_on: '2026-10-01', last_watered_on: '2026-11-20', current_interval_days: 14 }
    expect(zoneStatus(z, today)).toBe('watered')
    expect(zoneStatus(z, '2026-11-27')).toBe('watered') // 7 days
    expect(zoneStatus(z, '2026-11-28')).toBe('planted') // 8 days: no longer recent, but under the 14-day interval
  })
})

describe('dates', () => {
  it('counts calendar days across DST and months', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2) // DST ends 25 Oct in Lisbon
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('takes "today" in the field, not in the phone’s timezone', () => {
    // winter: Lisbon is UTC+0
    expect(fieldToday(new Date('2026-11-22T23:30:00Z'))).toBe('2026-11-22')
    // summer: Lisbon is UTC+1, so 23:30 UTC is the next day there
    expect(fieldToday(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
  })

  it('formats days for people', () => {
    expect(formatDay('2026-09-28', today)).toMatch(/^28 Sept?$/)
    expect(formatDay('2025-09-28', today)).toMatch(/^28 Sept? 2025$/)
    expect(relativeDay('2026-11-22', today)).toBe('today')
    expect(relativeDay('2026-11-21', today)).toBe('yesterday')
    expect(relativeDay('2026-11-17', today)).toBe('5 days ago')
  })
})
