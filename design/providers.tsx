// The catalog's providers: the app's own, in src/App.tsx's order, over the seeded client of setup.ts
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { NotifyProvider } from '../src/components/NotifyProvider'
import { i18n } from '../src/i18n/client'
import { setAuth } from '../src/lib/authState'
import { CurrencyProvider } from '../src/lib/CurrencyProvider'
import { DashboardProvider } from '../src/lib/DashboardContext'
import { PrivacyProvider } from '../src/lib/PrivacyProvider'
import { ThemeProvider } from '../src/lib/ThemeContext'

export function DesignProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  // the owner's rights, as the family password gives them
  setAuth({ mode: 'password', me: null })
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <PrivacyProvider><CurrencyProvider><DashboardProvider><NotifyProvider>{children}</NotifyProvider></DashboardProvider></CurrencyProvider></PrivacyProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  )
}
