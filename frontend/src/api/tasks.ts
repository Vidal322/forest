import type { QueryClient } from '@tanstack/react-query'
import { daysBetween, formatDay, relativeDay } from '../domain/dates'
import { ACTIVITY, type Activity } from './activities'
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
  sow: { label: 'Semear', icon: '🕳️' },
  plant: { label: 'Plantar', icon: '🌱' },
  water: { label: 'Regar', icon: '💧' },
  fertilize: { label: 'Adubar', icon: '🧪' },
  add_nests: { label: 'Fazer ninhos', icon: '🪺' },
  improve_path: { label: 'Melhorar o caminho', icon: '🛤️' },
  other: { label: 'Outro', icon: '•' },
}

/** When an open task is due: "para hoje", "para amanhã", "para daqui a 3 dias", "para 2 dez", "atrasada desde 20 nov". */
export function dueLabel(due: string, today: string): string {
  if (daysBetween(today, due) < 0) return `atrasada desde ${formatDay(due, today)}`
  return `para ${relativeDay(due, today)}`
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
  onSaveOptimistic: (qc, input, before) => recountZones(qc, before, input),
  onDeleteOptimistic: (qc, _id, before) => recountZones(qc, before, undefined),
})

type Counted = Pick<Task, 'zone_id' | 'status'>

/**
 * Keep the zones' open task counts (badges, the zone list's order) right at once,
 * also offline, when a task is added, closed, reopened, moved or deleted: one less
 * where it was open, one more where it is open now. The server's zone list
 * replaces this once the write is through. Returns how to undo it.
 */
async function recountZones(qc: QueryClient, before: Counted | undefined, after: Counted | undefined) {
  const delta = new Map<string, number>()
  const add = (t: Counted | undefined, n: number) => {
    if (t?.zone_id && isOpen(t)) delta.set(t.zone_id, (delta.get(t.zone_id) ?? 0) + n)
  }
  add(before, -1)
  add(after, +1)
  for (const [id, n] of delta) if (n === 0) delta.delete(id)
  if (delta.size === 0) return () => {}
  // a zone list already on its way would bring the old counts back
  await qc.cancelQueries({ queryKey: ['zones'] })
  const shift = (sign: number) =>
    qc.setQueryData<Zone[]>(['zones'], (zones) =>
      zones?.map((z) => {
        const n = delta.get(z.id)
        return n ? { ...z, open_task_count: Math.max(0, z.open_task_count + sign * n) } : z
      }),
    )
  shift(+1)
  return () => shift(-1)
}

/** The plot a task counts under: its own, or its zone's (undefined if the zone isn't known here). */
export function taskPlotId(t: Pick<Task, 'plot_id' | 'zone_id'>, zones: Zone[]): string | undefined {
  if (t.plot_id) return t.plot_id
  return zones.find((z) => z.id === t.zone_id)?.plot_id
}

/** Where a task is: "Clareira · Parcela 1" or "Parcela 2". */
export function taskPlace(t: Task, plots: Plot[], zones: Zone[]): string {
  if (t.zone_id) {
    const z = zones.find((x) => x.id === t.zone_id)
    const p = z && plots.find((x) => x.id === z.plot_id)
    return z ? `${zoneName(z)}${p ? ` · ${p.name}` : ''}` : 'Uma zona apagada'
  }
  return plots.find((p) => p.id === t.plot_id)?.name ?? 'Uma parcela apagada'
}

export type ResolvedLink = { to: string; label: string }

/**
 * Where to see the log entry that closed a task: its line in a zone's history
 * (the task's own zone when the entry touched it, else one of the task's plot).
 * None while the task is open, or when the entry isn't known here (deleted, or too old).
 */
export function resolvedLink(task: Task, entries: Activity[], zones: Zone[], today: string): ResolvedLink | undefined {
  if (isOpen(task) || !task.resolved_by_activity_id) return undefined
  const a = entries.find((x) => x.id === task.resolved_by_activity_id)
  if (!a || a.zones.length === 0) return undefined
  const plotOf = (id: string) => zones.find((z) => z.id === id)?.plot_id
  const zoneId =
    a.zones.find((z) => z.zone_id === task.zone_id)?.zone_id ??
    a.zones.find((z) => task.plot_id !== null && plotOf(z.zone_id) === task.plot_id)?.zone_id ??
    a.zones[0]!.zone_id
  // the day as the zone's history shows it: "24 nov (hoje)"
  const day = formatDay(a.performed_on, today)
  const rel = relativeDay(a.performed_on, today)
  return {
    to: `/zones/${zoneId}#entry-${a.id}`,
    label: `${ACTIVITY[a.type].icon} ${ACTIVITY[a.type].label} ${day}${rel === day ? '' : ` (${rel})`}`,
  }
}
