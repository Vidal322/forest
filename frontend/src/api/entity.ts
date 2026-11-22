import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { apiGet, apiSend } from './client'
import { outboxDefaults, pendingWrites } from './outbox'

export interface Entity {
  id: string
}

export type SaveVars<In> = { id: string; input: In }

interface EntityOptions<T extends Entity, In> {
  /** Cache key and the last part of the URL: "plots" → /api/plots. */
  name: string
  sort: (a: T, b: T) => number
  /** What the list shows before the server answers. */
  optimistic: (id: string, input: In, before: T | undefined) => T
  /** Other lists a change here affects (e.g. deleting a plot deletes its zones). */
  alsoRefresh?: QueryKey[]
  /** Extra optimistic work when an entry is saved (e.g. a log entry recolours zones); returns how to undo it. */
  onSaveOptimistic?: (qc: QueryClient, input: In, before: T | undefined) => (() => void) | void
  /**
   * Entries carry a server `version` and edits send `base_version`. Several edits of one
   * entry queued offline were all made from the same version; once the first lands, the
   * next ones are sent from the version it produced instead of conflicting with ourselves.
   */
  versioned?: boolean
  /** Extra optimistic work when an entry is deleted; returns how to undo it. */
  onDeleteOptimistic?: (qc: QueryClient, id: string, before: T | undefined) => () => void
}

/**
 * List + upsert-by-id + delete for one kind of entry, all writes through the
 * outbox (ordered, kept on the phone while offline, optimistic in the list).
 */
export function defineEntity<T extends Entity, In>(opts: EntityOptions<T, In>) {
  const listKey = [opts.name] as const
  const saveKey = [opts.name, 'save'] as const
  const deleteKey = [opts.name, 'delete'] as const
  const path = `/api/${opts.name}`

  const replace = (qc: QueryClient, id: string, item: T | undefined) =>
    qc.setQueryData<T[]>(listKey, (list = []) =>
      (item ? [...list.filter((x) => x.id !== id), item] : list.filter((x) => x.id !== id)).sort(opts.sort),
    )

  const refreshWhenIdle = (qc: QueryClient) => {
    // Only once the last write of this kind is done: an earlier refetch would hide the others.
    if (pendingWrites(qc, listKey) > 1) return
    void qc.invalidateQueries({ queryKey: listKey })
    // Same for the related lists: their own last write refreshes them otherwise.
    for (const key of opts.alsoRefresh ?? []) {
      if (pendingWrites(qc, key) === 0) void qc.invalidateQueries({ queryKey: key })
    }
  }

  const isCode = (err: unknown, code: string) => (err as { code?: string } | null)?.code === code

  // Versions our own successful writes produced, by id (see `versioned`). Kept in the
  // query cache so it is saved on the phone and survives a reload between queued edits.
  const ownKey = ['own-versions', opts.name] as const
  const ownVersion = (qc: QueryClient, id: string) => qc.getQueryData<Record<string, number>>(ownKey)?.[id]
  const rebase = (qc: QueryClient, id: string, input: In): In => {
    const base = (input as { base_version?: number | null }).base_version
    const own = ownVersion(qc, id)
    if (!opts.versioned || base == null || own === undefined || own <= base) return input
    return { ...input, base_version: own }
  }

  /** Registered on the client so writes kept on the phone can resume after a reload. */
  function register(qc: QueryClient) {
    qc.setMutationDefaults(saveKey, {
      ...outboxDefaults,
      mutationFn: ({ id, input }: SaveVars<In>) => apiSend<T>('PUT', `${path}/${id}`, rebase(qc, id, input)),
      onMutate: async ({ id, input }: SaveVars<In>) => {
        await qc.cancelQueries({ queryKey: listKey })
        const before = qc.getQueryData<T[]>(listKey)?.find((x) => x.id === id)
        replace(qc, id, opts.optimistic(id, input, before))
        const undoExtra = opts.onSaveOptimistic?.(qc, input, before)
        return { before, undoExtra }
      },
      onSuccess: (saved: T) => {
        const v = (saved as { version?: number }).version
        if (opts.versioned && v !== undefined) qc.setQueryData<Record<string, number>>(ownKey, (m) => ({ ...m, [saved.id]: v }))
        replace(qc, saved.id, saved)
      },
      onError: (err, { id }: SaveVars<In>, ctx) => {
        const c = ctx as { before?: T; undoExtra?: () => void } | undefined
        // deleted on the server meanwhile: drop it here too; otherwise put back what was there
        replace(qc, id, isCode(err, 'deleted') ? undefined : c?.before)
        c?.undoExtra?.()
      },
      onSettled: () => refreshWhenIdle(qc),
    })
    qc.setMutationDefaults(deleteKey, {
      ...outboxDefaults,
      mutationFn: (id: string) => apiSend<void>('DELETE', `${path}/${id}`),
      onMutate: async (id: string) => {
        await qc.cancelQueries({ queryKey: listKey })
        const before = qc.getQueryData<T[]>(listKey)?.find((x) => x.id === id)
        replace(qc, id, undefined)
        const undoExtra = opts.onDeleteOptimistic?.(qc, id, before)
        return { before, undoExtra }
      },
      onError: (err, id: string, ctx) => {
        if (isCode(err, 'not_found')) return // never reached the server, or already gone: done
        const c = ctx as { before?: T; undoExtra?: () => void } | undefined
        replace(qc, id, c?.before)
        c?.undoExtra?.()
      },
      onSettled: () => refreshWhenIdle(qc),
    })
  }

  /** Lay the outbox's pending saves and deletes of this kind over fresh server data. */
  function withPendingWrites(qc: QueryClient, list: T[]): T[] {
    let out = list
    for (const m of qc.getMutationCache().getAll()) {
      if (m.state.status !== 'pending') continue
      const key = m.options.mutationKey
      if (key?.[0] !== opts.name) continue
      if (key[1] === 'save') {
        const { id, input } = m.state.variables as SaveVars<In>
        out = [...out.filter((x) => x.id !== id), opts.optimistic(id, input, out.find((x) => x.id === id))]
      } else if (key[1] === 'delete') {
        const id = m.state.variables as string
        out = out.filter((x) => x.id !== id)
      }
    }
    return out === list ? list : [...out].sort(opts.sort)
  }

  return {
    listKey,
    register,
    useList: () => {
      const qc = useQueryClient()
      return useQuery({
        queryKey: listKey,
        // keep showing changes still waiting in the outbox (after a restart, or a
        // refresh racing the queue): the server doesn't have them yet
        queryFn: async ({ signal }) => withPendingWrites(qc, await apiGet<T[]>(path, { signal })),
      })
    },
    useSave: () => useMutation<T, Error, SaveVars<In>>({ mutationKey: saveKey }),
    useDelete: () => useMutation<void, Error, string>({ mutationKey: deleteKey }),
  }
}
