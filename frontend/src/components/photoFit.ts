import type { Photo } from '../api/field'

export interface PhotoInfo extends Photo {
  residual_px: number | null
  is_current: boolean
}

/** How well a newer photo lines up, in words (residual = typical landmark miss, in frame px). */
export function fitLabel(p: Pick<PhotoInfo, 'residual_px' | 'alignment_points'> | { residual_px: number | null }): string {
  if (p.residual_px === null) return 'is the reference photo'
  const pts = (p as { alignment_points?: unknown[] }).alignment_points?.length
  if (pts === 3) return 'lines up exactly on its 3 landmarks (add a 4th next time to check it)'
  if (p.residual_px < 3) return 'lines up very well'
  if (p.residual_px < 10) return `lines up well (±${p.residual_px.toFixed(0)} px)`
  return `lines up roughly (±${p.residual_px.toFixed(0)} px) — consider aligning again with more landmarks`
}
