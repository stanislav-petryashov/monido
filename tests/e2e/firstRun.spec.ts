import { dropUnauthorized, expect, PASSWORD, test } from './fixtures'

test('the first visitor sets the password, signs out and signs back in; a wrong password is refused', async ({ page, errors }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up sign-in' })).toBeVisible()
  await page.getByLabel('Family password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Repeat the password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Save and sign in' }).click()

  const accountMenu = page.getByRole('button', { name: /account menu$/ })
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await accountMenu.click()
  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page.getByText('Enter your family password.')).toBeVisible()
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('not-the-family-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await password.fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await expect(accountMenu).toBeVisible()
  dropUnauthorized(errors, '/api/auth/login')
  dropUnauthorized(errors, '/api/snapshot')
})
