import { lazy, Suspense } from 'react'
import { Freshness } from '../../components/layout/Freshness'

// the figures need the schedules (domain/loans.ts): loaded with the subtitle, not with the app's first screen
const Body = lazy(() => import('./LoansSubtitleBody').then(m => ({ default: m.LoansSubtitleBody })))

/** The Loans title row's subtitle (`RouteDef.subtitle`); the data month and rate (`Freshness`) while it loads. */
export function LoansSubtitle() {
  return <Suspense fallback={<Freshness />}><Body /></Suspense>
}
