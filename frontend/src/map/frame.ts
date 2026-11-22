import { CRS, Transformation, latLng, latLngBounds, type LatLng, type LatLngBounds } from 'leaflet'

/**
 * The field's coordinate frame: pixels of the first field photo, origin top-left,
 * x to the right, y DOWN (docs/data-model.md §1). No latitude/longitude anywhere.
 *
 * Leaflet only knows "lat/lng", so the frame is mapped as lat = y, lng = x.
 * CRS.Simple puts y up; this CRS flips it so y grows downwards like image pixels,
 * which means a frame point needs no conversion beyond swapping the order.
 * At zoom 0, one frame unit is one screen pixel.
 */
export const FRAME_CRS = { ...CRS.Simple, transformation: new Transformation(1, 0, 1, 0) }

/** A point in frame units, `[x, y]` — the same order as GeoJSON coordinates. */
export type FramePoint = readonly [x: number, y: number]

export function toLatLng([x, y]: FramePoint): LatLng {
  return latLng(y, x)
}

export function toFramePoint(ll: LatLng): FramePoint {
  return [ll.lng, ll.lat]
}

/** The whole photo: from the top-left corner (0, 0) to (width, height). */
export function frameBounds(width: number, height: number): LatLngBounds {
  return latLngBounds(toLatLng([0, 0]), toLatLng([width, height]))
}

/**
 * The zoom at which a `photo` fits entirely inside a `view` (both in pixels / frame units),
 * rounded down to a multiple of `snap` so the whole photo stays visible.
 * With FRAME_CRS, zoom z shows one frame unit as 2^z screen pixels.
 */
export function fitZoom(
  view: { x: number; y: number },
  photo: { width: number; height: number },
  snap: number,
): number {
  const exact = Math.log2(Math.min(view.x / photo.width, view.y / photo.height))
  return snap > 0 ? Math.floor(exact / snap + 1e-9) * snap : exact
}
