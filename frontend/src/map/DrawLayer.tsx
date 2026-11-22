import { divIcon, DomEvent, type LeafletEvent, type Marker as LeafletMarker } from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { Marker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet'
import { toFramePoint, toLatLng, type FramePoint } from './frame'
import { dedupeCorners, insertionIndex } from './geometry'

const cornerIcon = divIcon({ className: 'map-corner', html: '<i></i>', iconSize: [44, 44], iconAnchor: [22, 22] })
const selectedIcon = divIcon({ className: 'map-corner is-selected', html: '<i></i>', iconSize: [44, 44], iconAnchor: [22, 22] })

const round = (p: FramePoint): FramePoint => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]

/**
 * The outline being drawn: tap the map to add a corner, drag a corner to move it,
 * tap a corner to select it (so it can be removed). `valid` colours it white or red.
 * With `readOnly` it only shows the outline (while the details are being filled in).
 */
export function DrawLayer({
  corners,
  onChange,
  valid,
  selected = null,
  onSelect,
  readOnly = false,
  liveValid,
}: {
  corners: FramePoint[]
  onChange?: (next: FramePoint[]) => void
  valid: boolean
  selected?: number | null
  onSelect?: (index: number | null) => void
  readOnly?: boolean
  /** validity of a shape while a corner is being dragged */
  liveValid?: (corners: FramePoint[]) => boolean
}) {
  const map = useMap()
  // a double-tap is two clicks: while drawing it would add a corner instead of only zooming
  useEffect(() => {
    if (readOnly) return
    map.doubleClickZoom.disable()
    return () => {
      map.doubleClickZoom.enable()
    }
  }, [map, readOnly])

  useMapEvents({
    click(e) {
      if (readOnly || !onChange) return
      const p = round(toFramePoint(e.latlng))
      const i = insertionIndex(corners, p)
      onChange(dedupeCorners([...corners.slice(0, i), p, ...corners.slice(i)]))
    },
  })

  // the corner being dragged, so the outline follows the finger
  const [dragging, setDragging] = useState<{ i: number; p: FramePoint } | null>(null)
  const shown = useMemo(
    () => (dragging ? corners.map((c, i) => (i === dragging.i ? dragging.p : c)) : corners),
    [corners, dragging],
  )
  const positions = useMemo(() => shown.map((p) => toLatLng(p)), [shown])
  const markerPositions = useMemo(() => corners.map((p) => toLatLng(p)), [corners])
  const ok = dragging && liveValid ? liveValid(shown) : valid
  const color = ok ? '#fff' : '#ff5b4a'

  return (
    <>
      {shown.length >= 3 ? (
        <Polygon
          positions={positions}
          interactive={false}
          pathOptions={{ color, weight: 3, dashArray: '8 5', fillColor: '#fff', fillOpacity: 0.25 }}
        />
      ) : (
        shown.length === 2 && (
          <Polyline positions={positions} interactive={false} pathOptions={{ color, weight: 3, dashArray: '8 5' }} />
        )
      )}
      {!readOnly &&
        markerPositions.map((pos, i) => (
          <Marker
            // corners have no identity but their order
            key={i}
            position={pos}
            icon={i === selected ? selectedIcon : cornerIcon}
            draggable
            keyboard={false}
            title={`Corner ${i + 1}: drag to move, tap to select`}
            eventHandlers={{
              click: (e: LeafletEvent) => {
                DomEvent.stopPropagation(e)
                onSelect?.(i === selected ? null : i)
              },
              drag: (e: LeafletEvent) => setDragging({ i, p: round(toFramePoint((e.target as LeafletMarker).getLatLng())) }),
              dragend: (e: LeafletEvent) => {
                setDragging(null)
                const next = [...corners]
                next[i] = round(toFramePoint((e.target as LeafletMarker).getLatLng()))
                onChange?.(dedupeCorners(next))
              },
            }}
          />
        ))}
    </>
  )
}
