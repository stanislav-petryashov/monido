import { useTranslation } from 'react-i18next'
import { monthOf } from '../../domain/dates'
import { bridgeParts, monthWindow, partialCapitalMonths, selectedDeltas } from '../../domain/overviewBlocks'
import type { FinanceSnapshot } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { PHONE, useMedia } from '../../lib/media'
import { milestoneText } from '../../lib/milestoneText'
import { signed } from '../../lib/pageHelpers'
import { useMoney } from '../../lib/privacy'
import { WindowChart } from './WindowChart'

interface NetWorthBlockProps {
  snapshot: FinanceSnapshot
  /** The selected closed month, 'YYYY-MM' */
  month: string
  /** The close card of this month is on the page above: its milestone is not repeated here */
  resultShown?: boolean
}


/**
 * The Overview's main block: the selected month's net worth with its changes over the month and the year, the window
 * of the thirteen months up to it (WindowChart) and the bridge — net worth and loans as the two parts of the assets.
 * Two columns (overview.css's grid areas): the figures with the bridge at their foot on the left, the chart on the right;
 * one column on a phone, the chart between the figures and the bridge.
 * The amounts come through the dashboard's `fmt`, which masks them in privacy mode. A partial month (a balance missing
 * or without a rate) shows "—" with a note, no changes and no bridge, and is a gap on the chart.
 */
export function NetWorthBlock({ snapshot, month, resultShown = false }: NetWorthBlockProps) {
  const { t } = useTranslation()
  const { fmt, fmtCompact } = useDashboard()
  const fmtIn = useMoney()
  const compact = useMedia(PHONE)
  const window = monthWindow(snapshot.history, month)
  const partial = partialCapitalMonths(snapshot)
  const point = snapshot.history.find(p => monthOf(p.date) === month)
  const selected = point && !partial.has(month) ? point : undefined
  const value = selected ? fmt(selected.netWorth) : '—'
  const deltas = selectedDeltas(snapshot.history, month, partial)
  // the bridge follows the selected month, the same point the value comes from
  const parts = selected ? bridgeParts(selected) : null
  // without loans the bar is net worth alone: no loans part, caption or clause about them
  const loans = !!selected && selected.liabilities > 0
  // the month's headline milestone, for the one who did not close it; an imported month is never announced
  const milestone = resultShown ? undefined : snapshot.milestones?.find(m => m.month === month && m.headline && m.announced)
  const first = snapshot.history.length > 0 && month === monthOf(snapshot.history[0].date)

  const delta = (amount: number, label: string) => (
    <span className="delta-pair">
      <span className="delta num">{signed(amount, fmt)}</span>
      {' '}
      <span className="delta-pair__label">{label}</span>
    </span>
  )

  return (
    <section className="card card--p nw">
      <div className="nw__head">
        <span className="figure-label">{`${t('metrics.net_worth.title')} · ${fmtMonth(month)}`}</span>
        <strong className="hl__value" role="region" tabIndex={0} aria-label={value}>{value}</strong>
        <div className="nw__deltas">
          {/* no previous point: the first month says so, a month after a gap has no month change */}
          {deltas.month !== null
            ? delta(deltas.month, t('common.overMonth'))
            : first && <span>{t('pages.overview.firstMonth')}</span>}
          {deltas.year !== null && delta(deltas.year, t('common.overYear'))}
        </div>
        {point && !selected && <p className="note">{t('pages.overview.netWorthIncomplete')}</p>}
        {milestone && <p className="nw__milestone">{milestoneText(t, milestone, fmtIn)}</p>}
      </div>
      <WindowChart
        window={window}
        fmtCompact={fmtCompact}
        value={value}
        compact={compact}
        changeLabel={t('pages.overview.changeLane')}
        // a partial month is a gap on the line and the strip; only then, so a full history keeps its point spacing
        unavailableMonths={partial.size ? [...partial] : undefined}
        label={t('pages.overview.windowLabel', { count: window.points.length, month: fmtMonth(monthOf(window.points.at(-1)?.date ?? `${month}-01`)) })}
      />
      {selected && parts && (
        <div className="bridge-block">
          <div className="bridge" aria-hidden="true">
            <i className="bridge__net" style={{ width: `${parts.netPct}%` }} />
            {loans && <i className="bridge__loans" style={{ width: `${parts.loansPct}%` }} />}
          </div>
          <div className="bridge__row">
            <span className="bridge__part">
              <i className="bridge__key bridge__key--net" aria-hidden="true" />
              {t('metrics.net_worth.title')}
              {' '}
              <span className="num">{fmt(selected.netWorth)}</span>
            </span>
            {loans && (
              <span className="bridge__part">
                <i className="bridge__key bridge__key--loans" aria-hidden="true" />
                {t('modules.loans.title')}
                {' '}
                <span className="num">{fmt(selected.liabilities)}</span>
              </span>
            )}
          </div>
          <p className="note">{t(loans ? 'pages.overview.bridgeNote' : 'pages.overview.bridgeNoteOwned', { assets: fmt(selected.assets) })}</p>
        </div>
      )}
    </section>
  )
}
