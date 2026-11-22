import { DomUtil, type LatLng, type Map as LeafletMap, type ZoomAnimEvent } from 'leaflet'
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { applyAffine, cssMatrix, type Affine } from './affine'
import { toLatLng } from './frame'

/**
 * A photo drawn through its alignment transform onto the frame: Leaflet's
 * ImageOverlay can only place an upright rectangle, but a newer photo may be
 * shifted, scaled and slightly rotated. Its three corners go through the affine
 * transform, and a CSS matrix maps the <img> onto them.
 */
export function AffineImage({ url, width, height, affine, alt }: { url: string; width: number; height: number; affine: Affine; alt: string }) {
  const map = useMap()
  useEffect(() => {
    const img = DomUtil.create('img', 'leaflet-image-layer leaflet-zoom-animated') as HTMLImageElement
    img.src = url
    img.alt = alt
    img.style.transformOrigin = '0 0'
    img.style.width = `${width}px`
    img.style.height = `${height}px`
    // its own pane, under the drawings (overlayPane is 400): a new photo can never cover them
    const pane = map.getPane('fieldPhoto') ?? map.createPane('fieldPhoto')
    pane.style.zIndex = '350'
    pane.appendChild(img)

    const corners: LatLng[] = [
      toLatLng(applyAffine(affine, [0, 0])),
      toLatLng(applyAffine(affine, [width, 0])),
      toLatLng(applyAffine(affine, [0, height])),
    ]
    const place = (toPoint: (ll: LatLng) => { x: number; y: number }) => {
      const [p0, p1, p2] = corners.map(toPoint) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
      img.style.transform = cssMatrix(p0, p1, p2, width, height)
    }
    const reset = () => place((ll) => map.latLngToLayerPoint(ll))
    // during the zoom animation, place it where it will end up (as Leaflet's own layers do)
    const zoomAnim = (e: ZoomAnimEvent) =>
      place((ll) => (map as LeafletMap & { _latLngToNewLayerPoint: (l: LatLng, z: number, c: LatLng) => { x: number; y: number } })._latLngToNewLayerPoint(ll, e.zoom, e.center))
    reset()
    map.on('zoom viewreset', reset)
    map.on('zoomanim', zoomAnim)
    return () => {
      map.off('zoom viewreset', reset)
      map.off('zoomanim', zoomAnim)
      img.remove()
    }
  }, [map, url, width, height, affine, alt])
  return null
}
