import { Link } from 'react-router'
import { isOpen, TASK_KIND, type ResolvedLink, type Task } from '../api/tasks'
import { fieldToday, relativeDay } from '../domain/dates'
import type { Toast } from '../hooks/useTaskToggle'

/** The short message with an optional Undo, shown above the lists. */
export function ToastLine({ toast, onUndo }: { toast: Toast | null; onUndo: () => void }) {
  return (
    <output className="flash" aria-live="polite">
      {toast && (
        <span key={toast.n}>
          {toast.text}{' '}
          {toast.undo && (
            <button type="button" className="btn-link" onClick={onUndo}>
              Undo
            </button>
          )}
        </span>
      )}
    </output>
  )
}

/** One task: a big tick button (done / reopen) and the rest of the row opens the editor. */
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
  onEdit: () => void
  onToggle: () => void
}) {
  const open = isOpen(task)
  const overdue = open && task.due_on !== null && task.due_on < today
  const closedOn = task.completed_at ? relativeDay(fieldToday(new Date(task.completed_at)), today) : null
  return (
    <li className={`task${open ? '' : ' task--closed'}${overdue ? ' task--overdue' : ''}`}>
      <button type="button" className="task__tick" aria-pressed={!open} aria-label={`Done: ${task.title}`} onClick={onToggle}>
        <span className="task__tick-circle" aria-hidden="true">
          {open ? '' : '✓'}
        </span>
      </button>
      <div className="task__main">
        <button id={`task-${task.id}`} type="button" className="task__body" onClick={onEdit}>
          <span className="task__title">
            <span className="visually-hidden">Edit: </span>
            <span aria-hidden="true">{TASK_KIND[task.kind].icon}</span> {task.title}
          </span>
          <span className="task__meta">
            {[
              place,
              open && task.due_on ? `due ${relativeDay(task.due_on, today)}` : null,
              task.status === 'in_progress' ? 'in progress' : null,
              task.status === 'done' && closedOn ? `done ${closedOn}` : null,
              task.status === 'cancelled' ? 'cancelled' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </button>
        {resolvedBy && (
          <Link className="task__link" to={resolvedBy.to}>
            <span className="visually-hidden">Done by the log entry:</span> {resolvedBy.label} →
          </Link>
        )}
      </div>
    </li>
  )
}
