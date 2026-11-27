import { useMutationState, useQueryClient, type Mutation } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { friendlyError } from '../api/errors'
import { inlineErrors, isShownInline, isWaiting, OUTBOX_SCOPE } from '../api/outbox'

type AnyMutation = Mutation<unknown, Error, unknown, unknown>

const inOutbox = (m: AnyMutation) => m.options.scope?.id === OUTBOX_SCOPE.id

/** Thin bar under the top bar: changes waiting to be sent, and queued changes the server refused. */
export function SyncStatus() {
  const qc = useQueryClient()
  const waiting = useMutationState({
    filters: { status: 'pending', predicate: inOutbox },
    select: (m) => isWaiting({ isPaused: m.state.isPaused, failureCount: m.state.failureCount, failureReason: m.state.failureReason }),
  }).filter(Boolean).length
  useSyncExternalStore(inlineErrors.subscribe, inlineErrors.getSnapshot)
  const failed = useMutationState({
    filters: { status: 'error', predicate: inOutbox },
    select: (m) => m,
  }).filter((m) => !isShownInline(m.mutationId))

  if (waiting === 0 && failed.length === 0) return null
  return (
    <div className="sync">
      {waiting > 0 && (
        <output className="sync__waiting">
          {waiting === 1
            ? '1 alteração guardada neste telemóvel, à espera de rede.'
            : `${waiting} alterações guardadas neste telemóvel, à espera de rede.`}
        </output>
      )}
      {failed.map((m) => (
        <p key={m.mutationId} className="sync__failed" role="alert">
          {describe(m.state.variables)} não foi guardado: {friendlyError(m.state.error)}{' '}
          <button type="button" className="btn btn-small" onClick={() => qc.getMutationCache().remove(m)}>
            OK
          </button>
        </p>
      ))}
    </div>
  )
}

/** "“Falta semear”" for a write whose input has a title/name, else "Um registo". */
function describe(variables: unknown): string {
  const input = (variables as { input?: Record<string, unknown> } | undefined)?.input
  const name = input?.title ?? input?.name ?? input?.scientific_name ?? input?.label
  return typeof name === 'string' && name ? `“${name}”` : 'Um registo'
}
