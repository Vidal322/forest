import type { Photo } from '../api/field'

export interface PhotoInfo extends Photo {
  residual_px: number | null
  is_current: boolean
}

/** How well a newer photo lines up, in words (residual = typical landmark miss, in frame px). */
export function fitLabel(p: Pick<PhotoInfo, 'residual_px' | 'alignment_points'> | { residual_px: number | null }): string {
  if (p.residual_px === null) return 'É a fotografia de referência'
  const pts = (p as { alignment_points?: unknown[] }).alignment_points?.length
  if (pts === 3) return 'Encaixa exatamente nos 3 pontos de referência (marca um 4.º da próxima vez para o confirmar)'
  if (p.residual_px < 3) return 'Encaixa muito bem'
  if (p.residual_px < 10) return `Encaixa bem (±${p.residual_px.toFixed(0)} px)`
  return `Encaixa mais ou menos (±${p.residual_px.toFixed(0)} px). Talvez valha a pena alinhar outra vez com mais pontos de referência`
}
