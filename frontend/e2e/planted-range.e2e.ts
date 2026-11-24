import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

/** The field's day (Europe/Lisbon) plus `offset` days, as YYYY-MM-DD. */
function fieldDay(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

type Qty = [zone: string, n: number]

async function log(request: APIRequestContext, type: string, day: string, unit: string, zones: Qty[], species: string[]) {
  const res = await request.put(`/api/activities/${randomUUID()}`, {
    data: {
      type,
      performed_on: day,
      notes: null,
      zones: zones.map(([zone_id, quantity]) => ({ zone_id, quantity, unit })),
      species: species.map((species_id) => ({ species_id, quantity: null, unit: null, notes: null })),
    },
  })
  if (!res.ok()) throw new Error(`activity: ${res.status()} ${await res.text()}`)
}

async function putSpecies(request: APIRequestContext, scientific: string, common: string) {
  const id = randomUUID()
  const res = await request.put(`/api/species/${id}`, { data: { scientific_name: scientific, common_name: common, notes: null } })
  if (!res.ok()) throw new Error(`species: ${res.status()} ${await res.text()}`)
  return id
}

test('stats show covas and trees planted between two dates, per plot and per species', async ({ page, request }) => {
  await ensureField(request)
  const stamp = Date.now()
  const name = `Planted plot ${stamp}`
  const plot = await putPlot(request, name)
  const a = await putZone(request, plot, 'A', rect(120, 120, 60, 60))
  const b = await putZone(request, plot, 'B', rect(200, 120, 60, 60))
  // names no other test looks up (species-usage finds 'Quercus suber' by substring)
  const cork = await putSpecies(request, `Planted ${stamp} sp.`, `Planted cork ${stamp}`)
  await log(request, 'sowing', fieldDay(-3), 'holes', [[a, 120], [b, 80]], [cork])
  await log(request, 'planting', fieldDay(-2), 'trees', [[b, 15]], [cork])
  await log(request, 'sowing', fieldDay(-60), 'holes', [[a, 1000]], [cork]) // outside "Last 30 days"

  await page.goto('/stats')
  const card = page.getByRole('region', { name: 'Sown & planted by date' })
  await card.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(card.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByLabel('From')).toHaveValue(fieldDay(-29))
  const plotRow = card.getByRole('table', { name: 'Per plot' }).getByRole('row', { name: new RegExp(name) })
  await expect(plotRow.getByRole('cell')).toHaveText(['200', '15'])
  const speciesRow = card.getByRole('table', { name: 'Per species' }).getByRole('row', { name: new RegExp(`Planted cork ${stamp}`) })
  await expect(speciesRow.getByRole('cell')).toHaveText(['200', '15'])

  // a range that reaches back to the old sowing counts it too; the range is kept in the address
  await card.getByLabel('From').fill(fieldDay(-90))
  await expect(plotRow.getByRole('cell')).toHaveText(['1,200', '15'])
  await expect(page).toHaveURL(new RegExp(`from=${fieldDay(-90)}`))

  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(0)
  // phone width, but tall enough that the whole card is above the bottom nav in the picture
  const vp = page.viewportSize()!
  await page.setViewportSize({ width: vp.width, height: 1600 })
  await shot(page, 'planted-range', card)
})
