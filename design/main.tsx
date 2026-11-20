// The design catalog, local only (npm run dev, /design/): every shared element from design/registry.ts, drawn with the
// app's real components and CSS. The CSS comes in src/main.tsx's order first, then every other file at once, so the
// cascade can differ from the app's lazily loaded pages.
import '@fontsource-variable/onest/index.css'
import '../src/styles/tokens.css'
import '../src/styles/record-charts.css'
import '../src/styles/ui-surfaces.css'
import '../src/styles/record-list.css'
import '../src/styles/accounts.css'
import '../src/styles/admin.css'
import '../src/styles/allocation.css'
import '../src/styles/assets.css'
import '../src/styles/availability.css'
import '../src/styles/cashflow.css'
import '../src/styles/categories.css'
import '../src/styles/controls.css'
import '../src/styles/disclosure.css'
import '../src/styles/finance.css'
import '../src/styles/goals.css'
import '../src/styles/loans.css'
import '../src/styles/month-coverage.css'
import '../src/styles/overview.css'
import '../src/styles/progress-track.css'
import '../src/styles/real-estate.css'
import '../src/styles/setup.css'
import '../src/styles/shell.css'
import '../src/styles/wchart.css'
import '../src/modules/advisor/advisor.css'
import '../src/modules/reminders/notifications.css'
import '../src/pages/admin/journal.css'
import '../src/pages/admin/journal-mobile.css'
import '../src/pages/settings/data-settings.css'
import '../src/pages/settings/family-settings.css'
import '../src/pages/settings/settings-navigation.css'
import './design.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DesignPage } from './DesignPage'
import { blockApi } from './noApi'
import { DesignProviders } from './providers'
import { designClient, initDesignI18n } from './setup'

// no request of the catalog reaches the dev server's API, a write least of all
window.fetch = blockApi(window.fetch.bind(window))
await initDesignI18n('en-US')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesignProviders client={designClient()}><DesignPage /></DesignProviders>
  </StrictMode>,
)
