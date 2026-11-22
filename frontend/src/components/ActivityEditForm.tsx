import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ACTIVITY, activities, UNIT_LABEL, ZONE_UNITS, type Activity, type ActivityType, type QuantityUnit } from '../api/activities'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import { SAVED_ON_PHONE } from '../api/outbox'
import { zoneName, type Zone } from '../api/plots'
import type { Species } from '../api/species'
import { useOutboxWrite } from '../hooks/useOutboxWrite'

const TYPES: ActivityType[] = ['watering', 'sowing', 'planting', 'fertilizing', 'other']

function parseCount(text: string): number | null | 'bad' {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : 'bad'
}

/**
 * Fix a logged entry: kind, day, quantity per zone, species, notes — or delete it.
 * The edit starts from the entry's version at the moment the form opened, so a
 * change made on another phone meanwhile is reported instead of overwritten.
 */
export function ActivityEditForm({
  activity,
  zones,
  species,
  today,
  onDone,
  onCancel,
  onReload,
}: {
  activity: Activity
  zones: Zone[]
  species: Species[]
  today: string
  onDone: (message: string) => void
  onCancel: () => void
  /** after a version conflict: start again from the latest copy */
  onReload?: () => void
}) {
  const save = activities.useSave()
  const del = activities.useDelete()
  const saveState = useOutboxWrite(save)
  const [baseVersion] = useState(activity.version)
  const liveZone = new Map(zones.map((z) => [z.id, z]))
  const liveSpecies = new Set(species.map((s) => s.id))
  // zones/species deleted since: the server would refuse them, so they are left out
  const keptZones = activity.zones.filter((z) => liveZone.has(z.zone_id))
  const droppedZones = activity.zones.length - keptZones.length
  const droppedSpecies = activity.species.filter((s) => !liveSpecies.has(s.species_id)).length

  // the entry's zones, editable: a zone tapped by mistake can go, a forgotten one can come in
  const [chosenZoneIds, setZoneIds] = useState(() => keptZones.map((z) => z.zone_id))
  // a zone deleted on another phone while the form is open simply drops out
  const zoneIds = chosenZoneIds.filter((id) => liveZone.has(id))
  const [type, setType] = useState(activity.type)
  const [day, setDay] = useState(activity.performed_on)
  const [notes, setNotes] = useState(activity.notes ?? '')
  const [unit, setUnit] = useState<QuantityUnit | null>(activity.zones.find((z) => z.unit)?.unit ?? ACTIVITY[activity.type].unit)
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(activity.zones.map((z) => [z.zone_id, z.quantity == null ? '' : String(z.quantity)])),
  )
  const [chosenSpecies, setChosenSpecies] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      activity.species.filter((s) => liveSpecies.has(s.species_id)).map((s) => [s.species_id, s.quantity == null ? '' : String(s.quantity)]),
    ),
  )
  const [confirming, setConfirming] = useState(false)
  const [localError, setLocalError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const ids = { day: useId(), notes: useId(), err: useId(), head: useId(), unit: useId() }

  useEffect(() => {
    heading.current?.scrollIntoView?.({ block: 'nearest' })
    heading.current?.focus()
  }, [])
  useEffect(() => {
    if (saveState.waiting) onDone(SAVED_ON_PHONE)
  }, [saveState.waiting, onDone])

  const busy = saveState.busy
  const code = save.error instanceof ApiError ? save.error.code : null
  const error = localError || (save.error ? friendlyError(save.error) : '')
  const hasSpecies = type === 'sowing' || type === 'planting'
  const units = ZONE_UNITS[type]

  const chooseType = (t: ActivityType) => {
    // keep a unit that still fits; otherwise the new kind's usual one
    if (!unit || !ZONE_UNITS[t].includes(unit)) setUnit(ACTIVITY[t].unit)
    setType(t)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (zoneIds.length === 0) return setLocalError('Keep at least one zone (or delete the entry).')
    if (!day || day > today) return setLocalError("The day can't be after today.")
    const zoneRows = []
    for (const zoneId of zoneIds) {
      const c = type === 'other' && !unit ? null : parseCount(counts[zoneId] ?? '')
      if (c === 'bad') return setLocalError('Quantities are whole numbers, like 100.')
      if (c !== null && !unit) return setLocalError('Choose a unit for the quantity.')
      zoneRows.push({ zone_id: zoneId, quantity: c, unit: c === null ? null : unit })
    }
    const sp = []
    if (hasSpecies) {
      for (const [id, text] of Object.entries(chosenSpecies)) {
        const c = parseCount(text)
        if (c === 'bad') return setLocalError('Counts per species are whole numbers.')
        const before = activity.species.find((s) => s.species_id === id)
        sp.push({
          species_id: id,
          quantity: c,
          unit: c === null ? null : type === 'planting' ? ('trees' as const) : ('seeds' as const),
          notes: before?.notes ?? null,
        })
      }
    }
    setLocalError('')
    save.mutate(
      {
        id: activity.id,
        input: { type, performed_on: day, notes: notes.trim() || null, zones: zoneRows, species: sp, base_version: baseVersion },
      },
      { onSuccess: () => onDone('Entry saved.') },
    )
  }

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.head}>
      <h2 id={ids.head} ref={heading} tabIndex={-1}>
        Edit entry
      </h2>
      {(droppedZones > 0 || droppedSpecies > 0) && (
        <p className="note">
          {[
            droppedZones > 0 && `${droppedZones} deleted zone${droppedZones === 1 ? '' : 's'}`,
            droppedSpecies > 0 && `${droppedSpecies} deleted species`,
          ]
            .filter(Boolean)
            .join(' and ')}{' '}
          will be left out when you save.
        </p>
      )}
      <fieldset className="chips-field">
        <legend>What was done</legend>
        <div className="row">
          {TYPES.map((t) => (
            <button key={t} type="button" className={`chip${type === t ? ' is-on' : ''}`} aria-pressed={type === t} onClick={() => chooseType(t)}>
              <span aria-hidden="true">{ACTIVITY[t].icon}</span> {ACTIVITY[t].label}
            </button>
          ))}
        </div>
      </fieldset>
      <label htmlFor={ids.day}>Day</label>
      <input id={ids.day} type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />

      <fieldset className="chips-field">
        <legend>Zones, and the quantity in each (optional)</legend>
        {zoneIds.map((zoneId) => {
          const name = zoneName(liveZone.get(zoneId)!)
          return (
            <div key={zoneId} className="per-zone__row">
              <label htmlFor={`${ids.unit}-${zoneId}`}>
                {name}
                <span className="visually-hidden">, {unit ? UNIT_LABEL[unit] : 'quantity'}</span>
              </label>
              <span className="row">
                <input
                  id={`${ids.unit}-${zoneId}`}
                  inputMode="numeric"
                  value={counts[zoneId] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [zoneId]: e.target.value })}
                />
                {zoneIds.length > 1 && (
                  <button type="button" className="btn btn-icon" aria-label={`Remove ${name} from this entry`} onClick={() => setZoneIds((z) => z.filter((x) => x !== zoneId))}>
                    ✕
                  </button>
                )}
              </span>
            </div>
          )
        })}
        {zones.some((z) => !zoneIds.includes(z.id)) && (
          <select
            aria-label="Add a zone to this entry"
            value=""
            onChange={(e) => e.target.value && setZoneIds((z) => [...z, e.target.value])}
          >
            <option value="">＋ Add a zone…</option>
            {zones
              .filter((z) => !zoneIds.includes(z.id))
              .map((z) => (
                <option key={z.id} value={z.id}>
                  {zoneName(z)}
                </option>
              ))}
          </select>
        )}
        <label htmlFor={ids.unit} className="visually-hidden">
          Unit
        </label>
        <select id={ids.unit} className="unit-select" value={unit ?? ''} onChange={(e) => setUnit((e.target.value || null) as QuantityUnit | null)}>
          {(!unit || !units.includes(unit)) && <option value="">unit…</option>}
          {units.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </fieldset>

      {hasSpecies && species.length > 0 && (
        <fieldset className="chips-field">
          <legend>{type === 'sowing' ? 'Seed mix' : 'Species'}</legend>
          <div className="row">
            {species.map((s) => {
              const on = s.id in chosenSpecies
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    setChosenSpecies((cur) => {
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
          {Object.keys(chosenSpecies).map((id) => {
            const s = species.find((x) => x.id === id)
            return (
              <label key={id} className="per-zone__row">
                <span>
                  {s?.common_name ?? s?.scientific_name} — how many {type === 'planting' ? 'trees' : 'seeds'}?
                </span>
                <input inputMode="numeric" value={chosenSpecies[id]} onChange={(e) => setChosenSpecies({ ...chosenSpecies, [id]: e.target.value })} />
              </label>
            )
          })}
        </fieldset>
      )}

      <label htmlFor={ids.notes}>
        Notes <span className="muted">(optional)</span>
      </label>
      <textarea id={ids.notes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />

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
      {confirming ? (
        <fieldset className="confirm">
          <legend className="visually-hidden">Confirm delete</legend>
          <p>Delete this entry{activity.zones.length > 1 ? ` (it covers ${activity.zones.length} zones)` : ''}?</p>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                // the entry leaves the history at once: close now (a refusal shows in the sync bar)
                del.mutate(activity.id)
                onDone('Entry deleted.')
              }}
            >
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="row form__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-link-danger" onClick={() => setConfirming(true)} disabled={busy}>
            Delete
          </button>
        </div>
      )}
    </form>
  )
}
