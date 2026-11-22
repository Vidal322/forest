import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'

/**
 * - checking:    first check in progress
 * - online:      the API answered
 * - no-network:  the device itself has no connection
 * - unreachable: the device is online but the API didn't answer
 */
export type ServerStatus = 'checking' | 'online' | 'no-network' | 'unreachable'

/**
 * Tracks whether the API is reachable. Checks on mount, then every intervalMs
 * while the tab is visible, and immediately when the tab becomes visible or the
 * device comes back online. Only the latest check may update the status, and a
 * slow check is abandoned when the next one starts.
 *
 * The offline queue (later) uses this same signal to decide when to sync.
 */
export function useServerStatus(intervalMs = 30_000): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking')

  useEffect(() => {
    let current: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void check(), intervalMs)
    }

    async function check() {
      clearTimeout(timer)
      current?.abort()
      if (document.visibilityState === 'hidden') return // resume on visibilitychange
      if (!navigator.onLine) {
        setStatus('no-network')
        return // resume on the 'online' event
      }
      const ctrl = new AbortController()
      current = ctrl
      try {
        const body = await apiGet<{ status?: string }>('/healthz', { signal: ctrl.signal, cache: 'no-store' })
        if (ctrl.signal.aborted) return
        // a captive-portal page could answer 200: insist on our own body
        setStatus(body?.status === 'ok' ? 'online' : 'unreachable')
      } catch {
        if (ctrl.signal.aborted) return // superseded or unmounted
        setStatus(navigator.onLine ? 'unreachable' : 'no-network')
      }
      schedule()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    const onOnline = () => void check()
    const onOffline = () => {
      current?.abort()
      clearTimeout(timer)
      setStatus('no-network')
    }

    void check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      current?.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [intervalMs])

  return status
}
