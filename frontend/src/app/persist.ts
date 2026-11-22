import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientSave,
  type PersistedClient,
  type Persister,
  type PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'
import { OUTBOX_SCOPE } from '../api/outbox'

/** Bump when cached *data* from an older version can no longer be read (queued changes are always kept). */
export const CACHE_VERSION = 'forest-1'

/** How long cached data is trusted without signal (queued changes are kept regardless). */
export const KEEP_FOR_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Data from an old app version or too long ago is dropped, but never the
 * outbox: a change made in the field must survive an app update and a long
 * offline stretch. (TanStack would discard the whole saved state otherwise.)
 */
export function keepingOutbox(p: Persister, now: () => number = Date.now): Persister {
  return {
    ...p,
    restoreClient: async () => {
      const saved = await p.restoreClient()
      if (!saved) return saved
      if (saved.buster === CACHE_VERSION && now() - saved.timestamp <= KEEP_FOR_MS) return saved
      const kept: PersistedClient = {
        buster: CACHE_VERSION,
        timestamp: now(),
        clientState: { mutations: saved.clientState.mutations, queries: [] },
      }
      return kept
    },
  }
}

export const dehydrateOptions: PersistQueryClientOptions['dehydrateOptions'] = {
  // every outbox change not yet confirmed by the server (paused offline, or retrying);
  // other mutations (the field photo upload) can't be resumed and aren't kept
  shouldDehydrateMutation: (m) => m.state.status === 'pending' && m.options.scope?.id === OUTBOX_SCOPE.id,
  // also lists whose last refresh failed: their data is still the best we have
  shouldDehydrateQuery: (q) => q.state.data !== undefined,
}

/**
 * The query cache (last data seen) and the outbox (changes not yet sent) are
 * saved in IndexedDB, so the app opens with data and keeps every change made
 * offline, also after the phone closes it.
 */
export function persistOptions(): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: keepingOutbox(
      createAsyncStoragePersister({
        storage: { getItem: get, setItem: set, removeItem: del },
        key: 'forest-cache',
        // written almost at once: a phone may kill the app right after "Saved on this phone"
        throttleTime: 100,
      }),
    ),
    maxAge: Infinity, // expiry is handled by keepingOutbox, which keeps the outbox
    buster: CACHE_VERSION,
    dehydrateOptions,
  }
}

/**
 * Save right away when the app goes to the background (switching apps, locking the
 * phone): timers stop there, so a pending throttled save might never happen.
 */
export function saveWhenHidden(queryClient: QueryClient, options: Omit<PersistQueryClientOptions, 'queryClient'>) {
  const save = () => {
    if (document.visibilityState === 'hidden') {
      void persistQueryClientSave({ queryClient, persister: options.persister, buster: options.buster, dehydrateOptions })
    }
  }
  document.addEventListener('visibilitychange', save)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', save)
    window.removeEventListener('pagehide', save)
  }
}

/** After a restore: send what was waiting (the outbox keeps the original order). */
export function resumeOutbox(queryClient: QueryClient) {
  void queryClient.resumePausedMutations()
  for (const m of queryClient.getMutationCache().getAll()) {
    if (m.state.status === 'pending' && !m.state.isPaused) void m.continue()
  }
}
