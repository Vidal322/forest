import type { QueryClient } from '@tanstack/react-query'
import { isApiError } from './client'

/**
 * Every write (create, edit, delete) goes through one queue: TanStack mutations
 * sharing this scope run one at a time, in the order they were made. That keeps
 * "add species, then log a sowing with it" in order, also after being offline.
 */
export const OUTBOX_SCOPE = { id: 'outbox' }

/** Said when a change could not reach the server yet: it is kept and sent later. */
export const SAVED_ON_PHONE = 'Saved on this phone. It will be sent when there is a connection.'
export const DELETED_ON_PHONE = 'Deleted on this phone. The server will be told when there is a connection.'

/** No answer at all (no signal, server down): keep the write and try again later. */
export function isRetryable(err: unknown): boolean {
  return isApiError(err) && (err.code === 'network' || err.code === 'timeout')
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

/*
 * Which failed writes a screen is already showing next to its form. The sync bar
 * reports every other failed write (e.g. one queued offline whose form is long
 * closed), so each failure is shown exactly once.
 */
const shownInline = new Set<number>()
const listeners = new Set<() => void>()
let version = 0

export function markShownInline(mutationId: number) {
  if (shownInline.has(mutationId)) return
  shownInline.add(mutationId)
  version++
  listeners.forEach((l) => l())
}

export function isShownInline(mutationId: number): boolean {
  return shownInline.has(mutationId)
}

/** For useSyncExternalStore: changes whenever a failure is marked as shown. */
export const inlineErrors = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => version,
}
