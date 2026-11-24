import { expect, test } from '@playwright/test'
import { ensureField, makePng, putPlot, putZone, rect, shot } from './helpers.ts'

interface PhotoInfo {
  id: string
  is_current: boolean
}

test('the map loads a light copy of a big photo, still lined up with the drawings', async ({ page, request }) => {
  await ensureField(request)
  const field = await (await request.get('/api/field')).json()
  const fw: number = field.frame_width
  const fh: number = field.frame_height
  const before: PhotoInfo[] = await (await request.get('/api/field/photos')).json()
  const was = before.find((p) => p.is_current)!

  // a newer photo twice the size of the frame (e.g. a sharper satellite screenshot), aligned by four landmarks
  const [w, h] = [fw * 2, fh * 2]
  const pts: [number, number][] = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.1, 0.9],
    [0.9, 0.9],
  ]
  const alignment = pts.map(([u, v]) => ({ photo: [u * w, v * h], frame: [u * fw, v * fh] }))
  const added = await request.post('/api/field/photos', {
    multipart: {
      photo: { name: 'sharper.png', mimeType: 'image/png', buffer: makePng(w, h, [80, 128, 60]) },
      alignment: JSON.stringify(alignment),
    },
  })
  expect(added.status(), await added.text()).toBe(201)

  try {
    const geom = rect(fw * 0.2, fh * 0.3, fw * 0.4, fh * 0.5) // off-centre: a shift would show
    const plotId = await putPlot(request, `Display plot ${Date.now()}`, geom)
    await putZone(request, plotId, 'Display zone', geom)
    await page.goto('/')
    const img = page.getByRole('img', { name: 'Aerial photo of the field' })
    await expect(img).toHaveAttribute('src', /\/api\/photos\/[0-9a-f-]+\.jpg\/display$/)
    // the 2048 px copy, not the full-size photo (e2e code has no DOM types)
    const naturalWidth = () =>
      img.evaluate((el) => {
        const i = el as unknown as { complete: boolean; naturalWidth: number }
        return i.complete ? i.naturalWidth : 0
      })
    await expect.poll(naturalWidth).toBe(2048)

    // the copy covers the whole frame, and the zone sits where its frame pixels say on it
    const box = (await img.boundingBox())!
    const scale = box.width / fw // screen px per frame unit
    expect(box.height).toBeCloseTo(fh * scale, 0)
    // the zone, found through its label (the field may hold other specs' zones)
    const labelId = await page.locator('.map-label--zone', { hasText: 'Display zone' }).getAttribute('id')
    const zone = (await page.locator(`path.map-zone[aria-describedby="${labelId}"]`).boundingBox())!
    // centres within 1 px; sizes within the outline's stroke
    expect(Math.abs(zone.x + zone.width / 2 - (box.x + fw * 0.4 * scale))).toBeLessThan(1)
    expect(Math.abs(zone.y + zone.height / 2 - (box.y + fh * 0.55 * scale))).toBeLessThan(1)
    expect(Math.abs(zone.width - fw * 0.4 * scale)).toBeLessThan(4)
    expect(Math.abs(zone.height - fh * 0.5 * scale)).toBeLessThan(4)
    await shot(page, 'display-photo-map')
  } finally {
    // leave the field showing its earlier photo for the other specs
    await request.put(`/api/field/photos/${was.id}/current`)
  }
})
