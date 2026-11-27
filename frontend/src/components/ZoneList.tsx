import { Link } from 'react-router'
import { zoneName, type Plot, type Zone } from '../api/plots'
import { taskCount } from '../domain/attention'
import { byNeed, NEED_ORDER_HINT, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { StatusBadge } from './StatusBadge'
import { Icon } from './Icon'

/** Every zone as a button, by plot, most urgent first: the way to reach zones without aiming at the map. */
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
  if (zones.length === 0) return <p className="muted">Ainda não há zonas.</p>
  return (
    <div id={id} className="zone-list">
      <p className="zone-list__hint">{NEED_ORDER_HINT}</p>
      {plots.map((p) => {
        const own = zones
          .filter((z) => z.plot_id === p.id)
          .sort((a, b) => zoneName(a).localeCompare(zoneName(b), undefined, { numeric: true, sensitivity: 'base' }))
          .sort(byNeed(today))
        if (own.length === 0) return null
        return (
          <section key={p.id} aria-label={p.name}>
            <h3>
              <Link to={`/plots/${p.id}`}>
                {p.name} <Icon name="next" size={16} />
              </Link>
            </h3>
            <ul>
              {own.map((z) => {
                const s = zoneStatus(z, today)
                return (
                  <li key={z.id}>
                    <button type="button" onClick={() => onPick(z)}>
                      <span>
                        {zoneName(z)}
                        {z.open_task_count > 0 && (
                          <>
                            {' '}
                            <span className="zone-list__meta">
                              · {taskCount(z.open_task_count)}
                            </span>
                          </>
                        )}
                      </span>
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
