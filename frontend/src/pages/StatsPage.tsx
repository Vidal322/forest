import { useIsMutating } from '@tanstack/react-query'
import { Link } from 'react-router'
import { OUTBOX_SCOPE } from '../api/outbox'
import { friendlyError } from '../api/errors'
import { formatHa } from '../api/plots'
import { usePlotStats, type PlotStats } from '../api/stats'
import { relativeDay } from '../domain/dates'
import { useFieldToday } from '../hooks/useFieldToday'

const n = (v: number) => v.toLocaleString('en-GB')

/** Per plot: area (measured vs the old map), what was sown/planted, watering, and what's pending. */
export function StatsPage() {
  const stats = usePlotStats()
  const pending = useIsMutating({ predicate: (m) => m.options.scope?.id === OUTBOX_SCOPE.id })
  const today = useFieldToday()
  const offline = stats.isPending && stats.fetchStatus === 'paused'
  const totals = (stats.data ?? []).reduce(
    (t, p) => ({ area: t.area + (p.area_ha ?? 0), holes: t.holes + p.holes_sown, trees: t.trees + p.trees_planted, dry: t.dry + p.zones_need_water }),
    { area: 0, holes: 0, trees: 0, dry: 0 },
  )
  return (
    <div className="page">
      <h1>Plot stats</h1>
      {offline && <p className="note">No connection. Stats need signal.</p>}
      {stats.isPending && !offline && <p className="muted">Loading…</p>}
      {stats.isError && (
        <div className="note warn" role="alert">
          {friendlyError(stats.error)}{' '}
          <button type="button" className="btn" onClick={() => void stats.refetch()}>
            Try again
          </button>
        </div>
      )}
      {stats.data?.length === 0 && (
        <p className="muted">
          No plots yet. <Link to="/">Draw them on the map.</Link>
        </p>
      )}
      {stats.data && (
        <p className="muted small" aria-live="polite">
          Updated {relativeTime(stats.dataUpdatedAt)}
          {stats.isFetching ? ' · refreshing…' : ''}
          {pending > 0 ? ` · ${pending} change${pending === 1 ? '' : 's'} not sent yet, not counted here` : ''}
        </p>
      )}
      {stats.data && stats.data.length > 1 && (
        <div className="stats stats--totals" aria-label="Whole field">
          <Stat label="Field area" value={totals.area > 0 ? formatHa(totals.area) : '—'} />
          <Stat label="Covas sown" value={n(totals.holes)} />
          <Stat label="Trees planted" value={n(totals.trees)} />
          <Stat label="Zones needing water" value={n(totals.dry)} warn={totals.dry > 0} />
        </div>
      )}
      {stats.data?.map((p) => <PlotCard key={p.plot_id} p={p} today={today} />)}
      {stats.data && stats.data.some((p) => p.area_ha === null) && (
        <p className="muted small">
          Areas appear once the scale is set in <Link to="/field">Field setup</Link>.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`stat${warn ? ' stat--warn' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function PlotCard({ p, today }: { p: PlotStats; today: string }) {
  const diff = p.area_ha !== null && p.declared_area_ha ? ((p.area_ha - p.declared_area_ha) / p.declared_area_ha) * 100 : null
  return (
    <section className="card" aria-labelledby={`plot-${p.plot_id}`}>
      <h2 id={`plot-${p.plot_id}`}>{p.name}</h2>
      <p className="muted">
        {p.area_ha !== null ? `${formatHa(p.area_ha)} measured` : 'Area not measured yet'}
        {p.declared_area_ha !== null && ` · ${formatHa(p.declared_area_ha)} on the old map`}
        {diff !== null && ` (${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%)`}
      </p>
      <div className="stats">
        <Stat label={p.zone_count === 1 ? 'zone' : 'zones'} value={n(p.zone_count)} />
        <Stat label="need water now" value={n(p.zones_need_water)} warn={p.zones_need_water > 0} />
        <Stat label="covas sown" value={n(p.holes_sown)} />
        <Stat label="trees planted" value={n(p.trees_planted)} />
        <Stat label="species" value={n(p.species_count)} />
        <Stat label="waterings, 30 days" value={n(p.waterings_last_30d)} />
        {p.litres_watered > 0 && <Stat label="litres watered" value={n(p.litres_watered)} />}
        {(p.tree_count > 0 || p.dead_tree_count > 0) && <Stat label="trees alive / dead" value={`${n(p.tree_count)} / ${n(p.dead_tree_count)}`} />}
        <Stat label="open tasks" value={n(p.open_task_count)} />
      </div>
      <p className="muted small">
        Last watered: {p.last_watered_on ? relativeDay(p.last_watered_on, today) : 'never'}
      </p>
      <WateringCoverage watered={p.zones_watered_7d} total={p.cultivation_zones} />
      <WeeklyActivity weeks={p.activities_per_week} />
    </section>
  )
}

function WateringCoverage({ watered, total }: { watered: number; total: number }) {
  const pct = total > 0 ? Math.round((watered / total) * 100) : 0
  return (
    <>
      <h3 className="stats__h">Watered in the last 7 days</h3>
      {total === 0 ? (
        <p className="muted small">No cultivation zones yet.</p>
      ) : (
        <>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="small">
            <b>
              {n(watered)} of {n(total)}
            </b>{' '}
            cultivation {total === 1 ? 'zone' : 'zones'} ({pct}%)
          </p>
        </>
      )}
    </>
  )
}

const weekLabel = (ago: number) => (ago === 0 ? 'last 7 days' : `${ago * 7}–${ago * 7 + 6} days ago`)

function WeeklyActivity({ weeks }: { weeks: number[] }) {
  const max = Math.max(1, ...weeks)
  const total = weeks.reduce((a, b) => a + b, 0)
  return (
    <>
      <h3 className="stats__h">Activity per week, last 8 weeks</h3>
      {total === 0 ? (
        <p className="muted small">Nothing logged in the last 8 weeks.</p>
      ) : (
        <>
          <ol className="weeks" aria-label="Activities logged per week, oldest first">
            {weeks.map((v, i) => (
              <li key={i} className={v === 0 ? 'is-zero' : undefined}>
                <span className="weeks__n" aria-hidden="true">
                  {v}
                </span>
                <span className="weeks__bar">
                  <i style={{ height: `${(v / max) * 100}%` }} />
                </span>
                <span className="visually-hidden">
                  {weekLabel(weeks.length - 1 - i)}: {v} {v === 1 ? 'activity' : 'activities'}
                </span>
              </li>
            ))}
          </ol>
          <p className="weeks__axis muted small" aria-hidden="true">
            <span>8 weeks ago</span>
            <span>now</span>
          </p>
        </>
      )}
    </>
  )
}

function relativeTime(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}
