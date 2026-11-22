import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from './client'
import { outboxDefaults, pendingWrites } from './outbox'

export interface Species {
  id: string
  scientific_name: string
  common_name: string | null
  notes: string | null
  updated_at: string
}

export type SpeciesInput = Pick<Species, 'scientific_name' | 'common_name' | 'notes'>
export type SaveSpeciesVars = { id: string; input: SpeciesInput }

export const speciesKey = ['species'] as const
const saveKey = ['species', 'save'] as const
const deleteKey = ['species', 'delete'] as const

const byName = (a: Species, b: Species) =>
  a.scientific_name.localeCompare(b.scientific_name, undefined, { sensitivity: 'base' })

export function useSpeciesList() {
  return useQuery({ queryKey: speciesKey, queryFn: ({ signal }) => apiGet<Species[]>('/api/species', { signal }) })
}

/** Put `item` back as it was before a failed write (or remove it if it didn't exist). */
function restore(qc: QueryClient, id: string, item: Species | undefined) {
  qc.setQueryData<Species[]>(speciesKey, (list = []) =>
    (item ? [...list.filter((s) => s.id !== id), item] : list.filter((s) => s.id !== id)).sort(byName),
  )
}

function refreshWhenIdle(qc: QueryClient) {
  // Only once the last species write is done: an earlier refetch would hide the others.
  if (pendingWrites(qc, speciesKey) <= 1) return qc.invalidateQueries({ queryKey: speciesKey })
}

/**
 * Mutation functions are registered on the client (not inline in the hooks) so
 * writes saved on the phone can be resumed after a reload, when no component
 * that started them exists any more.
 */
export function registerSpeciesMutations(qc: QueryClient) {
  qc.setMutationDefaults(saveKey, {
    ...outboxDefaults,
    mutationFn: ({ id, input }: SaveSpeciesVars) => apiSend<Species>('PUT', `/api/species/${id}`, input),
    onMutate: async ({ id, input }: SaveSpeciesVars) => {
      await qc.cancelQueries({ queryKey: speciesKey })
      const before = qc.getQueryData<Species[]>(speciesKey)?.find((s) => s.id === id)
      const optimistic: Species = { id, ...input, updated_at: new Date().toISOString() }
      qc.setQueryData<Species[]>(speciesKey, (list = []) =>
        [...list.filter((s) => s.id !== id), optimistic].sort(byName),
      )
      return { before }
    },
    onSuccess: (saved: Species) => {
      qc.setQueryData<Species[]>(speciesKey, (list = []) =>
        [...list.filter((s) => s.id !== saved.id), saved].sort(byName),
      )
    },
    onError: (err, { id }: SaveSpeciesVars, ctx) =>
      // deleted on the server meanwhile: drop it here too
      restore(qc, id, (err as { code?: string }).code === 'deleted' ? undefined : (ctx as { before?: Species } | undefined)?.before),
    onSettled: () => refreshWhenIdle(qc),
  })

  qc.setMutationDefaults(deleteKey, {
    ...outboxDefaults,
    mutationFn: (id: string) => apiSend<void>('DELETE', `/api/species/${id}`),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: speciesKey })
      const before = qc.getQueryData<Species[]>(speciesKey)?.find((s) => s.id === id)
      qc.setQueryData<Species[]>(speciesKey, (list = []) => list.filter((s) => s.id !== id))
      return { before }
    },
    onError: (err, id: string, ctx) => {
      // already gone on the server: that's what we wanted
      if ((err as { code?: string }).code === 'not_found') return
      restore(qc, id, (ctx as { before?: Species } | undefined)?.before)
    },
    onSettled: () => refreshWhenIdle(qc),
  })
}

export function useSaveSpecies() {
  return useMutation<Species, Error, SaveSpeciesVars>({ mutationKey: saveKey })
}

export function useDeleteSpecies() {
  return useMutation<void, Error, string>({ mutationKey: deleteKey })
}
