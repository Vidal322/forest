import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ACTIVITY, activities as activitiesApi, UNIT_LABEL, useZoneHistory, type Activity } from '../api/activities'
import { friendlyError } from '../api/errors'
import { KIND_LABEL, plots as plotsApi, zoneName, zoneSubtitle, zones as zonesApi } from '../api/plots'
import { useSpeciesList } from '../api/species'
import { isOpen, resolvedLink, tasks as tasksApi, type Task } from '../api/tasks'
import { ActivityEditForm } from '../components/ActivityEditForm'
import { Flash } from '../components/Flash'
import { StatusBadge } from '../components/StatusBadge'
import { TaskForm } from '../components/TaskForm'
import { ZoneTrees } from '../components/ZoneTrees'
import { formatDay, relativeDay } from '../domain/dates'
import { formatNumber } from '../domain/numbers'
import { needsWater, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { useFieldToday } from '../hooks/useFieldToday'
import { useFlash } from '../hooks/useFlash'
import { STATUS_COLOR } from '../map/colors'
import { TaskRow, ToastLine } from '../components/TaskRow'
import { useTaskToggle, type Toast } from '../hooks/useTaskToggle'
import { Icon } from '../components/Icon'

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
  const allEntries = activitiesApi.useList()

  // "#entry-<id>" (from a task done by that entry): bring the entry into view and mark it
  const location = useLocation()
  const [target, setTarget] = useState<string | null>(null)
  const shownFor = useRef<string | null>(null)
  const targetId = location.hash.startsWith('#entry-') ? location.hash.slice('#entry-'.length) : null
  const targetLoaded = targetId !== null && history.data.some((a) => a.id === targetId)
  useEffect(() => {
    if (!targetId || !targetLoaded || shownFor.current === location.key) return
    shownFor.current = location.key
    setTarget(targetId)
    requestAnimationFrame(() => {
      const el = document.getElementById(`entry-${targetId}`)
      el?.scrollIntoView?.({ block: 'center' })
      el?.focus({ preventScroll: true })
    })
  }, [targetId, targetLoaded, location.key])

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
          <Link className="link-tap" to="/"><Icon name="back" size={18} /> Mapa</Link>
        </p>
        {zones.isPending ? (
          <p className="muted">A carregar…</p>
        ) : zones.isError ? (
          <p className="note warn" role="alert">
            {friendlyError(zones.error)}
          </p>
        ) : (
          <>
            <h1>Zona não encontrada</h1>
            <p className="muted">Pode ter sido apagada.</p>
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
  const entries = [...history.data, ...(allEntries.data ?? [])]
  const doneBy = (t: Task) => resolvedLink(t, entries, zones.data ?? [], today)
  const speciesName = new Map((species.data ?? []).map((s) => [s.id, s.common_name ?? s.scientific_name]))

  return (
    <div className="page">
      <p className="crumbs">
        <Link className="link-tap" to={`/?zone=${zone.id}`}><Icon name="back" size={18} /> Mapa</Link>
        {plot && <span className="muted"> · {plot.name}</span>}
      </p>
      <h1>{zoneName(zone)}</h1>
      <p className="page-subtitle">{zoneSubtitle(zone, plot)}</p>
      <p className="row">
        <StatusBadge status={status} label={STATUS_LABEL[status]} />
        {zone.kind !== 'cultivation' && <span className="muted">{KIND_LABEL[zone.kind]}</span>}
      </p>
      {needsWater(zone, today) && (
        <p className="note">Sem rega, sementeira nem plantação há {zone.current_interval_days} dias ou mais.</p>
      )}
      {zone.notes && <p className="muted">{zone.notes}</p>}
      <div className="row">
        <Link className="btn btn-primary" to={`/log?zone=${zone.id}`}>
          <Icon name="add" /> Registar
        </Link>
        <Link className="btn" to={`/?edit=${zone.id}`}>
          <Icon name="edit" /> Editar o contorno
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
          <h2 id="zone-tasks">Tarefas</h2>
          <span className="spacer" />
          {editing?.kind !== 'task' && (
            <button id="zone-add-task" type="button" className="btn btn-small" onClick={() => open({ kind: 'task' }, 'zone-add-task')}>
              <Icon name="add" /> Acrescentar tarefa
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
          <p className="muted">Nada por fazer aqui.</p>
        ) : (
          <ul className="list">
            {openTasks.map((t) => (
              <TaskRow key={t.id} task={t} today={today} resolvedBy={doneBy(t)} onEdit={() => open({ kind: 'task', task: t }, `task-${t.id}`)} onToggle={() => toggle(t)} />
            ))}
          </ul>
        )}
        {closedTasks.length > 0 && (
          <>
            <button type="button" className="btn-link" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? 'Esconder' : 'Mostrar'} as feitas ({closedTasks.length})
            </button>
            {showClosed && (
              <ul className="list">
                {closedTasks.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} resolvedBy={doneBy(t)} onEdit={() => open({ kind: 'task', task: t }, `task-${t.id}`)} onToggle={() => toggle(t)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {zone.kind === 'cultivation' && <ZoneTrees zoneId={zone.id} species={species.data ?? []} onMessage={show} />}

      <section aria-labelledby="zone-history">
        <h2 id="zone-history" className="section-head">
          Histórico
        </h2>
        {history.isError && (
          <p className="note warn" role="alert">
            {friendlyError(history.error)}
          </p>
        )}
        {history.offline && history.data.length === 0 && <p className="note">Sem rede. O histórico aparece quando houver rede.</p>}
        {history.data.length === 0 && !history.isPending && !history.offline && <p className="muted">Ainda não registaste nada aqui.</p>}
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
                  className={`timeline__item${target === a.id ? ' is-target' : ''}`}
                  onClick={() => open({ kind: 'activity', activity: a }, `entry-${a.id}`)}
                >
                  <span className="timeline__title">
                    <span className="visually-hidden">Editar: </span>
                    <Icon name={ACTIVITY[a.type].icon} /> {ACTIVITY[a.type].label}
                    {mine?.quantity != null && mine.unit && ` · ${formatNumber(mine.quantity)} ${UNIT_LABEL[mine.unit]}`}
                  </span>
                  <span className="timeline__meta">
                    {formatDay(a.performed_on, today)}
                    {relativeDay(a.performed_on, today) !== formatDay(a.performed_on, today) && ` (${relativeDay(a.performed_on, today)})`}
                    {others > 0 && ` · com ${others === 1 ? 'mais 1 zona' : `mais ${others} zonas`}`}
                  </span>
                  {a.species.length > 0 && (
                    <span className="timeline__meta">
                      {a.species
                        .map((s) => `${speciesName.get(s.species_id) ?? 'uma espécie apagada'}${s.quantity != null ? ` ×${formatNumber(s.quantity)}` : ''}`)
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
