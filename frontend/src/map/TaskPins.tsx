import { divIcon, DomEvent, type Marker as LeafletMarker } from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, useMap, useMapEvents } from 'react-leaflet'
import { TASK_KIND } from '../api/tasks'
import { toLatLng } from './frame'
import { pinTitle, type TaskSpot } from './taskSpots'
import { iconSvg } from '../components/icons'

/** A pin's title only where its place is this wide on screen (else the pins' labels pile up). */
const LABEL_MIN_PX = 120

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Red pins for the open tasks; tapping one calls `onPick` with its place. */
export function TaskPins({
  spots,
  selectedKey,
  onPick,
}: {
  spots: TaskSpot[]
  selectedKey?: string | null
  onPick: (spot: TaskSpot) => void
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const scale = 2 ** zoom
  return (
    <>
      {spots.map((s) => (
        <Pin
          key={s.key}
          spot={s}
          label={s.width * scale >= LABEL_MIN_PX}
          selected={s.key === selectedKey}
          onPick={onPick}
        />
      ))}
    </>
  )
}

function Pin({
  spot,
  label,
  selected,
  onPick,
}: {
  spot: TaskSpot
  label: boolean
  selected: boolean
  onPick: (spot: TaskSpot) => void
}) {
  const n = spot.tasks.length
  const first = spot.tasks[0]!
  const mark = n === 1 ? iconSvg(TASK_KIND[first.kind].icon, 16) : escape(String(n))
  const text = n === 1 ? first.title : `${n} tarefas`
  const icon = useMemo(
    () =>
      divIcon({
        className: `map-task-pin${n > 1 ? ' map-task-pin--many' : ''}${selected ? ' is-selected' : ''}`,
        // hidden from screen readers: the marker's title names the pin
        html: `<i aria-hidden="true">${mark}</i>${label ? `<span aria-hidden="true">${escape(text)}</span>` : ''}`,
        // 44 px to tap; the dot sits just under the place's centre, clear of the zone's name
        iconSize: [44, 44],
        iconAnchor: [22, 0],
      }),
    [mark, text, label, n, selected],
  )
  const title = pinTitle(spot)
  // Leaflet sets the title only on the first icon (a divIcon reuses its element): keep it current
  const marker = useRef<LeafletMarker>(null)
  useEffect(() => {
    marker.current?.getElement()?.setAttribute('title', title)
  }, [title, icon])
  return (
    <Marker
      ref={marker}
      position={toLatLng(spot.at)}
      icon={icon}
      title={title}
      zIndexOffset={selected ? 1000 : 0}
      eventHandlers={{
        click: (e) => {
          DomEvent.stopPropagation(e) // not a background tap
          onPick(spot)
        },
      }}
    />
  )
}
