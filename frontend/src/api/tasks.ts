import { defineEntity } from './entity'
import { zoneName, type Plot, type Zone } from './plots'

export type TaskKind = 'sow' | 'plant' | 'water' | 'fertilize' | 'add_nests' | 'improve_path' | 'other'
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

export interface Task {
  id: string
  plot_id: string | null
  zone_id: string | null
  title: string
  description: string | null
  kind: TaskKind
  status: TaskStatus
  due_on: string | null
  completed_at: string | null
  resolved_by_activity_id: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface TaskInput {
  plot_id: string | null
  zone_id: string | null
  title: string
  description: string | null
  kind: TaskKind
  status: TaskStatus
  due_on: string | null
  resolved_by_activity_id: string | null
  base_version: number | null
}

export const TASK_KIND: Record<TaskKind, { label: string; icon: string }> = {
  sow: { label: 'Sow', icon: '🕳️' },
  plant: { label: 'Plant', icon: '🌱' },
  water: { label: 'Water', icon: '💧' },
  fertilize: { label: 'Fertilize', icon: '🧪' },
  add_nests: { label: 'Add nests', icon: '🪺' },
  improve_path: { label: 'Improve path', icon: '🛤️' },
  other: { label: 'Other', icon: '•' },
}

export const isOpen = (t: Pick<Task, 'status'>) => t.status === 'open' || t.status === 'in_progress'

/** The task as an input for an edit, starting from its current version. */
export function taskInput(t: Task, changes: Partial<TaskInput> = {}): TaskInput {
  return {
    plot_id: t.plot_id,
    zone_id: t.zone_id,
    title: t.title,
    description: t.description,
    kind: t.kind,
    status: t.status,
    due_on: t.due_on,
    resolved_by_activity_id: t.resolved_by_activity_id,
    base_version: t.version,
    ...changes,
  }
}

export const tasks = defineEntity<Task, TaskInput>({
  name: 'tasks',
  // open first by due date (undated last), then closed, most recent first
  sort: (a, b) =>
    Number(!isOpen(a)) - Number(!isOpen(b)) ||
    (isOpen(a)
      ? (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999')
      : (b.completed_at ?? '').localeCompare(a.completed_at ?? '')) ||
    a.created_at.localeCompare(b.created_at),
  optimistic: (id, input, before) => {
    const now = new Date().toISOString()
    const { base_version: _b, ...rest } = input
    const closing = !isOpen(input)
    return {
      id,
      ...rest,
      completed_at: closing ? (before?.completed_at ?? now) : null,
      version: before?.version ?? 1,
      created_at: before?.created_at ?? now,
      updated_at: now,
    }
  },
  versioned: true,
  alsoRefresh: [['zones'], ['plot-stats']], // open task counts
})

/** Where a task is: "Clareira · Plot 1" or "Plot 2". */
export function taskPlace(t: Task, plots: Plot[], zones: Zone[]): string {
  if (t.zone_id) {
    const z = zones.find((x) => x.id === t.zone_id)
    const p = z && plots.find((x) => x.id === z.plot_id)
    return z ? `${zoneName(z)}${p ? ` · ${p.name}` : ''}` : 'A deleted zone'
  }
  return plots.find((p) => p.id === t.plot_id)?.name ?? 'A deleted plot'
}
