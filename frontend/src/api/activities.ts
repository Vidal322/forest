import type { QueryClient } from '@tanstack/react-query'
import { defineEntity } from './entity'
import type { Zone } from './plots'

export type ActivityType = 'watering' | 'sowing' | 'planting' | 'fertilizing' | 'other'
export type QuantityUnit = 'holes' | 'seeds' | 'trees' | 'litres' | 'kg'

export interface ActivityZone {
  zone_id: string
  quantity: number | null
  unit: QuantityUnit | null
}

export interface ActivitySpecies {
  species_id: string
  quantity: number | null
  unit: QuantityUnit | null
  notes: string | null
}

export interface Activity {
  id: string
  type: ActivityType
  performed_on: string
  notes: string | null
  zones: ActivityZone[]
  species: ActivitySpecies[]
  version: number
  created_at: string
  updated_at: string
}

export interface ActivityInput {
  type: ActivityType
  performed_on: string
  notes: string | null
  zones: ActivityZone[]
  species: ActivitySpecies[]
  /** the version an edit started from; null for a new entry */
  base_version: number | null
}

export const ACTIVITY: Record<ActivityType, { label: string; past: string; icon: string; unit: QuantityUnit | null }> = {
  watering: { label: 'Watered', past: 'watered', icon: '💧', unit: 'litres' },
  sowing: { label: 'Sowed', past: 'sowed', icon: '🕳️', unit: 'holes' },
  planting: { label: 'Planted', past: 'planted', icon: '🌱', unit: 'trees' },
  fertilizing: { label: 'Fertilized', past: 'fertilized', icon: '🧪', unit: 'kg' },
  other: { label: 'Other', past: 'logged', icon: '•', unit: null },
}

export const UNIT_LABEL: Record<QuantityUnit, string> = {
  holes: 'covas',
  seeds: 'seeds',
  trees: 'trees',
  litres: 'litres',
  kg: 'kg',
}

const LAST_FIELD: Partial<Record<ActivityType, 'last_watered_on' | 'last_sown_on' | 'last_planted_on'>> = {
  watering: 'last_watered_on',
  sowing: 'last_sown_on',
  planting: 'last_planted_on',
}

/**
 * Show a new log entry on the map at once (also offline): move the zones' "last
 * watered / sown / planted" dates. The server's zone list replaces this on refresh.
 */
function applyToZones(qc: QueryClient, input: ActivityInput) {
  const field = LAST_FIELD[input.type]
  if (!field) return
  const ids = new Set(input.zones.map((z) => z.zone_id))
  const before = new Map<string, string | null>()
  qc.setQueryData<Zone[]>(['zones'], (list) =>
    list?.map((z) => {
      if (!ids.has(z.id) || (z[field] !== null && z[field]! >= input.performed_on)) return z
      before.set(z.id, z[field])
      return { ...z, [field]: input.performed_on }
    }),
  )
  // refused by the server: put the dates back (a refetch follows anyway)
  return () =>
    qc.setQueryData<Zone[]>(['zones'], (list) =>
      list?.map((z) => (before.has(z.id) && z[field] === input.performed_on ? { ...z, [field]: before.get(z.id)! } : z)),
    )
}

export const activities = defineEntity<Activity, ActivityInput>({
  name: 'activities',
  sort: (a, b) => b.performed_on.localeCompare(a.performed_on) || b.created_at.localeCompare(a.created_at),
  optimistic: (id, input, before) => {
    const now = new Date().toISOString()
    const { base_version: _base, ...rest } = input
    return { id, ...rest, version: before?.version ?? 1, created_at: before?.created_at ?? now, updated_at: now }
  },
  alsoRefresh: [['zones']],
  onSaveOptimistic: applyToZones,
  versioned: true,
})

/** "Clareira", "Clareira and Rochas", "A, B and C", or "4 zones" */
export function zonesPhrase(names: string[]): string {
  if (names.length === 1) return names[0]!
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.length} zones`
}
