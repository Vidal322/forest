import { zoneCode, type Zone } from '../api/plots'

/** The zone's code ("Z3") set before its name; "nova" while it hasn't reached the server. */
export function ZoneCode({ zone }: { zone: Pick<Zone, 'code'> }) {
  return <span className={`zone-code${zone.code ? '' : ' zone-code--new'}`}>{zoneCode(zone)}</span>
}
