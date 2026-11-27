import { useIsMutating } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { OUTBOX_SCOPE } from '../api/outbox'
import { friendlyError } from '../api/errors'
import { formatHa } from '../api/plots'
import { usePlotStats, type PlotStats } from '../api/stats'
import { PlantedInRange } from '../components/PlantedInRange'
import { relativeDay } from '../domain/dates'
import { formatNumber as n } from '../domain/numbers'
import { useFieldToday } from '../hooks/useFieldToday'

/** Per plot: area (measured vs the old map), what was sown/planted (all time and between two dates), watering, and what's pending. */
export function StatsPage() {
  const stats = usePlotStats()
  const pending = useIsMutating({ predicate: (m) => m.options.scope?.id === OUTBOX_SCOPE.id })
  const today = useFieldToday()
  const offline = stats.isPending && stats.fetchStatus === 'paused'
  // "#plot-<id>" (from a plot's page): bring that plot's card into view once it is there
  const location = useLocation()
  const shownFor = useRef<string | null>(null)
  const loaded = stats.data !== undefined
  useEffect(() => {
    if (!loaded || !location.hash.startsWith('#plot-') || shownFor.current === location.key) return
    shownFor.current = location.key
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ block: 'start' }))
  }, [loaded, location.hash, location.key])
  const totals = (stats.data ?? []).reduce(
    (t, p) => ({ area: t.area + (p.area_ha ?? 0), holes: t.holes + p.holes_sown, trees: t.trees + p.trees_planted, dry: t.dry + p.zones_need_water }),
    { area: 0, holes: 0, trees: 0, dry: 0 },
  )
  return (
    <div className="page">
      <h1>Estatísticas</h1>
      {offline && <p className="note">Sem rede. As estatísticas precisam de rede.</p>}
      {stats.isPending && !offline && <p className="muted">A carregar…</p>}
      {stats.isError && (
        <div className="note warn" role="alert">
          {friendlyError(stats.error)}{' '}
          <button type="button" className="btn" onClick={() => void stats.refetch()}>
            Tentar outra vez
          </button>
        </div>
      )}
      {stats.data?.length === 0 && (
        <p className="muted">
          Ainda não há parcelas. <Link to="/">Desenha-as no mapa.</Link>
        </p>
      )}
      {stats.data && (
        <p className="muted small" aria-live="polite">
          Atualizado {relativeTime(stats.dataUpdatedAt)}
          {stats.isFetching ? ' · a atualizar…' : ''}
          {pending > 0
            ? ` · ${pending === 1 ? '1 alteração ainda não enviada, não contada aqui' : `${pending} alterações ainda não enviadas, não contadas aqui`}`
            : ''}
        </p>
      )}
      {stats.data && stats.data.length > 1 && (
        <div className="stats stats--totals" aria-label="Terreno todo">
          <Stat label="Área do terreno" value={totals.area > 0 ? formatHa(totals.area) : '—'} />
          <Stat label="Covas semeadas" value={n(totals.holes)} />
          <Stat label="Árvores plantadas" value={n(totals.trees)} />
          <Stat label="Zonas por regar" value={n(totals.dry)} warn={totals.dry > 0} />
        </div>
      )}
      {stats.data && stats.data.length > 0 && <PlantedInRange today={today} />}
      {stats.data?.map((p) => <PlotCard key={p.plot_id} p={p} today={today} />)}
      {stats.data && stats.data.some((p) => p.area_ha === null) && (
        <p className="muted small">
          As áreas aparecem quando a escala estiver marcada em <Link to="/field">Configurar o terreno</Link>.
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
      <h2 id={`plot-${p.plot_id}`}>
        <Link to={`/plots/${p.plot_id}`}>
          {p.name} <span aria-hidden="true">›</span>
        </Link>
      </h2>
      <p className="muted">
        {p.area_ha !== null ? `${formatHa(p.area_ha)} medidos` : 'Área ainda por medir'}
        {p.declared_area_ha !== null && ` · ${formatHa(p.declared_area_ha)} no mapa antigo`}
        {diff !== null && ` (${diff >= 0 ? '+' : ''}${diff.toFixed(0)} %)`}
      </p>
      <div className="stats">
        <Stat label={p.zone_count === 1 ? 'zona' : 'zonas'} value={n(p.zone_count)} />
        <Stat label="por regar agora" value={n(p.zones_need_water)} warn={p.zones_need_water > 0} />
        <Stat label="covas semeadas" value={n(p.holes_sown)} />
        <Stat label="árvores plantadas" value={n(p.trees_planted)} />
        <Stat label={p.species_count === 1 ? 'espécie' : 'espécies'} value={n(p.species_count)} />
        <Stat label="regas, 30 dias" value={n(p.waterings_last_30d)} />
        {p.litres_watered > 0 && <Stat label="litros de rega" value={n(p.litres_watered)} />}
        {(p.tree_count > 0 || p.dead_tree_count > 0) && <Stat label="árvores vivas / mortas" value={`${n(p.tree_count)} / ${n(p.dead_tree_count)}`} />}
        <Stat label="tarefas por fazer" value={n(p.open_task_count)} />
      </div>
      <p className="muted small">
        Última rega: {p.last_watered_on ? relativeDay(p.last_watered_on, today) : 'nunca'}
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
      <h3 className="stats__h">Regadas nos últimos 7 dias</h3>
      {total === 0 ? (
        <p className="muted small">Ainda não há zonas de cultivo.</p>
      ) : (
        <>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="small">
            <b>
              {n(watered)} de {n(total)}
            </b>{' '}
            {total === 1 ? 'zona' : 'zonas'} de cultivo ({pct} %)
          </p>
        </>
      )}
    </>
  )
}

const weekLabel = (ago: number) => (ago === 0 ? 'últimos 7 dias' : `há ${ago * 7} a ${ago * 7 + 6} dias`)

function WeeklyActivity({ weeks }: { weeks: number[] }) {
  const max = Math.max(1, ...weeks)
  const total = weeks.reduce((a, b) => a + b, 0)
  return (
    <>
      <h3 className="stats__h">Registos por semana, últimas 8 semanas</h3>
      {total === 0 ? (
        <p className="muted small">Nada registado nas últimas 8 semanas.</p>
      ) : (
        <>
          <ol className="weeks" aria-label="Registos por semana, do mais antigo para o mais recente">
            {weeks.map((v, i) => (
              <li key={i} className={v === 0 ? 'is-zero' : undefined}>
                <span className="weeks__n" aria-hidden="true">
                  {v}
                </span>
                <span className="weeks__bar">
                  <i style={{ height: `${(v / max) * 100}%` }} />
                </span>
                <span className="visually-hidden">
                  {weekLabel(weeks.length - 1 - i)}: {v} {v === 1 ? 'registo' : 'registos'}
                </span>
              </li>
            ))}
          </ol>
          <p className="weeks__axis muted small" aria-hidden="true">
            <span>há 8 semanas</span>
            <span>agora</span>
          </p>
        </>
      )}
    </>
  )
}

function relativeTime(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`
}
