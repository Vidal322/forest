import { useEffect, useState } from 'react'

/** `value`, once it has stayed the same for `ms` (e.g. while a slider is being dragged). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}
