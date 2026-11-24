import { zoneName, type Plot, type Zone } from '../api/plots'
import type { Attention } from '../domain/attention'
import { daysDry } from '../domain/zoneStatus'

/** The expanded "Needs attention" panel: each group with its count, each zone a button. */
export function NeedsAttention({
  id,
  plots,
  summary,
  today,
  onPick,
}: {
  id?: string
  plots: Plot[]
  summary: Attention
  today: string
  onPick: (z: Zone) => void
}) {
  const plotName = new Map(plots.map((p) => [p.id, p.name]))
  if (summary.total === 0) {
    return (
      <p id={id} className="attention__none">
        No zone needs water or sowing, and no zone has open tasks.
      </p>
    )
  }
  const group = (title: string, zones: Zone[], meta?: (z: Zone) => string) =>
    zones.length > 0 && (
      <section aria-label={`${title}: ${zones.length}`}>
        <h3>
          {title} <span className="badge attention__count">{zones.length}</span>
        </h3>
        <ul>
          {zones.map((z) => (
            <li key={z.id}>
              <button type="button" onClick={() => onPick(z)}>
                <span>{zoneName(z)}</span>
                <span className="zone-list__meta">
                  {[plotName.get(z.plot_id), meta?.(z)].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  return (
    <div id={id} className="zone-list attention">
      {group('Need water', summary.water, (z) => {
        const d = daysDry(z, today)
        return d === null ? '' : `dry ${d} day${d === 1 ? '' : 's'}`
      })}
      {group('Not sown yet', summary.sowing)}
      {group('Open tasks', summary.tasks, (z) => `${z.open_task_count} open task${z.open_task_count === 1 ? '' : 's'}`)}
    </div>
  )
}
