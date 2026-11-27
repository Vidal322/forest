import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import { SAVED_ON_PHONE } from '../api/outbox'
import { useDeleteSpecies, useSaveSpecies, useSpeciesList, type Species } from '../api/species'
import { useSpeciesStats, type SpeciesStats } from '../api/stats'
import { Flash } from '../components/Flash'
import { formatDay } from '../domain/dates'
import { useFlash } from '../hooks/useFlash'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { newId } from '../lib/uuid'

type Editing = { mode: 'add' } | { mode: 'edit'; species: Species } | null


/** The species catalogue: picked later when logging a planting or a sowing. */
export function SpeciesPage() {
  const list = useSpeciesList()
  const stats = useSpeciesStats()
  const statsById = useMemo(() => new Map((stats.data ?? []).map((st) => [st.species_id, st])), [stats.data])
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
          Espécies
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
            ＋ Acrescentar espécie
          </button>
        )}
      </div>
      <p className="muted">Escolhes estas espécies quando registas uma plantação ou uma sementeira.</p>

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
        <p className="note">Sem rede. A lista de espécies aparece assim que houver rede.</p>
      )}
      {list.isPending && !offlineNoData && <p className="muted">A carregar as espécies…</p>}
      {list.isError && (
        <div className="note warn" role="alert">
          {friendlyError(list.error)}{' '}
          <button type="button" className="btn" onClick={() => void list.refetch()}>
            Tentar outra vez
          </button>
        </div>
      )}

      {list.data && list.data.length === 0 && editing === null && (
        <div className="empty">
          <p>Ainda não há espécies.</p>
          <p className="muted">Acrescenta as árvores e as sementes que usas, por exemplo “Quercus suber”, sobreiro.</p>
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <>
          <label className="search">
            <span className="visually-hidden">Procurar espécies</span>
            <input
              type="search"
              placeholder="🔍 Procurar espécies"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {shown.length === 0 ? (
            <p className="muted">Nenhuma espécie corresponde a “{query}”.</p>
          ) : (
            <ul className="list" aria-label="Espécies">
              {shown.map((s) => (
                <li key={s.id}>
                  <button
                    id={`species-${s.id}`}
                    type="button"
                    className="list__item"
                    // one form at a time, so a half-typed edit is never thrown away
                    disabled={editing !== null}
                    onClick={() => open({ mode: 'edit', species: s }, `species-${s.id}`)}
                    aria-label={`Editar ${s.scientific_name}`}
                    aria-describedby={stats.data ? `species-usage-${s.id}` : undefined}
                  >
                    <span className="list__title">
                      <i>{s.scientific_name}</i>
                    </span>
                    {s.common_name && <span className="list__sub">{s.common_name}</span>}
                    {stats.data && <span id={`species-usage-${s.id}`} className="list__sub species-usage">{usage(statsById.get(s.id))}</span>}
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "2 zonas · 120 árvores vivas · semeada a 28 set · plantada a 3 out", or "Ainda não foi usada". */
function usage(st: SpeciesStats | undefined): string {
  if (!st || (st.zone_count === 0 && st.alive_tree_count === 0 && !st.last_sown_on && !st.last_planted_on)) return 'Ainda não foi usada'
  const parts = [plural(st.zone_count, 'zona', 'zonas'), plural(st.alive_tree_count, 'árvore viva', 'árvores vivas')]
  if (st.last_sown_on) parts.push(`semeada a ${formatDay(st.last_sown_on)}`)
  if (st.last_planted_on) parts.push(`plantada a ${formatDay(st.last_planted_on)}`)
  return parts.join(' · ')
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
  const save = useSaveSpecies()
  const del = useDeleteSpecies()
  const saveState = useOutboxWrite(save)
  const delState = useOutboxWrite(del)
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

  // The change couldn't reach the server: it's kept on the phone and sent later, so we're done here.
  const queued = saveState.waiting || delState.waiting
  useEffect(() => {
    if (queued) onDone(SAVED_ON_PHONE)
  }, [queued, onDone])

  const serverError = save.error ?? del.error
  // Deleted elsewhere: nothing left to edit.
  useEffect(() => {
    if (serverError instanceof ApiError && serverError.code === 'deleted') onDone(friendlyError(serverError))
  }, [serverError, onDone])

  const fieldError = serverError instanceof ApiError ? serverError.field : null
  const errorText = localError || (serverError ? friendlyError(serverError) : '')
  const busy = saveState.busy || delState.busy

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const name = scientific.trim()
    if (!name) {
      setLocalError('Escreve o nome científico.')
      firstInput.current?.focus()
      return
    }
    setLocalError('')
    save.mutate(
      {
        id: species?.id ?? newId(),
        input: { scientific_name: name, common_name: common.trim() || null, notes: notes.trim() || null },
      },
      { onSuccess: () => onDone(species ? `Espécie guardada: ${name}.` : `Espécie acrescentada: ${name}.`) },
    )
  }

  const remove = () => {
    if (!species || busy) return
    del.mutate(species.id, { onSuccess: () => onDone(`Espécie apagada: ${species.scientific_name}.`) })
  }

  const describedBy = (field: string) => (errorText && (fieldError === field || (localError && field === 'scientific_name')) ? ids.err : undefined)

  return (
    <form className="card form" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h2 id={ids.title}>{species ? 'Editar espécie' : 'Acrescentar espécie'}</h2>

      <label htmlFor={ids.sci}>Nome científico</label>
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
        Nome comum <span className="muted">(opcional)</span>
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
        Notas <span className="muted">(opcional)</span>
      </label>
      <textarea
        id={ids.notes}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="por exemplo, gosta de solo húmido"
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
          <legend className="visually-hidden">Confirmar que apagas</legend>
          <p>
            Apagar <i>{species?.scientific_name}</i>? As plantações e as sementeiras que já registaste continuam com ela.
          </p>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              {delState.busy ? 'A apagar…' : 'Apagar'}
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
              Não apagar
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="row form__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {saveState.busy ? 'A guardar…' : species ? 'Guardar' : 'Acrescentar'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancelar
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
              Apagar
            </button>
          )}
        </div>
      )}
    </form>
  )
}
