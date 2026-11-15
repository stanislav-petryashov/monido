import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { assetHistoryView, type AssetChanges } from '../../domain/assetChanges'
import { monthOf, monthsBetween } from '../../domain/dates'
import { monthWindow } from '../../domain/overviewBlocks'
import type { AssetPeriod, FinanceSnapshot } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { WindowChart } from '../overview/WindowChart'

/** The months around each period: the period itself and as much again before it, clamped to the history */
const SIZE: Record<AssetPeriod, number> = { month: 6, quarter: 12, year: 24, all: 36 }

interface AssetHistoryCardProps {
  snapshot: FinanceSnapshot
  period: AssetPeriod
  /** The period's change: its start shades the window; null — no period, nothing shaded */
  changes: AssetChanges | null
  /** «over the month»: the shaded span's caption */
  overLabel: string
  /** A phone: the chart's narrow frame */
  compact: boolean
}

/** Open the History disclosure at the end of the page and land on it, as the /assets#history address does */
function openHistory(e: MouseEvent<HTMLAnchorElement>) {
  const details = document.getElementById('history')
  if (!(details instanceof HTMLDetailsElement)) return
  e.preventDefault()
  details.open = true
  details.focus()
  window.history.replaceState(window.history.state, '', '#history')
}

/**
 * The assets over the months around the period (WindowChart reading `assets`): the period shaded with its change,
 * the months or the years at the foot, the window's largest month named; a link opens the full History.
 */
export function AssetHistoryCard({ snapshot, period, changes, overLabel, compact }: AssetHistoryCardProps) {
  const { t } = useTranslation()
  const { fmt, fmtCompact } = useDashboard()
  const last = snapshot.capital?.date ?? snapshot.history.at(-1)?.date
  if (!last) return null
  const months = monthWindow(snapshot.history, monthOf(last), SIZE[period], 'assets')
  const { points } = months
  const unavailable = assetHistoryView(snapshot).unavailableAssets
  const hasUnavailable = points.some((p, i) => unavailable.includes(monthOf(p.date)) || (i > 0 && monthsBetween(monthOf(points[i - 1].date), monthOf(p.date)) !== 1))
  if (points.length === 0) return null
  const from = changes && period !== 'all' ? points.findIndex(p => monthOf(p.date) === changes.startMonth) : -1
  const first = monthOf(points[0].date)
  const lastPoint = points[points.length - 1]

  return (
    <section className="card card--p mt-2 assets-history" aria-labelledby="assets-history">
      <div className="card-hd--row">
        <h2 className="card-hd" id="assets-history">
          {points.length === 24 ? t('pages.assets.historyTitleYears', { count: 2 }) : t('pages.assets.historyTitle', { count: points.length })}
        </h2>
        <span className="assets-meta">{t('pages.assets.historySince', { month: t(`dates.monthOf.${Number(first.slice(5))}`), year: first.slice(0, 4) })}</span>
      </div>
      <WindowChart
        window={months}
        fmtCompact={fmtCompact}
        value={unavailable.includes(monthOf(lastPoint.date)) ? '—' : fmt(lastPoint.assets)}
        unavailableMonths={unavailable}
        compact={compact}
        broad
        field="assets"
        calendar
        changeLabel={t('pages.overview.changeLane')}
        highlight={changes?.complete && !hasUnavailable && from >= 0 ? { from, label: `${signed(changes.change, fmt)} ${overLabel}` } : undefined}
        event={(month, change) => (compact
          ? `${fmtMonth(month)}: ${signed(change, fmt)}`
          : t('pages.assets.historyEvent', { month: fmtMonth(month), change: signed(change, fmt) }))}
        label={t('pages.overview.windowLabel', { count: points.length, month: fmtMonth(monthOf(lastPoint.date)) })}
      />
      {hasUnavailable && <p className="note">{t('pages.assets.incomplete')}</p>}
      <a className="assets-more" href="#history" onClick={openHistory}>{t('pages.assets.historyMore')}</a>
    </section>
  )
}
