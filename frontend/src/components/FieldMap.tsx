import 'leaflet/dist/leaflet.css'
import { Browser, type Map as LeafletMap } from 'leaflet'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ImageOverlay, MapContainer, ZoomControl } from 'react-leaflet'
import { isIdentity, type Affine } from '../map/affine'
import { AffineImage } from '../map/AffineImage'
import { FRAME_CRS, fitZoom, frameBounds } from '../map/frame'

export interface FieldPhoto {
  url: string
  /** Size of the frame (pixels of the first photo): the map's extent. */
  width: number
  height: number
  /**
   * A newer photo's own size and its transform onto the frame. Absent (or identity)
   * when the photo is the frame itself.
   */
  image?: { width: number; height: number; affine: Affine }
}

/** How far past the photo's edges you can zoom out, in zoom levels (each level halves the size). */
const ZOOM_OUT_SLACK = 0.5
/** Closest zoom: 1 frame unit = 2^MAX_ZOOM screen pixels. */
const MAX_ZOOM = 3

/**
 * The field photo on its pixel coordinate frame, with pinch-zoom and pan.
 * Shapes (plots, zones, tasks) are passed as children, in the same frame (see map/frame.ts).
 *
 * Leaflet reads maxBounds and friends only once, so give this component a `key` that changes
 * with the photo's size: that recreates the map together with this component's state.
 */
export function FieldMap({
  photo,
  children,
  wheelZoom = true,
  doubleTapZoom = true,
}: {
  photo: FieldPhoto
  children?: ReactNode
  /** false for a map inside a scrolling page: the mouse wheel then scrolls the page. */
  wheelZoom?: boolean
  /** false where every tap places something: a double-tap would place it twice. */
  doubleTapZoom?: boolean
}) {
  const { width, height } = photo
  const bounds = useMemo(() => frameBounds(width, height), [width, height])
  // Room to pan half a photo past each edge, so corners can be centred under a thumb.
  const panBounds = useMemo(() => bounds.pad(0.5), [bounds])
  const [map, setMap] = useState<LeafletMap | null>(null)

  useEffect(() => {
    if (!map) return
    const fit = () => {
      const size = map.getSize()
      if (size.x === 0 || size.y === 0) return // not laid out yet (or hidden)
      // Not map.getBoundsZoom: it clamps to the current minZoom, which is what we are computing.
      // Same rule as Leaflet: fractional zoom only where CSS 3D transforms exist (all current phones).
      const snap = Browser.any3d ? (map.options.zoomSnap ?? 1) : 1
      const zoom = fitZoom(size, { width, height }, snap)
      map.setMinZoom(zoom - Math.max(ZOOM_OUT_SLACK, snap))
      return zoom
    }
    if (fit() !== undefined) map.fitBounds(bounds, { animate: false })
    // A phone rotation changes the size: keep "zoomed all the way out" meaning "whole field visible".
    map.on('resize', fit)
    // Leaflet only watches window resizes; the header (status pill) can also change the map's height.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize())
    observer?.observe(map.getContainer())
    return () => {
      observer?.disconnect()
      map.off('resize', fit)
    }
  }, [map, bounds, width, height])

  return (
    <section className="fieldmap" aria-label="Mapa do terreno">
      <MapContainer
        ref={setMap}
        className="fieldmap__map"
        crs={FRAME_CRS}
        bounds={bounds}
        // No maxBoundsViscosity: Leaflet's drag limit assumes north is up, which is wrong for y-down.
        // The view still springs back inside these bounds when the drag ends.
        maxBounds={panBounds}
        // Low until the effect sets the real floor; else the first fit is clamped to zoom 0.
        minZoom={-8}
        maxZoom={MAX_ZOOM}
        zoomSnap={0.25}
        zoomDelta={0.5}
        attributionControl={false}
        // Leaflet's own control is titled in English
        zoomControl={false}
        scrollWheelZoom={wheelZoom}
        doubleClickZoom={doubleTapZoom}
      >
        <ZoomControl position="topleft" zoomInTitle="Aproximar" zoomOutTitle="Afastar" />
        {photo.image && !isIdentity(photo.image.affine) ? (
          <AffineImage
            url={photo.url}
            width={photo.image.width}
            height={photo.image.height}
            affine={photo.image.affine}
            alt="Fotografia aérea do terreno"
          />
        ) : (
          <ImageOverlay url={photo.url} bounds={bounds} alt="Fotografia aérea do terreno" />
        )}
        {children}
      </MapContainer>
      <button
        type="button"
        className="fieldmap__fit"
        onClick={() => map?.fitBounds(bounds, { animate: !prefersReducedMotion() })}
        disabled={!map}
      >
        Terreno todo
      </button>
    </section>
  )
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
