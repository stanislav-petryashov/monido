import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import { lazy } from 'react'
import { IconArrowsExchange, IconReceipt } from '@tabler/icons-react'
import type { ClientModule } from '../client'
import { CashflowPrimary, CashflowSubtitle, CategoriesSubtitle } from './CashflowTitle'
import { CushionCell, ExpensesCell, IncomeCell, LeftCell } from './OverviewKpis'
import { OverviewNetCard } from './OverviewNetCard'

// Pages sit right in the route: this file exports no component, and a named lazy here breaks fast refresh
export const cashflowClient: ClientModule = {
  key: 'cashflow',
  icon: IconArrowsExchange,
  overview: {
    // the closed month's figures, the cushion last as the figure of the moment; the card: the twelve months' net
    kpis: [{ order: 10, Cell: IncomeCell }, { order: 20, Cell: ExpensesCell }, { order: 30, Cell: LeftCell }, { order: 40, Cell: CushionCell }],
    cards: [{ order: 20, Card: OverviewNetCard }],
  },
  // where an account's money comes from and goes, by category
  accountDetail: lazyWithChunks(() => import('./AccountCategories').then(m => ({ default: m.AccountCategories })), 'records'),
  routes: [
    {
      section: 'dashboard', path: '/cashflow', group: 'money', bottomBar: 40, bottomBarTitle: 'modules.cashflow.short', title: 'modules.cashflow.route', icon: IconArrowsExchange, order: 30,
      subtitle: CashflowSubtitle, primary: CashflowPrimary,
      page: lazyWithChunks(() => import('../../pages/CashFlow').then(m => ({ default: m.CashFlow })), 'analysis', 'planning', 'records'),
    },
    {
      section: 'data', path: '/cashflow/categories', area: '/cashflow', menu: false, title: 'modules.cashflow.flows.title', icon: IconReceipt, order: 25, subtitle: CategoriesSubtitle,
      page: lazy(() => import('./FlowsScreen').then(m => ({ default: m.FlowsScreen }))),
    },
  ],
}
