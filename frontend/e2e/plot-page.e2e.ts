import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

test('a plot’s page: reached from its label on the map and from the stats', async ({ page, request }) => {
  await ensureField(request)
  const name = `Plot page ${Date.now()}`
  const plotId = await putPlot(request, name, rect(620, 420, 300, 250))
  const dry = await putZone(request, plotId, 'Clareira', rect(650, 470, 100, 80))
  const wet = await putZone(request, plotId, 'Rochas', rect(780, 470, 100, 80))

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  const watering = await request.put(`/api/activities/${randomUUID()}`, {
    data: { type: 'watering', performed_on: today, notes: 'Com a cisterna', zones: [{ zone_id: wet, quantity: 200, unit: 'litres' }], species: [] },
  })
  expect(watering.ok(), await watering.text()).toBeTruthy()
  const task = await request.put(`/api/tasks/${randomUUID()}`, {
    data: { plot_id: null, zone_id: dry, title: 'Semear clareira', description: null, kind: 'sow', status: 'open', due_on: null, resolved_by_activity_id: null },
  })
  expect(task.ok(), await task.text()).toBeTruthy()

  await page.goto('/')
  await expect(page.locator('.map-label--plot', { hasText: name })).toBeVisible()
  await shot(page, 'plot-page-map')
  await page.locator('.map-label--plot', { hasText: name }).click()
  await expect(page).toHaveURL(new RegExp(`/plots/${plotId}$`))
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  const zones = page.getByRole('region', { name: 'Zones' }).getByRole('link')
  await expect(zones).toHaveText([/^Clareira · 1 open task/, /^Rochas/])
  await expect(page.getByRole('region', { name: 'To do' })).toContainText('Semear clareira')
  const recent = page.getByRole('region', { name: 'Recent activity' }).getByRole('link')
  await expect(recent).toHaveCount(1)
  await expect(recent).toContainText('Watered · 200 litres')
  await shot(page, 'plot-page')

  // the stats open at this plot's card, whose name leads back here
  await page.getByRole('link', { name: `Stats for ${name}` }).click()
  const card = page.getByRole('link', { name })
  await expect(card).toBeInViewport()
  await shot(page, 'plot-page-stats')
  await card.click()
  await expect(page).toHaveURL(new RegExp(`/plots/${plotId}$`))

  // a log entry opens in its zone's history
  await page.getByRole('region', { name: 'Recent activity' }).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/zones/${wet}#entry-`))
  await expect(page.getByRole('heading', { level: 1, name: 'Rochas' })).toBeVisible()
})
