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
        <h2 id="draw-menu-title">Desenhar</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>
      <ul>
        <li>
          <button ref={first} type="button" className="btn" onClick={() => onPick(newDraft('zone'))} disabled={plots.length === 0}>
            🟦 Uma zona <span className="muted small">— uma área que semeias, plantas ou regas, dentro de uma parcela</span>
          </button>
        </li>
        <li>
          <button type="button" className="btn" onClick={() => onPick(newDraft('plot'))}>
            🟩 Uma parcela <span className="muted small">— uma parte do terreno com nome</span>
          </button>
        </li>
        {plots.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn" onClick={() => onPick(editDraft('plot', p))}>
              ✎ Editar {p.name}
            </button>
          </li>
        ))}
      </ul>
      {plots.length === 0 && <p className="muted small">Desenha primeiro uma parcela: as zonas ficam dentro das parcelas.</p>}
    </section>
  )
}
