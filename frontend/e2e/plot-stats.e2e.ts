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

async function logActivity(request: APIRequestContext, type: string, day: string, zones: string[]) {
  const res = await request.put(`/api/activities/${randomUUID()}`, {
    data: { type, performed_on: day, notes: null, species: [], zones: zones.map((zone_id) => ({ zone_id, quantity: null, unit: null })) },
  })
  if (!res.ok()) throw new Error(`activity: ${res.status()} ${await res.text()}`)
}

test('plot stats show watering coverage and activity per week, without sideways scrolling', async ({ page, request }) => {
  await ensureField(request)
  const name = `Stats plot ${Date.now()}`
  const plot = await putPlot(request, name)
  const a = await putZone(request, plot, 'A', rect(120, 120, 60, 60))
  const b = await putZone(request, plot, 'B', rect(200, 120, 60, 60))
  await putZone(request, plot, 'C', rect(280, 120, 60, 60))
  await logActivity(request, 'watering', fieldDay(-2), [a, b])
  await logActivity(request, 'sowing', fieldDay(-20), [a])
  await logActivity(request, 'watering', fieldDay(-40), [b])

  await page.goto('/stats')
  const card = page.getByRole('region', { name })
  await expect(card).toContainText('2 of 3 cultivation zones (67%)')
  const weeks = card.getByRole('list', { name: /Activities logged per week/ }).getByRole('listitem')
  await expect(weeks).toHaveCount(8)
  await expect(weeks.nth(7)).toContainText('last 7 days: 1 activity')
  await expect(weeks.nth(5)).toContainText('14–20 days ago: 1 activity')
  await expect(weeks.nth(2)).toContainText('35–41 days ago: 1 activity')

  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(0)
  await card.scrollIntoViewIfNeeded()
  await shot(page, 'plot-stats')
})
