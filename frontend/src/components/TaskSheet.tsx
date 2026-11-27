import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { zoneName, type Plot, type Zone } from '../api/plots'
import { isOpen, type Task } from '../api/tasks'
import { useTaskToggle, type Toast } from '../hooks/useTaskToggle'
import { spotKey } from '../map/taskSpots'
import { TaskRow, ToastLine } from './TaskRow'

/**
 * Bottom sheet for a task pin tapped on the map: the open tasks of that zone (or plot),
 * each with its big tick to mark it done. Ticked ones stay (struck through, can be
 * ticked again) until the sheet closes, so the next tap never lands on another task.
 */
export function TaskSheet({
  at,
  tasks,
  plots,
  zones,
  today,
  onClose,
}: {
  /** the pin's place: "zone:<id>" or "plot:<id>" */
  at: string
  tasks: Task[]
  plots: Plot[]
  zones: Zone[]
  today: string
  onClose: () => void
}) {
  const [toast, setToast] = useState<Toast | null>(null)
  const showToast = useCallback((t: Omit<Toast, 'n'>) => setToast((old) => ({ ...t, n: (old?.n ?? 0) + 1 })), [])
  const { toggle, pinned } = useTaskToggle(showToast)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [at])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const [kind, id] = at.split(':') as ['zone' | 'plot', string]
  const zone = kind === 'zone' ? zones.find((z) => z.id === id) : undefined
  const plot = plots.find((p) => p.id === (zone ? zone.plot_id : id))
  // rows keep the order they first had: a ticked task sorts after the open ones in the list,
  // but must not move under the thumb
  const [order, setOrder] = useState<string[]>([])
  const here = tasks.filter((t) => spotKey(t) === at && (isOpen(t) || pinned.has(t.id)))
  const added = here.filter((t) => !order.includes(t.id)).map((t) => t.id)
  const known = added.length > 0 ? [...order, ...added] : order
  // adjusting state during render (React's pattern for reacting to a changed input)
  if (added.length > 0) setOrder(known)
  const shown = here.sort((a, b) => known.indexOf(a.id) - known.indexOf(b.id))
  const name = zone ? zoneName(zone) : (plot?.name ?? 'Tarefas')

  return (
    <section className="sheet" aria-labelledby="task-sheet-title">
      <div className="row">
        <h2 id="task-sheet-title" ref={heading} tabIndex={-1}>
          {name}
        </h2>
        <span className="spacer" />
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>
      <p className="muted">{zone ? (plot ? `Tarefas desta zona · ${plot.name}` : 'Tarefas desta zona') : 'Tarefas da parcela inteira'}</p>
      <ToastLine
        toast={toast}
        onUndo={() => {
          toast?.undo?.()
          setToast(null)
        }}
      />
      {shown.length > 0 ? (
        <ul className="list">
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} today={today} onToggle={() => toggle(t)} />
          ))}
        </ul>
      ) : (
        <p className="muted">Já não há nada por fazer aqui. 🌿</p>
      )}
      <div className="row form__actions">
        {zone ? (
          <Link className="btn" to={`/zones/${zone.id}`}>
            Histórico e tarefas
          </Link>
        ) : (
          <Link className="btn" to="/tasks">
            Todas as tarefas
          </Link>
        )}
      </div>
    </section>
  )
}
