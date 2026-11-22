import { useId, useState, type FormEvent } from 'react'
import type { Species } from '../api/species'
import { MAX_TREES, useSetTreeCounts, useTreeCounts } from '../api/trees'

const speciesName = (species: Species[], id: string) => {
  const s = species.find((x) => x.id === id)
  return s ? (s.common_name ?? s.scientific_name) : 'a deleted species'
}

/** Trees by species in a zone (alive / dead), editable: "counting dead is enough". */
export function ZoneTrees({ zoneId, species, onMessage }: { zoneId: string; species: Species[]; onMessage: (m: string) => void }) {
  const counts = useTreeCounts()
  const [editing, setEditing] = useState(false)
  const rows = (counts.data ?? []).filter((c) => c.zone_id === zoneId)
  const name = (id: string) => speciesName(species, id)
  const alive = rows.reduce((n, r) => n + r.alive, 0)
  const dead = rows.reduce((n, r) => n + r.dead, 0)

  return (
    <section aria-labelledby="zone-trees">
      <div className="row section-head">
        <h2 id="zone-trees">Trees by species</h2>
        <span className="spacer" />
        {!editing && species.length > 0 && (
          <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
            ✎ Count trees
          </button>
        )}
      </div>
      {editing ? (
        <TreeCountsForm
          zoneId={zoneId}
          species={species}
          rows={rows}
          onDone={(m) => {
            setEditing(false)
            onMessage(m)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : rows.length === 0 ? (
        <p className="muted">{species.length === 0 ? 'Add species first to count trees.' : 'No trees counted here yet.'}</p>
      ) : (
        <table className="trees">
          <thead>
            <tr>
              <th scope="col">Species</th>
              <th scope="col">Alive</th>
              <th scope="col">Dead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.species_id}>
                <td>{name(r.species_id)}</td>
                <td>{r.alive}</td>
                <td>{r.dead}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="trees__total">
                <td>Total</td>
                <td>{alive}</td>
                <td>{dead}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}

type Row = { species_id: string; alive: string; dead: string }

function TreeCountsForm({
  zoneId,
  species,
  rows,
  onDone,
  onCancel,
}: {
  zoneId: string
  species: Species[]
  rows: { species_id: string; alive: number; dead: number }[]
  onDone: (m: string) => void
  onCancel: () => void
}) {
  const set = useSetTreeCounts()
  const [announce, setAnnounce] = useState('')
  const [form, setForm] = useState<Row[]>(() => rows.map((r) => ({ species_id: r.species_id, alive: String(r.alive), dead: String(r.dead) })))
  const [error, setError] = useState('')
  const addId = useId()
  const unused = species.filter((s) => !form.some((r) => r.species_id === s.id))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = []
    for (const r of form) {
      const a = Number(r.alive || 0)
      const d = Number(r.dead || 0)
      if (![a, d].every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_TREES))
        return setError(`Counts are whole numbers from 0 to ${MAX_TREES.toLocaleString('en-GB')}.`)
      parsed.push({ zone_id: zoneId, species_id: r.species_id, alive: a, dead: d })
    }
    setError('')
    const changed = parsed.filter((p) => {
      const before = rows.find((r) => r.species_id === p.species_id)
      return before ? before.alive !== p.alive || before.dead !== p.dead : p.alive > 0 || p.dead > 0
    })
    // Each species is its own change in the outbox (kept on the phone, sent in order).
    // The form closes at once; if the server refuses one, the sync bar says so.
    for (const c of changed) set.mutate(c)
    onDone(changed.length === 0 ? 'Nothing changed.' : 'Tree counts updated.')
  }

  const update = (i: number, key: 'alive' | 'dead', value: string) => setForm((f) => f.map((r, j) => (j === i ? { ...r, [key]: value } : r)))
  const step = (i: number, key: 'alive' | 'dead', by: number, label: string) =>
    setForm((f) =>
      f.map((r, j) => {
        if (j !== i) return r
        const next = Math.min(MAX_TREES, Math.max(0, (Number(r[key]) || 0) + by))
        setAnnounce(`${label} ${key}: ${next}`)
        return { ...r, [key]: String(next) }
      }),
    )

  return (
    <form className="card" onSubmit={submit} noValidate aria-label="Count trees">
      <p className="muted small">How many of each species stand in this zone now. Moving a tree from alive to dead records that it died.</p>
      {form.map((r, i) => {
        const label = speciesName(species, r.species_id)
        return (
          <fieldset key={r.species_id} className="tree-row">
            <legend>{label}</legend>
            {(['alive', 'dead'] as const).map((key) => (
              <div key={key} className="stepper">
                <span className="stepper__label">{key === 'alive' ? 'Alive' : 'Dead'}</span>
                <button type="button" className="btn btn-icon" aria-label={`One ${key} ${label} less`} onClick={() => step(i, key, -1, label)}>
                  −
                </button>
                <input inputMode="numeric" aria-label={`${label}, ${key}`} value={r[key]} onChange={(e) => update(i, key, e.target.value)} />
                <button type="button" className="btn btn-icon" aria-label={`One ${key} ${label} more`} onClick={() => step(i, key, 1, label)}>
                  +
                </button>
              </div>
            ))}
          </fieldset>
        )
      })}
      {unused.length > 0 && (
        <>
          <label htmlFor={addId}>Add a species</label>
          <select
            id={addId}
            value=""
            onChange={(e) => e.target.value && setForm((f) => [...f, { species_id: e.target.value, alive: '0', dead: '0' }])}
          >
            <option value="">Choose…</option>
            {unused.map((s) => (
              <option key={s.id} value={s.id}>
                {s.common_name ?? s.scientific_name}
              </option>
            ))}
          </select>
        </>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
      <div className="row form__actions">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
