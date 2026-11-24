import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query'
import { apiGet } from './client'
import { defineEntity } from './entity'

export type Ring = [number, number][]

export interface Polygon {
  type: 'Polygon'
  coordinates: Ring[]
}

export interface Plot {
  id: string
  name: string
  geom: Polygon
  declared_area_ha: number | null
  notes: string | null
  area_ha: number | null
  updated_at: string
}

export type PlotInput = Pick<Plot, 'name' | 'geom' | 'declared_area_ha' | 'notes'>

export type ZoneKind = 'cultivation' | 'path' | 'other'

export interface Zone {
  id: string
  plot_id: string
  label: string | null
  kind: ZoneKind
  geom: Polygon
  notes: string | null
  area_ha: number | null
  updated_at: string
  last_sown_on: string | null
  last_planted_on: string | null
  last_watered_on: string | null
  current_interval_days: number
  open_task_count: number
  needs_water: boolean | null
}

export type ZoneInput = Pick<Zone, 'plot_id' | 'label' | 'kind' | 'geom' | 'notes'>

const byName = (a: Plot, b: Plot) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export const plots = defineEntity<Plot, PlotInput>({
  name: 'plots',
  sort: byName,
  // area is measured by the server; keep the old value while the outline is being saved
  optimistic: (id, input, before) => ({
    id,
    ...input,
    // measured by the server: keep it only while the outline is unchanged
    area_ha: before && JSON.stringify(before.geom) === JSON.stringify(input.geom) ? before.area_ha : null,
    updated_at: new Date().toISOString(),
  }),
  alsoRefresh: [['zones'], ['plot-stats'], ['tasks'], ['tree-counts'], ['species-stats'], ['planted-stats']],
  // deleting a plot deletes its zones, their tasks and counted trees: hide them at once (also offline)
  onDeleteOptimistic: (qc, id) => {
    const zoneIds = new Set((qc.getQueryData<Zone[]>(['zones']) ?? []).filter((z) => z.plot_id === id).map((z) => z.id))
    return hideRelated(qc, (r) => r.plot_id === id || (r.zone_id != null && zoneIds.has(r.zone_id)), zoneIds)
  },
})

export const zones = defineEntity<Zone, ZoneInput>({
  name: 'zones',
  alsoRefresh: [['plot-stats'], ['tasks'], ['tree-counts'], ['species-stats'], ['planted-stats']],
  // deleting a zone deletes its tasks and counted trees: hide them at once (also offline)
  onDeleteOptimistic: (qc, id) => hideRelated(qc, (r) => r.zone_id === id, new Set([id])),
  sort: (a, b) => a.id.localeCompare(b.id), // drawing order is decided by FieldLayers
  optimistic: (id, input, before) => ({
    // a new zone has no history yet; an edited one keeps its derived state
    last_sown_on: null,
    last_planted_on: null,
    last_watered_on: null,
    current_interval_days: 7,
    open_task_count: 0,
    needs_water: input.kind === 'cultivation' ? false : null,
    area_ha: null,
    ...before,
    id,
    ...input,
    updated_at: before?.updated_at ?? new Date().toISOString(),
  }),
})

/**
 * The zones' state as it stood on a past day (the map's "show state as of"), from
 * the server's activity log. Under ['zones'], so whatever refreshes the zones
 * (a back-dated log entry, a deleted zone) refreshes this too. While the next day
 * loads, the previous one stays shown (no flash of today's colours).
 */
export function useZonesAsOf(day: string | null) {
  return useQuery({
    queryKey: ['zones', 'as-of', day],
    // the day travels with the answer: while the next day loads, the shown colours are still this one's
    queryFn: async ({ signal }) => ({ day: day!, zones: await apiGet<Zone[]>(`/api/zones?as_of=${day}`, { signal }) }),
    enabled: day !== null,
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000, // a look back, not something to keep on the phone
  })
}

/** Today's zones (outlines, names) with the derived state of `past` (same zones on an earlier day). */
export function withStateOf(zones: Zone[], past: Zone[]): Zone[] {
  const byId = new Map(past.map((z) => [z.id, z]))
  return zones.map((z) => {
    const p = byId.get(z.id)
    if (!p) return z
    return {
      ...z,
      last_sown_on: p.last_sown_on,
      last_planted_on: p.last_planted_on,
      last_watered_on: p.last_watered_on,
      current_interval_days: p.current_interval_days,
      needs_water: p.needs_water,
    }
  })
}

/** The zone's label, or a description for unlabelled zones. */
export function zoneName(z: Zone): string {
  return z.label ?? (z.kind === 'path' ? 'Path' : z.kind === 'other' ? 'Unnamed area' : 'Unnamed zone')
}

export const KIND_LABEL: Record<ZoneKind, string> = { cultivation: 'Planting', path: 'Path', other: 'Other' }

export function formatHa(ha: number): string {
  return `${ha < 10 ? ha.toFixed(2) : ha.toFixed(1)} ha`
}

type Related = { id?: string; plot_id?: string | null; zone_id?: string | null; species_id?: string }

const sameRow = (a: Related, b: Related) =>
  a.id !== undefined ? a.id === b.id : a.zone_id === b.zone_id && a.species_id === b.species_id

/**
 * Hide zones, tasks and tree counts that a delete takes along; returns how to undo it
 * (putting back only the rows it hid, so later changes aren't lost).
 */
async function hideRelated(qc: QueryClient, gone: (r: Related) => boolean, zoneIds: Set<string>) {
  const keys = [['zones'], ['tasks'], ['tree-counts']] as const
  // a refresh already on its way would bring the hidden rows back
  await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })))
  const tests: Record<string, (r: Related) => boolean> = {
    zones: (z) => z.id !== undefined && zoneIds.has(z.id),
    tasks: gone,
    'tree-counts': (c) => c.zone_id != null && zoneIds.has(c.zone_id),
  }
  const removed = keys.map((k) => {
    const test = tests[k[0]]!
    const rows = (qc.getQueryData<Related[]>(k) ?? []).filter(test)
    qc.setQueryData<Related[]>(k, (list) => list?.filter((r) => !test(r)))
    return rows
  })
  return () =>
    keys.forEach((k, i) =>
      qc.setQueryData<Related[]>(k, (list) => (list ? [...list, ...removed[i]!.filter((r) => !list.some((x) => sameRow(x, r)))] : list)),
    )
}
