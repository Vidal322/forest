import { describe, expect, it } from 'vitest'
import { applyAffine, isIdentity } from './affine'

describe('affine', () => {
  it('maps a newer photo’s pixels onto the frame', () => {
    expect(applyAffine([2, 0, 10, 0, 2, 20], [5, 5])).toEqual([20, 30])
    expect(isIdentity([1, 0, 0, 0, 1, 0])).toBe(true)
    expect(isIdentity([2, 0, 0, 0, 2, 0])).toBe(false)
  })
})

describe('cssMatrix', async () => {
  const { cssMatrix, toAffine } = await import('./affine')
  it('maps the image corners onto the three screen points (y down)', () => {
    // 100×50 image, shown twice as big and moved to (10, 20)
    expect(cssMatrix({ x: 10, y: 20 }, { x: 210, y: 20 }, { x: 10, y: 120 }, 100, 50)).toBe('matrix(2, 0, 0, 2, 10, 20)')
    // rotated 90° clockwise: the top edge points down the screen
    expect(cssMatrix({ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 0 }, 100, 50)).toBe('matrix(0, 1, -1, 0, 50, 0)')
  })
  it('falls back to identity for a malformed stored transform', () => {
    expect(toAffine([1, 2])).toEqual([1, 0, 0, 0, 1, 0])
    expect(toAffine([2, 0, 0, 0, 2, 0])).toEqual([2, 0, 0, 0, 2, 0])
  })
})
