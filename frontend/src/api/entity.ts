import { useMutation, useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query'
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
  /** Extra optimistic work when an entry is saved (e.g. a log entry recolours zones). */
  onSaveOptimistic?: (qc: QueryClient, input: In) => void
  /** Extra optimistic work when an entry is deleted; returns how to undo it. */
  onDeleteOptimistic?: (qc: QueryClient, id: string) => () => void
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

  /** Registered on the client so writes kept on the phone can resume after a reload. */
  function register(qc: QueryClient) {
    qc.setMutationDefaults(saveKey, {
      ...outboxDefaults,
      mutationFn: ({ id, input }: SaveVars<In>) => apiSend<T>('PUT', `${path}/${id}`, input),
      onMutate: async ({ id, input }: SaveVars<In>) => {
        await qc.cancelQueries({ queryKey: listKey })
        const before = qc.getQueryData<T[]>(listKey)?.find((x) => x.id === id)
        replace(qc, id, opts.optimistic(id, input, before))
        opts.onSaveOptimistic?.(qc, input)
        return { before }
      },
      onSuccess: (saved: T) => replace(qc, saved.id, saved),
      onError: (err, { id }: SaveVars<In>, ctx) =>
        // deleted on the server meanwhile: drop it here too; otherwise put back what was there
        replace(qc, id, isCode(err, 'deleted') ? undefined : (ctx as { before?: T } | undefined)?.before),
      onSettled: () => refreshWhenIdle(qc),
    })
    qc.setMutationDefaults(deleteKey, {
      ...outboxDefaults,
      mutationFn: (id: string) => apiSend<void>('DELETE', `${path}/${id}`),
      onMutate: async (id: string) => {
        await qc.cancelQueries({ queryKey: listKey })
        const before = qc.getQueryData<T[]>(listKey)?.find((x) => x.id === id)
        replace(qc, id, undefined)
        const undoExtra = opts.onDeleteOptimistic?.(qc, id)
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

  return {
    listKey,
    register,
    useList: () => useQuery({ queryKey: listKey, queryFn: ({ signal }) => apiGet<T[]>(path, { signal }) }),
    useSave: () => useMutation<T, Error, SaveVars<In>>({ mutationKey: saveKey }),
    useDelete: () => useMutation<void, Error, string>({ mutationKey: deleteKey }),
  }
}
