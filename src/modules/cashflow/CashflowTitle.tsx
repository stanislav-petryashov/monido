import { Suspense } from 'react'
import { Freshness } from '../../components/layout/Freshness'
import { lazyWithChunks } from '../../i18n/lazyWithChunks'

// the finding needs the period figures (domain/cashflowPeriod.ts) and the page's texts: loaded with them, not with the first screen
const Finding = lazyWithChunks(() => import('../../pages/cashflow/TitleParts').then(m => ({ default: m.CashflowFinding })), 'analysis')
const Split = lazyWithChunks(() => import('../../pages/cashflow/TitleParts').then(m => ({ default: m.SplitAction })), 'analysis')
const Lead = lazyWithChunks(() => import('../../pages/cashflow/TitleParts').then(m => ({ default: m.CategoriesLead })), 'analysis')

/** The Income and expenses title row's subtitle (`RouteDef.subtitle`): the period's finding; the data month and rate while it loads */
export function CashflowSubtitle() {
  return <Suspense fallback={<Freshness />}><Finding /></Suspense>
}

/** The title row's primary (`RouteDef.primary`): "Split <amount> <month>" while the last closed month has unsplit amounts */
export function CashflowPrimary() {
  return <Suspense fallback={null}><Split /></Suspense>
}

/** The categories screen's subtitle (`RouteDef.subtitle` of /cashflow/categories): what to do there and what is left to split */
export function CategoriesSubtitle() {
  return <Suspense fallback={<Freshness />}><Lead /></Suspense>
}
