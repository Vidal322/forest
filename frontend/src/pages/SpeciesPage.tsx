import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import { Handoff, isWaiting } from '../api/outbox'
import { useDeleteSpecies, useSaveSpecies, useSpeciesList, type Species } from '../api/species'
import { Flash } from '../components/Flash'
import { useFlash } from '../hooks/useFlash'
import { newId } from '../lib/uuid'

type Editing = { mode: 'add' } | { mode: 'edit'; species: Species } | null

/** Said when a change could not reach the server yet: it is kept and sent later. */
export const SAVED_ON_PHONE = 'Saved on this phone. It will be sent when there is a connection.'

/** The species catalogue: picked later when logging a planting or a sowing. */
export function SpeciesPage() {
  const list = useSpeciesList()
  const [editing, setEditing] = useState<Editing>(null)
  const [query, setQuery] = useState('')
  const flash = useFlash()
  const addButton = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // where focus goes back to when the form closes (the button that opened it)
  const returnFocusTo = useRef<string | null>(null)

  const shown = useMemo(() => {
    const q = normalize(query)
    const all = list.data ?? []
    return q ? all.filter((s) => normalize(`${s.scientific_name} ${s.common_name ?? ''}`).includes(q)) : all
  }, [list.data, query])

  const open = (next: Exclude<Editing, null>, returnTo: string) => {
    clearFlash()
    returnFocusTo.current = returnTo
    setEditing(next)
  }

  const { show: showFlash, clear: clearFlash } = flash
  const close = useCallback(
    (message?: string) => {
      setEditing(null)
      if (message) showFlash(message)
      // after the re-render: the opener may be back (Add button) or still in the list
      requestAnimationFrame(() => {
        const target = returnFocusTo.current ? document.getElementById(returnFocusTo.current) : null
        ;(target ?? addButton.current ?? heading.current)?.focus()
      })
    },
    [showFlash],
  )

  const offlineNoData = list.isPending && list.fetchStatus === 'paused'

  return (
    <div className="page">
      <div className="row">
        <h1 ref={heading} tabIndex={-1}>
          Species
        </h1>
        <span className="spacer" />
        {editing === null && (
          <button
            ref={addButton}
            id="species-add"
            type="button"
            className="btn btn-primary"
            onClick={() => open({ mode: 'add' }, 'species-add')}
          >
            ＋ Add species
          </button>
        )}
      </div>
      <p className="muted">Picked when you log a planting or a sowing.</p>

      <Flash flash={flash} />

      {editing !== null && (
        <SpeciesForm
          key={editing.mode === 'edit' ? editing.species.id : 'new'}
          species={editing.mode === 'edit' ? editing.species : undefined}
          onDone={close}
          onCancel={() => close()}
        />
      )}

      {offlineNoData && (
        <p className="note">No connection. The species list will appear as soon as there is signal.</p>
      )}
      {list.isPending && !offlineNoData && <p className="muted">Loading species…</p>}
      {list.isError && (
        <div className="note warn" role="alert">
          {friendlyError(list.error)}{' '}
          <button type="button" className="btn" onClick={() => void list.refetch()}>
            Try again
          </button>
        </div>
      )}

      {list.data && list.data.length === 0 && editing === null && (
        <div className="empty">
          <p>No species yet.</p>
          <p className="muted">Add the trees and seeds you use, e.g. “Quercus suber — sobreiro”.</p>
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <>
          <label className="search">
            <span className="visually-hidden">Search species</span>
            <input
              type="search"
              placeholder="🔍 Search species"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {shown.length === 0 ? (
            <p className="muted">No species match “{query}”.</p>
          ) : (
            <ul className="list" aria-label="Species">
              {shown.map((s) => (
                <li key={s.id}>
                  <button
                    id={`species-${s.id}`}
                    type="button"
                    className="list__item"
                    // one form at a time, so a half-typed edit is never thrown away
                    disabled={editing !== null}
                    onClick={() => open({ mode: 'edit', species: s }, `species-${s.id}`)}
                    aria-label={`Edit ${s.scientific_name}`}
                  >
                    <span className="list__title">
                      <i>{s.scientific_name}</i>
                    </span>
                    {s.common_name && <span className="list__sub">{s.common_name}</span>}
                    {s.notes && <span className="list__sub muted">{s.notes}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** Lower-case, no accents: "Castanheiro" matches "castanhéiro". */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

function SpeciesForm({
  species,
  onDone,
  onCancel,
}: {
  species?: Species
  onDone: (message: string) => void
  onCancel: () => void
}) {
  // While this form is open it shows the result of its own writes; see SyncStatus.
  const [handoff] = useState(() => new Handoff())
  const save = useSaveSpecies(handoff)
  const del = useDeleteSpecies(handoff)
  const [scientific, setScientific] = useState(species?.scientific_name ?? '')
  const [common, setCommon] = useState(species?.common_name ?? '')
  const [notes, setNotes] = useState(species?.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [localError, setLocalError] = useState('')
  const ids = { sci: useId(), common: useId(), notes: useId(), err: useId(), title: useId() }
  const firstInput = useRef<HTMLInputElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)

  // Adding: put the cursor where you'll type. Editing: don't pop the keyboard up,
  // you may only want to read or delete.
  useEffect(() => {
    if (!species) firstInput.current?.focus()
    firstInput.current?.form?.scrollIntoView?.({ block: 'nearest' })
  }, [species])

  // The change couldn't reach the server: it's queued on the phone, so we're done here.
  const saveWaiting = save.isPending && isWaiting(save)
  const delWaiting = del.isPending && isWaiting(del)
  useEffect(() => {
    if (saveWaiting || delWaiting) {
      handoff.release()
      onDone(SAVED_ON_PHONE)
    }
  }, [saveWaiting, delWaiting, onDone, handoff])
  // Leaving while a write is still on its way: the sync bar reports how it ends.
  const busyRef = useRef(false)
  const pending = save.isPending || del.isPending
  useEffect(() => {
    busyRef.current = pending
  }, [pending])
  useEffect(
    () => () => {
      if (busyRef.current) handoff.release()
    },
    [handoff],
  )

  const serverError = save.error ?? del.error
  // Deleted elsewhere: nothing left to edit.
  useEffect(() => {
    if (serverError instanceof ApiError && serverError.code === 'deleted') onDone(friendlyError(serverError))
  }, [serverError, onDone])

  const fieldError = serverError instanceof ApiError ? serverError.field : null
  const errorText = localError || (serverError ? friendlyError(serverError) : '')
  const busy = save.isPending || del.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const name = scientific.trim()
    if (!name) {
      setLocalError('Scientific name is required.')
      firstInput.current?.focus()
      return
    }
    setLocalError('')
    save.mutate(
      {
        id: species?.id ?? newId(),
        input: { scientific_name: name, common_name: common.trim() || null, notes: notes.trim() || null },
      },
      { onSuccess: () => onDone(species ? `Saved ${name}.` : `Added ${name}.`) },
    )
  }

  const remove = () => {
    if (!species || busy) return
    del.mutate(species.id, { onSuccess: () => onDone(`Deleted ${species.scientific_name}.`) })
  }

  const describedBy = (field: string) => (errorText && (fieldError === field || (localError && field === 'scientific_name')) ? ids.err : undefined)

  return (
    <form className="card form" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h2 id={ids.title}>{species ? 'Edit species' : 'Add species'}</h2>

      <label htmlFor={ids.sci}>Scientific name</label>
      <input
        id={ids.sci}
        ref={firstInput}
        value={scientific}
        onChange={(e) => setScientific(e.target.value)}
        placeholder="Quercus suber"
        maxLength={200}
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
        aria-required="true"
        aria-invalid={fieldError === 'scientific_name' || Boolean(localError) || undefined}
        aria-describedby={describedBy('scientific_name')}
      />

      <label htmlFor={ids.common}>
        Common name <span className="muted">(optional)</span>
      </label>
      <input
        id={ids.common}
        value={common}
        onChange={(e) => setCommon(e.target.value)}
        placeholder="sobreiro"
        maxLength={200}
        aria-invalid={fieldError === 'common_name' || undefined}
        aria-describedby={describedBy('common_name')}
      />

      <label htmlFor={ids.notes}>
        Notes <span className="muted">(optional)</span>
      </label>
      <textarea
        id={ids.notes}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="e.g. likes wet soil"
        maxLength={2000}
        aria-invalid={fieldError === 'notes' || undefined}
        aria-describedby={describedBy('notes')}
      />

      {errorText && (
        <p id={ids.err} className="form__error" role="alert">
          {errorText}
        </p>
      )}

      {confirmDelete ? (
        <fieldset className="confirm">
          <legend className="visually-hidden">Confirm delete</legend>
          <p>
            Delete <i>{species?.scientific_name}</i>? Past plantings and sowings keep it.
          </p>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              {del.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button
              ref={keepButton}
              type="button"
              className="btn"
              onClick={() => {
                setConfirmDelete(false)
                requestAnimationFrame(() => deleteButton.current?.focus())
              }}
              disabled={busy}
            >
              Keep it
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="row form__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {save.isPending ? 'Saving…' : species ? 'Save' : 'Add'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span className="spacer" />
          {species && (
            <button
              ref={deleteButton}
              type="button"
              className="btn btn-link-danger"
              onClick={() => {
                setConfirmDelete(true)
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
