import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import { ACTIVITY, UNIT_LABEL, useZoneHistory, type Activity } from '../api/activities'
import { friendlyError } from '../api/errors'
import { formatHa, KIND_LABEL, plots as plotsApi, zoneName, zones as zonesApi } from '../api/plots'
import { useSpeciesList } from '../api/species'
import { isOpen, tasks as tasksApi, type Task } from '../api/tasks'
import { ActivityEditForm } from '../components/ActivityEditForm'
import { Flash } from '../components/Flash'
import { StatusBadge } from '../components/StatusBadge'
import { TaskForm } from '../components/TaskForm'
import { ZoneTrees } from '../components/ZoneTrees'
import { formatDay, relativeDay } from '../domain/dates'
import { needsWater, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { useFieldToday } from '../hooks/useFieldToday'
import { useFlash } from '../hooks/useFlash'
import { STATUS_COLOR } from '../map/colors'
import { TaskRow, ToastLine } from '../components/TaskRow'
import { useTaskToggle, type Toast } from '../hooks/useTaskToggle'

type Editing = { kind: 'activity'; activity: Activity } | { kind: 'task'; task?: Task } | null

/** Everything about one zone: its state, what happened there, and what is still to do. */
export function ZonePage() {
  const { id } = useParams()
  const zones = zonesApi.useList()
  const plots = plotsApi.useList()
  const history = useZoneHistory(id)
  const tasks = tasksApi.useList()
  const species = useSpeciesList()
  const today = useFieldToday()
  const flash = useFlash()
  const [editing, setEditing] = useState<Editing>(null)
  const [formKey, setFormKey] = useState(0)
  const returnFocus = useRef<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const { toggle, pinned } = useTaskToggle(useCallback((t: Omit<Toast, 'n'>) => setToast((o) => ({ ...t, n: (o?.n ?? 0) + 1 })), []))

  const { show } = flash
  const close = useCallback(
    (message?: string) => {
      setEditing(null)
      if (message) show(message)
      // back to the row or button that opened the form
      requestAnimationFrame(() => {
        const el = returnFocus.current ? document.getElementById(returnFocus.current) : null
        ;(el ?? document.getElementById('zone-add-task'))?.focus()
      })
    },
    [show],
  )
  const done = close
  const open = (next: Exclude<Editing, null>, from: string) => {
    returnFocus.current = from
    setEditing(next)
  }

  const zone = zones.data?.find((z) => z.id === id)
  if (!zone) {
    return (
      <div className="page">
        <p>
          <Link to="/">← Map</Link>
        </p>
        {zones.isPending ? (
          <p className="muted">Loading…</p>
        ) : zones.isError ? (
          <p className="note warn" role="alert">
            {friendlyError(zones.error)}
          </p>
        ) : (
          <>
            <h1>Zone not found</h1>
            <p className="muted">It may have been deleted.</p>
          </>
        )}
      </div>
    )
  }

  const plot = plots.data?.find((p) => p.id === zone.plot_id)
  const status = zoneStatus(zone, today)
  const zoneTasks = (tasks.data ?? []).filter((t) => t.zone_id === zone.id)
  // a task ticked here keeps its place until the page is left (no row slides under the thumb)
  const openTasks = zoneTasks.filter((t) => isOpen(t) || pinned.has(t.id))
  const closedTasks = zoneTasks.filter((t) => !isOpen(t) && !pinned.has(t.id))
  const speciesName = new Map((species.data ?? []).map((s) => [s.id, s.common_name ?? s.scientific_name]))

  return (
    <div className="page">
      <p className="crumbs">
        <Link to={`/?zone=${zone.id}`}>← Map</Link>
        {plot && <span className="muted"> · {plot.name}</span>}
      </p>
      <h1>{zoneName(zone)}</h1>
      <p className="row">
        <StatusBadge status={status} label={STATUS_LABEL[status]} />
        {zone.kind !== 'cultivation' && <span className="muted">{KIND_LABEL[zone.kind]}</span>}
        {zone.area_ha !== null && <span className="muted">{formatHa(zone.area_ha)}</span>}
      </p>
      {needsWater(zone, today) && (
        <p className="note">No watering, sowing or planting here for {zone.current_interval_days}+ days.</p>
      )}
      {zone.notes && <p className="muted">{zone.notes}</p>}
      <div className="row">
        <Link className="btn btn-primary" to={`/log?zone=${zone.id}`}>
          ＋ Log activity
        </Link>
        <Link className="btn" to={`/?edit=${zone.id}`}>
          ✎ Edit outline
        </Link>
      </div>
      <Flash flash={flash} />
      <ToastLine
        toast={toast}
        onUndo={() => {
          toast?.undo?.()
          setToast(null)
        }}
      />

      <section aria-labelledby="zone-tasks">
        <div className="row section-head">
          <h2 id="zone-tasks">To do</h2>
          <span className="spacer" />
          {editing?.kind !== 'task' && (
            <button id="zone-add-task" type="button" className="btn btn-small" onClick={() => open({ kind: 'task' }, 'zone-add-task')}>
              ＋ Add task
            </button>
          )}
        </div>
        {editing?.kind === 'task' && (
          <TaskForm
            key={`${editing.task?.id ?? 'new'}:${formKey}`}
            task={editing.task ? (zoneTasks.find((t) => t.id === editing.task!.id) ?? editing.task) : undefined}
            onReload={() => void tasks.refetch().then(() => setFormKey((k) => k + 1))}
            plots={plots.data ?? []}
            zones={zones.data ?? []}
            today={today}
            fixedWhere={editing.task ? undefined : `zone:${zone.id}`}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        )}
        {openTasks.length === 0 ? (
          <p className="muted">Nothing to do here.</p>
        ) : (
          <ul className="list">
            {openTasks.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onEdit={() => open({ kind: 'task', task: t }, `task-${t.id}`)} onToggle={() => toggle(t)} />
            ))}
          </ul>
        )}
        {closedTasks.length > 0 && (
          <>
            <button type="button" className="btn-link" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? 'Hide' : 'Show'} done ({closedTasks.length})
            </button>
            {showClosed && (
              <ul className="list">
                {closedTasks.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} onEdit={() => open({ kind: 'task', task: t }, `task-${t.id}`)} onToggle={() => toggle(t)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {zone.kind === 'cultivation' && <ZoneTrees zoneId={zone.id} species={species.data ?? []} onMessage={show} />}

      <section aria-labelledby="zone-history">
        <h2 id="zone-history" className="section-head">
          History
        </h2>
        {history.isError && (
          <p className="note warn" role="alert">
            {friendlyError(history.error)}
          </p>
        )}
        {history.offline && history.data.length === 0 && <p className="note">No connection. The history will appear when there is signal.</p>}
        {history.data.length === 0 && !history.isPending && !history.offline && <p className="muted">Nothing logged here yet.</p>}
        <ol className="timeline">
          {history.data.map((a) => {
            const mine = a.zones.find((z) => z.zone_id === zone.id)
            const others = a.zones.length - 1
            if (editing?.kind === 'activity' && editing.activity.id === a.id) {
              return (
                <li key={a.id} className="timeline__edit">
                  <ActivityEditForm
                    key={formKey}
                    activity={a}
                    onReload={() => setFormKey((k) => k + 1)}
                    zones={zones.data ?? []}
                    species={species.data ?? []}
                    today={today}
                    onDone={done}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              )
            }
            return (
              <li key={a.id} style={{ '--c': a.type === 'other' ? STATUS_COLOR.path : STATUS_COLOR[a.type === 'watering' ? 'watered' : a.type === 'sowing' ? 'sown' : a.type === 'planting' ? 'planted' : 'path'] } as CSSProperties}>
                <button
                  id={`entry-${a.id}`}
                  type="button"
                  className="timeline__item"
                  onClick={() => open({ kind: 'activity', activity: a }, `entry-${a.id}`)}
                >
                  <span className="timeline__title">
                    <span className="visually-hidden">Edit: </span>
                    <span aria-hidden="true">{ACTIVITY[a.type].icon}</span> {ACTIVITY[a.type].label}
                    {mine?.quantity != null && mine.unit && ` · ${mine.quantity} ${UNIT_LABEL[mine.unit]}`}
                  </span>
                  <span className="timeline__meta">
                    {formatDay(a.performed_on, today)}
                    {relativeDay(a.performed_on, today) !== formatDay(a.performed_on, today) && ` (${relativeDay(a.performed_on, today)})`}
                    {others > 0 && ` · with ${others} other zone${others === 1 ? '' : 's'}`}
                  </span>
                  {a.species.length > 0 && (
                    <span className="timeline__meta">
                      {a.species
                        .map((s) => `${speciesName.get(s.species_id) ?? 'a deleted species'}${s.quantity != null ? ` ×${s.quantity}` : ''}`)
                        .join(', ')}
                    </span>
                  )}
                  {a.notes && <span className="timeline__notes">{a.notes}</span>}
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
