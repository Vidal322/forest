import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { friendlyError } from '../api/errors'
import { DELETED_ON_PHONE, SAVED_ON_PHONE } from '../api/outbox'
import { MONTHS, overlappingMonths, wateringRules, type WateringRule } from '../api/stats'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { newId } from '../lib/uuid'
import { Icon } from './Icon'

const monthRange = (r: Pick<WateringRule, 'from_month' | 'to_month'>) =>
  r.from_month === r.to_month ? MONTHS[r.from_month - 1] : `de ${MONTHS[r.from_month - 1]} a ${MONTHS[r.to_month - 1]}`

/** "todos os dias", "de 4 em 4 dias". */
const everyDays = (n: number) => (n === 1 ? 'todos os dias' : `de ${n} em ${n} dias`)

/** Seasonal watering: "Verão, de junho a setembro: de 4 em 4 dias". Other months use the default. */
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
      <h2 id="rules-t">Rega por estação</h2>
      <p className="muted small">
        Uma zona fica “por regar” quando ninguém a regou, semeou ou plantou há mais tempo do que a regra deste mês.
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
              <button type="button" className="list__item" onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                <span className="list__title">
                  {r.name}: {everyDays(r.interval_days)}
                </span>
                <span className="list__sub muted">{monthRange(r)}</span>
              </button>
            </li>
          ),
        )}
      </ul>
      <p className="muted small">
        {list.length === 0 ? 'O ano todo' : 'Nos outros meses'}: {everyDays(defaultDays)} (podes mudar isto acima).
      </p>
      {overlaps.length > 0 && (
        <p className="note">
          {overlaps.length === 1 ? 'O mês de' : 'Os meses de'} {overlaps.map((m) => MONTHS[m - 1]).join(', ')}{' '}
          {overlaps.length === 1 ? 'está' : 'estão'} em mais do que uma regra: aí vale a regra com menos meses (ou a mais
          antiga, se tiverem os mesmos).
        </p>
      )}
      {editing === 'new' ? (
        <RuleForm onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          <Icon name="add" /> Acrescentar uma estação
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
    if (!name.trim()) return setLocalError('Dá um nome à estação, por exemplo “Verão”.')
    if (!Number.isInteger(n) || n < 1 || n > 365) return setLocalError('A rega é de 1 em 1 dia até de 365 em 365 dias.')
    setLocalError('')
    save.mutate(
      { id: rule?.id ?? newId(), input: { name: name.trim(), from_month: from, to_month: to, interval_days: n } },
      { onSuccess: () => onDone(`Estação guardada: ${name.trim()}.`) },
    )
  }

  return (
    <form className="card card--inset" onSubmit={submit} noValidate aria-label={rule ? `Editar ${rule.name}` : 'Estação nova'}>
      <label htmlFor={ids.name}>Estação</label>
      <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="Verão" maxLength={60} />
      <div className="coords">
        <div>
          <label htmlFor={ids.from}>De</label>
          <select id={ids.from} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.to}>Até (inclusive)</label>
          <select id={ids.to} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label htmlFor={ids.days}>Regar de quantos em quantos dias</label>
      <div className="input-row">
        <input id={ids.days} type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
        <span>dias</span>
      </div>
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <div className="row form__actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {saveState.busy ? 'A guardar…' : 'Guardar'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <span className="spacer" />
        {rule && (
          <button type="button" className="btn btn-link-danger" disabled={busy} onClick={() => del.mutate(rule.id, { onSuccess: () => onDone(`Estação apagada: ${rule.name}.`) })}>
            Apagar
          </button>
        )}
      </div>
    </form>
  )
}
