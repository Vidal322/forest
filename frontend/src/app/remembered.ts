import { useCallback, useState } from 'react'

/**
 * Choices kept while the app is open (a filter, a tab): they survive going to another
 * page and back, and are forgotten on reload. Not for anything that must persist.
 */
const memory = new Map<string, unknown>()

export function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial))
  const set = useCallback(
    (v: T) => {
      memory.set(key, v)
      setValue(v)
    },
    [key],
  )
  return [value, set]
}

/** Tests start from a fresh app. */
export function forgetRemembered() {
  memory.clear()
}
