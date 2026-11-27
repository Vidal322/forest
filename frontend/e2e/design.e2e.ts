/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { ensureField, putPlot, putZone, rect, shot } from './helpers.ts'

/**
 * The checklist's automatic checks on every page, on a phone: axe (contrast, labels, …) and touch targets of at
 * least 44 × 44 px. Also the shell: the self-hosted fonts, the tabs and the sync line.
 */

/** Every control a thumb can hit that is smaller than 44 × 44 px: "button "Fechar" 36×36". */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"])',
    )
    const out: string[] = []
    for (const el of controls) {
      // Leaflet's own zoom buttons and attribution get the 44 px look with the map (P3)
      if (el.closest('.leaflet-control-container')) continue
      if (el.closest('[aria-hidden="true"], [inert], .visually-hidden')) continue
      if ((el as HTMLButtonElement).disabled) continue
      // a checkbox, a radio or a hidden file input is hit through its label
      const input = el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type)
      const box: HTMLElement = (input && (el.closest('label') ?? (el.id ? document.querySelector<HTMLElement>(`label[for="${el.id}"]`) : null))) || el
      const r = box.getBoundingClientRect()
      const style = getComputedStyle(box)
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
      // a link inside running text (a sentence) is exempt
      if (el.tagName === 'A' && style.display === 'inline') {
        const parent = el.parentElement
        if (parent && (parent.textContent ?? '').trim() !== (el.textContent ?? '').trim()) continue
      }
      if (r.width < 43.5 || r.height < 43.5) {
        const name = el.getAttribute('aria-label') ?? (box.textContent ?? '').trim().slice(0, 40)
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}×${Math.round(r.height)}`)
      }
    }
    return out
  })
}

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return result.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} (${n.failureSummary?.split('\n')[1]?.trim() ?? ''})`))
}

test('every page passes axe and has 44 px touch targets; the shell uses the new look', async ({ page, request }) => {
  test.setTimeout(90_000)
  await ensureField(request)
  const plotName = `Parcela design ${Date.now()}`
  // in a corner of the photo, clear of the other specs' zones (its task pin must not cover them)
  const plotId = await putPlot(request, plotName, rect(1070, 20, 120, 200))
  const zoneId = await putZone(request, plotId, 'Clareira design', rect(1080, 40, 100, 80))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  const lastWeek = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date(Date.now() - 7 * 86_400_000))
  for (const [title, due_on] of [['Regar a clareira', lastWeek], ['Semear a clareira', today]]) {
    const res = await request.put(`/api/tasks/${randomUUID()}`, {
      data: { plot_id: null, zone_id: zoneId, title, description: null, kind: 'water', status: 'open', due_on, resolved_by_activity_id: null },
    })
    expect(res.ok()).toBe(true)
  }

  const origin = new URL(test.info().project.use.baseURL!).origin
  const outside: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin && !r.url().startsWith('data:')) outside.push(r.url())
  })

  const pages: [string, string, string | RegExp][] = [
    ['map', '/', 'Mapa do terreno'],
    ['log', '/log', 'Registar'],
    ['tasks', '/tasks', 'Tarefas'],
    ['stats', '/stats', 'Estatísticas'],
    ['species', '/species', 'Espécies'],
    ['field', '/field', 'Configurar o terreno'],
    ['more', '/more', 'Mais'],
    ['zone', `/zones/${zoneId}`, 'Clareira design'],
    ['plot', `/plots/${plotId}`, plotName],
    ['not-found', '/nada-aqui', 'Página não encontrada'],
  ]
  const problems: string[] = []
  for (const [name, path, heading] of pages) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading, includeHidden: true })).toBeAttached()
    await page.waitForLoadState('networkidle')
    for (const v of await axeViolations(page)) problems.push(`${name}: axe ${v}`)
    for (const s of await smallTargets(page)) problems.push(`${name}: small ${s}`)
    await shot(page, `design-${name}`)
  }
  expect(problems).toEqual([])
  // nothing fetched from anywhere else (Google Fonts, …)
  expect(outside).toEqual([])

  // the fonts are ours and loaded: Atkinson for the text, Alegreya italic for place names
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'Atrasadas' })).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Atkinson Hyperlegible Next')
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('700 16px "Atkinson Hyperlegible Next"'))).toBe(true)
  expect(await page.evaluate(() => document.fonts.load('italic 700 16px Alegreya').then((faces) => faces.length > 0))).toBe(true)

  // phone tabs: Mapa, Registar (until P4c), Tarefas with the late count, Mais; icons are SVG, no emoji
  const tabs = page.getByRole('navigation', { name: 'Principal' }).last()
  await expect(tabs.getByRole('link')).toHaveText(['Mapa', 'Registar', /^Tarefas ?\(1 atrasada\)$/, 'Mais'])
  await expect(tabs.getByRole('link', { name: 'Tarefas (1 atrasada)' })).toHaveAttribute('aria-current', 'page')
  await expect(tabs.locator('svg')).toHaveCount(4)
  // nothing waits to be sent: no sync line
  await expect(page.locator('.sync')).toHaveCount(0)
  await shot(page, 'design-tabs', tabs)

  // offline, a change waits on the phone and the line says so in words
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Feita: Semear a clareira' }).click()
  await expect(page.getByText('1 alteração guardada neste telemóvel, à espera de rede.')).toBeVisible()
  await shot(page, 'design-sync-waiting')
  await page.context().setOffline(false)
  await expect(page.locator('.sync')).toHaveCount(0)
})
