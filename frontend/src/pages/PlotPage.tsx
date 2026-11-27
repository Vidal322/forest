import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import { ACTIVITY, activities as activitiesApi, UNIT_LABEL, usePlotHistory, zonesPhrase, type Activity } from '../api/activities'
import { friendlyError } from '../api/errors'
import { formatHa, plots as plotsApi, zoneName, zones as zonesApi, type Zone } from '../api/plots'
import { isOpen, resolvedLink, taskPlotId, tasks as tasksApi, type Task } from '../api/tasks'
import { Flash } from '../components/Flash'
import { StatusBadge } from '../components/StatusBadge'
import { TaskForm } from '../components/TaskForm'
import { TaskRow, ToastLine } from '../components/TaskRow'
import { taskCount } from '../domain/attention'
import { formatDay, relativeDay } from '../domain/dates'
import { formatNumber } from '../domain/numbers'
import { byNeed, NEED_ORDER_HINT, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { useFieldToday } from '../hooks/useFieldToday'
import { useFlash } from '../hooks/useFlash'
import { useTaskToggle, type Toast } from '../hooks/useTaskToggle'
import { STATUS_COLOR } from '../map/colors'

/** How many log entries the page shows at first, and how many more each tap adds. */
const RECENT_STEP = 10

type Editing = { task?: Task } | null

const byName = (a: Zone, b: Zone) => zoneName(a).localeCompare(zoneName(b), undefined, { numeric: true, sensitivity: 'base' })

/** One plot at a glance: its zones by need, what is still to do there, and what was done lately. */
export function PlotPage() {
  const { id } = useParams()
  const plots = plotsApi.useList()
  const zones = zonesApi.useList()
  const tasks = tasksApi.useList()
  const entries = activitiesApi.useList()
  const today = useFieldToday()
  const flash = useFlash()
  const [editing, setEditing] = useState<Editing>(null)
  const [formKey, setFormKey] = useState(0)
  const [shown, setShown] = useState(RECENT_STEP)
  const returnFocus = useRef<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const { toggle, pinned } = useTaskToggle(useCallback((t: Omit<Toast, 'n'>) => setToast((o) => ({ ...t, n: (o?.n ?? 0) + 1 })), []))

  const allZones = useMemo(() => zones.data ?? [], [zones.data])
  const own = useMemo(() => allZones.filter((z) => z.plot_id === id).sort(byName).sort(byNeed(today)), [allZones, id, today])
  const ownIds = useMemo(() => new Set(own.map((z) => z.id)), [own])
  // the plot's own list from the server, so older entries aren't lost to the global log's cap
  const history = usePlotHistory(id, ownIds)
  const recent = history.data

  const { show } = flash
  const close = useCallback(
    (message?: string) => {
      setEditing(null)
      if (message) show(message)
      requestAnimationFrame(() => {
        const el = returnFocus.current ? document.getElementById(returnFocus.current) : null
        ;(el ?? document.getElementById('plot-add-task'))?.focus()
      })
    },
    [show],
  )
  const open = (next: Exclude<Editing, null>, from: string) => {
    returnFocus.current = from
    setEditing(next)
  }

  const plot = plots.data?.find((p) => p.id === id)
  if (!plot) {
    return (
      <div className="page">
        <p>
          <Link to="/">← Mapa</Link>
        </p>
        {plots.isPending ? (
          <p className="muted">A carregar…</p>
        ) : plots.isError ? (
          <p className="note warn" role="alert">
            {friendlyError(plots.error)}
          </p>
        ) : (
          <>
            <h1>Parcela não encontrada</h1>
            <p className="muted">Pode ter sido apagada.</p>
          </>
        )}
      </div>
    )
  }

  // zone tasks count under their plot; a task ticked here keeps its place until the page is left
  const plotTasks = (tasks.data ?? []).filter((t) => taskPlotId(t, allZones) === plot.id && (isOpen(t) || pinned.has(t.id)))
  const zoneById = new Map(own.map((z) => [z.id, z]))
  const place = (t: Task) => (t.zone_id ? (zoneById.get(t.zone_id) ? zoneName(zoneById.get(t.zone_id)!) : 'Uma zona apagada') : 'Parcela inteira')

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/">← Mapa</Link>
      </p>
      <h1>{plot.name}</h1>
      <p className="muted">
        {plot.area_ha !== null ? formatHa(plot.area_ha) : 'Área ainda por medir'}
        {plot.declared_area_ha !== null && ` · ${formatHa(plot.declared_area_ha)} no mapa antigo`}
        {` · ${own.length === 1 ? '1 zona' : `${own.length} zonas`}`}
      </p>
      {plot.notes && <p className="muted">{plot.notes}</p>}
      <div className="row">
        <Link className="btn" to={`/stats#plot-${plot.id}`}>
          📊 Estatísticas de {plot.name}
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

      <section aria-labelledby="plot-zones">
        <div className="section-head">
          <h2 id="plot-zones">Zonas</h2>
        </div>
        {zones.isError && !zones.data && (
          <p className="note warn" role="alert">
            {friendlyError(zones.error)}
          </p>
        )}
        {zones.isPending && <p className="muted">Loading…</p>}
        {zones.data && own.length === 0 && (
          <p className="muted">
            Ainda não há zonas nesta parcela. <Link to="/">Desenha-as no mapa.</Link>
          </p>
        )}
        {own.length > 0 && (
          <div className="zone-list">
            {own.length > 1 && <p className="zone-list__hint">{NEED_ORDER_HINT}</p>}
            <ul>
              {own.map((z) => {
                const s = zoneStatus(z, today)
                return (
                  <li key={z.id}>
                    <Link className="zone-list__item" to={`/zones/${z.id}`}>
                      <span>
                        {zoneName(z)}
                        {z.open_task_count > 0 && (
                          <span className="zone-list__meta">
                            {' '}
                            · {taskCount(z.open_task_count)}
                          </span>
                        )}
                      </span>
                      <StatusBadge status={s} label={STATUS_LABEL[s]} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="plot-tasks">
        <div className="row section-head">
          <h2 id="plot-tasks">Tarefas</h2>
          <span className="spacer" />
          {editing === null && (
            <button id="plot-add-task" type="button" className="btn btn-small" onClick={() => open({}, 'plot-add-task')}>
              ＋ Acrescentar tarefa
            </button>
          )}
        </div>
        {editing !== null && (
          <TaskForm
            key={`${editing.task?.id ?? 'new'}:${formKey}`}
            task={editing.task ? ((tasks.data ?? []).find((t) => t.id === editing.task!.id) ?? editing.task) : undefined}
            onReload={() => void tasks.refetch().then(() => setFormKey((k) => k + 1))}
            plots={plots.data ?? []}
            zones={allZones}
            today={today}
            fixedWhere={editing.task ? undefined : `plot:${plot.id}`}
            onDone={close}
            onCancel={() => setEditing(null)}
          />
        )}
        {tasks.isError && !tasks.data && (
          <p className="note warn" role="alert">
            {friendlyError(tasks.error)}
          </p>
        )}
        {tasks.data && plotTasks.length === 0 && <p className="muted">Nada por fazer nesta parcela.</p>}
        {plotTasks.length > 0 && (
          <ul className="list">
            {plotTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                place={place(t)}
                today={today}
                resolvedBy={resolvedLink(t, entries.data ?? [], allZones, today)}
                onEdit={() => open({ task: t }, `task-${t.id}`)}
                onToggle={() => toggle(t)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="plot-recent">
        <div className="section-head">
          <h2 id="plot-recent">Últimos registos</h2>
        </div>
        {history.isError && (
          <p className="note warn" role="alert">
            {friendlyError(history.error)}
          </p>
        )}
        {history.offline && recent.length === 0 && <p className="note">Sem rede. Os últimos registos aparecem quando houver rede.</p>}
        {zones.data && recent.length === 0 && !history.isPending && !history.offline && !history.isError && (
          <p className="muted">Ainda não registaste nada nesta parcela.</p>
        )}
        {recent.length > 0 && (
          <ol className="timeline">
            {recent.slice(0, shown).map((a) => (
              <RecentEntry key={a.id} a={a} zoneById={zoneById} today={today} />
            ))}
          </ol>
        )}
        {recent.length > shown && (
          <button type="button" className="btn-link" onClick={() => setShown((n) => n + RECENT_STEP * 2)}>
            Mostrar mais ({recent.length - shown} mais antigos)
          </button>
        )}
      </section>
    </div>
  )
}

const ENTRY_COLOR: Record<Activity['type'], string> = {
  watering: STATUS_COLOR.watered,
  sowing: STATUS_COLOR.sown,
  planting: STATUS_COLOR.planted,
  fertilizing: STATUS_COLOR.path,
  other: STATUS_COLOR.path,
}

/** One log entry, as it touched this plot: opens it in the zone's history. */
function RecentEntry({ a, zoneById, today }: { a: Activity; zoneById: Map<string, Zone>; today: string }) {
  const here = a.zones.filter((z) => zoneById.has(z.zone_id))
  // a total only when every zone here has a quantity in the same unit
  const unit = here[0]?.unit
  const total =
    unit && here.every((z) => z.quantity != null && z.unit === unit) ? here.reduce((s, z) => s + (z.quantity ?? 0), 0) : null
  const day = formatDay(a.performed_on, today)
  const rel = relativeDay(a.performed_on, today)
  return (
    <li style={{ '--c': ENTRY_COLOR[a.type] } as CSSProperties}>
      <Link className="timeline__item" to={`/zones/${here[0]!.zone_id}#entry-${a.id}`}>
        <span className="timeline__title">
          <span aria-hidden="true">{ACTIVITY[a.type].icon}</span> {ACTIVITY[a.type].label}
          {total !== null && unit && ` · ${formatNumber(total)} ${UNIT_LABEL[unit]}`}
        </span>
        <span className="timeline__meta">
          {day}
          {rel !== day && ` (${rel})`} · {zonesPhrase(here.map((z) => zoneName(zoneById.get(z.zone_id)!)))}
        </span>
        {a.notes && <span className="timeline__notes">{a.notes}</span>}
      </Link>
    </li>
  )
}
