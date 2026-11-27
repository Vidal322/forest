import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

test('the More page downloads the activity log as a CSV a spreadsheet reads', async ({ page, request }) => {
  await ensureField(request)
  const stamp = Date.now()
  const plot = `Encosta ${stamp}`
  const plotId = await putPlot(request, plot)
  const zoneA = await putZone(request, plotId, 'Clareira', rect(150, 150, 100, 80))
  const zoneB = await putZone(request, plotId, 'Rochas', rect(300, 150, 100, 80))
  const species = randomUUID()
  const name = `Export sp ${stamp}`
  const sp = await request.put(`/api/species/${species}`, { data: { scientific_name: name, common_name: 'sobreiro', notes: null } })
  expect(sp.ok()).toBeTruthy()
  const sowing = await request.put(`/api/activities/${randomUUID()}`, {
    data: {
      type: 'sowing',
      performed_on: '2025-06-28',
      notes: 'Sementeira à mão, “boa” terra',
      zones: [
        { zone_id: zoneA, quantity: 40, unit: 'holes' },
        { zone_id: zoneB, quantity: 10, unit: 'holes' },
      ],
      species: [{ species_id: species, quantity: null, unit: null, notes: null }],
    },
  })
  expect(sowing.ok(), await sowing.text()).toBeTruthy()

  await page.goto('/more')
  const button = page.getByRole('button', { name: 'Descarregar CSV' })
  await expect(button).toBeVisible()
  await shot(page, 'export-csv')

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(download.suggestedFilename()).toMatch(/^forest-atividades-\d{4}-\d{2}-\d{2}\.csv$/)
  const bytes = await readFile((await download.path())!)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM: accents survive Excel
  const text = bytes.subarray(3).toString('utf8')
  expect(text.split('\r\n')[0]).toBe('Data;Tipo;Zonas;Parcelas;Espécies;Quantidade;Notas')
  expect(text).toContain(
    `2025-06-28;Sementeira;Clareira, Rochas;${plot};${name} (sobreiro);50 covas;Sementeira à mão, “boa” terra`,
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
})
