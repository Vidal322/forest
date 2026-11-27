import { expect, test } from '@playwright/test'
import { ensureField, putPlot, putZone, shot } from './helpers.ts'

test('the map opens on a set-up field with a plot and a zone', async ({ page, request }) => {
  await ensureField(request)
  const plotId = await putPlot(request, `Smoke plot ${Date.now()}`)
  await putZone(request, plotId, 'Smoke zone')

  await page.goto('/')
  await expect(page.getByText('Configurar o teu terreno')).toHaveCount(0)
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await shot(page, 'smoke-map')
})
