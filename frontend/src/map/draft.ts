import type { Plot, Zone } from '../api/plots'
import { newId } from '../lib/uuid'
import type { FramePoint } from './frame'
import { openRing, ringArea, ringInsideRing, selfIntersects } from './geometry'

/** What is being drawn or edited on the map. */
export interface Draft {
  kind: 'plot' | 'zone'
  id: string
  /** null for a new shape */
  original: Plot | Zone | null
  corners: FramePoint[]
  /** earlier corner lists, for Undo */
  history: FramePoint[][]
  step: 'shape' | 'details'
  /** a corner tapped to be removed */
  selectedCorner: number | null
}

export function newDraft(kind: 'plot' | 'zone'): Draft {
  return { kind, id: newId(), original: null, corners: [], history: [], step: 'shape', selectedCorner: null }
}

export function editDraft(kind: 'plot' | 'zone', item: Plot | Zone): Draft {
  return {
    kind,
    id: item.id,
    original: item,
    corners: openRing(item.geom.coordinates[0] ?? []),
    history: [],
    step: 'shape',
    selectedCorner: null,
  }
}

const ringOf = (p: Plot) => openRing(p.geom.coordinates[0] ?? [])

export interface DraftCheck {
  ok: boolean
  /** what to tell the person (also when ok: a hint) */
  message: string
  /** zone: the plot that contains it */
  plotId?: string
}

/** Check a drawing like the server will, with words that say how to fix it. */
export function checkDraft(d: Draft, plots: Plot[], zones: Zone[]): DraftCheck {
  const n = d.corners.length
  if (n < 3) return { ok: false, message: `Tap the map to add corners — ${n} of at least 3.` }
  if (selfIntersects(d.corners)) return { ok: false, message: 'The outline crosses itself. Drag a corner to untangle it, or Undo.' }
  if (ringArea(d.corners) < 1) return { ok: false, message: 'The shape is too thin. Spread the corners out.' }

  if (d.kind === 'zone') {
    const fits = (p: Plot) => ringInsideRing(d.corners, ringOf(p))
    const current = d.original ? plots.find((p) => p.id === (d.original as Zone).plot_id) : undefined
    const plot = current && fits(current) ? current : plots.find(fits)
    if (!plot) return { ok: false, message: 'Keep the whole zone inside one plot.' }
    return { ok: true, message: `In ${plot.name}. Drag corners to adjust, or tap to add more.`, plotId: plot.id }
  }

  const own = d.original ? zones.filter((z) => z.plot_id === d.id) : []
  const outside = own.find((z) => !ringInsideRing(openRing(z.geom.coordinates[0] ?? []), d.corners))
  if (outside) return { ok: false, message: `${outside.label ?? 'A zone'} would end up outside. Include all its zones.` }
  return { ok: true, message: 'Drag corners to adjust, or tap to add more.' }
}

/** The draft after a change of corners, remembered for Undo. */
export function withCorners(d: Draft, corners: FramePoint[]): Draft {
  return { ...d, corners, history: [...d.history, d.corners], selectedCorner: null }
}
