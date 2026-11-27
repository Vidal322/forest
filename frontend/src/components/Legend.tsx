import { STATUS_LABEL, type ZoneStatus } from '../domain/zoneStatus'
import { PLOT_COLOR, STATUS_COLOR } from '../map/colors'

const ORDER: ZoneStatus[] = ['needs-water', 'watered', 'planted', 'sown', 'unsown', 'path']

export function Legend({ id }: { id?: string }) {
  return (
    <ul className="legend" id={id} aria-label="Cores do mapa">
      <li>
        <i className="swatch swatch--outline" style={{ borderColor: PLOT_COLOR }} aria-hidden="true" />
        Parcela
      </li>
      {ORDER.map((s) => (
        <li key={s}>
          <i
            // dashed like on the map: a cue that doesn't rely on colour alone
            className={`swatch${s === 'needs-water' || s === 'unsown' ? ' swatch--dashed' : ''}`}
            style={{ background: STATUS_COLOR[s] }}
            aria-hidden="true"
          />
          {STATUS_LABEL[s]}
        </li>
      ))}
      <li>
        <i className="swatch swatch--pin" aria-hidden="true" />
        Tarefa por fazer
      </li>
    </ul>
  )
}
