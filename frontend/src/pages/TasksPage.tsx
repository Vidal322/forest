import { useCallback, useMemo, useRef, useState } from 'react'
import { friendlyError } from '../api/errors'
import { plots as plotsApi, zones as zonesApi } from '../api/plots'
import { isOpen, taskPlace, tasks as tasksApi, type Task } from '../api/tasks'
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
  const today = useFieldToday()
  const [editing, setEditing] = useState<Editing>(null)
  const [formKey, setFormKey] = useState(0)
  const [showClosed, setShowClosed] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const returnFocus = useRef<string | null>(null)
  const showToast = useCallback((t: Omit<Toast, 'n'>) => setToast((old) => ({ ...t, n: (old?.n ?? 0) + 1 })), [])
  const { toggle, pinned } = useTaskToggle(showToast)

  const all = useMemo(() => list.data ?? [], [list.data])
  const groups = useMemo(() => {
    // a task ticked here keeps its place (struck through) until the page is left
    const open = all.filter((t) => isOpen(t) || pinned.has(t.id))
    const days = (t: Task) => (t.due_on ? daysBetween(today, t.due_on) : null)
    return [
      { key: 'overdue', title: 'Overdue', items: open.filter((t) => t.due_on !== null && days(t)! < 0) },
      { key: 'today', title: 'Today', items: open.filter((t) => days(t) === 0) },
      { key: 'week', title: 'Next 7 days', items: open.filter((t) => t.due_on !== null && days(t)! > 0 && days(t)! <= 7) },
      { key: 'later', title: 'Later', items: open.filter((t) => t.due_on !== null && days(t)! > 7) },
      { key: 'undated', title: 'No date', items: open.filter((t) => t.due_on === null) },
    ].filter((g) => g.items.length > 0)
  }, [all, today, pinned])
  const closed = all.filter((t) => !isOpen(t) && !pinned.has(t.id))

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

  const p = plots.data ?? []
  const z = zones.data ?? []
  const offline = list.isPending && list.fetchStatus === 'paused'
  const rowProps = (t: Task) => ({
    task: t,
    place: taskPlace(t, p, z),
    today,
    onEdit: () => edit(t),
    onToggle: () => toggle(t),
  })

  return (
    <div className="page">
      <div className="row">
        <h1>Tasks</h1>
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
            ＋ Add task
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
          list.data && <p className="note">This task was deleted in the meantime.</p>
        ))}

      {offline && <p className="note">No connection. Tasks will appear as soon as there is signal.</p>}
      {list.isPending && !offline && <p className="muted">Loading tasks…</p>}
      {list.isError && (
        <div className="note warn" role="alert">
          {friendlyError(list.error)}{' '}
          <button type="button" className="btn" onClick={() => void list.refetch()}>
            Try again
          </button>
        </div>
      )}
      {plots.data && p.length === 0 ? (
        <p className="muted">Draw a plot on the map first: tasks belong to a zone or a plot.</p>
      ) : (
        list.data &&
        groups.length === 0 &&
        editing === null && (
          <div className="empty">
            <p>Nothing to do. 🌿</p>
            <p className="muted">Add things like “Falta semear” or “Melhorar caminho” as tasks.</p>
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
            {showClosed ? 'Hide' : 'Show'} done and cancelled ({closed.length})
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
