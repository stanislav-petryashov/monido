import ru from '../../src/locales/ru-RU.json' with { type: 'json' }
import { expect, expectPageShown, test } from './fixtures'

test.beforeEach(async ({ signIn }) => { await signIn() })

test('switching the family language to Russian shows Russian text', async ({ page }) => {
  await page.goto('/settings/general')
  await expectPageShown(page)
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ru-RU')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru-RU')
  // the family setting, not this tab's: a fresh load of another page is in Russian too
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: ru.routes.overview })).toBeVisible()
})
