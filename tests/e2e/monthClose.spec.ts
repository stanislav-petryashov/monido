import { expect, expectPageShown, test } from './fixtures'

test.beforeEach(async ({ signIn }) => { await signIn() })

test('marks an untouched account unchanged, fills its balance and lets the user undo', async ({ page }) => {
  await page.goto('/close')
  await expectPageShown(page)

  const copy = page.getByRole('button', { name: /^No changes: / }).first()
  await expect(copy).toBeVisible()
  const account = (await copy.getAttribute('aria-label'))!.slice('No changes: '.length)
  const balance = page.getByRole('textbox', { name: `Balance: ${account}`, exact: true })
  const progress = page.locator('.close-bar__value')
  const before = (await progress.innerText()).match(/^(\d+) of (\d+)$/)!
  await expect(balance).toHaveValue('')
  await copy.click()
  await expect(balance).toHaveValue(/\d/)
  await expect(progress).toHaveText(`${Number(before[1]) + 1} of ${before[2]}`)

  await page.getByRole('button', { name: `Undo: ${account}`, exact: true }).click()
  await expect(balance).toHaveValue('')
  await expect(progress).toHaveText(before[0])
})
