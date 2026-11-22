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
  alsoRefresh: [['zones'], ['plot-stats']],
  // deleting a plot deletes its zones: hide them at once too (also while offline)
  onDeleteOptimistic: (qc, id) => {
    const before = qc.getQueryData<Zone[]>(['zones'])
    qc.setQueryData<Zone[]>(['zones'], (list = []) => list.filter((z) => z.plot_id !== id))
    return () => {
      const gone = (before ?? []).filter((z) => z.plot_id === id)
      qc.setQueryData<Zone[]>(['zones'], (list = []) => [...list, ...gone.filter((g) => !list.some((z) => z.id === g.id))])
    }
  },
})

export const zones = defineEntity<Zone, ZoneInput>({
  name: 'zones',
  alsoRefresh: [['plot-stats']],
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

/** The zone's label, or a description for unlabelled zones. */
export function zoneName(z: Zone): string {
  return z.label ?? (z.kind === 'path' ? 'Path' : z.kind === 'other' ? 'Unnamed area' : 'Unnamed zone')
}

export const KIND_LABEL: Record<ZoneKind, string> = { cultivation: 'Planting', path: 'Path', other: 'Other' }

export function formatHa(ha: number): string {
  return `${ha < 10 ? ha.toFixed(2) : ha.toFixed(1)} ha`
}
