import { zoneName, type Plot, type Zone } from '../api/plots'
import type { Attention } from '../domain/attention'
import { taskCount } from '../domain/attention'
import { days } from '../domain/dates'
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
        Nenhuma zona está por regar ou por semear, e nenhuma tem tarefas por fazer.
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
      {group('Por regar', summary.water, (z) => {
        const d = daysDry(z, today)
        return d === null ? '' : `sem rega há ${days(d)}`
      })}
      {group('Ainda sem nada', summary.sowing)}
      {group('Tarefas por fazer', summary.tasks, (z) => taskCount(z.open_task_count))}
    </div>
  )
}
