import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

test('the app speaks Portuguese: page language, installed name, the map and the tasks', async ({ page, request }) => {
  await ensureField(request)
  const name = `Parcela pt ${Date.now()}`
  const plotId = await putPlot(request, name)
  const zoneId = await putZone(request, plotId, 'Clareira pt', rect(150, 150, 120, 90))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  const task = await request.put(`/api/tasks/${randomUUID()}`, {
    data: { plot_id: null, zone_id: zoneId, title: 'Falta semear', description: null, kind: 'sow', status: 'open', due_on: today, resolved_by_activity_id: null },
  })
  expect(task.ok()).toBe(true)

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT')
  const tabs = page.getByRole('navigation', { name: 'Principal' }).last()
  await expect(tabs.getByRole('link')).toHaveText([/Mapa/, /Registar/, /Tarefas/, /Mais/])
  await page.getByRole('button', { name: 'Camadas' }).click()
  await expect(page.getByRole('list', { name: 'Cores do mapa' })).toContainText('Por regar')
  await shot(page, 'portuguese-map-layers')

  await tabs.getByRole('link', { name: 'Tarefas' }).click()
  await expect(page.getByRole('heading', { name: /^Hoje/ })).toBeVisible()
  await expect(page.getByText(`Clareira pt · ${name} · para hoje`)).toBeVisible()
  await shot(page, 'portuguese-tasks')

  // the installed app's name and description
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ lang: 'pt-PT', name: 'Forest — registo do terreno', description: 'Regista plantações, sementeiras e regas no teu terreno.' })
})
