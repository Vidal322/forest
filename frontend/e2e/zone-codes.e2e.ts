import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

/** Taps the field photo at a fraction of its shown size (0..1 from its top-left corner). */
async function tapPhoto(page: Page, fx: number, fy: number) {
  const box = await page.getByRole('img', { name: 'Fotografia aérea do terreno' }).boundingBox()
  if (!box) throw new Error('the field photo is not shown')
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
}

test('zone codes: next to the name in the zone list, the sheet, the zone page and tasks; "nova" until synced', async ({ page, context, request }) => {
  await ensureField(request)
  // sorts before the other specs' plots, so a zone drawn inside it goes to this one even where plots overlap
  const plot = `0 Códigos ${Date.now()}`
  const plotId = await putPlot(request, plot, rect(100, 100, 1000, 600))
  const clareira = await putZone(request, plotId, 'Clareira', rect(150, 150, 100, 80))
  const rochas = await putZone(request, plotId, 'Rochas', rect(300, 150, 100, 80))
  expect((await request.delete(`/api/zones/${rochas}`)).ok()).toBeTruthy()
  await putZone(request, plotId, 'Pinhal', rect(450, 150, 100, 80)) // Z3: Rochas keeps Z2
  const task = await request.put(`/api/tasks/${randomUUID()}`, {
    data: { plot_id: null, zone_id: clareira, title: 'Abrir covas na clareira', description: null, kind: 'sow', status: 'open', due_on: null, resolved_by_activity_id: null },
  })
  expect(task.ok(), await task.text()).toBeTruthy()

  // the zone list on the map
  await page.goto('/')
  await page.getByRole('button', { name: 'Zonas', exact: true }).click()
  const own = page.locator('#map-zone-list').getByRole('region', { name: plot })
  await expect(own.getByRole('button')).toHaveText([/^Z1 Clareira/, /^Z3 Pinhal/])
  await shot(page, 'zone-codes-list', page.locator('#map-zone-list'))

  // the zone sheet
  await own.getByRole('button', { name: /Clareira/ }).click()
  const sheet = page.getByRole('region', { name: 'Clareira' })
  await expect(sheet.locator('.zone-code')).toHaveText('Z1')
  await shot(page, 'zone-codes-sheet')

  // the zone page's subtitle
  await page.goto(`/zones/${clareira}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Clareira' })).toBeVisible()
  await expect(page.getByText(`Zona Z1 da parcela ${plot}`)).toBeVisible()
  await shot(page, 'zone-codes-zone-page')

  // a task row
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Tarefas' }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'Abrir covas na clareira' })
  await expect(row).toContainText(`Z1 Clareira, ${plot}`)
  await shot(page, 'zone-codes-tasks')

  // a zone drawn offline has no code yet: it reads "nova" until it reaches the server
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Mapa' }).click()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Desenhar' }).click()
  await page.getByRole('button', { name: /Uma zona/ }).click()
  for (const [fx, fy] of [
    [0.4, 0.5],
    [0.55, 0.5],
    [0.55, 0.65],
    [0.4, 0.65],
  ] as const)
    await tapPhoto(page, fx, fy)
  await expect(page.getByText(`Em ${plot}.`)).toBeVisible()
  await page.getByRole('button', { name: 'Seguinte' }).click()
  await page.getByLabel('Nome').fill('Viveiro')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  const waiting = page.getByText('1 alteração guardada neste telemóvel, à espera de rede.')
  await expect(waiting).toBeVisible()
  await page.getByRole('button', { name: 'Zonas', exact: true }).click()
  await expect(own.getByRole('button')).toHaveText([/^Z1 Clareira/, /^Z3 Pinhal/, /^nova Viveiro/])
  await own.getByRole('button', { name: /Viveiro/ }).click()
  const fresh = page.getByRole('region', { name: 'Viveiro' })
  await expect(fresh.locator('.zone-code')).toHaveText('nova')
  await shot(page, 'zone-codes-offline-sheet')

  // back online it gets the plot's next code (Z2 stays with the deleted Rochas)
  await context.setOffline(false)
  await expect(waiting).toBeHidden({ timeout: 15_000 })
  await expect(fresh.locator('.zone-code')).toHaveText('Z4')
})
