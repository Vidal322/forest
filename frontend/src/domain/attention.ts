import { zoneName, type Zone } from '../api/plots'
import { byNeed, zoneStatus } from './zoneStatus'

export interface Attention {
  water: Zone[]
  sowing: Zone[]
  tasks: Zone[]
  /** Distinct zones in any of the groups (a dry zone with a task counts once). */
  total: number
}

const byName = (a: Zone, b: Zone) => zoneName(a).localeCompare(zoneName(b), undefined, { numeric: true, sensitivity: 'base' })

/** Zones that need something done, by what they need, from the derived status (as on the map). */
export function attention(zones: Zone[], today: string): Attention {
  const water = zones.filter((z) => zoneStatus(z, today) === 'needs-water').sort(byName).sort(byNeed(today))
  const sowing = zones.filter((z) => zoneStatus(z, today) === 'unsown').sort(byName)
  const tasks = zones
    .filter((z) => z.open_task_count > 0)
    .sort(byName)
    .sort((a, b) => b.open_task_count - a.open_task_count)
  const total = new Set([...water, ...sowing, ...tasks].map((z) => z.id)).size
  return { water, sowing, tasks, total }
}

/** "1 tarefa por fazer", "3 tarefas por fazer". */
export const taskCount = (n: number) => (n === 1 ? '1 tarefa por fazer' : `${n} tarefas por fazer`)

export function attentionLabel(total: number): string {
  if (total === 0) return 'Nenhuma zona precisa de nada'
  return total === 1 ? '1 zona precisa de atenção' : `${total} zonas precisam de atenção`
}
