import type { FramePoint } from './frame'

/** [a b c d e f]: frame x' = a·x + b·y + c, y' = d·x + e·y + f, for photo pixel (x, y). */
export type Affine = readonly [number, number, number, number, number, number]

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0]

export function applyAffine(t: Affine, [x, y]: FramePoint): FramePoint {
  return [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]]
}

export function isIdentity(t: Affine): boolean {
  return t.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9)
}

/** A stored transform, or identity if it isn't 6 finite numbers. */
export function toAffine(v: unknown): Affine {
  return Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (v as unknown as Affine)
    : IDENTITY
}

type Pt = { x: number; y: number }

/**
 * The CSS matrix that maps a w×h <img> onto three screen points: where its
 * top-left, top-right and bottom-left corners must land.
 */
export function cssMatrix(p0: Pt, p1: Pt, p2: Pt, w: number, h: number): string {
  const a = (p1.x - p0.x) / w
  const b = (p1.y - p0.y) / w
  const c = (p2.x - p0.x) / h
  const d = (p2.y - p0.y) / h
  return `matrix(${a}, ${b}, ${c}, ${d}, ${p0.x}, ${p0.y})`
}
