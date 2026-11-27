import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import { DELETED_ON_PHONE, SAVED_ON_PHONE } from '../api/outbox'
import { formatHa, plots as plotsApi, zoneName, zones as zonesApi, type Plot, type Zone, type ZoneKind } from '../api/plots'
import { isOpen, tasks as tasksApi } from '../api/tasks'
import { useTreeCounts } from '../api/trees'
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
  const what = draft.kind === 'plot' ? 'parcela' : 'zona'

  if (draft.step === 'details') {
    return draft.kind === 'plot' ? (
      <PlotDetails draft={draft} setDraft={setDraft} plots={plots} zones={zones} onDone={onDone} />
    ) : (
      <ZoneDetails draft={draft} setDraft={setDraft} plots={plots} plotId={check.plotId} onDone={onDone} />
    )
  }

  return (
    <section className="sheet sheet--compact" aria-labelledby="draw-title">
      <h2 id="draw-title">{draft.original ? `Editar o contorno da ${what}` : `Desenhar uma ${what}`}</h2>
      <p className={check.ok ? 'muted' : 'draw-hint draw-hint--bad'} aria-live="polite">
        {check.message}
      </p>
      {draft.corners.length >= 3 && (
        <p className="muted small">
          {draft.corners.length} cantos
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
          ↶ Desfazer
        </button>
        <button type="button" className="btn" onClick={() => setDraft(null)}>
          Cancelar
        </button>
        {draft.selectedCorner !== null && draft.corners.length > 3 && (
          <button
            type="button"
            className="btn"
            onClick={() => setDraft(withCorners(draft, draft.corners.filter((_, i) => i !== draft.selectedCorner)))}
          >
            Tirar o canto
          </button>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!check.ok}
          onClick={() => setDraft({ ...draft, step: 'details' })}
        >
          Seguinte
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
          <legend className="visually-hidden">Confirmar que apagas</legend>
          <p>{deleteQuestion}</p>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>
              {deleteLabel}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Não apagar
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="row form__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'A guardar…' : 'Guardar'}
          </button>
          <button type="button" className="btn" onClick={onBack} disabled={busy}>
            ← Contorno
          </button>
          <span className="spacer" />
          {onDelete && (
            <button type="button" className="btn btn-link-danger" onClick={() => setConfirming(true)} disabled={busy}>
              Apagar
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
  while (used.has(`parcela ${n}`)) n++
  return `Parcela ${n}`
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
  const [declared, setDeclared] = useState(original?.declared_area_ha != null ? String(original.declared_area_ha).replace('.', ',') : '')
  const [notes, setNotes] = useState(original?.notes ?? '')
  const [localError, setLocalError] = useState('')
  const save = plotsApi.useSave()
  const del = plotsApi.useDelete()
  const { busy, error } = useShapeWrite(save, del, onDone)
  const ids = { name: useId(), ha: useId(), notes: useId() }
  const zoneCount = zones.filter((z) => z.plot_id === draft.id).length
  const taken = useTakenAlong((z) => z === draft.id, new Set(zones.filter((z) => z.plot_id === draft.id).map((z) => z.id)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const ha = declared.trim() === '' ? null : Number(declared.replace(',', '.'))
    if (!name.trim()) return setLocalError('Dá um nome à parcela.')
    const clash = plots.find((p) => p.id !== draft.id && p.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (clash) return setLocalError(`${NAME_TAKEN} “${clash.name}”.`)
    if (ha !== null && !(ha > 0 && ha < 100_000)) return setLocalError('Os hectares no mapa antigo têm de ser um número acima de 0.')
    setLocalError('')
    const n = name.trim()
    save.mutate(
      {
        id: draft.id,
        input: { name: n, geom: { type: 'Polygon', coordinates: [closeRing(draft.corners)] }, declared_area_ha: ha, notes: notes.trim() || null },
      },
      { onSuccess: () => onDone(original ? `${n} guardada.` : `${n} acrescentada.`) },
    )
  }

  const serverField = error instanceof ApiError ? error.field : null
  return (
    <DetailsShell
      title={original ? `Editar ${original.name}` : 'Parcela nova'}
      error={localError || (error ? friendlyError(error) : '')}
      busy={busy}
      onBack={() => setDraft({ ...draft, step: 'shape' })}
      onSubmit={submit}
      deleteLabel="Apagar a parcela"
      deleteQuestion={deleteQuestion(
        original?.name ?? 'esta parcela',
        [plural(zoneCount, 'zona', 'zonas'), plural(taken.tasks, 'tarefa por fazer', 'tarefas por fazer'), plural(taken.trees, 'árvore contada', 'árvores contadas')],
      )}
      onDelete={original ? () => del.mutate(draft.id, { onSuccess: () => onDone(`${original.name} apagada.`) }) : undefined}
    >
      <label htmlFor={ids.name}>Nome</label>
      <input
        id={ids.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        aria-invalid={serverField === 'name' || localError.startsWith(NAME_TAKEN) || undefined}
      />
      <label htmlFor={ids.ha}>
        Hectares no mapa antigo <span className="muted">(opcional)</span>
      </label>
      <input id={ids.ha} inputMode="decimal" value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder="6,2" />
      <label htmlFor={ids.notes}>
        Notas <span className="muted">(opcional)</span>
      </label>
      <textarea id={ids.notes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
    </DetailsShell>
  )
}

const KINDS: { value: ZoneKind; label: string; hint: string }[] = [
  { value: 'cultivation', label: 'Cultivo', hint: 'semeia-se, planta-se, rega-se' },
  { value: 'path', label: 'Caminho', hint: 'nunca precisa de rega' },
  { value: 'other', label: 'Outro', hint: 'pedras, um barracão, …' },
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
  const taken = useTakenAlong(() => false, new Set([draft.id]))
  const plot = plots.find((p) => p.id === plotId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!plotId) return setLocalError('Esta zona já não está dentro de uma parcela. Volta ao contorno e corrige-o.')
    setLocalError('')
    const l = label.trim() || null
    save.mutate(
      {
        id: draft.id,
        input: { plot_id: plotId, label: l, kind, geom: { type: 'Polygon', coordinates: [closeRing(draft.corners)] }, notes: notes.trim() || null },
      },
      { onSuccess: () => onDone(original ? `${l ?? name} guardada.` : l ? `${l} acrescentada.` : 'Zona acrescentada.', draft.id) },
    )
  }

  const name = original ? zoneName(original) : 'esta zona'
  return (
    <DetailsShell
      title={original ? `Editar ${name}` : `Zona nova${plot ? ` em ${plot.name}` : ''}`}
      error={localError || (error ? friendlyError(error) : '')}
      busy={busy}
      onBack={() => setDraft({ ...draft, step: 'shape' })}
      onSubmit={submit}
      deleteLabel="Apagar a zona"
      deleteQuestion={deleteQuestion(name, [plural(taken.tasks, 'tarefa por fazer', 'tarefas por fazer'), plural(taken.trees, 'árvore contada', 'árvores contadas')])}
      onDelete={original ? () => del.mutate(draft.id, { onSuccess: () => onDone(`${name} apagada.`) }) : undefined}
    >
      <label htmlFor={ids.label}>
        Nome <span className="muted">(opcional)</span>
      </label>
      <input id={ids.label} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="Ninhos de outubro" />
      <fieldset className="choice">
        <legend id={ids.kind}>O que é?</legend>
        {KINDS.map((k) => (
          <label key={k.value} className={`choice__opt${kind === k.value ? ' is-on' : ''}`}>
            <input type="radio" name="zone-kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
            <b>{k.label}</b>
            <span className="muted small">{k.hint}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={ids.notes}>
        Notas <span className="muted">(opcional)</span>
      </label>
      <textarea id={ids.notes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
    </DetailsShell>
  )
}

function plural(n: number, one: string, many: string): string | null {
  return n > 0 ? `${n} ${n === 1 ? one : many}` : null
}

const NAME_TAKEN = 'Já há outra parcela com o nome'

/** "Apagar Parcela 1, com 3 zonas e 2 tarefas por fazer? O que registaste lá fica guardado." */
function deleteQuestion(name: string, along: (string | null)[]): string {
  const parts = along.filter(Boolean) as string[]
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0]
  return `Apagar ${name}${list ? `, com ${list}` : ''}? O que registaste lá fica guardado.`
}

/** Open tasks and counted trees that a delete takes along (shown before confirming). */
function useTakenAlong(onPlot: (plotId: string | null) => boolean, zoneIds: Set<string>) {
  const tasks = tasksApi.useList()
  const trees = useTreeCounts()
  return {
    tasks: (tasks.data ?? []).filter((t) => isOpen(t) && (onPlot(t.plot_id) || (t.zone_id !== null && zoneIds.has(t.zone_id)))).length,
    trees: (trees.data ?? []).filter((c) => zoneIds.has(c.zone_id)).reduce((n, c) => n + c.alive + c.dead, 0),
  }
}
