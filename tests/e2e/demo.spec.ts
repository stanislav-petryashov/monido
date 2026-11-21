import { expect, test } from './fixtures'

test('the demo starts a sandbox from the sign-in page and shows the Overview', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
})
