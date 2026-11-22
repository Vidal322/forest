import { useCallback, useMemo, useState } from 'react'

export interface FlashState {
  message: { text: string; n: number } | null
  show: (text: string) => void
  clear: () => void
}

/** A short confirmation ("Added Quercus suber.") announced to screen readers. */
export function useFlash(): FlashState {
  const [message, setMessage] = useState<FlashState['message']>(null)
  const show = useCallback((text: string) => setMessage((m) => ({ text, n: (m?.n ?? 0) + 1 })), [])
  const clear = useCallback(() => setMessage(null), [])
  return useMemo(() => ({ message, show, clear }), [message, show, clear])
}
