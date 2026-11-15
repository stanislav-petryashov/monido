import { lazy } from 'react'
import { IconCreditCard } from '@tabler/icons-react'
import type { ClientModule } from '../client'
import { LoansSubtitle } from './LoansSubtitle'

// Pages sit right in the route: this file exports no component, and a named lazy here breaks fast refresh
export const loansClient: ClientModule = {
  key: 'loans',
  assetRecords: { kind: 'loan', path: '/loans' },
  icon: IconCreditCard,
  routes: [{
    section: 'data', path: '/loans', group: 'money', bottomBar: 50, title: 'modules.loans.title', icon: IconCreditCard, order: 25, subtitle: LoansSubtitle,
    page: lazy(() => import('../../pages/admin/LoansView').then(m => ({ default: m.LoansView }))),
  }],
}
