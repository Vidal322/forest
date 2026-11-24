import { expect, test } from '@playwright/test'
import { ensureField, shot } from './helpers.ts'

// Desktop has no bottom tabs: the More page (with the CSV export) must be in the top bar.
for (const width of [1280, 641]) {
  test.describe(`desktop ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: false, hasTouch: false })

    test('the top navigation reaches the More page and its export', async ({ page, request }) => {
      await ensureField(request)
      await page.goto('/')
      const top = page.getByRole('navigation', { name: 'Main' }).first()
      const more = top.getByRole('link', { name: 'More' })
      await expect(more).toBeVisible()
      // the whole bar fits: nothing pushed off screen at the narrowest desktop width
      const box = (await more.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate<number>('document.documentElement.scrollWidth')).toBeLessThanOrEqual(width)
      // and every label stays on one line (a 44px-tall link, not a wrapped two-liner)
      for (const link of await top.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeLessThanOrEqual(48)
      const online = (await page.locator('.topbar > :last-child').boundingBox())!
      expect(online.x + online.width).toBeLessThanOrEqual(width)
      await more.click()
      await expect(page).toHaveURL(/\/more$/)
      await expect(more).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible()
      await shot(page, `desktop-more-${width}`)
    })
  })
}
