import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import { DELETED_ON_PHONE, SAVED_ON_PHONE } from '../api/outbox'
import { zoneName, type Plot, type Zone } from '../api/plots'
import { isOpen, TASK_KIND, tasks as tasksApi, type Task, type TaskKind, type TaskStatus } from '../api/tasks'
import { addDays } from '../domain/dates'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { newId } from '../lib/uuid'

/** "zone:<id>" or "plot:<id>" — one select for "where". */
type Where = `zone:${string}` | `plot:${string}` | ''

const KIND_ORDER: TaskKind[] = ['sow', 'plant', 'water', 'fertilize', 'add_nests', 'improve_path', 'other']

/** Add or edit a task. On a zone/plot page `fixedWhere` preselects (and hides) the place. */
export function TaskForm({
  task,
  plots,
  zones,
  today,
  fixedWhere,
  onDone,
  onCancel,
  onReload,
}: {
  task?: Task
  plots: Plot[]
  zones: Zone[]
  today: string
  fixedWhere?: Where
  onDone: (message: string) => void
  onCancel: () => void
  /** after a version conflict: fetch the latest copy and start the form again from it */
  onReload?: () => void
}) {
  const save = tasksApi.useSave()
  const del = tasksApi.useDelete()
  const saveState = useOutboxWrite(save)
  const delState = useOutboxWrite(del)
  const initialWhere: Where = task ? (task.zone_id ? `zone:${task.zone_id}` : `plot:${task.plot_id}`) : (fixedWhere ?? '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [where, setWhere] = useState<Where>(initialWhere)
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'other')
  const [due, setDue] = useState(task?.due_on ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'open')
  const [description, setDescription] = useState(task?.description ?? '')
  const [confirming, setConfirming] = useState(false)
  // the version this edit started from — fixed, so a change made elsewhere meanwhile is caught
  const [baseVersion] = useState(task?.version ?? null)
  const [localError, setLocalError] = useState<{ field: 'title' | 'where'; text: string } | null>(null)
  const firstInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const ids = { title: useId(), where: useId(), due: useId(), desc: useId(), err: useId(), head: useId() }

  // Adding: cursor in the title. Editing: bring the form into view (it opens above the list).
  useEffect(() => {
    if (!task) firstInput.current?.focus()
    else {
      heading.current?.scrollIntoView?.({ block: 'start' })
      heading.current?.focus()
    }
    // only when the form opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (saveState.waiting) onDone(SAVED_ON_PHONE)
    else if (delState.waiting) onDone(DELETED_ON_PHONE)
  }, [saveState.waiting, delState.waiting, onDone])

  const busy = saveState.busy || delState.busy
  const serverError = save.error ?? del.error
  const code = serverError instanceof ApiError ? serverError.code : null
  // deleted (with its zone/plot) on another phone: nothing left to edit
  useEffect(() => {
    if (code === 'deleted') onDone('This task was deleted in the meantime.')
  }, [code, onDone])
  const error = localError?.text ?? (serverError ? friendlyError(serverError) : '')
  const serverField = serverError instanceof ApiError ? serverError.field : null
  const blamed = localError?.field ?? (serverField === 'zone_id' || serverField === 'plot_id' ? 'where' : serverField)
  const describedBy = (f: string) => (error && blamed === f ? ids.err : undefined)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const t = title.trim()
    if (!t) {
      setLocalError({ field: 'title', text: 'Write what needs doing.' })
      return firstInput.current?.focus()
    }
    if (!where || !whereKnown) return setLocalError({ field: 'where', text: 'Choose the zone or plot.' })
    setLocalError(null)
    const [type, id] = where.split(':') as ['zone' | 'plot', string]
    save.mutate(
      {
        id: task?.id ?? newId(),
        input: {
          zone_id: type === 'zone' ? id : null,
          plot_id: type === 'plot' ? id : null,
          title: t,
          description: description.trim() || null,
          kind,
          status,
          due_on: due || null,
          // reopened: no longer resolved by the entry that closed it
          resolved_by_activity_id: isOpen({ status }) ? null : (task?.resolved_by_activity_id ?? null),
          base_version: baseVersion,
        },
      },
      { onSuccess: () => onDone(task ? `Saved “${t}”.` : `Added “${t}”.`) },
    )
  }

  const plotName = new Map(plots.map((p) => [p.id, p.name]))
  const whereKnown =
    fixedWhere !== undefined ||
    plots.some((p) => where === `plot:${p.id}`) ||
    zones.some((z) => where === `zone:${z.id}`)
  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.head}>
      <h2 id={ids.head} ref={heading} tabIndex={-1}>
        {task ? 'Edit task' : 'New task'}
      </h2>
      <label htmlFor={ids.title}>What needs doing?</label>
      <input
        id={ids.title}
        ref={firstInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Falta semear"
        maxLength={200}
        aria-invalid={blamed === 'title' || undefined}
        aria-describedby={describedBy('title')}
      />

      {!fixedWhere && (
        <>
          <label htmlFor={ids.where}>Where</label>
          <select
            id={ids.where}
            value={where}
            onChange={(e) => setWhere(e.target.value as Where)}
            aria-invalid={blamed === 'where' || undefined}
            aria-describedby={describedBy('where')}
          >
            <option value="">Choose a zone or plot…</option>
            {where && !whereKnown && (
              <option value={where} disabled>
                (a deleted zone or plot — choose another)
              </option>
            )}
            {plots.map((p) => (
              <optgroup key={p.id} label={p.name}>
                <option value={`plot:${p.id}`}>The whole of {p.name}</option>
                {zones
                  .filter((z) => z.plot_id === p.id)
                  .map((z) => (
                    <option key={z.id} value={`zone:${z.id}`}>
                      {zoneName(z)} ({plotName.get(z.plot_id)})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </>
      )}

      <fieldset className="chips-field">
        <legend>Kind</legend>
        <div className="row">
          {KIND_ORDER.map((k) => (
            <button key={k} type="button" className={`chip${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              <span aria-hidden="true">{TASK_KIND[k].icon}</span> {TASK_KIND[k].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="chips-field">
        <legend>Due</legend>
        <div className="row">
          {[
            ['', 'No date'],
            [addDays(today, 7), 'In a week'],
            [addDays(today, 30), 'In a month'],
          ].map(([value, label]) => (
            <button key={label} type="button" className={`chip${due === value ? ' is-on' : ''}`} aria-pressed={due === value} onClick={() => setDue(value!)}>
              {label}
            </button>
          ))}
          <label className="visually-hidden" htmlFor={ids.due}>
            Due date
          </label>
          <input id={ids.due} type="date" className="log__date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </fieldset>

      {task && (
        <fieldset className="chips-field">
          <legend>Status</legend>
          <div className="row">
            {(
              [
                ['open', 'Open'],
                ['in_progress', 'In progress'],
                ['done', 'Done'],
                ['cancelled', 'Cancelled'],
              ] as [TaskStatus, string][]
            ).map(([value, label]) => (
              <button key={value} type="button" className={`chip${status === value ? ' is-on' : ''}`} aria-pressed={status === value} onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label htmlFor={ids.desc}>
        Details <span className="muted">(optional)</span>
      </label>
      <textarea id={ids.desc} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />

      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}{' '}
          {code === 'version_conflict' && onReload && (
            <button type="button" className="btn btn-small" onClick={onReload}>
              Load latest
            </button>
          )}
        </p>
      )}
      {confirming && task ? (
        <fieldset className="confirm">
          <legend className="visually-hidden">Confirm delete</legend>
          <p>Delete “{task.title}”? Mark it done or cancelled instead to keep a record.</p>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                // the task leaves the list at once: close now (a refusal shows in the sync bar)
                del.mutate(task.id)
                onDone(`Deleted “${task.title}”.`)
              }}
            >
              Delete
            </button>
            <button ref={keepButton} type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="row form__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {saveState.busy ? 'Saving…' : task ? 'Save' : 'Add task'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span className="spacer" />
          {task && (
            <button
              type="button"
              className="btn btn-link-danger"
              onClick={() => {
                setConfirming(true)
                requestAnimationFrame(() => keepButton.current?.focus())
              }}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  )
}
