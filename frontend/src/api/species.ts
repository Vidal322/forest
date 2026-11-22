import { defineEntity, type SaveVars } from './entity'

export interface Species {
  id: string
  scientific_name: string
  common_name: string | null
  notes: string | null
  updated_at: string
}

export type SpeciesInput = Pick<Species, 'scientific_name' | 'common_name' | 'notes'>
export type SaveSpeciesVars = SaveVars<SpeciesInput>

export const species = defineEntity<Species, SpeciesInput>({
  name: 'species',
  sort: (a, b) => a.scientific_name.localeCompare(b.scientific_name, undefined, { sensitivity: 'base' }),
  optimistic: (id, input) => ({ id, ...input, updated_at: new Date().toISOString() }),
  alsoRefresh: [['plot-stats']],
})

export const speciesKey = species.listKey
export const useSpeciesList = species.useList
export const useSaveSpecies = species.useSave
export const useDeleteSpecies = species.useDelete
