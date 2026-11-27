import { expect, test, type Page } from '@playwright/test'
import { makePng, shot } from './helpers.ts'

// The main flows, as someone in the field does them on a phone: only taps and typing, no API shortcuts.
// It needs an empty database (it sets the field up), so it runs before the other specs (see playwright.config.ts).

/** Taps the field photo at a fraction of its shown size (0..1 from its top-left corner). */
async function tapPhoto(page: Page, fx: number, fy: number) {
  const box = await page.getByRole('img', { name: 'Fotografia aérea do terreno' }).boundingBox()
  if (!box) throw new Error('the field photo is not shown')
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
}

async function drawOutline(page: Page, corners: [number, number][]) {
  for (const [fx, fy] of corners) await tapPhoto(page, fx, fy)
}

test('the main flows on a phone: field, plot, zone, watering, an offline sowing, a task', async ({ page, context }) => {
  test.setTimeout(90_000)

  // ── 1. Field setup with a photo ───────────────────────────────────────────────────────────────
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bem-vindo ao Forest' })).toBeVisible()
  await shot(page, 'walkthrough-01-welcome')
  await page.getByRole('link', { name: 'Configurar o teu terreno' }).click()

  await page.getByLabel('Nome do terreno').fill('Quinta do Vale')
  await page.locator('input[type=file]').setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: makePng() })
  await expect(page.getByRole('img', { name: 'Pré-visualização do terreno que escolheste' })).toBeVisible()
  await shot(page, 'walkthrough-02-field-photo')
  await page.getByRole('button', { name: 'Criar o terreno' }).click()
  await expect(page.getByText('Terreno criado. Agora marca a escala.')).toBeVisible()

  // the scale: the line A–B typed in (dragging the handles is covered by the unit tests)
  await page.getByText('Escrever as posições à mão').click()
  await page.getByLabel('A x', { exact: true }).fill('100')
  await page.getByLabel('A y', { exact: true }).fill('700')
  await page.getByLabel('B x', { exact: true }).fill('1100')
  await page.getByLabel('B y', { exact: true }).fill('700')
  await page.getByLabel('Comprimento real da linha A–B').fill('200')
  await page.getByRole('button', { name: 'Guardar a escala' }).click()
  await expect(page.getByText('Escala guardada.')).toBeVisible()
  await shot(page, 'walkthrough-03-field-scale')

  // ── 2. Draw a plot and a zone ─────────────────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Mapa' }).click()
  await expect(page.getByText('Ainda não há parcelas.')).toBeVisible()
  await page.getByRole('button', { name: 'Afastar' }).click({ trial: true }) // the note doesn't cover it
  await page.getByRole('button', { name: '＋ Desenhar' }).click()
  await shot(page, 'walkthrough-04-draw-menu')
  await page.getByRole('button', { name: /Uma parcela/ }).click()
  await drawOutline(page, [
    [0.15, 0.15],
    [0.85, 0.15],
    [0.85, 0.85],
    [0.15, 0.85],
  ])
  await expect(page.getByText('4 cantos')).toBeVisible()
  await shot(page, 'walkthrough-05-plot-outline')
  await page.getByRole('button', { name: 'Seguinte' }).click()
  await page.getByLabel('Nome').fill('Encosta')
  await shot(page, 'walkthrough-06-plot-details')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Encosta acrescentada.')).toBeVisible()

  await page.getByRole('button', { name: '＋ Desenhar' }).click()
  await page.getByRole('button', { name: /Uma zona/ }).click()
  await drawOutline(page, [
    [0.3, 0.3],
    [0.6, 0.3],
    [0.6, 0.6],
    [0.3, 0.6],
  ])
  await expect(page.getByText('Em Encosta.')).toBeVisible()
  await shot(page, 'walkthrough-07-zone-outline')
  await page.getByRole('button', { name: 'Seguinte' }).click()
  await expect(page.getByRole('heading', { name: 'Zona nova em Encosta' })).toBeVisible()
  await page.getByLabel('Nome').fill('Canteiro')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Canteiro acrescentada.')).toBeVisible()
  // the new zone's sheet opens: logging there is one tap away
  const sheet = page.getByRole('region', { name: 'Canteiro' })
  await expect(sheet).toContainText('Sem nada')
  await shot(page, 'walkthrough-08-zone-sheet')

  // ── 3. Quick log a watering ───────────────────────────────────────────────────────────────────
  await sheet.getByRole('link', { name: '＋ Registar', exact: true }).click()
  await expect(page.getByText('Escolhida: Canteiro')).toBeVisible()
  await page.getByRole('button', { name: 'Rega', exact: true }).click()
  await page.getByLabel(/Quantidade \(litros\)/).fill('40')
  await shot(page, 'walkthrough-09-log-watering')
  await page.getByRole('button', { name: 'Guardar rega em Canteiro' }).click()
  await expect(page.getByText('Rega guardada em Canteiro, hoje.')).toBeInViewport()
  await expect(page.getByText('Nenhuma zona escolhida')).toBeVisible() // the form is ready for the next entry
  await shot(page, 'walkthrough-10-logged')

  // ── 4. Offline: log a sowing, it waits on the phone ───────────────────────────────────────────
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Escolher numa lista' }).click()
  await page.getByRole('checkbox', { name: /Canteiro/ }).check()
  await page.getByRole('button', { name: 'Sementeira', exact: true }).click()
  await page.getByLabel(/Quantidade \(covas\)/).fill('120')
  await page.getByRole('button', { name: 'Guardar sementeira em Canteiro' }).click()
  // the confirmation sits at the top of the form: it is brought into sight
  await expect(page.getByText('Guardado neste telemóvel. Vai ser enviado quando houver rede.')).toBeInViewport()
  const waiting = page.getByText('1 alteração guardada neste telemóvel, à espera de rede.')
  await expect(waiting).toBeVisible()
  await shot(page, 'walkthrough-11-offline-sowing')

  // ── 5. Back online: it syncs ──────────────────────────────────────────────────────────────────
  await context.setOffline(false)
  await expect(waiting).toBeHidden({ timeout: 15_000 })
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Mapa' }).click()
  await page.getByRole('button', { name: 'Zonas' }).click()
  await page.locator('#map-zone-list').getByRole('button', { name: /Canteiro/ }).click()
  await expect(sheet.getByText('Sementeira')).toBeVisible()
  await sheet.getByRole('link', { name: 'Histórico e tarefas' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Canteiro' })).toBeVisible()
  await expect(page.getByText(/Sementeira · 120 covas/)).toBeVisible()
  await expect(page.getByText(/Rega · 40 litros/)).toBeVisible()
  await shot(page, 'walkthrough-12-synced-history')

  // ── 6. Add a task and close it ────────────────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Tarefas' }).click()
  await page.getByRole('button', { name: '＋ Acrescentar tarefa' }).click()
  await page.getByLabel('O que há para fazer?').fill('Pôr ninhos')
  await page.getByLabel('Onde').selectOption({ label: 'Canteiro (Encosta)' })
  await page.getByRole('button', { name: /Fazer ninhos/ }).click()
  await page.getByRole('button', { name: 'Daqui a uma semana' }).click()
  await shot(page, 'walkthrough-13-task-form')
  await page.getByRole('button', { name: 'Acrescentar tarefa', exact: true }).click()
  await expect(page.getByText('Tarefa acrescentada: “Pôr ninhos”.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Próximos 7 dias/ })).toBeVisible()
  await shot(page, 'walkthrough-14-task-added')
  await page.getByRole('button', { name: 'Feita: Pôr ninhos' }).click()
  await expect(page.getByRole('button', { name: 'Feita: Pôr ninhos' })).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'walkthrough-15-task-done')
  // once the page is left and opened again, it is under the closed ones
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Mapa' }).click()
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Tarefas' }).click()
  await expect(page.getByText('Nada por fazer.')).toBeVisible()
  await page.getByRole('button', { name: 'Mostrar as feitas e as canceladas (1)' }).click()
  await expect(page.getByRole('button', { name: 'Feita: Pôr ninhos' })).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'walkthrough-16-task-closed')
})
