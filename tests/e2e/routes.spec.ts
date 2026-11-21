import { expect, expectPageShown, test } from './fixtures'

// every page of the menu and the pages reached from them (src/routes.ts and the modules' client.tsx); /setup is left
// out: it is the setup wizard, which a seeded family has finished
const ROUTES = [
  '/', '/assets', '/available-money', '/cashflow', '/cashflow/categories', '/goals', '/goals/edit', '/health',
  '/advisor', '/advisor/ask', '/advisor/connect', '/close', '/accounts', '/real-estate', '/loans',
  '/settings/general', '/settings/family', '/settings/reminders', '/settings/history', '/settings/data',
]

// where a page sends the visitor on purpose: Advisor opens on asking Claude without Telegram sign-in (AdvisorPage.tsx)
const LANDS_ON: Record<string, string> = { '/advisor': '/advisor/ask' }

test.beforeEach(async ({ signIn }) => { await signIn() })

for (const route of ROUTES) {
  test(`${route} opens`, async ({ page }) => {
    await page.goto(route)
    await expectPageShown(page)
    // an unknown address is sent to the Overview: a route that vanished would pass the checks above
    expect(new URL(page.url()).pathname).toBe(LANDS_ON[route] ?? route)
  })
}

test('Income and expenses for a year shows where the income went, and a group opens its categories', async ({ page }) => {
  await page.goto('/cashflow?p=year')
  await expectPageShown(page)
  const card = page.getByRole('region', { name: 'Where the income went' })
  const group = card.getByRole('button', { name: /Opens its categories\.$/ }).first()
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await group.click()
  await expect(group).toHaveAttribute('aria-expanded', 'true')
})
