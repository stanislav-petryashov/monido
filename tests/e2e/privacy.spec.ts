import { expect, expectPageShown, test } from './fixtures'

test.beforeEach(async ({ signIn }) => { await signIn() })

test('the privacy toggle masks the amounts', async ({ page }) => {
  await page.goto('/')
  await expectPageShown(page)
  const mask = page.getByText('•••')
  await expect(mask).toHaveCount(0)
  await page.getByRole('button', { name: 'Hide amounts' }).click()
  await expect(page.getByRole('button', { name: 'Show amounts' })).toHaveAttribute('aria-pressed', 'true')
  await expect(mask.first()).toBeVisible()
})
