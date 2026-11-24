import { expect, test, type Page } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

/** The on-screen box of a plot name's text (the label itself is padded with thumb room). */
async function nameText(page: Page, name: string) {
  const label = page.locator('.map-label--plot', { hasText: name })
  await expect(label).toBeVisible()
  return label.evaluate((el) => {
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(el)
    const r = range.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
  })
}

test('on the map, a tap on a zone right next to a plot’s name opens the zone, not the plot', async ({ page, request }) => {
  await ensureField(request)
  const name = `Tap ${Date.now() % 1000}`
  // a zone filling the plot's top-left corner, where the plot's name sits
  const plotId = await putPlot(request, name, rect(700, 10, 490, 150))
  await putZone(request, plotId, 'Canto', rect(700, 10, 490, 150))
  const sheet = page.getByRole('region', { name: 'Canto' })

  // just below and just right of the name, inside its thumb room but on the zone
  for (const [where, at] of [
    ['below', (t: Awaited<ReturnType<typeof nameText>>) => [t.x, t.bottom + 7]],
    ['right', (t: Awaited<ReturnType<typeof nameText>>) => [t.right + 6, t.y]],
  ] as const) {
    await page.goto('/')
    const t = await nameText(page, name)
    if (where === 'below') await shot(page, 'map-tap-overlap')
    const [x, y] = at(t)
    await page.touchscreen.tap(x, y)
    await expect(sheet, `a tap ${where} the name`).toBeVisible()
    await expect(page).not.toHaveURL(/\/plots\//)
  }

  // above the name there is no zone (outside the plot): the thumb room still opens the plot
  await page.goto('/')
  let t = await nameText(page, name)
  await page.touchscreen.tap(t.x, t.top - 6)
  await expect(page).toHaveURL(new RegExp(`/plots/${plotId}$`))

  // and so does a tap on the name itself, over the zone
  await page.goto('/')
  t = await nameText(page, name)
  await page.touchscreen.tap(t.x, t.y)
  await expect(page).toHaveURL(new RegExp(`/plots/${plotId}$`))
})
