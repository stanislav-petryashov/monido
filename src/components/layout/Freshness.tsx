import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { Trans, useTranslation } from 'react-i18next'
import type { FinanceSnapshot } from '../../domain/types'
import { monthsBehind } from '../../domain/dates'
import { useDisplayCurrency } from '../../lib/currencyState'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth, fmtNum } from '../../lib/formatters'
import { dataMonth } from '../../lib/snapshotSelectors'
import { useAsOf, useSnapshot } from '../../lib/useFinanceData'
import { Link } from '../ui/Link'

/** A closed month older than this many months makes the data stale. */
const STALE_AFTER = 2

/** The month the data is for; stale or missing data links to data entry, and only the age is the warning. */
function monthLine(asOf: FinanceSnapshot['asOf'], t: TFunction): ReactNode {
  const closed = dataMonth(asOf)
  if (!closed) return <Link to="/close" className="title-row__link">{t('nav.noData')}</Link>
  const behind = monthsBehind(closed, new Date())
  const text = <Trans i18nKey="nav.dataFor" components={{ lead: <span />, month: <>{fmtMonth(closed)}</> }} />
  if (behind < STALE_AFTER) return text
  return (
    <Link to="/close" className="title-row__link">
      {text}
      <span className="title-row__stale"> · <Trans i18nKey="nav.monthsAgo" values={{ value: behind }} components={{ tail: <span /> }} /></span>
    </Link>
  )
}

/**
 * The rate of the shown currency to the dollar. Dollars have no rate to show, not even while it loads (until the snapshot
 * names its currency, the quick view stands in; with neither there is nothing to show); the rate of a currency that has
 * none is simply absent.
 */
function useFxText(): string | null {
  const { t } = useTranslation()
  const { view } = useDisplayCurrency()
  const { rates, ratesLoading } = useDashboard()
  const { data: base } = useSnapshot(s => s.baseCurrency)
  const shown = base ?? view
  if (shown == null || shown === 'USD') return null
  if (ratesLoading) return t('nav.ratesLoading')
  return rates && base ? t('nav.rate', { rate: fmtNum(rates.perUsd, 2), code: base }) : null
}

/** The title row's subtitle: which month the data is for and, after a separator, the rate. Nothing until either is known. */
export function Freshness() {
  const { t } = useTranslation()
  const asOf = useAsOf()
  const fx = useFxText()
  const month = asOf.data ? monthLine(asOf.data, t) : null
  if (!month) return fx
  return <>{month}{fx && <>{' · '}{fx}</>}</>
}
