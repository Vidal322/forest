import { deflateSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Locator, Page } from '@playwright/test'

/** A plain-colour PNG (the API only needs a decodable image as the field photo). */
export function makePng(width = 1200, height = 800, rgb: [number, number, number] = [96, 140, 70]): Buffer {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** Sets the field up from a generated photo unless it already is (each preview starts with an empty database). */
export async function ensureField(request: APIRequestContext, name = 'E2E field'): Promise<void> {
  const got = await request.get('/api/field')
  if (got.ok()) return
  const res = await request.post('/api/field', {
    multipart: { name, photo: { name: 'field.png', mimeType: 'image/png', buffer: makePng() } },
  })
  if (!res.ok()) throw new Error(`field setup: ${res.status()} ${await res.text()}`)
}

/** A rectangle in frame pixels as a GeoJSON polygon. */
export function rect(x: number, y: number, w: number, h: number) {
  return { type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] }
}

export async function putPlot(request: APIRequestContext, name: string, geom = rect(100, 100, 400, 300)) {
  const id = randomUUID()
  const res = await request.put(`/api/plots/${id}`, { data: { name, geom, declared_area_ha: null, notes: null } })
  if (!res.ok()) throw new Error(`plot: ${res.status()} ${await res.text()}`)
  return id
}

export async function putZone(request: APIRequestContext, plotId: string, label: string, geom = rect(150, 150, 100, 80)) {
  const id = randomUUID()
  const res = await request.put(`/api/zones/${id}`, {
    data: { plot_id: plotId, label, kind: 'cultivation', geom, notes: null },
  })
  if (!res.ok()) throw new Error(`zone: ${res.status()} ${await res.text()}`)
  return id
}

/** Saves a screenshot under e2e-results/ for the reviewer to look at (phone usability):
 * the whole page, or only `part` of it (e.g. one card) when given. */
export async function shot(page: Page, name: string, part?: Locator): Promise<void> {
  const path = `e2e-results/${name}.png`
  await (part ? part.screenshot({ path }) : page.screenshot({ path, fullPage: true }))
}
