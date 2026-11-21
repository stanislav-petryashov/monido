// End-to-end tests in a real browser against the built app: `npm run e2e` (builds first), .github/workflows/e2e.yml in CI.
// Each run starts two servers on fresh temporary databases (tests/e2e/server.ts): the family app and the demo.
import { defineConfig } from '@playwright/test'

const APP = 'http://127.0.0.1:41731'
const DEMO = 'http://127.0.0.1:41732'
const server = (url: string, args: string) => ({
  command: `node --import tsx tests/e2e/server.ts ${args}`,
  url: `${url}/api/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  // the wrapper removes its temporary DATA_DIR once the server has stopped
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
})

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 2,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP,
    locale: 'en-US',
    timezoneId: 'UTC',
    // as in scripts/screenshots.ts: PW_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium
    channel: process.env.PW_CHANNEL,
    trace: 'retain-on-failure',
  },
  // the first run sets the family password the others sign in with; the family language is switched last, as every
  // other test reads the English screens
  projects: [
    { name: 'first-run', testMatch: 'firstRun.spec.ts' },
    { name: 'app', testMatch: ['routes.spec.ts', 'monthClose.spec.ts', 'privacy.spec.ts'], dependencies: ['first-run'] },
    { name: 'language', testMatch: 'language.spec.ts', dependencies: ['app'] },
    { name: 'demo', testMatch: 'demo.spec.ts', use: { baseURL: DEMO } },
  ],
  webServer: [server(APP, '41731'), server(DEMO, '41732 --demo')],
})
