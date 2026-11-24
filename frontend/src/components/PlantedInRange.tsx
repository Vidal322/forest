import { useId } from 'react'
import { useSearchParams } from 'react-router'
import { friendlyError } from '../api/errors'
import { usePlantedStats, type PlantedStats } from '../api/stats'
import { addDays, formatDay } from '../domain/dates'

const n = (v: number) => v.toLocaleString('en-GB')
/** A real calendar day as YYYY-MM-DD (not 2026-13-45, which the address could carry). */
const isDay = (s: string | null): s is string => s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s

/** Quick ranges, ending today at the latest. */
function presets(today: string): { label: string; from: string; to: string }[] {
  const monthStart = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDays(monthStart, -1)
  return [
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ]
}

/**
 * Covas sown and trees planted between two dates, per plot and per species. The range lives in the
 * address (?from=&to=), so it survives going to a plot and back; it starts as "this year".
 */
export function PlantedInRange({ today }: { today: string }) {
  const [params, setParams] = useSearchParams()
  const ids = useId()
  const from = isDay(params.get('from')) ? params.get('from')! : `${today.slice(0, 4)}-01-01`
  const to = isDay(params.get('to')) ? params.get('to')! : today
  const reversed = from > to
  const stats = usePlantedStats(reversed ? null : { from, to })
  const setRange = (f: string, t: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set('from', f)
        next.set('to', t)
        return next
      },
      { replace: true },
    )
  const shown = stats.data && !reversed ? stats.data : null
  const stale = shown !== null && (shown.from !== from || shown.to !== to)

  return (
    <section className="card" aria-labelledby={`${ids}h`}>
      <h2 id={`${ids}h`}>Sown &amp; planted by date</h2>
      <fieldset className="range-presets">
        <legend className="visually-hidden">Quick ranges</legend>
        {presets(today).map((p) => (
          <button
            key={p.label}
            type="button"
            className={`chip${p.from === from && p.to === to ? ' is-on' : ''}`}
            aria-pressed={p.from === from && p.to === to}
            onClick={() => setRange(p.from, p.to)}
          >
            {p.label}
          </button>
        ))}
      </fieldset>
      <div className="range-dates">
        <div>
          <label htmlFor={`${ids}from`}>From</label>
          <input
            id={`${ids}from`}
            type="date"
            value={from}
            aria-invalid={reversed || undefined}
            onChange={(e) => e.target.value && setRange(e.target.value, to)}
          />
        </div>
        <div>
          <label htmlFor={`${ids}to`}>To</label>
          <input
            id={`${ids}to`}
            type="date"
            value={to}
            aria-invalid={reversed || undefined}
            onChange={(e) => e.target.value && setRange(from, e.target.value)}
          />
        </div>
      </div>
      {reversed && (
        <p className="note warn" role="alert">
          The start date is after the end date.
        </p>
      )}
      {!reversed && stats.isPending && stats.fetchStatus === 'paused' && <p className="note">No connection. Stats need signal.</p>}
      {!reversed && stats.isPending && stats.fetchStatus !== 'paused' && <p className="muted">Loading…</p>}
      {!reversed && stats.isError && (
        <div className="note warn" role="alert">
          {friendlyError(stats.error)}{' '}
          <button type="button" className="btn" onClick={() => void stats.refetch()}>
            Try again
          </button>
        </div>
      )}
      {shown && (
        <div aria-busy={stale} className={stale ? 'is-stale' : undefined}>
          <p className="muted small" aria-live="polite">
            {formatDay(shown.from, today)} – {formatDay(shown.to, today)}, both days included
            {stale ? ' · updating…' : ''}
          </p>
          <PlotTable stats={shown} />
          <SpeciesTable stats={shown} />
        </div>
      )}
    </section>
  )
}

function PlotTable({ stats }: { stats: PlantedStats }) {
  if (stats.plots.length === 0) return <p className="muted small">No plots yet.</p>
  const holes = stats.plots.reduce((t, p) => t + p.holes_sown, 0)
  const trees = stats.plots.reduce((t, p) => t + p.trees_planted, 0)
  return (
    <table className="trees planted">
      <caption className="visually-hidden">Per plot</caption>
      <thead>
        <tr>
          <th scope="col">Plot</th>
          <th scope="col">Covas sown</th>
          <th scope="col">Trees planted</th>
        </tr>
      </thead>
      <tbody>
        {stats.plots.map((p) => (
          <tr key={p.plot_id}>
            <th scope="row">{p.name}</th>
            <td>{n(p.holes_sown)}</td>
            <td>{n(p.trees_planted)}</td>
          </tr>
        ))}
        {stats.plots.length > 1 && (
          <tr className="trees__total">
            <th scope="row">All plots</th>
            <td>{n(holes)}</td>
            <td>{n(trees)}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function SpeciesTable({ stats }: { stats: PlantedStats }) {
  return (
    <>
      <h3 className="stats__h">Per species</h3>
      {stats.species.length === 0 ? (
        <p className="muted small">No species logged on sowings or plantings in these dates.</p>
      ) : (
        <>
          <table className="trees planted">
            <caption className="visually-hidden">Per species</caption>
            <thead>
              <tr>
                <th scope="col">Species</th>
                <th scope="col">Covas sown</th>
                <th scope="col">Trees planted</th>
              </tr>
            </thead>
            <tbody>
              {stats.species.map((s) => (
                <tr key={s.species_id}>
                  <th scope="row">
                    {s.common_name ?? <i>{s.scientific_name}</i>}
                    {s.common_name && (
                      <span className="planted__sci">
                        <i>{s.scientific_name}</i>
                      </span>
                    )}
                  </th>
                  <td>{n(s.holes_sown)}</td>
                  <td>{n(s.trees_planted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            A cova sown with a seed mix counts for each species in it. Trees of a mixed planting count per species only
            when the count per species was logged.
          </p>
        </>
      )}
    </>
  )
}
