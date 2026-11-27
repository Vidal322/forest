import { useEffect, useRef, type ReactNode } from 'react'
import { formatHa, KIND_LABEL, zoneName, type Plot, type Zone } from '../api/plots'
import { formatLongDay, relativeDay } from '../domain/dates'
import { needsWater, STATUS_LABEL, zoneStatus } from '../domain/zoneStatus'
import { StatusBadge } from './StatusBadge'
import { Icon } from './Icon'

/** Bottom sheet for the zone tapped on the map (or picked from the zone list). */
export function ZoneSheet({
  zone,
  plot,
  today,
  asOf,
  onClose,
  children,
}: {
  zone: Zone
  plot: Plot | undefined
  /** the day the state is for: today, or the past day the map shows */
  today: string
  /** set when the map shows a past day (`today` is then that day) */
  asOf?: string
  onClose: () => void
  children?: ReactNode
}) {
  const status = zoneStatus(zone, today)
  const dry = needsWater(zone, today)
  const heading = useRef<HTMLHeadingElement>(null)

  // Announce and focus the sheet when it opens (or switches zone); Escape closes it.
  useEffect(() => {
    heading.current?.focus()
  }, [zone.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const facts: [string, string][] = []
  if (zone.last_watered_on) facts.push(['Rega', relativeDay(zone.last_watered_on, today)])
  if (zone.last_sown_on) facts.push(['Sementeira', relativeDay(zone.last_sown_on, today)])
  if (zone.last_planted_on) facts.push(['Plantação', relativeDay(zone.last_planted_on, today)])
  if (zone.area_ha !== null) facts.push(['Área', formatHa(zone.area_ha)])
  return (
    <section className="sheet" aria-labelledby="zone-sheet-title">
      <div className="row">
        <h2 id="zone-sheet-title" ref={heading} tabIndex={-1}>
          {zoneName(zone)}
        </h2>
        <span className="spacer" />
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Fechar">
          <Icon name="close" />
        </button>
      </div>
      {asOf && <p className="sheet__asof">A {formatLongDay(asOf)}:</p>}
      <p className="row">
        <StatusBadge status={status} label={STATUS_LABEL[status]} />
        {(plot || zone.kind !== 'cultivation') && (
          <span className="muted">{[plot?.name, zone.kind !== 'cultivation' ? KIND_LABEL[zone.kind] : null].filter(Boolean).join(', ')}</span>
        )}
      </p>
      {dry && <p className="note">Sem rega, sementeira nem plantação há {zone.current_interval_days} dias ou mais.</p>}
      {facts.length > 0 ? (
        <dl className="facts">
          {facts.map(([k, v]) => (
            <div key={k} className="facts__row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        zone.kind === 'cultivation' && <p className="muted">Ainda não registaste nada aqui.</p>
      )}
      {zone.notes && <p className="muted">{zone.notes}</p>}
      {children}
    </section>
  )
}
