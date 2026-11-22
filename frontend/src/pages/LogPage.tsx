import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
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
import { SAVED_ON_PHONE } from '../api/outbox'
import { plots as plotsApi, zoneName, zones as zonesApi, type Zone } from '../api/plots'
import { useSpeciesList } from '../api/species'
import { FieldMap } from '../components/FieldMap'
import { Flash } from '../components/Flash'
import { StatusBadge } from '../components/StatusBadge'
import { addDays, formatDay } from '../domain/dates'
import { needsWater, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { useFieldToday } from '../hooks/useFieldToday'
import { useFlash } from '../hooks/useFlash'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { newId } from '../lib/uuid'
import { FieldLayers } from '../map/FieldLayers'

const MAIN: ActivityType[] = ['watering', 'sowing', 'planting']
const MORE: ActivityType[] = ['fertilizing', 'other']

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
  // the entry this form is waiting on; once it is queued or saved the form moves on,
  // and a later refusal of it is reported by the sync bar instead
  const [pendingId, setPendingId] = useState<string | null>(null)
  const ownsResult = pendingId !== null && save.variables?.id === pendingId
  const saveState = useOutboxWrite(save, ownsResult)
  const today = useFieldToday()
  const flash = useFlash()
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
  const [showList, setShowList] = useState(false)
  const [error, setError] = useState('')
  const ids = { count: useId(), date: useId(), notes: useId(), err: useId() }

  const allZones = useMemo(() => zones.data ?? [], [zones.data])
  const chosen = allZones.filter((z) => selected.has(z.id))
  const dry = allZones.filter((z) => needsWater(z, today))
  const photo = field.data ? fieldPhoto(field.data) : null
  const effectiveUnit = unit ?? (type ? ACTIVITY[type].unit : null)
  const hasSpecies = type === 'sowing' || type === 'planting'

  // (a zone deleted meanwhile simply isn't in `chosen`, which is built from the live list)

  const { show } = flash
  // queued offline: as good as saved — clear the form for the next entry
  const queued = ownsResult && saveState.waiting
  useEffect(() => {
    if (!queued) return
    show(SAVED_ON_PHONE)
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only touches state setters
  }, [queued, show])

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
    if (chosen.length === 0) return setError('Tap the zones you worked on, on the map or in the list.')
    if (!type) return setError('Choose what you did: watered, sowed, planted…')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError('Choose the day.')
    if (day > today) return setError("The day can't be after today.")
    const counts: Record<string, number | null> = {}
    for (const z of chosen) {
      const c = type === 'other' ? null : parseCount(perZone ? (perZone[z.id] ?? '') : sameCount)
      if (c === 'bad') return setError('Quantities are whole numbers, like 100.')
      counts[z.id] = c
    }
    const anyCount = Object.values(counts).some((c) => c !== null)
    if (anyCount && !effectiveUnit) return setError('Choose a unit for the quantity.')
    const sp: ActivitySpecies[] = []
    if (hasSpecies) {
      for (const [id, text] of Object.entries(species)) {
        const c = parseCount(text)
        if (c === 'bad') return setError('Counts per species are whole numbers.')
        sp.push({ species_id: id, quantity: c, unit: c === null ? null : type === 'planting' ? 'trees' : 'seeds', notes: null })
      }
    }
    setError('')
    const names = chosen.map((z) => zoneName(z))
    const what = ACTIVITY[type].past
    const id = newId()
    setPendingId(id)
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
          show(`Logged: ${what} ${zonesPhrase(names)}${day === today ? ' today' : ` on ${formatDay(day, today)}`}.`)
          reset()
        },
      },
    )
  }

  if (field.data === null || (plots.data && plots.data.length === 0)) {
    return (
      <div className="page">
        <h1>Log activity</h1>
        <p className="note">
          First {field.data === null ? 'set up the field' : 'draw your plots and zones'}.{' '}
          <Link to={field.data === null ? '/field' : '/'}>{field.data === null ? 'Field setup' : 'Open the map'}</Link>
        </p>
      </div>
    )
  }

  return (
    <form className="page log" onSubmit={submit} noValidate>
      <h1>Log activity</h1>
      <p className="muted small">① tap zones · ② tap what you did · ③ Save</p>
      <Flash flash={flash} />

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

      <div className="row">
        <output className="log__count" aria-live="polite">
          {chosen.length === 0 ? 'No zones selected' : `${zonesPhrase(chosen.map((z) => zoneName(z)))} selected`}
        </output>
        <span className="spacer" />
        {dry.length > 0 && (
          <button type="button" className="chip" onClick={() => setSelected((s) => new Set([...s, ...dry.map((z) => z.id)]))}>
            All that need water ({dry.length})
          </button>
        )}
        {chosen.length > 0 && (
          <button type="button" className="chip" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        )}
        <button type="button" className="chip" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
          {showList ? 'Hide list' : 'Pick from a list'}
        </button>
      </div>

      {showList && (
        <fieldset className="zone-checks">
          <legend className="visually-hidden">Zones</legend>
          {allZones.length === 0 && <p className="muted">{zones.isError ? friendlyError(zones.error) : 'No zones yet.'}</p>}
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
        <legend className="visually-hidden">What did you do?</legend>
        {[...MAIN, ...(showMore || (type && MORE.includes(type)) ? MORE : [])].map((t) => (
          <button
            key={t}
            type="button"
            className={`act act--${t}${type === t ? ' is-on' : ''}`}
            aria-pressed={type === t}
            onClick={() => chooseType(t)}
          >
            <span className="act__icon" aria-hidden="true">
              {ACTIVITY[t].icon}
            </span>
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
          More… (fertilized, other)
        </button>
      )}

      <fieldset className="log__when">
        <legend className="label-like">When</legend>
        <div className="row">
          {[today, addDays(today, -1)].map((d, i) => (
            <button key={d} type="button" className={`chip${day === d ? ' is-on' : ''}`} aria-pressed={day === d} onClick={() => setDay(i === 0 ? null : d)}>
              {i === 0 ? 'Today' : 'Yesterday'}
            </button>
          ))}
          <label className="visually-hidden" htmlFor={ids.date}>
            Another day
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
            How many {effectiveUnit ? UNIT_LABEL[effectiveUnit] : ''}
            {chosen.length > 1 && !perZone ? ' in each zone' : ''} <span className="muted">(optional)</span>
          </label>
          {!perZone ? (
            <div className="input-row">
              <input id={ids.count} inputMode="numeric" value={sameCount} onChange={(e) => setSameCount(e.target.value)} placeholder="e.g. 100" />
              <UnitSelect type={type} value={effectiveUnit} onChange={setUnit} />
              {chosen.length > 1 && (
                <button type="button" className="btn-link" onClick={() => setPerZone(Object.fromEntries(chosen.map((z) => [z.id, sameCount])))}>
                  Per zone…
                </button>
              )}
            </div>
          ) : (
            <div className="per-zone">
              {chosen.map((z) => (
                <label key={z.id} className="per-zone__row">
                  <span>
                    {zoneName(z)}
                    <span className="visually-hidden">, {effectiveUnit ? UNIT_LABEL[effectiveUnit] : 'quantity'}</span>
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
                  Same for all
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {hasSpecies && (
        <fieldset className="log__species">
          <legend>{type === 'sowing' ? 'Seed mix' : 'Species'} <span className="muted">(optional)</span></legend>
          {(speciesList.data ?? []).length === 0 ? (
            <p className="muted small">
              No species yet. <Link to="/species">Add species</Link>
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
                  {s?.common_name ?? s?.scientific_name} — how many {type === 'planting' ? 'trees' : 'seeds'}?
                </span>
                <input inputMode="numeric" value={species[id]} onChange={(e) => setSpecies({ ...species, [id]: e.target.value })} />
              </label>
            )
          })}
        </fieldset>
      )}

      <details className="log__notes" open={notes !== ''}>
        <summary>Add notes</summary>
        <label htmlFor={ids.notes} className="visually-hidden">
          Notes
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
            ? 'Saving…'
            : type && chosen.length > 0
              ? `Save — ${ACTIVITY[type].label} ${chosen.length === 1 ? zoneName(chosen[0]!) : `${chosen.length} zones`}`
              : 'Save'}
        </button>
      </div>
    </form>
  )
}

function UnitSelect({ type, value, onChange }: { type: ActivityType; value: QuantityUnit | null; onChange: (u: QuantityUnit) => void }) {
  return (
    <select aria-label="Unit" value={value ?? ''} onChange={(e) => onChange(e.target.value as QuantityUnit)} className="unit-select">
      {value === null && <option value="">unit…</option>}
      {ZONE_UNITS[type].map((u) => (
        <option key={u} value={u}>
          {UNIT_LABEL[u]}
        </option>
      ))}
    </select>
  )
}
