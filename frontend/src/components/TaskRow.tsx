import { Link } from 'react-router'
import { ACTIVITY } from '../api/activities'
import { dueLabel, isOpen, TASK_KIND, type ResolvedLink, type Task } from '../api/tasks'
import { fieldToday, whenDay } from '../domain/dates'
import type { Toast } from '../hooks/useTaskToggle'
import { Icon } from './Icon'

/** The short message with an optional Undo, shown above the lists. */
export function ToastLine({ toast, onUndo }: { toast: Toast | null; onUndo: () => void }) {
  return (
    <output className="flash" aria-live="polite">
      {toast && (
        <span key={toast.n}>
          {toast.text}{' '}
          {toast.undo && (
            <button type="button" className="btn-link" onClick={onUndo}>
              Anular
            </button>
          )}
        </span>
      )}
    </output>
  )
}

/** One task: a big tick button (done / reopen) and the rest of the row opens the editor (when there is one). */
export function TaskRow({
  task,
  place,
  today,
  resolvedBy,
  onEdit,
  onToggle,
}: {
  task: Task
  place?: string
  today: string
  /** the log entry that closed it, if any (see `resolvedLink`) */
  resolvedBy?: ResolvedLink
  /** without it the row only shows the task (e.g. on the map) */
  onEdit?: () => void
  onToggle: () => void
}) {
  const open = isOpen(task)
  const overdue = open && task.due_on !== null && task.due_on < today
  const closedOn = task.completed_at ? whenDay(fieldToday(new Date(task.completed_at)), today) : null
  const content = (
    <>
      <span className="task__title">
        {onEdit && <span className="visually-hidden">Editar: </span>}
        <Icon name={TASK_KIND[task.kind].icon} /> {task.title}
      </span>
      <span className="task__meta">
        {[
          place,
          open && task.due_on ? dueLabel(task.due_on, today) : null,
          task.status === 'in_progress' ? 'em curso' : null,
          task.status === 'done' && closedOn ? `feita ${closedOn}` : null,
          task.status === 'cancelled' ? 'cancelada' : null,
        ]
          .filter(Boolean)
          .join(', ')}
      </span>
    </>
  )
  return (
    <li className={`task${open ? '' : ' task--closed'}${overdue ? ' task--overdue' : ''}`}>
      <button type="button" className="task__tick" aria-pressed={!open} aria-label={`Feita: ${task.title}`} onClick={onToggle}>
        <span className="task__tick-circle" aria-hidden="true">
          {!open && <Icon name="check" size={18} />}
        </span>
      </button>
      <div className="task__main">
        {onEdit ? (
          <button id={`task-${task.id}`} type="button" className="task__body" onClick={onEdit}>
            {content}
          </button>
        ) : (
          <div className="task__body task__body--static">{content}</div>
        )}
        {resolvedBy && (
          <Link className="task__link" to={resolvedBy.to}>
            <span className="visually-hidden">Feita com o registo:</span> <Icon name={ACTIVITY[resolvedBy.type].icon} size={18} />{' '}
            {resolvedBy.label}
            <Icon name="next" size={16} />
          </Link>
        )}
      </div>
    </li>
  )
}
