import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import { DELETED_ON_PHONE, SAVED_ON_PHONE } from '../api/outbox'
import { formatHa, plots as plotsApi, zoneName, zones as zonesApi, type Plot, type Zone, type ZoneKind } from '../api/plots'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { closeRing, ringArea } from '../map/geometry'
import { checkDraft, withCorners, type Draft } from '../map/draft'

/** The bottom panel while drawing: instructions, Undo/Cancel/Next, then the details form. */
export function ShapeEditor({
  draft,
  setDraft,
  plots,
  zones,
  metresPerUnit,
  onDone,
}: {
  draft: Draft
  setDraft: (d: Draft | null) => void
  plots: Plot[]
  zones: Zone[]
  metresPerUnit: number | null
  onDone: (message: string, selectZoneId?: string) => void
}) {
  const check = checkDraft(draft, plots, zones)
  const what = draft.kind === 'plot' ? 'plot' : 'zone'

  if (draft.step === 'details') {
    return draft.kind === 'plot' ? (
      <PlotDetails draft={draft} setDraft={setDraft} plots={plots} zones={zones} onDone={onDone} />
    ) : (
      <ZoneDetails draft={draft} setDraft={setDraft} plots={plots} plotId={check.plotId} onDone={onDone} />
    )
  }

  return (
    <section className="sheet sheet--compact" aria-labelledby="draw-title">
      <h2 id="draw-title">{draft.original ? `Edit the ${what}’s outline` : `Draw a ${what}`}</h2>
      <p className={check.ok ? 'muted' : 'draw-hint draw-hint--bad'} aria-live="polite">
        {check.message}
      </p>
      {draft.corners.length >= 3 && (
        <p className="muted small">
          {draft.corners.length} corners
          {metresPerUnit ? ` · ${formatHa((ringArea(draft.corners) * metresPerUnit ** 2) / 10_000)}` : ''}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={draft.history.length === 0}
          onClick={() =>
            setDraft({ ...draft, corners: draft.history[draft.history.length - 1] ?? [], history: draft.history.slice(0, -1) })
          }
        >
          ↶ Undo
        </button>
        <button type="button" className="btn" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {draft.selectedCorner !== null && draft.corners.length > 3 && (
          <button
            type="button"
            className="btn"
            onClick={() => setDraft(withCorners(draft, draft.corners.filter((_, i) => i !== draft.selectedCorner)))}
          >
            Remove corner
          </button>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!check.ok}
          onClick={() => setDraft({ ...draft, step: 'details' })}
        >
          Next
        </button>
      </div>
    </section>
  )
}

/** Shared save/delete plumbing for the two details forms. */
function useShapeWrite(
  save: Parameters<typeof useOutboxWrite>[0],
  del: Parameters<typeof useOutboxWrite>[0],
  onDone: (message: string) => void,
) {
  const saveState = useOutboxWrite(save)
  const delState = useOutboxWrite(del)
  useEffect(() => {
    if (saveState.waiting) onDone(SAVED_ON_PHONE)
    else if (delState.waiting) onDone(DELETED_ON_PHONE)
  }, [saveState.waiting, delState.waiting, onDone])
  return { busy: saveState.busy || delState.busy, error: save.error ?? del.error }
}

function DetailsShell({
  title,
  children,
  error,
  busy,
  onBack,
  deleteLabel,
  deleteQuestion,
  onDelete,
  onSubmit,
}: {
  title: string
  children: ReactNode
  error: string
  busy: boolean
  onBack: () => void
  deleteLabel?: string
  deleteQuestion?: string
  onDelete?: () => void
  onSubmit: (e: FormEvent) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const ids = { title: useId(), err: useId() }
  return (
    <form className="sheet" onSubmit={onSubmit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>{title}</h2>
      {children}
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      {confirming && onDelete ? (
        <fieldset className="confirm">
          <legend className="visually-hidden">Confirm delete</legend>
          <p>{deleteQuestion}</p>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>
              {deleteLabel}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="row form__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={onBack} disabled={busy}>
            ← Outline
          </button>
          <span className="spacer" />
          {onDelete && (
            <button type="button" className="btn btn-link-danger" onClick={() => setConfirming(true)} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  )
}

function nextPlotName(plots: Plot[]): string {
  const used = new Set(plots.map((p) => p.name.toLowerCase()))
  let n = plots.length + 1
  while (used.has(`plot ${n}`)) n++
  return `Plot ${n}`
}

function PlotDetails({
  draft,
  setDraft,
  plots,
  zones,
  onDone,
}: {
  draft: Draft
  setDraft: (d: Draft | null) => void
  plots: Plot[]
  zones: Zone[]
  onDone: (message: string) => void
}) {
  const original = draft.original as Plot | null
  const [name, setName] = useState(original?.name ?? nextPlotName(plots))
  const [declared, setDeclared] = useState(original?.declared_area_ha != null ? String(original.declared_area_ha) : '')
  const [notes, setNotes] = useState(original?.notes ?? '')
  const [localError, setLocalError] = useState('')
  const save = plotsApi.useSave()
  const del = plotsApi.useDelete()
  const { busy, error } = useShapeWrite(save, del, onDone)
  const ids = { name: useId(), ha: useId(), notes: useId() }
  const zoneCount = zones.filter((z) => z.plot_id === draft.id).length

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const ha = declared.trim() === '' ? null : Number(declared.replace(',', '.'))
    if (!name.trim()) return setLocalError('Give the plot a name.')
    const clash = plots.find((p) => p.id !== draft.id && p.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (clash) return setLocalError(`Another plot is already called “${clash.name}”.`)
    if (ha !== null && !(ha > 0 && ha < 100_000)) return setLocalError('The hectares on the old map must be a number above 0.')
    setLocalError('')
    const n = name.trim()
    save.mutate(
      {
        id: draft.id,
        input: { name: n, geom: { type: 'Polygon', coordinates: [closeRing(draft.corners)] }, declared_area_ha: ha, notes: notes.trim() || null },
      },
      { onSuccess: () => onDone(original ? `Saved ${n}.` : `Added ${n}.`) },
    )
  }

  const serverField = error instanceof ApiError ? error.field : null
  return (
    <DetailsShell
      title={original ? `Edit ${original.name}` : 'New plot'}
      error={localError || (error ? friendlyError(error) : '')}
      busy={busy}
      onBack={() => setDraft({ ...draft, step: 'shape' })}
      onSubmit={submit}
      deleteLabel="Delete plot"
      deleteQuestion={`Delete ${original?.name}${zoneCount ? ` and its ${zoneCount} zone${zoneCount === 1 ? '' : 's'}` : ''}? Their history is kept.`}
      onDelete={original ? () => del.mutate(draft.id, { onSuccess: () => onDone(`Deleted ${original.name}.`) }) : undefined}
    >
      <label htmlFor={ids.name}>Name</label>
      <input
        id={ids.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        aria-invalid={serverField === 'name' || localError.startsWith('Another plot') || undefined}
      />
      <label htmlFor={ids.ha}>
        Hectares on the old map <span className="muted">(optional)</span>
      </label>
      <input id={ids.ha} inputMode="decimal" value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder="6.2" />
      <label htmlFor={ids.notes}>
        Notes <span className="muted">(optional)</span>
      </label>
      <textarea id={ids.notes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
    </DetailsShell>
  )
}

const KINDS: { value: ZoneKind; label: string; hint: string }[] = [
  { value: 'cultivation', label: 'Planting', hint: 'sown, planted, watered' },
  { value: 'path', label: 'Path', hint: 'never needs water' },
  { value: 'other', label: 'Other', hint: 'rocks, a shed, …' },
]

function ZoneDetails({
  draft,
  setDraft,
  plots,
  plotId,
  onDone,
}: {
  draft: Draft
  setDraft: (d: Draft | null) => void
  plots: Plot[]
  plotId: string | undefined
  onDone: (message: string, selectZoneId?: string) => void
}) {
  const original = draft.original as Zone | null
  const [label, setLabel] = useState(original?.label ?? '')
  const [kind, setKind] = useState<ZoneKind>(original?.kind ?? 'cultivation')
  const [notes, setNotes] = useState(original?.notes ?? '')
  const save = zonesApi.useSave()
  const del = zonesApi.useDelete()
  const { busy, error } = useShapeWrite(save, del, onDone)
  const [localError, setLocalError] = useState('')
  const ids = { label: useId(), notes: useId(), kind: useId() }
  const plot = plots.find((p) => p.id === plotId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!plotId) return setLocalError('This zone is no longer inside a plot. Go back to the outline and fix it.')
    setLocalError('')
    const l = label.trim() || null
    save.mutate(
      {
        id: draft.id,
        input: { plot_id: plotId, label: l, kind, geom: { type: 'Polygon', coordinates: [closeRing(draft.corners)] }, notes: notes.trim() || null },
      },
      { onSuccess: () => onDone(original ? `Saved ${l ?? name}.` : `Added ${l ?? 'a zone'}.`, draft.id) },
    )
  }

  const name = original ? zoneName(original) : 'zone'
  return (
    <DetailsShell
      title={original ? `Edit ${name}` : `New zone${plot ? ` in ${plot.name}` : ''}`}
      error={localError || (error ? friendlyError(error) : '')}
      busy={busy}
      onBack={() => setDraft({ ...draft, step: 'shape' })}
      onSubmit={submit}
      deleteLabel="Delete zone"
      deleteQuestion={`Delete ${name}? What was logged there is kept.`}
      onDelete={original ? () => del.mutate(draft.id, { onSuccess: () => onDone(`Deleted ${name}.`) }) : undefined}
    >
      <label htmlFor={ids.label}>
        Name <span className="muted">(optional)</span>
      </label>
      <input id={ids.label} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="Ninhos de outubro" />
      <fieldset className="choice">
        <legend id={ids.kind}>What is it?</legend>
        {KINDS.map((k) => (
          <label key={k.value} className={`choice__opt${kind === k.value ? ' is-on' : ''}`}>
            <input type="radio" name="zone-kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
            <b>{k.label}</b>
            <span className="muted small">{k.hint}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={ids.notes}>
        Notes <span className="muted">(optional)</span>
      </label>
      <textarea id={ids.notes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
    </DetailsShell>
  )
}
