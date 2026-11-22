import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

/**
 * Every write (create, edit, delete) goes through one queue: TanStack mutations
 * sharing this scope run one at a time, in the order they were made. That keeps
 * "add species, then log a sowing with it" in order, also after being offline.
 */
export const OUTBOX_SCOPE = { id: 'outbox' }

/** No answer at all (no signal, server down): keep the write and try again later. */
export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && err.isOffline
}

export const outboxDefaults = {
  scope: OUTBOX_SCOPE,
  // Paused while the phone is offline; once online, keep retrying unreachable-server
  // errors with backoff. A real answer from the server (4xx/5xx) is final.
  retry: (_failures: number, err: unknown) => isRetryable(err),
  retryDelay: (failures: number) => Math.min(30_000, 1000 * 2 ** failures),
} as const

/**
 * A write is "waiting" when it hasn't reached the server and won't until there is
 * a connection: paused offline, or retrying after the server didn't answer.
 */
export function isWaiting(m: { isPaused: boolean; failureCount: number; failureReason: unknown }): boolean {
  return m.isPaused || (m.failureCount > 0 && isRetryable(m.failureReason))
}

/** Writes still to be sent for `key` (used to hold back refetches that would hide them). */
export function pendingWrites(qc: QueryClient, key: readonly unknown[]): number {
  return qc.isMutating({ mutationKey: key })
}

/**
 * Set on a mutation's meta by the screen that started it. While `inline` is true the
 * screen shows the outcome itself; once the screen let go (closed because the change
 * was queued, or navigated away) this bar reports it instead.
 */
export class Handoff {
  inline = true
  /** The screen closed or moved on: from now on the sync bar reports the outcome. */
  release() {
    this.inline = false
  }
}
