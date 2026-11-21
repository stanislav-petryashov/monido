import { test as base, expect, type Page } from '@playwright/test'

/** The family password the first run sets (firstRun.spec.ts) and every later test signs in with */
export const PASSWORD = 'e2e-throwaway-password'

/**
 * `errors`: every uncaught page error and console error of the test; the test fails on any left at its end (a test that
 * provokes one on purpose removes it). `signIn`: a session cookie for the page, through the sign-in API.
 */
export const test = base.extend<{ errors: string[]; signIn: () => Promise<void> }>({
  errors: [async ({ page }, provide) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()} (${message.location().url})`) })
    await provide(errors)
    expect(errors).toEqual([])
  }, { auto: true }],
  signIn: async ({ page }, provide) => {
    await provide(async () => {
      const response = await page.request.post('/api/auth/login', { data: { password: PASSWORD } })
      expect(response.status(), await response.text()).toBe(200)
    })
  },
})

export { expect }

/**
 * Removes the console lines of 401 answers from `path`. Expected for a refused sign-in; for /api/snapshot it is a known
 * issue: CurrencyProvider and DashboardProvider sit above AuthGate (src/App.tsx), so the sign-in screen reads the
 * snapshot before anyone has signed in. Called at the end of a test, after the requests have answered.
 */
export function dropUnauthorized(errors: string[], path: string): void {
  const expected = (e: string) => e.includes('status of 401') && e.endsWith(`${path})`)
  errors.splice(0, errors.length, ...errors.filter(e => !expected(e)))
}

/** The page's title has drawn and no part of it shows the error screen or a failed load. */
export async function expectPageShown(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  // the lazy chunks and the page's reads have answered: a failure would be on the screen and in the console by now
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Could not display the page')).toHaveCount(0)
  await expect(page.getByText('Failed to load')).toHaveCount(0)
}
