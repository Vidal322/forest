import { zoneName, type Plot, type Zone } from '../api/plots'
import { isOpen, type Task } from '../api/tasks'
import type { FramePoint } from './frame'
import { centroid, openRing } from './geometry'

/** Where open tasks are pinned: a zone, or a plot for tasks of the whole plot. */
export interface TaskSpot {
  /** "zone:<id>" or "plot:<id>" */
  key: string
  name: string
  zone?: Zone
  plot?: Plot
  at: FramePoint
  /** how wide the place is, in frame units (labels only when it is wide on screen) */
  width: number
  tasks: Task[]
}

export const spotKey = (t: Pick<Task, 'zone_id' | 'plot_id'>) => (t.zone_id ? `zone:${t.zone_id}` : `plot:${t.plot_id}`)

/**
 * Tasks have no position of their own: open ones are pinned at their zone's centre, or
 * their plot's. One pin per place (several tasks there share it), in the tasks' order.
 * Tasks of a place this phone doesn't know (deleted meanwhile) have no pin.
 */
export function taskSpots(tasks: Task[], plots: Plot[], zones: Zone[]): TaskSpot[] {
  const spots = new Map<string, TaskSpot>()
  for (const t of tasks) {
    if (!isOpen(t)) continue
    const key = spotKey(t)
    let spot = spots.get(key)
    if (!spot) {
      const zone = t.zone_id ? zones.find((z) => z.id === t.zone_id) : undefined
      const plot = t.zone_id ? plots.find((p) => p.id === zone?.plot_id) : plots.find((p) => p.id === t.plot_id)
      const shape = t.zone_id ? zone : plot
      if (!shape) continue
      const corners = openRing(shape.geom.coordinates[0] ?? [])
      const xs = corners.map((p) => p[0])
      spot = {
        key,
        name: zone ? zoneName(zone) : plot!.name,
        zone,
        plot,
        at: centroid(corners),
        width: Math.max(...xs) - Math.min(...xs),
        tasks: [],
      }
      spots.set(key, spot)
    }
    spot.tasks.push(t)
  }
  return [...spots.values()]
}

/** What a pin says to a screen reader (and on hover). */
export function pinTitle(spot: TaskSpot): string {
  const [first] = spot.tasks
  return spot.tasks.length === 1 ? `Task: ${first!.title}` : `${spot.tasks.length} tasks: ${spot.name}`
}
