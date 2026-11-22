import { latLng } from 'leaflet'
import { describe, expect, it } from 'vitest'
import { FRAME_CRS, fitZoom, frameBounds, toFramePoint, toLatLng } from './frame'

describe('frame coordinates', () => {
  it('round-trips a frame point through Leaflet lat/lng', () => {
    expect(toFramePoint(toLatLng([412, 233]))).toEqual([412, 233])
    expect(toLatLng([412, 233])).toEqual(latLng(233, 412))
  })

  it('puts the origin top-left with y growing downwards on screen, like image pixels', () => {
    const origin = FRAME_CRS.latLngToPoint(toLatLng([0, 0]), 0)
    const below = FRAME_CRS.latLngToPoint(toLatLng([0, 100]), 0)
    const right = FRAME_CRS.latLngToPoint(toLatLng([100, 0]), 0)
    expect(origin).toMatchObject({ x: 0, y: 0 })
    expect(below).toMatchObject({ x: 0, y: 100 }) // larger y = lower on screen
    expect(right).toMatchObject({ x: 100, y: 0 })
  })

  it('shows one frame unit as 2^zoom screen pixels, the same on both axes', () => {
    const p = FRAME_CRS.latLngToPoint(toLatLng([10, 20]), 2)
    expect(p).toMatchObject({ x: 40, y: 80 })
    expect(toFramePoint(FRAME_CRS.pointToLatLng(p, 2))).toEqual([10, 20])
  })

  it('measures distances in frame units (no Earth model)', () => {
    expect(FRAME_CRS.distance(toLatLng([0, 0]), toLatLng([300, 400]))).toBe(500)
  })

  it('bounds the photo from (0, 0) to (width, height)', () => {
    const b = frameBounds(1000, 700)
    // Leaflet's "south" is the smallest lat = smallest y, which is the TOP edge in this frame.
    expect([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).toEqual([0, 0, 1000, 700])
    expect(b.contains(toLatLng([999, 699]))).toBe(true)
    expect(b.contains(toLatLng([500, -1]))).toBe(false)
  })
})

describe('fitZoom', () => {
  it('zooms out on a phone so the whole photo fits the narrower side', () => {
    // 390 px wide phone, 1000 units wide photo: 0.39 px/unit → 2^-1.36
    const z = fitZoom({ x: 390, y: 700 }, { width: 1000, height: 700 }, 0.25)
    expect(z).toBe(-1.5)
    expect(1000 * 2 ** z).toBeLessThanOrEqual(390)
  })

  it('is limited by height on a wide, short screen', () => {
    expect(fitZoom({ x: 2000, y: 350 }, { width: 1000, height: 700 }, 0.25)).toBe(-1)
  })

  it('keeps an exact fit instead of rounding it down a step', () => {
    expect(fitZoom({ x: 2000, y: 1400 }, { width: 1000, height: 700 }, 0.25)).toBe(1)
  })

  it('does not snap when snapping is off', () => {
    expect(fitZoom({ x: 500, y: 700 }, { width: 1000, height: 700 }, 0)).toBe(-1)
  })
})
