import { expect, test } from '@playwright/test'

test('the theme switch cycles Auto, Light, Dark and survives a reload', async ({ page }) => {
  await page.goto('/')
  const theme = page.getByRole('button', { name: /^Theme/ })
  await expect(theme).toHaveAccessibleName(/Auto/)
  await theme.click()
  await expect(theme).toHaveAccessibleName(/Light/)
  await theme.click()
  await expect(theme).toHaveAccessibleName(/Dark/)
  // The switch lands inside a view transition, a frame or two later.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await page.reload()
  // Applied before first paint, by index.html.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await expect(page.getByRole('button', { name: /^Theme/ })).toHaveAccessibleName(/Dark/)
})
