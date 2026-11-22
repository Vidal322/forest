import type { ZoneStatus } from '../domain/zoneStatus'
import { STATUS_COLOR } from '../map/colors'

/** Dark text on a light chip with a coloured dot: readable in sunlight whatever the colour. */
export function StatusBadge({ status, label }: { status: ZoneStatus; label: string }) {
  return (
    <span className="status-badge">
      <i className={`swatch${status === 'needs-water' || status === 'unsown' ? ' swatch--dashed' : ''}`} style={{ background: STATUS_COLOR[status] }} aria-hidden="true" />
      {label}
    </span>
  )
}
