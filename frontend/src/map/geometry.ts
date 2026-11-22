import type { FramePoint } from './frame'

/** Plane geometry in frame units, used to check a drawing before it is sent. */

/** Is p inside the ring (open or closed)? Ray casting; points on the edge may go either way. */
export function pointInRing(p: FramePoint, ring: readonly FramePoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance from p to the segment a–b. */
function distToSegment(p: FramePoint, a: FramePoint, b: FramePoint): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Inside the ring, or within `tolerance` units of its edge (the server allows 1 unit). */
export function pointNearRing(p: FramePoint, ring: readonly FramePoint[], tolerance = 1): boolean {
  if (pointInRing(p, ring)) return true
  for (let i = 0; i < ring.length; i++) {
    if (distToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= tolerance) return true
  }
  return false
}

/** Area in frame units² (shoelace; the ring may be open or closed). */
export function ringArea(ring: readonly FramePoint[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!
    const [x2, y2] = ring[(i + 1) % ring.length]!
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

function orient(a: FramePoint, b: FramePoint, c: FramePoint): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
}

function onSegment(a: FramePoint, b: FramePoint, p: FramePoint): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  )
}

function segmentsCross(a: FramePoint, b: FramePoint, c: FramePoint, d: FramePoint): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (o1 !== o2 && o3 !== o4) return true
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  )
}

/** Does the closed outline through these corners (open ring) cross itself? */
export function selfIntersects(corners: readonly FramePoint[]): boolean {
  const n = corners.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      // neighbouring edges share a corner: skip them
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(a, b, corners[j]!, corners[(j + 1) % n]!)) return true
    }
  }
  return false
}

/** The closed GeoJSON ring for these corners. */
export function closeRing(corners: readonly FramePoint[]): [number, number][] {
  const ring = corners.map((p) => [p[0], p[1]] as [number, number])
  const first = ring[0]
  if (first) ring.push([first[0], first[1]])
  return ring
}

/** The corners of a closed GeoJSON ring (without the repeated last point). */
export function openRing(ring: readonly FramePoint[]): FramePoint[] {
  const last = ring[ring.length - 1]
  const first = ring[0]
  if (ring.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1)
  return [...ring]
}

/** Average of the corners: good enough to place a label or find "which plot is this in". */
export function centroid(corners: readonly FramePoint[]): FramePoint {
  const n = corners.length || 1
  return [corners.reduce((s, p) => s + p[0], 0) / n, corners.reduce((s, p) => s + p[1], 0) / n]
}

/** Index after which a new corner goes: the edge nearest to p (or the end, under 3 corners). */
export function insertionIndex(corners: readonly FramePoint[], p: FramePoint): number {
  if (corners.length < 3) return corners.length
  let best = corners.length
  let bestDist = Infinity
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % corners.length]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
    if (d < bestDist) {
      bestDist = d
      best = i + 1
    }
  }
  return best
}
