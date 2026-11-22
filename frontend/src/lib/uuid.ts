/**
 * A random (v4) UUID, made on the device so entries created offline keep their id.
 * crypto.randomUUID only exists on https/localhost; a phone opening the dev server
 * over the LAN (plain http) still has crypto.getRandomValues, so build it from that.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40 // version 4
  b[8] = (b[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
