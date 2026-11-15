import { initClientI18n, loadLocaleChunk } from '../src/i18n/client'
import { installNoNetwork, takeBlocked } from './helpers/noNetwork'

// every project: no host but loopback is reachable (tests/helpers/noNetwork.ts); a test that tried another one fails
installNoNetwork()
afterEach(() => {
  const blocked = takeBlocked()
  if (blocked.length) throw new Error(blocked.join('\n'))
})

// every project (vitest.config.ts): tests run in English; a test switches language with withLanguage (tests/helpers/i18n.ts)
await initClientI18n('en-US')
// the Records and Settings screens are rendered directly in many tests, without DataPage, which loads their texts in the app;
// the Advisor pages' tests load their own chunk (tests/modules/advisor/routes.test.tsx renders the routes without it)
await loadLocaleChunk('records')

// Direct financial-panel tests bypass the cash-flow route's lazy locale loader.
await loadLocaleChunk('analysis')
await loadLocaleChunk('planning')
