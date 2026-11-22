import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from './client'
import { outboxDefaults, pendingWrites } from './outbox'

export interface TreeCount {
  zone_id: string
  species_id: string
  alive: number
  dead: number
}

export type TreeCountVars = TreeCount

const listKey = ['tree-counts'] as const
const saveKey = ['tree-counts', 'save'] as const

/** Counts above this are refused by the server. */
export const MAX_TREES = 10_000

export function useTreeCounts() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: listKey,
    // counts still waiting in the outbox win over what the server says (it doesn't have them yet)
    queryFn: async ({ signal }) => {
      let list = await apiGet<TreeCount[]>('/api/tree-counts', { signal })
      for (const m of qc.getMutationCache().getAll()) {
        if (m.state.status !== 'pending' || m.options.mutationKey?.[1] !== 'save' || m.options.mutationKey[0] !== 'tree-counts') continue
        list = withCount(list, m.state.variables as TreeCount)
      }
      return list
    },
  })
}

function withCount(list: TreeCount[], c: TreeCount): TreeCount[] {
  return [
    ...list.filter((x) => !(x.zone_id === c.zone_id && x.species_id === c.species_id)),
    ...(c.alive > 0 || c.dead > 0 ? [c] : []),
  ]
}

function put(qc: QueryClient, c: TreeCount) {
  qc.setQueryData<TreeCount[]>(listKey, (list = []) => withCount(list, c))
}

/**
 * "This zone has 12 alive and 2 dead sobreiros": the server sets its tree records to
 * these counts. A target (not "+1") makes a resent change harmless.
 */
export function registerTreeMutations(qc: QueryClient) {
  qc.setMutationDefaults(saveKey, {
    ...outboxDefaults,
    mutationFn: (c: TreeCountVars) =>
      apiSend<TreeCount>('PUT', `/api/zones/${c.zone_id}/trees/${c.species_id}`, { alive: c.alive, dead: c.dead }),
    onMutate: async (c: TreeCountVars) => {
      await qc.cancelQueries({ queryKey: listKey })
      const before = qc.getQueryData<TreeCount[]>(listKey)?.find((x) => x.zone_id === c.zone_id && x.species_id === c.species_id)
      put(qc, c)
      return { before }
    },
    onError: (_e, c: TreeCountVars, ctx) => {
      const before = (ctx as { before?: TreeCount } | undefined)?.before
      put(qc, before ?? { ...c, alive: 0, dead: 0 })
    },
    onSettled: () => {
      if (pendingWrites(qc, listKey) <= 1) {
        void qc.invalidateQueries({ queryKey: listKey })
        void qc.invalidateQueries({ queryKey: ['plot-stats'] })
      }
    },
  })
}

export function useSetTreeCounts() {
  return useMutation<TreeCount, Error, TreeCountVars>({ mutationKey: saveKey })
}
