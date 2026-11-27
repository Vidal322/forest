import { divIcon, type LeafletEvent, type Marker as LeafletMarker } from 'leaflet'
import { useMemo } from 'react'
import { Marker, Polyline } from 'react-leaflet'
import { toFramePoint, toLatLng, type FramePoint } from './frame'

// 44 px to grab with a thumb; the exact point is the small dot in the middle,
// and the letter sits beside it so the finger never hides what's underneath.
const handleIcon = (label: string) =>
  divIcon({ className: 'map-handle', html: `<i></i><span>${label}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] })

/**
 * A line with two draggable ends, in frame units. Used to set the scale: drag the
 * ends onto something whose real length is known.
 */
export function CalibrationLine({
  value,
  onChange,
  onDragEnd,
}: {
  value: readonly [FramePoint, FramePoint]
  onChange: (next: [FramePoint, FramePoint]) => void
  /** Called once a drag is finished (for announcements, "has been placed" checks). */
  onDragEnd?: () => void
}) {
  const [a, b] = value
  const icons = useMemo(() => [handleIcon('A'), handleIcon('B')] as const, [])
  const move = (i: 0 | 1) => (e: LeafletEvent) => {
    const p = toFramePoint((e.target as LeafletMarker).getLatLng())
    const rounded: FramePoint = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]
    onChange(i === 0 ? [rounded, b] : [a, rounded])
  }
  return (
    <>
      {/* dark halo under a white dashed line: visible on light and dark ground */}
      <Polyline positions={[toLatLng(a), toLatLng(b)]} pathOptions={{ color: '#1d1c18', weight: 7, opacity: 0.6 }} />
      <Polyline positions={[toLatLng(a), toLatLng(b)]} pathOptions={{ color: '#fff', weight: 3, dashArray: '10 6' }} />
      <Marker
        position={toLatLng(a)}
        icon={icons[0]}
        draggable
        keyboard={false}
        title="Início da linha da escala (arrasta)"
        eventHandlers={{ drag: move(0), dragend: (e) => (move(0)(e), onDragEnd?.()) }}
      />
      <Marker
        position={toLatLng(b)}
        icon={icons[1]}
        draggable
        keyboard={false}
        title="Fim da linha da escala (arrasta)"
        eventHandlers={{ drag: move(1), dragend: (e) => (move(1)(e), onDragEnd?.()) }}
      />
    </>
  )
}
