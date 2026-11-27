import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activities as activitiesApi } from '../api/activities'
import { friendlyError } from '../api/errors'
import { plots as plotsApi, zones as zonesApi } from '../api/plots'
import { isOpen, resolvedLink, taskPlace, taskPlotId, tasks as tasksApi, type Task } from '../api/tasks'
import { useRemembered } from '../app/remembered'
import { TaskForm } from '../components/TaskForm'
import { TaskRow, ToastLine } from '../components/TaskRow'
import { daysBetween } from '../domain/dates'
import { useFieldToday } from '../hooks/useFieldToday'
import { useTaskToggle, type Toast } from '../hooks/useTaskToggle'

type Editing = { mode: 'add' } | { mode: 'edit'; id: string } | null
/** Open tasks grouped by urgency, with one tap to tick them done; closed ones below. */
export function TasksPage() {
  const list = tasksApi.useList()
  const plots = plotsApi.useList()
  const zones = zonesApi.useList()
  const entries = activitiesApi.useList()
  const today = useFieldToday()
  const [editing, setEditing] = useState<Editing>(null)
  const [formKey, setFormKey] = useState(0)
  const [showClosed, setShowClosed] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const returnFocus = useRef<string | null>(null)
  const showToast = useCallback((t: Omit<Toast, 'n'>) => setToast((old) => ({ ...t, n: (old?.n ?? 0) + 1 })), [])
  const { toggle, pinned } = useTaskToggle(showToast)
  const [plotChoice, setPlotChoice] = useRemembered<string | null>('tasks.plot', null)

  const p = useMemo(() => plots.data ?? [], [plots.data])
  const z = useMemo(() => zones.data ?? [], [zones.data])
  const all = useMemo(() => list.data ?? [], [list.data])
  // filtering only makes sense with two plots or more; a deleted plot falls back to all
  const plotFilter = p.length > 1 && p.some((x) => x.id === plotChoice) ? plotChoice : null
  const filterName = p.find((x) => x.id === plotFilter)?.name
  // a plot chosen earlier may sit past the edge of the chip row: bring it into view (sideways only)
  const chipRow = useRef<HTMLDivElement>(null)
  const chipsShown = p.length > 1
  useEffect(() => {
    const row = chipRow.current
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !on) return
    const past = on.getBoundingClientRect().right - row.getBoundingClientRect().right
    if (past > 0) row.scrollLeft += past + 16
    // only when the chips first appear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipsShown])
  // open tasks per plot (zone tasks count under their plot), for the chips
  const openByPlot = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of all) {
      const id = isOpen(t) ? taskPlotId(t, z) : undefined
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [all, z])
  const openTotal = all.filter(isOpen).length
  const shown = useMemo(
    () => (plotFilter === null ? all : all.filter((t) => taskPlotId(t, z) === plotFilter)),
    [all, z, plotFilter],
  )
  const groups = useMemo(() => {
    // a task ticked here keeps its place (struck through) until the page is left
    const open = shown.filter((t) => isOpen(t) || pinned.has(t.id))
    const days = (t: Task) => (t.due_on ? daysBetween(today, t.due_on) : null)
    return [
      { key: 'overdue', title: 'Atrasadas', items: open.filter((t) => t.due_on !== null && days(t)! < 0) },
      { key: 'today', title: 'Hoje', items: open.filter((t) => days(t) === 0) },
      { key: 'week', title: 'Próximos 7 dias', items: open.filter((t) => t.due_on !== null && days(t)! > 0 && days(t)! <= 7) },
      { key: 'later', title: 'Mais tarde', items: open.filter((t) => t.due_on !== null && days(t)! > 7) },
      { key: 'undated', title: 'Sem prazo', items: open.filter((t) => t.due_on === null) },
    ].filter((g) => g.items.length > 0)
  }, [shown, today, pinned])
  const closed = shown.filter((t) => !isOpen(t) && !pinned.has(t.id))
  const elsewhere = plotFilter === null ? 0 : openTotal - (openByPlot.get(plotFilter) ?? 0)

  const editingTask = editing?.mode === 'edit' ? all.find((t) => t.id === editing.id) : undefined
  const close = useCallback((message?: string) => {
    setEditing(null)
    if (message) setToast((old) => ({ text: message, n: (old?.n ?? 0) + 1 }))
    requestAnimationFrame(() => {
      const el = returnFocus.current ? document.getElementById(returnFocus.current) : null
      ;(el ?? document.getElementById('tasks-add'))?.focus()
    })
  }, [])
  const edit = (t: Task) => {
    returnFocus.current = `task-${t.id}`
    setEditing({ mode: 'edit', id: t.id })
  }

  const offline = list.isPending && list.fetchStatus === 'paused'
  const rowProps = (t: Task) => ({
    task: t,
    place: taskPlace(t, p, z),
    today,
    resolvedBy: resolvedLink(t, entries.data ?? [], z, today),
    onEdit: () => edit(t),
    onToggle: () => toggle(t),
  })

  return (
    <div className="page">
      <div className="row">
        <h1>Tarefas</h1>
        <span className="spacer" />
        {editing === null && (
          <button
            id="tasks-add"
            type="button"
            className="btn btn-primary"
            disabled={p.length === 0}
            onClick={() => {
              returnFocus.current = 'tasks-add'
              setEditing({ mode: 'add' })
            }}
          >
            ＋ Acrescentar tarefa
          </button>
        )}
      </div>

      <ToastLine
        toast={toast}
        onUndo={() => {
          toast?.undo?.()
          setToast(null)
        }}
      />

      {chipsShown && (
        <fieldset className="tasks__filter">
          <legend className="visually-hidden">Mostrar as tarefas de</legend>
          <div ref={chipRow} className="row tasks__plots">
            <button type="button" className={`chip${plotFilter === null ? ' is-on' : ''}`} aria-pressed={plotFilter === null} onClick={() => setPlotChoice(null)}>
              Todas as parcelas ({openTotal})
            </button>
            {p.map((x) => (
              <button
                key={x.id}
                type="button"
                className={`chip${plotFilter === x.id ? ' is-on' : ''}`}
                aria-pressed={plotFilter === x.id}
                onClick={() => setPlotChoice(x.id)}
              >
                {x.name} ({openByPlot.get(x.id) ?? 0})
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {editing?.mode === 'add' && <TaskForm key="new" plots={p} zones={z} today={today} onDone={close} onCancel={() => close()} />}
      {editing?.mode === 'edit' &&
        (editingTask ? (
          <TaskForm
            key={`${editingTask.id}:${formKey}`}
            task={editingTask}
            plots={p}
            zones={z}
            today={today}
            onDone={close}
            onCancel={() => close()}
            onReload={() => void list.refetch().then(() => setFormKey((k) => k + 1))}
          />
        ) : (
          list.data && <p className="note">Esta tarefa foi apagada entretanto.</p>
        ))}

      {offline && <p className="note">Sem rede. As tarefas aparecem assim que houver rede.</p>}
      {list.isPending && !offline && <p className="muted">A carregar as tarefas…</p>}
      {list.isError && (
        <div className="note warn" role="alert">
          {friendlyError(list.error)}{' '}
          <button type="button" className="btn" onClick={() => void list.refetch()}>
            Tentar outra vez
          </button>
        </div>
      )}
      {plots.data && p.length === 0 ? (
        <p className="muted">Desenha primeiro uma parcela no mapa: as tarefas pertencem a uma zona ou a uma parcela.</p>
      ) : (
        list.data &&
        groups.length === 0 &&
        editing === null && (
          <div className="empty">
            <p>Nada por fazer{filterName ? ` em ${filterName}` : ''}. 🌿</p>
            {elsewhere > 0 ? (
              <>
                <p className="muted">
                  {elsewhere === 1 ? '1 tarefa por fazer noutra parcela.' : `${elsewhere} tarefas por fazer noutras parcelas.`}
                </p>
                <button type="button" className="btn" onClick={() => setPlotChoice(null)}>
                  Mostrar todas as parcelas
                </button>
              </>
            ) : (
              <p className="muted">Acrescenta como tarefas coisas como “Falta semear” ou “Melhorar caminho”.</p>
            )}
          </div>
        )
      )}

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`tasks-${g.key}`}>
          <h2 id={`tasks-${g.key}`} className={`tasks__group tasks__group--${g.key}`}>
            {g.title} <span className="muted">({g.items.length})</span>
          </h2>
          <ul className="list">
            {g.items.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
          </ul>
        </section>
      ))}

      {closed.length > 0 && (
        <section>
          <button type="button" className="btn-link" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Esconder' : 'Mostrar'} as feitas e as canceladas ({closed.length})
          </button>
          {showClosed && (
            <ul className="list">
              {closed.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
