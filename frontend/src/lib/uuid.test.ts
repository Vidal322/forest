import { describe, expect, it } from 'vitest'
import { newId } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  it('makes a v4 UUID', () => {
    expect(newId()).toMatch(V4)
  })

  it('works without crypto.randomUUID (plain http on the LAN)', () => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const ids = new Set(Array.from({ length: 50 }, newId))
      expect(ids.size).toBe(50)
      for (const id of ids) expect(id).toMatch(V4)
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID
    }
  })
})
