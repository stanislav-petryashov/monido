import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedPills } from '../../../components/ui/SegmentedPills'
import { monthEnd, monthOf, shiftMonth } from '../../../domain/dates'
import { monthWindow } from '../../../domain/overviewBlocks'
import { fmtCompactCurrency, fmtMonth } from '../../../lib/formatters'
import { niceTicks } from '../../../lib/niceTicks'
import { signed } from '../../../lib/pageHelpers'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../../lib/privacy'
import { WindowChart } from '../../overview/WindowChart'

/** The window switch: the 12 months up to the last closed one, or the whole history */
const WINDOWS = ['12', 'all'] as const
export type AccountWindow = (typeof WINDOWS)[number]

interface BalanceCardProps {
  name: string
  currency: string
  /** The month-end balances up to the last closed month, oldest first */
  balances: { month: string; value: number }[]
  lastMonth: string
  window: AccountWindow
  onWindow: (w: AccountWindow) => void
  /** A phone: the chart's narrow frame */
  compact: boolean
}

/**
 * «Balance by month»: the account's month-end balances through the shared WindowChart (no ECharts here) — the line, the
 * monthly change strip with the last month in violet, the biggest month named only when it stands out (`labelOnlyStandout`) —, the window switch
 * 12 months / All time and, in the 12-month window, the balance a year earlier as a dashed line (a checkbox, on by
 * default; the scale covers both years).
 */
export function BalanceCard({ name, currency, balances, lastMonth, window, onWindow, compact }: BalanceCardProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const masked = useMoney()
  const [lastYear, setLastYear] = useState(true)
  const titleId = useId()
  const history = balances.map(b => ({ date: monthEnd(b.month), assets: b.value, liabilities: 0, netWorth: 0 }))
  const win = monthWindow(history, lastMonth, window === '12' ? 12 : history.length, 'assets')
  const { points } = win
  if (points.length < 2) return null
  const byMonth = new Map(balances.map(b => [b.month, b.value]))
  const yearAgo = points.map(p => byMonth.get(shiftMonth(monthOf(p.date), -12)) ?? null)
  const canGhost = window === '12' && yearAgo.some(v => v !== null)
  const ghost = canGhost && lastYear ? yearAgo : null
  const values = [...points.map(p => p.assets), ...(ghost ?? []).filter((v): v is number => v !== null)]
  // the account's own scale (small steps for a small balance), the year-ago line inside it
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const money = (v: number) => masked(v, currency)
  const first = monthOf(points[0].date)
  const last = points[points.length - 1]

  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('pages.accounts.balance.title')}</h2>
        <div className="acc-card__tools">
          {canGhost && (
            <label className="acc-check">
              <input type="checkbox" className="admin-cb" checked={lastYear} onChange={e => setLastYear(e.target.checked)} />
              {t('pages.accounts.balance.lastYear')}
            </label>
          )}
          <SegmentedPills items={WINDOWS} active={window} onSelect={onWindow} ariaLabel={t('pages.accounts.balance.period')}
            label={w => t(w === '12' ? 'pages.accounts.balance.window12' : 'pages.accounts.balance.windowAll')} />
        </div>
      </div>
      <WindowChart
        window={{ ...win, ticks }}
        fmtCompact={(v, digits) => (hidden ? PRIVACY_MASK : fmtCompactCurrency(v, currency, digits))}
        value={money(last.assets)}
        compact={compact}
        field="assets"
        calendar
        changeLabel={t('pages.overview.changeLane')}
        ghost={ghost ? { values: ghost, label: t('pages.accounts.yearAgo') } : undefined}
        labelOnlyStandout
        event={(month, change) => {
          const text = signed(change, money)
          return compact ? `${fmtMonth(month)}: ${text}` : t('pages.accounts.balance.biggest', { month: fmtMonth(month), change: text })
        }}
        label={t('pages.accounts.balance.label', { name, from: fmtMonth(first), to: fmtMonth(monthOf(last.date)) })}
      />
    </section>
  )
}
