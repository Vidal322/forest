import { useEffect, useState } from 'react'
import { fieldToday } from '../domain/dates'

/**
 * Today in the field, kept current: a phone left on the map overnight must show
 * which zones need water this morning, not yesterday's colours.
 */
export function useFieldToday(): string {
  const [today, setToday] = useState(fieldToday)
  useEffect(() => {
    const check = () => setToday(fieldToday())
    const timer = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])
  return today
}
