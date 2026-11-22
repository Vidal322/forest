import { useEffect, useRef } from 'react'
import type { Plot } from '../api/plots'
import { editDraft, newDraft, type Draft } from '../map/draft'

/** What to draw: a new plot, a new zone (inside a plot), or a plot's outline to fix. */
export function DrawMenu({ plots, onPick, onClose }: { plots: Plot[]; onPick: (d: Draft) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <section className="sheet menu-sheet" aria-labelledby="draw-menu-title">
      <div className="row">
        <h2 id="draw-menu-title">Draw</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <ul>
        <li>
          <button ref={first} type="button" className="btn" onClick={() => onPick(newDraft('zone'))} disabled={plots.length === 0}>
            🟦 A zone <span className="muted small">— an area you sow, plant or water, inside a plot</span>
          </button>
        </li>
        <li>
          <button type="button" className="btn" onClick={() => onPick(newDraft('plot'))}>
            🟩 A plot <span className="muted small">— a named part of the field</span>
          </button>
        </li>
        {plots.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn" onClick={() => onPick(editDraft('plot', p))}>
              ✎ Edit {p.name}
            </button>
          </li>
        ))}
      </ul>
      {plots.length === 0 && <p className="muted small">Draw a plot first: zones go inside plots.</p>}
    </section>
  )
}
