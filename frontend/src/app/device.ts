import { useCallback, useState } from 'react'

/**
 * Choices kept on this phone across reloads (which map layers are shown). Stored in
 * localStorage: never shared, and the app works the same when the browser refuses it
 * (private mode, blocked site data) — the choice is then only kept while the page is open.
 */
const PREFIX = 'forest.'

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // not kept past this visit
  }
}

/**
 * A setting remembered on the device. `parse` turns what was stored (possibly by an
 * older app version, or nothing) into a valid value.
 */
export function useDeviceSetting<T>(key: string, parse: (stored: unknown) => T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => parse(read(key)))
  const set = useCallback(
    (v: T) => {
      write(key, v)
      setValue(v)
    },
    [key],
  )
  return [value, set]
}
