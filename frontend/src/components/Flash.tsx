import type { FlashState } from '../hooks/useFlash'

export function Flash({ flash }: { flash: FlashState }) {
  return (
    <output className="flash" aria-live="polite">
      {/* keyed: the same text twice in a row is announced again */}
      {flash.message && <span key={flash.message.n}>{flash.message.text}</span>}
    </output>
  )
}
