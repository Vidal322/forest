import { describe, expect, it } from 'vitest'
import { centroid, closeRing, insertionIndex, openRing, pointInRing, pointNearRing, ringArea, selfIntersects } from './geometry'

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]

describe('geometry', () => {
  it('knows inside from outside', () => {
    expect(pointInRing([5, 5], square)).toBe(true)
    expect(pointInRing([15, 5], square)).toBe(false)
    expect(pointNearRing([10.5, 5], square)).toBe(true) // within 1 unit of the edge
    expect(pointNearRing([12, 5], square)).toBe(false)
  })

  it('measures area for open and closed rings', () => {
    expect(ringArea(square)).toBe(100)
    expect(ringArea(closeRing(square))).toBe(100)
  })

  it('spots an outline that crosses itself', () => {
    expect(selfIntersects(square)).toBe(false)
    expect(
      selfIntersects([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(true)
    expect(selfIntersects([[0, 0], [10, 0], [5, 5]])).toBe(false)
  })

  it('closes and opens rings', () => {
    expect(closeRing(square)).toHaveLength(5)
    expect(openRing(closeRing(square))).toEqual(square)
    expect(centroid(square)).toEqual([5, 5])
  })
})

describe('insertionIndex', () => {
  it('appends until there is a triangle, then inserts on the nearest edge', () => {
    expect(insertionIndex([], [1, 1])).toBe(0)
    expect(insertionIndex([[0, 0]], [1, 1])).toBe(1)
    const tri: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    expect(insertionIndex(tri, [5, -2])).toBe(1) // near edge 0–1
    expect(insertionIndex(tri, [-2, 8])).toBe(3) // near the closing edge 2–0: goes at the end
  })
})

describe('ringInsideRing', async () => {
  const { ringInsideRing, dedupeCorners } = await import('./geometry')
  // an L-shaped plot: the top-right quarter is missing
  const L: [number, number][] = [
    [0, 0],
    [50, 0],
    [50, 50],
    [100, 50],
    [100, 100],
    [0, 100],
  ]
  it('accepts a shape inside, also touching the edge', () => {
    expect(ringInsideRing([[10, 10], [40, 10], [40, 40]], L)).toBe(true)
    expect(ringInsideRing([[0, 0], [50, 0], [50, 50], [0, 50]], L)).toBe(true)
  })
  it('refuses a shape whose corners are inside but an edge cuts the notch', () => {
    expect(ringInsideRing([[40, 10], [45, 10], [90, 60], [85, 60]], L)).toBe(false)
  })
  it('drops repeated corners', () => {
    expect(dedupeCorners([[0, 0], [10, 0], [10, 0], [10, 10], [0, 0]])).toEqual([[0, 0], [10, 0], [10, 10]])
  })
})
