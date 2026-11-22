import { useQuery, type QueryClient } from '@tanstack/react-query'
import { apiGet } from './client'
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

/** Units a quantity per zone can be in, by type (the server refuses others; totals add these up). */
export const ZONE_UNITS: Record<ActivityType, QuantityUnit[]> = {
  sowing: ['holes', 'seeds'],
  planting: ['trees'],
  watering: ['litres'],
  fertilizing: ['kg', 'litres'],
  other: ['holes', 'seeds', 'trees', 'litres', 'kg'],
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
 * Keep the map's colours right at once (also offline) when an entry is added,
 * changed or deleted: work out the zones' "last watered / sown / planted" again
 * from the cached entries. The server's zone list replaces this on refresh.
 *
 * The cache holds the latest entries only, so a date found there wins; when none is,
 * the server's date is kept unless it came from the entry that was changed/removed.
 */
function recolourZones(qc: QueryClient, zoneIds: Set<string>, removed: Activity | undefined) {
  const list = qc.getQueryData<Activity[]>(['activities']) ?? []
  const before = qc.getQueryData<Zone[]>(['zones'])
  qc.setQueryData<Zone[]>(['zones'], (zones) =>
    zones?.map((z) => {
      if (!zoneIds.has(z.id)) return z
      const next = { ...z }
      for (const [type, field] of Object.entries(LAST_FIELD) as [ActivityType, (typeof LAST_FIELD)[ActivityType] & string][]) {
        const cached = list
          .filter((a) => a.type === type && a.zones.some((x) => x.zone_id === z.id))
          .reduce<string | null>((m, a) => (m === null || a.performed_on > m ? a.performed_on : m), null)
        const current = z[field]
        const cameFromRemoved =
          removed !== undefined && removed.type === type && removed.performed_on === current && removed.zones.some((x) => x.zone_id === z.id)
        if (cached !== null && (current === null || cached > current || cameFromRemoved)) next[field] = cached
        else if (cached === null && cameFromRemoved) next[field] = null
      }
      return next
    }),
  )
  return () => qc.setQueryData(['zones'], before)
}

const zoneIdsOf = (...entries: ({ zones: { zone_id: string }[] } | undefined)[]) =>
  new Set(entries.flatMap((e) => e?.zones.map((z) => z.zone_id) ?? []))

export const activities = defineEntity<Activity, ActivityInput>({
  name: 'activities',
  sort: (a, b) => b.performed_on.localeCompare(a.performed_on) || b.created_at.localeCompare(a.created_at),
  optimistic: (id, input, before) => {
    const now = new Date().toISOString()
    const { base_version: _base, ...rest } = input
    return { id, ...rest, version: before?.version ?? 1, created_at: before?.created_at ?? now, updated_at: now }
  },
  alsoRefresh: [['zones'], ['plot-stats']],
  onSaveOptimistic: (qc, input, before) => recolourZones(qc, zoneIdsOf(input, before), before),
  onDeleteOptimistic: (qc, _id, before) => recolourZones(qc, zoneIdsOf(before), before),
  versioned: true,
})

/** "Clareira", "Clareira and Rochas", "A, B and C", or "4 zones" */
export function zonesPhrase(names: string[]): string {
  if (names.length === 1) return names[0]!
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.length} zones`
}

/** The server's default page size for GET /api/activities. */
const GLOBAL_LIST_LIMIT = 500

/**
 * A zone's whole history: the server's list for the zone (not capped like the global
 * one), with the cached global list on top for entries made or changed on the phone.
 */
export function useZoneHistory(zoneId: string | undefined) {
  const all = activities.useList()
  const zone = useQuery({
    // under ['activities'], so every refresh of the log refreshes it too
    queryKey: ['activities', 'zone', zoneId],
    queryFn: ({ signal }) => apiGet<Activity[]>(`/api/activities?zone_id=${zoneId}&limit=5000`, { signal }),
    enabled: Boolean(zoneId),
  })
  const recent = (all.data ?? []).filter((a) => a.zones.some((z) => z.zone_id === zoneId))
  // The global list is complete unless the server capped it: only then can older
  // entries be missing, and they come from the zone's own list.
  const capped = (all.data?.length ?? 0) >= GLOBAL_LIST_LIMIT
  const oldestRecent = capped ? all.data![all.data!.length - 1]!.performed_on : null
  const recentIds = new Set(recent.map((a) => a.id))
  const older = capped ? (zone.data ?? []).filter((a) => !recentIds.has(a.id) && a.performed_on < oldestRecent!) : []
  const data = [...recent, ...older].sort(
    (a, b) => b.performed_on.localeCompare(a.performed_on) || b.created_at.localeCompare(a.created_at),
  )
  return { data, isPending: all.isPending && zone.isPending, isError: all.isError && zone.isError, error: all.error ?? zone.error, offline: all.isPending && all.fetchStatus === 'paused' }
}
