import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

test('the species page shows where each species is used', async ({ page, request }) => {
  await ensureField(request)
  const plotId = await putPlot(request, `Species plot ${Date.now()}`)
  const zoneA = await putZone(request, plotId, 'Clareira', rect(150, 150, 100, 80))
  const zoneB = await putZone(request, plotId, 'Rochas', rect(300, 150, 100, 80))

  const used = randomUUID()
  const unused = randomUUID()
  for (const [id, name, common] of [
    [used, 'Quercus suber', 'sobreiro'],
    [unused, 'Arbutus unedo', 'medronheiro'],
  ]) {
    const res = await request.put(`/api/species/${id}`, { data: { scientific_name: name, common_name: common, notes: null } })
    expect(res.ok()).toBeTruthy()
  }
  const sowing = await request.put(`/api/activities/${randomUUID()}`, {
    data: {
      type: 'sowing',
      performed_on: '2025-06-28',
      notes: null,
      zones: [{ zone_id: zoneA, quantity: 40, unit: 'holes' }],
      species: [{ species_id: used, quantity: null, unit: null, notes: null }],
    },
  })
  expect(sowing.ok(), await sowing.text()).toBeTruthy()
  const trees = await request.put(`/api/zones/${zoneB}/trees/${used}`, { data: { alive: 12, dead: 2 } })
  expect(trees.ok(), await trees.text()).toBeTruthy()

  await page.goto('/species')
  const suber = page.getByRole('button', { name: 'Editar Quercus suber' })
  await expect(suber).toContainText('2 zonas · 12 árvores vivas · semeada a 28 jun 2025')
  await expect(page.getByRole('button', { name: 'Editar Arbutus unedo' })).toContainText('Ainda não foi usada')
  await shot(page, 'species-usage')
})
