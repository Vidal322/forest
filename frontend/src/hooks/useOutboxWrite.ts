import { useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import { isWaiting, markShownInline } from '../api/outbox'

/**
 * The state of a form's write through the outbox:
 * - busy:    being sent right now (disable the button, show "Saving…")
 * - waiting: kept on the phone until there is a connection — the form is free again
 * - error:   the server refused it; shown by the form, so the sync bar won't repeat it
 */
export function useOutboxWrite<TData, TVars>(m: UseMutationResult<TData, Error, TVars>) {
  const qc = useQueryClient()
  const waiting = m.isPending && isWaiting(m)
  const busy = m.isPending && !waiting

  const { status, submittedAt, variables } = m
  useEffect(() => {
    if (status !== 'error') return
    qc.getMutationCache()
      .findAll({ status: 'error', predicate: (x) => x.state.submittedAt === submittedAt && x.state.variables === variables })
      .forEach((x) => markShownInline(x.mutationId))
  }, [qc, status, submittedAt, variables])

  return { waiting, busy, error: m.error }
}
