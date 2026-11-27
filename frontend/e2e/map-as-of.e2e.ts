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
  // its outline, found through its label (the field may hold other zones: the walkthrough's)
  const labelId = await page.locator('.map-label--zone', { hasText: 'Old sowing' }).getAttribute('id')
  const zone = page.locator(`path.map-zone[aria-describedby="${labelId}"]`)
  // sown 20 days ago, never watered: dry today
  await expect(zone).toHaveAttribute('fill', '#d9822b')

  await page.getByRole('button', { name: 'Camadas' }).click()
  await page.getByLabel('Dia', { exact: true }).fill(fieldDay(-18))
  await expect(page.getByText(/^A ver /)).toBeVisible()
  await expect(page.getByText('há 18 dias')).toBeVisible()
  // two days after sowing it was just sown
  await expect(zone).toHaveAttribute('fill', '#c9a227')
  await shot(page, 'map-as-of-panel')
  await page.getByRole('button', { name: 'Camadas' }).click()
  await shot(page, 'map-as-of')

  // before anything was logged: nothing there yet
  await page.getByRole('button', { name: 'Camadas' }).click()
  await page.getByLabel('Dia', { exact: true }).fill(fieldDay(-25))
  await expect(zone).toHaveAttribute('fill', '#efe7d6')
  await page.getByRole('button', { name: 'Camadas' }).click()

  // near its corner: the walkthrough's smaller zone lies over its middle (and gave the field a scale, so the sheet
  // shows the area instead of "Nothing logged here yet")
  await zone.click({ position: { x: 6, y: 6 } })
  const sheet = page.getByRole('region', { name: 'Old sowing' })
  await expect(sheet).toContainText('Sem nada')
  // its actions still act on today, and say so
  await expect(sheet).toContainText('O que registares ou editares fica com o dia de hoje.')
  await expect(sheet.getByRole('link', { name: '＋ Registar hoje' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: '✎ Editar a zona hoje' })).toBeVisible()
  await shot(page, 'map-as-of-sheet')
  await page.getByRole('button', { name: 'Voltar a hoje' }).click()
  await expect(page.getByText(/^A ver /)).toHaveCount(0)
  await expect(zone).toHaveAttribute('fill', '#d9822b')
  await expect(sheet).toContainText('Por regar')
  await expect(sheet.getByRole('link', { name: '＋ Registar', exact: true })).toBeVisible()
  await expect(sheet).not.toContainText('fica com o dia de hoje')
})
