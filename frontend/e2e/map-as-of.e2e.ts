import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

/** today+offset in the field's timezone, as YYYY-MM-DD */
function fieldDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

test('the map shows the zones as they were on a past day, and goes back to today in one tap', async ({ page, request }) => {
  await ensureField(request)
  const plotId = await putPlot(request, `As-of plot ${Date.now()}`, rect(60, 120, 1000, 600))
  const zoneId = await putZone(request, plotId, 'Old sowing', rect(200, 250, 600, 300))
  const res = await request.put(`/api/activities/${randomUUID()}`, {
    data: { type: 'sowing', performed_on: fieldDay(-20), zones: [{ zone_id: zoneId }] },
  })
  expect(res.ok()).toBeTruthy()

  await page.goto('/')
  const zone = page.locator('path.map-zone').first()
  // sown 20 days ago, never watered: dry today
  await expect(zone).toHaveAttribute('fill', '#d9822b')

  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByLabel('Date').fill(fieldDay(-18))
  await expect(page.getByText(/^Viewing /)).toBeVisible()
  await expect(page.getByText('18 days ago')).toBeVisible()
  // two days after sowing it was just sown
  await expect(zone).toHaveAttribute('fill', '#c9a227')
  await shot(page, 'map-as-of-panel')
  await page.getByRole('button', { name: 'Layers' }).click()
  await shot(page, 'map-as-of')

  // before anything was logged: nothing there yet
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByLabel('Date').fill(fieldDay(-25))
  await expect(zone).toHaveAttribute('fill', '#efe7d6')
  await page.getByRole('button', { name: 'Layers' }).click()

  await zone.click()
  await expect(page.getByRole('region', { name: 'Old sowing' })).toContainText('Nothing logged here yet')
  await shot(page, 'map-as-of-sheet')
  await page.getByRole('button', { name: 'Back to today' }).click()
  await expect(page.getByText(/^Viewing /)).toHaveCount(0)
  await expect(zone).toHaveAttribute('fill', '#d9822b')
  await expect(page.getByRole('region', { name: 'Old sowing' })).toContainText('Needs water')
})
