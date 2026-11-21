import { expect, expectPageShown, test } from './fixtures'

test.beforeEach(async ({ signIn }) => { await signIn() })

test('filling an account of the open month from its hint moves the progress', async ({ page }) => {
  await page.goto('/close')
  await expectPageShown(page)
  const progress = page.getByRole('region', { name: /^Filling in / })
  const missing = progress.getByRole('button', { name: /: not filled$/ })
  const before = await missing.count()
  expect(before).toBeGreaterThan(0)
  const account = (await missing.first().getAttribute('aria-label'))!.replace(/: not filled$/, '')

  // the balance field shows last month's figure as its placeholder: typing it is what the hint suggests
  const balance = page.getByRole('textbox', { name: new RegExp(`^Balance: ${account}`) })
  const hint = await balance.getAttribute('placeholder')
  expect(hint).toMatch(/\d/)
  await balance.fill(hint!.replace(/,/g, ''))
  await balance.blur()
  const noFlows = page.getByRole('button', { name: `No income or expenses: ${account}` })
  if (await noFlows.isVisible()) await noFlows.click()

  await expect(progress.getByRole('button', { name: `${account}: filled` })).toBeVisible()
  await expect(missing).toHaveCount(before - 1)
})
