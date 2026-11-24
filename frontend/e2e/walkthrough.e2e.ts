import { expect, test, type Page } from '@playwright/test'
import { makePng, shot } from './helpers.ts'

// The main flows, as someone in the field does them on a phone: only taps and typing, no API shortcuts.
// It needs an empty database (it sets the field up), so it runs before the other specs (see playwright.config.ts).

/** Taps the field photo at a fraction of its shown size (0..1 from its top-left corner). */
async function tapPhoto(page: Page, fx: number, fy: number) {
  const box = await page.getByRole('img', { name: 'Aerial photo of the field' }).boundingBox()
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
  await expect(page.getByRole('heading', { name: 'Welcome to Forest' })).toBeVisible()
  await shot(page, 'walkthrough-01-welcome')
  await page.getByRole('link', { name: 'Set up your field' }).click()

  await page.getByLabel('Field name').fill('Quinta do Vale')
  await page.locator('input[type=file]').setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: makePng() })
  await expect(page.getByRole('img', { name: 'Preview of the field you chose' })).toBeVisible()
  await shot(page, 'walkthrough-02-field-photo')
  await page.getByRole('button', { name: 'Create field' }).click()
  await expect(page.getByText('Field created. Now set the scale.')).toBeVisible()

  // the scale: the line A–B typed in (dragging the handles is covered by the unit tests)
  await page.getByText('Type the positions instead').click()
  await page.getByLabel('A x', { exact: true }).fill('100')
  await page.getByLabel('A y', { exact: true }).fill('700')
  await page.getByLabel('B x', { exact: true }).fill('1100')
  await page.getByLabel('B y', { exact: true }).fill('700')
  await page.getByLabel('Real length of the line A–B').fill('200')
  await page.getByRole('button', { name: 'Save scale' }).click()
  await expect(page.getByText('Scale saved.')).toBeVisible()
  await shot(page, 'walkthrough-03-field-scale')

  // ── 2. Draw a plot and a zone ─────────────────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Map' }).click()
  await expect(page.getByText('No plots yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Zoom out' }).click({ trial: true }) // the note doesn't cover it
  await page.getByRole('button', { name: '＋ Draw' }).click()
  await shot(page, 'walkthrough-04-draw-menu')
  await page.getByRole('button', { name: /A plot/ }).click()
  await drawOutline(page, [
    [0.15, 0.15],
    [0.85, 0.15],
    [0.85, 0.85],
    [0.15, 0.85],
  ])
  await expect(page.getByText('4 corners')).toBeVisible()
  await shot(page, 'walkthrough-05-plot-outline')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Name').fill('Encosta')
  await shot(page, 'walkthrough-06-plot-details')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Added Encosta.')).toBeVisible()

  await page.getByRole('button', { name: '＋ Draw' }).click()
  await page.getByRole('button', { name: /A zone/ }).click()
  await drawOutline(page, [
    [0.3, 0.3],
    [0.6, 0.3],
    [0.6, 0.6],
    [0.3, 0.6],
  ])
  await expect(page.getByText('In Encosta.')).toBeVisible()
  await shot(page, 'walkthrough-07-zone-outline')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'New zone in Encosta' })).toBeVisible()
  await page.getByLabel('Name').fill('Canteiro')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Added Canteiro.')).toBeVisible()
  // the new zone's sheet opens: logging there is one tap away
  const sheet = page.getByRole('region', { name: 'Canteiro' })
  await expect(sheet).toContainText('Nothing yet')
  await shot(page, 'walkthrough-08-zone-sheet')

  // ── 3. Quick log a watering ───────────────────────────────────────────────────────────────────
  await sheet.getByRole('link', { name: '＋ Log activity' }).click()
  await expect(page.getByText('Canteiro selected')).toBeVisible()
  await page.getByRole('button', { name: 'Watered' }).click()
  await page.getByLabel(/How many litres/).fill('40')
  await shot(page, 'walkthrough-09-log-watering')
  await page.getByRole('button', { name: 'Save — Watered Canteiro' }).click()
  await expect(page.getByText('Logged: watered Canteiro today.')).toBeInViewport()
  await expect(page.getByText('No zones selected')).toBeVisible() // the form is ready for the next entry
  await shot(page, 'walkthrough-10-logged')

  // ── 4. Offline: log a sowing, it waits on the phone ───────────────────────────────────────────
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Pick from a list' }).click()
  await page.getByRole('checkbox', { name: /Canteiro/ }).check()
  await page.getByRole('button', { name: 'Sowed' }).click()
  await page.getByLabel(/How many covas/).fill('120')
  await page.getByRole('button', { name: 'Save — Sowed Canteiro' }).click()
  // the confirmation sits at the top of the form: it is brought into sight
  await expect(page.getByText('Saved on this phone. It will be sent when there is a connection.')).toBeInViewport()
  const waiting = page.getByText('1 change saved on this phone, waiting for a connection.')
  await expect(waiting).toBeVisible()
  await shot(page, 'walkthrough-11-offline-sowing')

  // ── 5. Back online: it syncs ──────────────────────────────────────────────────────────────────
  await context.setOffline(false)
  await expect(waiting).toBeHidden({ timeout: 15_000 })
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Map' }).click()
  await page.getByRole('button', { name: 'Zones' }).click()
  await page.locator('#map-zone-list').getByRole('button', { name: /Canteiro/ }).click()
  await expect(sheet.getByText('Sown')).toBeVisible()
  await sheet.getByRole('link', { name: 'History & tasks' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Canteiro' })).toBeVisible()
  await expect(page.getByText(/Sowed · 120 covas/)).toBeVisible()
  await expect(page.getByText(/Watered · 40 litres/)).toBeVisible()
  await shot(page, 'walkthrough-12-synced-history')

  // ── 6. Add a task and close it ────────────────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: '＋ Add task' }).click()
  await page.getByLabel('What needs doing?').fill('Pôr ninhos')
  await page.getByLabel('Where').selectOption({ label: 'Canteiro (Encosta)' })
  await page.getByRole('button', { name: /Add nests/ }).click()
  await page.getByRole('button', { name: 'In a week' }).click()
  await shot(page, 'walkthrough-13-task-form')
  await page.getByRole('button', { name: 'Add task' }).click()
  await expect(page.getByText('Added “Pôr ninhos”.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Next 7 days/ })).toBeVisible()
  await shot(page, 'walkthrough-14-task-added')
  await page.getByRole('button', { name: 'Done: Pôr ninhos' }).click()
  await expect(page.getByRole('button', { name: 'Done: Pôr ninhos' })).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'walkthrough-15-task-done')
  // once the page is left and opened again, it is under the closed ones
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Map' }).click()
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Tasks' }).click()
  await expect(page.getByText('Nothing to do.')).toBeVisible()
  await page.getByRole('button', { name: 'Show done and cancelled (1)' }).click()
  await expect(page.getByRole('button', { name: 'Done: Pôr ninhos' })).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'walkthrough-16-task-closed')
})
