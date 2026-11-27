import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  ACTIVITY,
  activities,
  UNIT_LABEL,
  ZONE_UNITS,
  zonesPhrase,
  type ActivitySpecies,
  type ActivityType,
  type QuantityUnit,
} from '../api/activities'
import { friendlyError } from '../api/errors'
import { fieldPhoto, useField } from '../api/field'
import { markShownInline, SAVED_ON_PHONE } from '../api/outbox'
import { plots as plotsApi, zoneName, zones as zonesApi, type Zone } from '../api/plots'
import { useSpeciesList } from '../api/species'
import { isOpen, TASK_KIND, taskInput, taskPlace, tasks as tasksApi, type Task, type TaskKind } from '../api/tasks'
import { FieldMap } from '../components/FieldMap'
import { ToastLine } from '../components/TaskRow'
import { StatusBadge } from '../components/StatusBadge'
import { addDays, formatDay } from '../domain/dates'
import { needsWater, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { useFieldToday } from '../hooks/useFieldToday'
import type { Toast } from '../hooks/useTaskToggle'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { newId } from '../lib/uuid'
import { FieldLayers } from '../map/FieldLayers'
import { Icon } from '../components/Icon'

const MAIN: ActivityType[] = ['watering', 'sowing', 'planting']
const MORE: ActivityType[] = ['fertilizing', 'other']

/** The kind of open task this work usually finishes: ticked for closing by default. */
const CLOSES: Partial<Record<ActivityType, TaskKind>> = {
  watering: 'water',
  sowing: 'sow',
  planting: 'plant',
  fertilizing: 'fertilize',
}

function parseCount(text: string): number | null | 'bad' {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : 'bad'
}

/**
 * The quick log: ① tap zones ② tap what you did ③ Save. Everything else
 * (date, quantities, species, notes) is optional and starts with sensible values.
 */
export function LogPage() {
  const field = useField()
  const plots = plotsApi.useList()
  const zones = zonesApi.useList()
  const speciesList = useSpeciesList()
  const save = activities.useSave()
  const qc = useQueryClient()
  const tasks = tasksApi.useList()
  const saveTask = tasksApi.useSave()
  // the entry this form is waiting on; once it is queued or saved the form moves on,
  // and a later refusal of it is reported by the sync bar instead
  const [pendingId, setPendingId] = useState<string | null>(null)
  const ownsResult = pendingId !== null && save.variables?.id === pendingId
  const saveState = useOutboxWrite(save, ownsResult)
  const today = useFieldToday()
  const del = activities.useDelete()
  // the last message, with an Undo for the entry just logged (a wrong tap is fixed in one more)
  const [toast, setToast] = useState<Toast | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const say = useCallback((text: string, undo?: () => void) => {
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1, undo }))
    // Save sits at the bottom, the message at the top: bring it into sight (the form is cleared for the next entry)
    requestAnimationFrame(() => form.current?.querySelector('.flash')?.scrollIntoView?.({ block: 'nearest' }))
  }, [])
  // how to undo the entry being saved: delete it and reopen the tasks it closed
  const undoPending = useRef<(() => void) | undefined>(undefined)
  // " Tarefa feita: <titles>." for the tasks the entry being saved closes ('' when none)
  const donePending = useRef('')
  const [params, setParams] = useSearchParams()

  const [selected, setSelected] = useState<Set<string>>(() => new Set(params.getAll('zone')))
  const [type, setType] = useState<ActivityType | null>(null)
  const [showMore, setShowMore] = useState(false)
  // null = today (follows the date if the page stays open past midnight)
  const [pickedDay, setDay] = useState<string | null>(null)
  const day = pickedDay ?? today
  const [sameCount, setSameCount] = useState('')
  const [perZone, setPerZone] = useState<Record<string, string> | null>(null)
  const [unit, setUnit] = useState<QuantityUnit | null>(null)
  const [species, setSpecies] = useState<Record<string, string>>({}) // id → count text
  const [notes, setNotes] = useState('')
  // tasks ticked or unticked by hand; the others follow the default (see CLOSES)
  const [taskTicks, setTaskTicks] = useState<Record<string, boolean>>({})
  const [showList, setShowList] = useState(false)
  const [error, setError] = useState('')
  const ids = { count: useId(), date: useId(), notes: useId(), err: useId() }

  const allZones = useMemo(() => zones.data ?? [], [zones.data])
  const chosen = allZones.filter((z) => selected.has(z.id))
  const dry = allZones.filter((z) => needsWater(z, today))
  const photo = field.data ? fieldPhoto(field.data) : null
  const effectiveUnit = unit ?? (type ? ACTIVITY[type].unit : null)
  const hasSpecies = type === 'sowing' || type === 'planting'

  // open tasks on the chosen zones or on their plots, the kind this work finishes first
  const chosenIds = new Set(chosen.map((z) => z.id))
  const chosenPlots = new Set(chosen.map((z) => z.plot_id))
  const closes = type ? CLOSES[type] : undefined
  const openTasks = type
    ? (tasks.data ?? [])
        .filter((t) => isOpen(t) && (t.zone_id ? chosenIds.has(t.zone_id) : t.plot_id !== null && chosenPlots.has(t.plot_id)))
        .sort((a, b) => Number(b.kind === closes) - Number(a.kind === closes))
    : []
  // a plot-wide task is ticked by default only when every zone of its plot was worked
  const wholePlot = (plotId: string) => allZones.every((z) => z.plot_id !== plotId || chosenIds.has(z.id))
  const ticked = (t: Task) => taskTicks[t.id] ?? (t.kind === closes && (t.zone_id !== null || (t.plot_id !== null && wholePlot(t.plot_id))))
  const closing = openTasks.filter(ticked).length

  // (a zone deleted meanwhile simply isn't in `chosen`, which is built from the live list)

  // queued offline: as good as saved — clear the form for the next entry
  const queued = ownsResult && saveState.waiting
  useEffect(() => {
    if (!queued) return
    say(`${SAVED_ON_PHONE}${donePending.current}`, undoPending.current)
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only touches state setters
  }, [queued, say])

  const toggle = (z: Zone) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(z.id)) next.delete(z.id)
      else next.add(z.id)
      return next
    })

  function reset() {
    setPendingId(null)
    setSelected(new Set())
    setType(null)
    setShowMore(false)
    setDay(null)
    setSameCount('')
    setPerZone(null)
    setUnit(null)
    setSpecies({})
    setNotes('')
    setTaskTicks({})
    if (params.has('zone')) setParams({}, { replace: true })
  }

  const chooseType = (t: ActivityType) => {
    // a count typed for another kind of work (covas vs litres) doesn't carry over
    if (t !== type) {
      setSameCount('')
      setPerZone(null)
      setUnit(null)
    }
    setType(t)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (saveState.busy) return
    if (chosen.length === 0) return setError('Toca nas zonas onde trabalhaste, no mapa ou na lista.')
    if (!type) return setError('Escolhe o que fizeste: rega, sementeira, plantação…')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError('Escolhe o dia.')
    if (day > today) return setError('O dia não pode ser depois de hoje.')
    const counts: Record<string, number | null> = {}
    for (const z of chosen) {
      const c = type === 'other' ? null : parseCount(perZone ? (perZone[z.id] ?? '') : sameCount)
      if (c === 'bad') return setError('As quantidades são números inteiros, como 100.')
      counts[z.id] = c
    }
    const anyCount = Object.values(counts).some((c) => c !== null)
    if (anyCount && !effectiveUnit) return setError('Escolhe a unidade da quantidade.')
    const sp: ActivitySpecies[] = []
    if (hasSpecies) {
      for (const [id, text] of Object.entries(species)) {
        const c = parseCount(text)
        if (c === 'bad') return setError('As quantidades por espécie são números inteiros.')
        sp.push({ species_id: id, quantity: c, unit: c === null ? null : type === 'planting' ? 'trees' : 'seeds', notes: null })
      }
    }
    setError('')
    const names = chosen.map((z) => zoneName(z))
    const what = ACTIVITY[type].saved
    const id = newId()
    const toClose = openTasks.filter(ticked)
    setPendingId(id)
    const undo = () => {
      // put the tasks back as they were, then remove the entry
      for (const t of toClose) saveTask.mutate({ id: t.id, input: taskInput(t) })
      del.mutate(id)
    }
    undoPending.current = undo
    const closed =
      toClose.length === 0 ? '' : ` ${toClose.length === 1 ? 'Tarefa feita' : 'Tarefas feitas'}: ${toClose.map((t) => t.title).join(', ')}.`
    donePending.current = closed
    save.mutate(
      {
        id,
        input: {
          type,
          performed_on: day,
          notes: notes.trim() || null,
          zones: chosen.map((z) => ({
            zone_id: z.id,
            quantity: counts[z.id] ?? null,
            unit: counts[z.id] != null ? effectiveUnit : null,
          })),
          species: sp,
          base_version: null,
        },
      },
      {
        onSuccess: () => {
          say(`${what} em ${zonesPhrase(names)}, ${day === today ? 'hoje' : `a ${formatDay(day, today)}`}.${closed}`, undo)
          reset()
        },
        onError: () => {
          // refused while the form is open: it says so and keeps the ticks for the next try;
          // the task writes that depended on this entry fail too, and needn't be reported again
          for (const m of qc.getMutationCache().findAll({ mutationKey: tasksApi.listKey })) {
            const input = (m.state.variables as { input?: { resolved_by_activity_id?: string | null } } | undefined)?.input
            if (input?.resolved_by_activity_id === id) markShownInline(m.mutationId)
          }
        },
      },
    )
    // queued after the entry (one ordered outbox), so the server knows the entry first
    for (const t of toClose) {
      saveTask.mutate({ id: t.id, input: taskInput(t, { status: 'done', resolved_by_activity_id: id }) })
    }
  }

  if (field.data === null || (plots.data && plots.data.length === 0)) {
    return (
      <div className="page">
        <h1>Registar</h1>
        <p className="note">
          Primeiro {field.data === null ? 'configura o terreno' : 'desenha as parcelas e as zonas'}.{' '}
          <Link to={field.data === null ? '/field' : '/'}>{field.data === null ? 'Configurar o terreno' : 'Abrir o mapa'}</Link>
        </p>
      </div>
    )
  }

  return (
    <form ref={form} className="page log" onSubmit={submit} noValidate>
      <h1>Registar</h1>
      <p className="muted small">① toca nas zonas · ② toca no que fizeste · ③ Guardar</p>
      <ToastLine
        toast={toast}
        onUndo={() => {
          toast?.undo?.()
          setToast({ text: 'Registo anulado.', n: (toast?.n ?? 0) + 1 })
        }}
      />

      {photo && (
        <div className="setup-map log__map">
          <FieldMap key={`${photo.width}x${photo.height}`} photo={photo} wheelZoom={false}>
            <FieldLayers
              plots={plots.data ?? []}
              zones={allZones}
              today={today}
              selectedIds={selected}
              onSelectZone={toggle}
            />
          </FieldMap>
        </div>
      )}

      <output className="log__count" aria-live="polite">
          {chosen.length === 0 ? 'Nenhuma zona escolhida' : `Escolhida: ${zonesPhrase(chosen.map((z) => zoneName(z)))}`}
      </output>
      <div className="row log__select">
        {dry.length > 0 && (
          <button type="button" className="chip" onClick={() => setSelected((s) => new Set([...s, ...dry.map((z) => z.id)]))}>
            Todas as zonas por regar ({dry.length})
          </button>
        )}
        {chosen.length > 0 && (
          <button type="button" className="chip" onClick={() => setSelected(new Set())}>
            Limpar
          </button>
        )}
        <button type="button" className="chip" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
          {showList ? 'Esconder a lista' : 'Escolher numa lista'}
        </button>
      </div>

      {showList && (
        <fieldset className="zone-checks">
          <legend className="visually-hidden">Zonas</legend>
          {allZones.length === 0 && (
            <p className="muted">{zones.isError ? friendlyError(zones.error) : zones.isPending ? 'A carregar as zonas…' : 'Ainda não há zonas.'}</p>
          )}
          {allZones.map((z) => {
            const s = zoneStatus(z, today)
            return (
              <label key={z.id} className="zone-check">
                <input type="checkbox" checked={selected.has(z.id)} onChange={() => toggle(z)} />
                <span>{zoneName(z)}</span>
                <StatusBadge status={s} label={STATUS_LABEL[s]} />
              </label>
            )
          })}
        </fieldset>
      )}

      <fieldset className="actions3">
        <legend className="visually-hidden">O que fizeste?</legend>
        {[...MAIN, ...(showMore || (type && MORE.includes(type)) ? MORE : [])].map((t) => (
          <button
            key={t}
            type="button"
            className={`act act--${t}${type === t ? ' is-on' : ''}`}
            aria-pressed={type === t}
            onClick={() => chooseType(t)}
          >
            <Icon className="act__icon" name={ACTIVITY[t].icon} size={28} />
            {ACTIVITY[t].label}
          </button>
        ))}
      </fieldset>
      {!showMore && !(type && MORE.includes(type)) && (
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setShowMore(true)
            // the button goes away: move focus to the first new choice
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.act--fertilizing')?.focus())
          }}
        >
          Mais… (adubação, outro)
        </button>
      )}

      {openTasks.length > 0 && (
        <fieldset className="zone-checks log__tasks">
          <legend>Também ficou feito</legend>
          {openTasks.map((t) => (
            <label key={t.id} className="zone-check">
              <input
                type="checkbox"
                checked={ticked(t)}
                onChange={(e) => setTaskTicks((cur) => ({ ...cur, [t.id]: e.target.checked }))}
              />
              <span>
                <Icon name={TASK_KIND[t.kind].icon} /> {t.title}
                <span className="muted small"> · {taskPlace(t, plots.data ?? [], allZones)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="log__when">
        <legend className="label-like">Quando</legend>
        <div className="row">
          {[today, addDays(today, -1)].map((d, i) => (
            <button key={d} type="button" className={`chip${day === d ? ' is-on' : ''}`} aria-pressed={day === d} onClick={() => setDay(i === 0 ? null : d)}>
              {i === 0 ? 'Hoje' : 'Ontem'}
            </button>
          ))}
          <label className="visually-hidden" htmlFor={ids.date}>
            Outro dia
          </label>
          <input
            id={ids.date}
            type="date"
            className="log__date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value === today ? null : e.target.value)}
          />
        </div>
      </fieldset>

      {type && type !== 'other' && (
        <div className="log__qty">
          <label htmlFor={perZone ? undefined : ids.count} id={`${ids.count}-label`}>
            Quantidade{effectiveUnit ? ` (${UNIT_LABEL[effectiveUnit]})` : ''}
            {chosen.length > 1 && !perZone ? ' em cada zona' : ''} <span className="muted">(opcional)</span>
          </label>
          {!perZone ? (
            <div className="input-row">
              <input id={ids.count} inputMode="numeric" value={sameCount} onChange={(e) => setSameCount(e.target.value)} placeholder="por exemplo, 100" />
              <UnitSelect type={type} value={effectiveUnit} onChange={setUnit} />
              {chosen.length > 1 && (
                <button type="button" className="btn-link" onClick={() => setPerZone(Object.fromEntries(chosen.map((z) => [z.id, sameCount])))}>
                  Por zona…
                </button>
              )}
            </div>
          ) : (
            <div className="per-zone">
              {chosen.map((z) => (
                <label key={z.id} className="per-zone__row">
                  <span>
                    {zoneName(z)}
                    <span className="visually-hidden">, {effectiveUnit ? UNIT_LABEL[effectiveUnit] : 'quantidade'}</span>
                  </span>
                  <input
                    inputMode="numeric"
                    value={perZone[z.id] ?? ''}
                    onChange={(e) => setPerZone({ ...perZone, [z.id]: e.target.value })}
                  />
                </label>
              ))}
              <div className="row">
                <UnitSelect type={type} value={effectiveUnit} onChange={setUnit} />
                <button type="button" className="btn-link" onClick={() => setPerZone(null)}>
                  Igual em todas
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {hasSpecies && (
        <fieldset className="log__species">
          <legend>{type === 'sowing' ? 'Mistura de sementes' : 'Espécies'} <span className="muted">(opcional)</span></legend>
          {(speciesList.data ?? []).length === 0 ? (
            <p className="muted small">
              Ainda não há espécies. <Link to="/species">Acrescentar espécies</Link>
            </p>
          ) : (
            <div className="row">
              {(speciesList.data ?? []).map((s) => {
                const on = s.id in species
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setSpecies((cur) => {
                        const next = { ...cur }
                        if (on) delete next[s.id]
                        else next[s.id] = ''
                        return next
                      })
                    }
                  >
                    {s.common_name ?? s.scientific_name}
                  </button>
                )
              })}
            </div>
          )}
          {Object.keys(species).map((id) => {
            const s = speciesList.data?.find((x) => x.id === id)
            return (
              <label key={id} className="per-zone__row">
                <span>
                  {s?.common_name ?? s?.scientific_name}: quantas {type === 'planting' ? 'árvores' : 'sementes'}?
                </span>
                <input inputMode="numeric" value={species[id]} onChange={(e) => setSpecies({ ...species, [id]: e.target.value })} />
              </label>
            )
          })}
        </fieldset>
      )}

      <details className="log__notes" open={notes !== ''}>
        <summary>Acrescentar uma nota</summary>
        <label htmlFor={ids.notes} className="visually-hidden">
          Nota
        </label>
        <textarea id={ids.notes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </details>

      {/* kept in view at the bottom: the 3-tap flow shouldn't need a scroll */}
      <div className="save-bar">
        {(error || (ownsResult && save.error)) && (
          <p id={ids.err} className="form__error" role="alert">
            {error || friendlyError(save.error)}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-big btn-block"
          disabled={saveState.busy}
          aria-describedby={error || (ownsResult && save.error) ? ids.err : undefined}
        >
          {saveState.busy
            ? 'A guardar…'
            : type && chosen.length > 0
              ? `Guardar ${ACTIVITY[type].noun} em ${chosen.length === 1 ? zoneName(chosen[0]!) : `${chosen.length} zonas`}${
                  closing === 0 ? '' : ` · fecha ${closing === 1 ? '1 tarefa' : `${closing} tarefas`}`
                }`
              : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

function UnitSelect({ type, value, onChange }: { type: ActivityType; value: QuantityUnit | null; onChange: (u: QuantityUnit) => void }) {
  return (
    <select aria-label="Unidade" value={value ?? ''} onChange={(e) => onChange(e.target.value as QuantityUnit)} className="unit-select">
      {value === null && <option value="">unidade…</option>}
      {ZONE_UNITS[type].map((u) => (
        <option key={u} value={u}>
          {UNIT_LABEL[u]}
        </option>
      ))}
    </select>
  )
}
