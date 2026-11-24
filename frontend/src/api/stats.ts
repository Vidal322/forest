import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'
import { defineEntity } from './entity'

export interface PlotStats {
  plot_id: string
  name: string
  area_ha: number | null
  declared_area_ha: number | null
  zone_count: number
  tree_count: number
  dead_tree_count: number
  species_count: number
  last_watered_on: string | null
  open_task_count: number
  holes_sown: number
  trees_planted: number
  litres_watered: number
  waterings_last_30d: number
  zones_need_water: number
}

export function usePlotStats() {
  return useQuery({
    queryKey: ['plot-stats'],
    queryFn: ({ signal }) => apiGet<PlotStats[]>('/api/plot-stats', { signal }),
  })
}

/** Where a species is used (zones, living trees, last sowing / planting). */
export interface SpeciesStats {
  species_id: string
  zone_count: number
  alive_tree_count: number
  last_sown_on: string | null
  last_planted_on: string | null
}

export function useSpeciesStats() {
  return useQuery({
    queryKey: ['species-stats'],
    queryFn: ({ signal }) => apiGet<SpeciesStats[]>('/api/species-stats', { signal }),
  })
}

export interface WateringRule {
  id: string
  name: string
  from_month: number
  to_month: number
  interval_days: number
  created_at: string
  updated_at: string
}

export type WateringRuleInput = Pick<WateringRule, 'name' | 'from_month' | 'to_month' | 'interval_days'>

export const wateringRules = defineEntity<WateringRule, WateringRuleInput>({
  name: 'watering-rules',
  sort: (a, b) => a.from_month - b.from_month || a.created_at.localeCompare(b.created_at),
  optimistic: (id, input, before) => {
    const now = new Date().toISOString()
    return { id, ...input, created_at: before?.created_at ?? now, updated_at: now }
  },
  alsoRefresh: [['zones'], ['plot-stats']], // the interval in effect changes the colours
})

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The months a rule covers (ranges may wrap past December). */
export function ruleMonths(r: Pick<WateringRule, 'from_month' | 'to_month'>): number[] {
  const out: number[] = []
  for (let m = r.from_month; ; m = (m % 12) + 1) {
    out.push(m)
    if (m === r.to_month) break
  }
  return out
}

/** Months covered by more than one rule (the narrowest range wins there). */
export function overlappingMonths(rules: Pick<WateringRule, 'from_month' | 'to_month'>[]): number[] {
  const count = new Map<number, number>()
  for (const r of rules) for (const m of ruleMonths(r)) count.set(m, (count.get(m) ?? 0) + 1)
  return [...count].filter(([, n]) => n > 1).map(([m]) => m).sort((a, b) => a - b)
}
