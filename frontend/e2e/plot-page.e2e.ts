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

  const zones = page.getByRole('region', { name: 'Zonas' }).getByRole('link')
  await expect(zones).toHaveText([/^Z1 Clareira · 1 tarefa por fazer/, /^Z2 Rochas/])
  await expect(page.getByRole('region', { name: 'Tarefas', exact: true })).toContainText('Semear clareira')
  const recent = page.getByRole('region', { name: 'Últimos registos' }).getByRole('link')
  await expect(recent).toHaveCount(1)
  await expect(recent).toContainText('Rega · 200 litros')
  await shot(page, 'plot-page')

  // the stats open at this plot's card, whose name leads back here
  await page.getByRole('link', { name: `Estatísticas de ${name}` }).click()
  const card = page.getByRole('link', { name })
  await expect(card).toBeInViewport()
  // only the page scrolled to the card: the top bar and the tabs are still where they were (the whole app used to slide up)
  await expect(page.getByRole('link', { name: 'Forest' })).toBeInViewport({ ratio: 1 })
  const tabs = await page.locator('nav.tabs').boundingBox()
  expect(tabs && Math.round(tabs.y + tabs.height)).toBe(page.viewportSize()?.height)
  await shot(page, 'plot-page-stats')
  await card.click()
  await expect(page).toHaveURL(new RegExp(`/plots/${plotId}$`))

  // a log entry opens in its zone's history
  await page.getByRole('region', { name: 'Últimos registos' }).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/zones/${wet}#entry-`))
  await expect(page.getByRole('heading', { level: 1, name: 'Rochas' })).toBeVisible()
})
