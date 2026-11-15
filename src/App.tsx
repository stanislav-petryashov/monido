import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { CurrencyProvider } from './lib/CurrencyProvider'
import { PrivacyProvider } from './lib/PrivacyProvider'
import { DashboardProvider } from './lib/DashboardContext'
import { ThemeProvider } from './lib/ThemeContext'
import { AppShell } from './components/layout/AppShell'
import { AuthGate } from './components/AuthGate'
import { SetupGate } from './components/SetupGate'
import { DemoEnded } from './components/demo/DemoEnded'
import { NotifyProvider } from './components/NotifyProvider'
import { i18n } from './i18n/client'
import { queryClient } from './lib/queryClient'
import { settingsQuery } from './lib/familySettingsQuery'
import { Loading } from './components/ui/Loading'

function FamilyApp() {
  const settings = useQuery(settingsQuery)
  // Mount date editors only after the shared format is known. Data changes redraw plain formatters too.
  if (!settings.data && settings.isPending) return <Loading />
  return <><SetupGate><AppShell /></SetupGate><DemoEnded /></>
}

export default function App() {
  // Fresh child elements redraw plain formatters too; stable component identity preserves unsaved editors.
  useTranslation()
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <PrivacyProvider>
            <CurrencyProvider>
              <DashboardProvider>
                <NotifyProvider>
                  <AuthGate><FamilyApp /></AuthGate>
                </NotifyProvider>
              </DashboardProvider>
            </CurrencyProvider>
          </PrivacyProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  )
}
