import { DomEvent, type Polygon as LeafletPolygon, type PathOptions } from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Polygon, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { formatHa, type Plot, type Polygon as Geom, type Zone } from '../api/plots'
import { zoneStatus, type ZoneStatus } from '../domain/zoneStatus'
import { PLOT_COLOR, STATUS_COLOR } from './colors'
import { outerRingLatLngs, toLatLng, type FramePoint } from './frame'
import { openRing, ringArea } from './geometry'

const ringLatLngs = (g: Geom) => outerRingLatLngs(g.coordinates)
const corners = (g: Geom) => openRing(g.coordinates[0] ?? [])

/** Zone labels only where the zone is wide enough on screen to hold one. */
const LABEL_MIN_PX = 80

function widthOf(g: Geom): number {
  const xs = corners(g).map((p) => p[0])
  return Math.max(...xs) - Math.min(...xs)
}

/** Top-most corner (smallest y; leftmost on ties): where the plot's name goes, out of its zones' way. */
function topCorner(g: Geom): FramePoint {
  return corners(g).reduce((best, p) => (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0]) ? p : best))
}

function zoneStyle(status: ZoneStatus, selected: boolean): PathOptions {
  const color = STATUS_COLOR[status]
  return {
    color: selected || status === 'unsown' ? '#fff' : color,
    weight: selected ? 4 : 2,
    fillColor: color,
    fillOpacity: selected ? 0.7 : status === 'path' ? 0.55 : 0.45,
    dashArray: status === 'needs-water' ? '6 4' : status === 'unsown' ? '3 3' : undefined,
  }
}

/** Plots (outlines) and zones (filled by status) on the field map. */
export function FieldLayers({
  plots,
  zones,
  today,
  selectedId,
  selectedIds,
  onSelectZone,
  onBackgroundClick,
  interactive = true,
}: {
  plots: Plot[]
  zones: Zone[]
  today: string
  selectedId?: string | null
  /** several selected zones (quick log); drawn like the selected one */
  selectedIds?: ReadonlySet<string>
  onSelectZone?: (z: Zone) => void
  /** A tap on the map outside any zone (e.g. to close the zone's sheet). */
  onBackgroundClick?: () => void
  /** false while drawing: taps must land on the map, not open a zone. */
  interactive?: boolean
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    click: () => onBackgroundClick?.(),
  })
  const scale = 2 ** zoom // screen px per frame unit

  // Bigger zones first, so a small zone inside (or overlapping) a big one stays on top and tappable.
  const ordered = useMemo(
    () => [...zones].sort((a, b) => ringArea(corners(b.geom)) - ringArea(corners(a.geom)) || a.id.localeCompare(b.id)),
    [zones],
  )

  const layerRefs = useRef(new Map<string, LeafletPolygon>())
  const selected = zones.find((z) => z.id === selectedId)
  // selected zones on top, so their white outline isn't hidden under a neighbour
  const selectionKey = [...(selectedIds ?? [])].sort().join(',')
  useEffect(() => {
    for (const id of selectionKey ? selectionKey.split(',') : []) layerRefs.current.get(id)?.bringToFront()
  }, [selectionKey, zones])
  useEffect(() => {
    if (!selected) return
    layerRefs.current.get(selected.id)?.bringToFront()
    // keep the zone visible above the sheet that covers the bottom of the screen
    const size = map.getSize()
    const sheet = size.x < 900 ? Math.round(size.y * 0.6) : 0
    const c = corners(selected.geom)
    const center: FramePoint = [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length]
    map.panInside(toLatLng(center), { paddingTopLeft: [20, 20], paddingBottomRight: [20, sheet + 20] })
    // only when the selection changes, not on every edit of the zone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, map])

  return (
    <>
      {plots.map((p) => (
        <Polygon key={p.id} positions={ringLatLngs(p.geom)} interactive={false} pathOptions={{ color: PLOT_COLOR, weight: 3, fill: false }}>
          <Tooltip permanent direction="right" offset={[6, 14]} position={toLatLng(topCorner(p.geom))} className="map-label map-label--plot">
            {p.name}
            {p.area_ha !== null ? ` · ${formatHa(p.area_ha)}` : ''}
          </Tooltip>
        </Polygon>
      ))}
      {ordered.map((z) => {
        const status = zoneStatus(z, today)
        const isSelected = z.id === selectedId || Boolean(selectedIds?.has(z.id))
        const showLabel = z.label && z.kind === 'cultivation' && widthOf(z.geom) * scale >= LABEL_MIN_PX
        return (
          <Polygon
            // `interactive` is read by Leaflet only once: remount when it changes
            key={`${z.id}:${interactive}`}
            ref={(layer) => {
              if (layer) layerRefs.current.set(z.id, layer)
              else layerRefs.current.delete(z.id)
            }}
            className="map-zone"
            positions={ringLatLngs(z.geom)}
            pathOptions={zoneStyle(status, isSelected)}
            interactive={interactive}
            eventHandlers={
              onSelectZone
                ? {
                    click: (e) => {
                      DomEvent.stopPropagation(e) // not a background tap
                      onSelectZone(z)
                    },
                  }
                : undefined
            }
          >
            {showLabel && (
              <Tooltip permanent direction="center" className="map-label map-label--zone">
                {z.label}
              </Tooltip>
            )}
          </Polygon>
        )
      })}
    </>
  )
}
