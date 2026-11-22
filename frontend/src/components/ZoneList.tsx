import { zoneName, type Plot, type Zone } from '../api/plots'
import { STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { StatusBadge } from './StatusBadge'

/** Every zone as a button, by plot: the way to reach zones without aiming at the map. */
export function ZoneList({
  id,
  plots,
  zones,
  today,
  onPick,
}: {
  id?: string
  plots: Plot[]
  zones: Zone[]
  today: string
  onPick: (z: Zone) => void
}) {
  if (zones.length === 0) return <p className="muted">No zones yet.</p>
  return (
    <div id={id} className="zone-list">
      {plots.map((p) => {
        const own = zones.filter((z) => z.plot_id === p.id).sort((a, b) => zoneName(a).localeCompare(zoneName(b)))
        if (own.length === 0) return null
        return (
          <section key={p.id} aria-label={p.name}>
            <h3>{p.name}</h3>
            <ul>
              {own.map((z) => {
                const s = zoneStatus(z, today)
                return (
                  <li key={z.id}>
                    <button type="button" onClick={() => onPick(z)}>
                      <span>{zoneName(z)}</span>
                      <StatusBadge status={s} label={STATUS_LABEL[s]} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
