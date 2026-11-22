import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { friendlyError } from '../api/errors'
import { DELETED_ON_PHONE, SAVED_ON_PHONE } from '../api/outbox'
import { MONTHS, overlappingMonths, wateringRules, type WateringRule } from '../api/stats'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { newId } from '../lib/uuid'

const monthRange = (r: Pick<WateringRule, 'from_month' | 'to_month'>) =>
  r.from_month === r.to_month ? MONTHS[r.from_month - 1] : `${MONTHS[r.from_month - 1]} – ${MONTHS[r.to_month - 1]}`

/** Seasonal watering: "Summer, June – September: every 4 days". Other months use the default. */
export function WateringRules({ defaultDays, onMessage }: { defaultDays: number; onMessage: (m: string) => void }) {
  const rules = wateringRules.useList()
  const [editing, setEditing] = useState<WateringRule | 'new' | null>(null)
  const list = rules.data ?? []
  const overlaps = overlappingMonths(list)
  const done = useCallback(
    (m: string) => {
      setEditing(null)
      onMessage(m)
    },
    [onMessage],
  )

  return (
    <section className="card" aria-labelledby="rules-t">
      <h2 id="rules-t">Watering by season</h2>
      <p className="muted small">
        A zone “needs water” when nothing was watered, sown or planted there for longer than the rule for this month.
      </p>
      {rules.isError && (
        <p className="note warn" role="alert">
          {friendlyError(rules.error)}
        </p>
      )}
      <ul className="list">
        {list.map((r) =>
          editing !== 'new' && editing?.id === r.id ? (
            <li key={r.id}>
              <RuleForm rule={r} onDone={done} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={r.id}>
              <button type="button" className="list__item" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                <span className="list__title">
                  {r.name}: every {r.interval_days} day{r.interval_days === 1 ? '' : 's'}
                </span>
                <span className="list__sub muted">{monthRange(r)}</span>
              </button>
            </li>
          ),
        )}
      </ul>
      <p className="muted small">
        {list.length === 0 ? 'All year' : 'Any other month'}: every {defaultDays} days (change it above).
      </p>
      {overlaps.length > 0 && (
        <p className="note">
          {overlaps.map((m) => MONTHS[m - 1]).join(', ')} {overlaps.length === 1 ? 'is' : 'are'} in more than one rule:
          the shorter range wins there (the older rule, if they are equally long).
        </p>
      )}
      {editing === 'new' ? (
        <RuleForm onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          ＋ Add a season
        </button>
      )}
    </section>
  )
}

function RuleForm({ rule, onDone, onCancel }: { rule?: WateringRule; onDone: (m: string) => void; onCancel: () => void }) {
  const save = wateringRules.useSave()
  const del = wateringRules.useDelete()
  const saveState = useOutboxWrite(save)
  const delState = useOutboxWrite(del)
  const [name, setName] = useState(rule?.name ?? '')
  const [from, setFrom] = useState(rule?.from_month ?? 6)
  const [to, setTo] = useState(rule?.to_month ?? 9)
  const [days, setDays] = useState(String(rule?.interval_days ?? 4))
  const [localError, setLocalError] = useState('')
  const ids = { name: useId(), from: useId(), to: useId(), days: useId(), err: useId() }
  useEffect(() => {
    if (saveState.waiting) onDone(SAVED_ON_PHONE)
    else if (delState.waiting) onDone(DELETED_ON_PHONE)
  }, [saveState.waiting, delState.waiting, onDone])
  const busy = saveState.busy || delState.busy
  const error = localError || (save.error ?? del.error ? friendlyError(save.error ?? del.error) : '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const n = Number(days)
    if (!name.trim()) return setLocalError('Name the season, e.g. “Summer”.')
    if (!Number.isInteger(n) || n < 1 || n > 365) return setLocalError('Water every 1 to 365 days.')
    setLocalError('')
    save.mutate(
      { id: rule?.id ?? newId(), input: { name: name.trim(), from_month: from, to_month: to, interval_days: n } },
      { onSuccess: () => onDone(`Saved ${name.trim()}.`) },
    )
  }

  return (
    <form className="card card--inset" onSubmit={submit} noValidate aria-label={rule ? `Edit ${rule.name}` : 'New season'}>
      <label htmlFor={ids.name}>Season</label>
      <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer" maxLength={60} />
      <div className="coords">
        <div>
          <label htmlFor={ids.from}>From</label>
          <select id={ids.from} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.to}>To (inclusive)</label>
          <select id={ids.to} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label htmlFor={ids.days}>Water every</label>
      <div className="input-row">
        <input id={ids.days} type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
        <span>days</span>
      </div>
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <div className="row form__actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {saveState.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <span className="spacer" />
        {rule && (
          <button type="button" className="btn btn-link-danger" disabled={busy} onClick={() => del.mutate(rule.id, { onSuccess: () => onDone(`Removed ${rule.name}.`) })}>
            Remove
          </button>
        )}
      </div>
    </form>
  )
}
