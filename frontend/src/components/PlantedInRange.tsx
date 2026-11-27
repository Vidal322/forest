import { useId } from 'react'
import { useSearchParams } from 'react-router'
import { friendlyError } from '../api/errors'
import { usePlantedStats, type PlantedStats } from '../api/stats'
import { addDays, formatDay } from '../domain/dates'
import { formatNumber as n } from '../domain/numbers'

/** A real calendar day as YYYY-MM-DD (not 2026-13-45, which the address could carry). */
const isDay = (s: string | null): s is string => s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s

/** Quick ranges, ending today at the latest. */
function presets(today: string): { label: string; from: string; to: string }[] {
  const monthStart = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDays(monthStart, -1)
  return [
    { label: 'Este mês', from: monthStart, to: today },
    { label: 'Mês passado', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { label: 'Últimos 30 dias', from: addDays(today, -29), to: today },
    { label: 'Este ano', from: `${today.slice(0, 4)}-01-01`, to: today },
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
      <h2 id={`${ids}h`}>Semeado e plantado entre datas</h2>
      <fieldset className="range-presets">
        <legend className="visually-hidden">Intervalos rápidos</legend>
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
          <label htmlFor={`${ids}from`}>De</label>
          <input
            id={`${ids}from`}
            type="date"
            value={from}
            aria-invalid={reversed || undefined}
            onChange={(e) => e.target.value && setRange(e.target.value, to)}
          />
        </div>
        <div>
          <label htmlFor={`${ids}to`}>Até</label>
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
          O primeiro dia é depois do último.
        </p>
      )}
      {!reversed && stats.isPending && stats.fetchStatus === 'paused' && <p className="note">Sem rede. As estatísticas precisam de rede.</p>}
      {!reversed && stats.isPending && stats.fetchStatus !== 'paused' && <p className="muted">A carregar…</p>}
      {!reversed && stats.isError && (
        <div className="note warn" role="alert">
          {friendlyError(stats.error)}{' '}
          <button type="button" className="btn" onClick={() => void stats.refetch()}>
            Tentar outra vez
          </button>
        </div>
      )}
      {shown && (
        <div aria-busy={stale} className={stale ? 'is-stale' : undefined}>
          <p className="muted small" aria-live="polite">
            De {formatDay(shown.from, today)} a {formatDay(shown.to, today)}, os dois dias incluídos
            {stale ? ' · a atualizar…' : ''}
          </p>
          <PlotTable stats={shown} />
          <SpeciesTable stats={shown} />
        </div>
      )}
    </section>
  )
}

function PlotTable({ stats }: { stats: PlantedStats }) {
  if (stats.plots.length === 0) return <p className="muted small">Ainda não há parcelas.</p>
  const holes = stats.plots.reduce((t, p) => t + p.holes_sown, 0)
  const trees = stats.plots.reduce((t, p) => t + p.trees_planted, 0)
  return (
    <table className="trees planted">
      <caption className="visually-hidden">Por parcela</caption>
      <thead>
        <tr>
          <th scope="col">Parcela</th>
          <th scope="col">Covas semeadas</th>
          <th scope="col">Árvores plantadas</th>
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
            <th scope="row">Todas as parcelas</th>
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
      <h3 className="stats__h">Por espécie</h3>
      {stats.species.length === 0 ? (
        <p className="muted small">Nenhuma espécie registada em sementeiras ou plantações nestas datas.</p>
      ) : (
        <>
          <table className="trees planted">
            <caption className="visually-hidden">Por espécie</caption>
            <thead>
              <tr>
                <th scope="col">Espécie</th>
                <th scope="col">Covas semeadas</th>
                <th scope="col">Árvores plantadas</th>
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
            Uma cova semeada com uma mistura de sementes conta para cada espécie da mistura. As árvores de uma plantação
            mista só contam por espécie quando registaste a quantidade de cada espécie; se entretanto foram apagadas
            algumas zonas dessa plantação, essa quantidade diminui na mesma proporção.
          </p>
        </>
      )}
    </>
  )
}
