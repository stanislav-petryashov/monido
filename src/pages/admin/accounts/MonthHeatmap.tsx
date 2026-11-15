import { Fragment, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountStats } from '../../../domain/accountStats'
import { fmtMonth, fmtMonthShort, fmtMonthYear, fmtNum } from '../../../lib/formatters'
import { signed } from '../../../lib/pageHelpers'
import { useMoney, usePrivacy } from '../../../lib/privacy'
import { useChartFrame } from '../../../components/charts/useChartFrame'

/** The tint steps of a cell: its change against the history's largest, in thirds */
const LEVELS = 3
const MONTHS = Array.from({ length: 12 }, (_, i) => `2000-${String(i + 1).padStart(2, '0')}`)

interface MonthHeatmapProps {
  stats: Pick<AccountStats, 'heat' | 'changes'>
  /** The last closed month: its cell is outlined */
  lastMonth: string
  currency: string
  /** A phone: the cells carry no numbers */
  compact: boolean
}

/**
 * «Month by month»: one row per calendar year of the account's history, a cell per month tinted by the month's change —
 * success up, warning down, three steps by its size against the largest —, the value in the cell but on a phone, the
 * last closed month outlined, a gap in the history dashed (the first month plain, months outside the history empty); the meta counts the months up and down; a visually
 * hidden summary says that and the biggest rise and fall; a key. Nothing until one month has a change.
 */
export function MonthHeatmap({ stats, lastMonth, currency, compact }: MonthHeatmapProps) {
  const { ref: heatRef, width, scale } = useChartFrame<HTMLDivElement>(700)
  const halfYears = scale > 1 && width < 700
  const groups = halfYears ? [0, 6] : [0]
  const columns = halfYears ? 6 : 12
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const masked = useMoney()
  const titleId = useId()
  const known = stats.changes.map(c => c.change).filter((c): c is number => c !== null)
  // no month with a change yet: a grid of empty cells says nothing
  if (known.length === 0) return null
  const largest = Math.max(0, ...known.map(Math.abs))
  const up = known.filter(c => c > 0).length
  const down = known.filter(c => c < 0).length
  /** '+1.7k', '−80': the cell's short amount */
  const short = (c: number) => {
    const abs = Math.abs(c)
    const value = abs >= 1e6 ? t('pages.accounts.heat.millions', { value: fmtNum(abs / 1e6, 1) })
      : abs >= 1000 ? t('pages.accounts.heat.thousands', { value: fmtNum(abs / 1000, 1) }) : fmtNum(abs, 0)
    return `${c > 0 ? '+' : c < 0 ? '−' : ''}${value}`
  }
  const tone = (c: number) => (c === 0 || largest === 0 ? '' : ` acc-heat__cell--${c > 0 ? 'up' : 'down'}-${Math.max(1, Math.ceil((Math.abs(c) / largest) * LEVELS))}`)
  const years = stats.heat.map(r => r.year)
  const first = stats.changes[0].month
  /** A cell without a change: before the history or after the last closed month empty, the first month plain, a real gap dashed */
  const blank = (ym: string) => (ym < first || ym > lastMonth ? ' acc-heat__cell--out' : ym === first ? '' : ' acc-heat__cell--none')
  const money = (c: number) => signed(c, v => masked(v, currency))
  /** The month with the largest change of that sign, for the screen reader's summary */
  const extreme = (sign: 1 | -1) => stats.changes.reduce<{ month: string; change: number } | null>((best, c) =>
    (c.change !== null && c.change * sign > 0 && (!best || c.change * sign > best.change * sign) ? { month: c.month, change: c.change } : best), null)
  const summary = [
    t('pages.accounts.heat.summary', { count: up, down }),
    ...([[extreme(1), 'pages.accounts.heat.biggestUp'], [extreme(-1), 'pages.accounts.heat.biggestDown']] as const)
      .flatMap(([m, key]) => (m ? [t(key, { month: fmtMonth(m.month), change: money(m.change) })] : [])),
  ].join(' ')

  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('pages.accounts.heat.title')}</h2>
        <span className="acc-card__meta">{t('pages.accounts.heat.meta', { count: up, down })}</span>
      </div>
      <div ref={heatRef} className="acc-heatmap" role="img" aria-label={t('pages.accounts.heat.label', { from: years[0], to: years[years.length - 1] })}>
      {groups.map(offset => <div key={offset}>
        {halfYears && <p className="acc-heat__half">{fmtMonthShort(MONTHS[offset])} — {fmtMonthShort(MONTHS[offset + 5])}</p>}
        <div className={halfYears ? 'acc-heat acc-heat--half' : 'acc-heat'}>
        <span />
        {MONTHS.slice(offset, offset + columns).map((m, i) => <span key={m} className="acc-heat__month" title={fmtMonth(m)}>{compact ? fmtNum(offset + i + 1, 0) : fmtMonthShort(m)}</span>)}
        {stats.heat.map(row => (
          <Fragment key={row.year}>
            <span className="acc-heat__year">{row.year}</span>
            {row.cells.slice(offset, offset + columns).map((cell, k) => { const i = offset + k; return cell === null
              ? <span key={i} className={`acc-heat__cell${blank(`${row.year}-${String(i + 1).padStart(2, '0')}`)}`} />
              : (
                <span key={i} className={`acc-heat__cell num${tone(cell.change)}${cell.month === lastMonth ? ' acc-heat__cell--last' : ''}`}
                  title={`${fmtMonthYear(cell.month)}: ${money(cell.change)}`}>
                  {compact || hidden ? '' : short(cell.change)}
                </span>
              )})}
          </Fragment>
        ))}
        </div>
      </div>)}
      </div>
      {/* the grid is a picture to a screen reader: what it shows, in words */}
      <p className="sr-only">{summary}</p>
      <div className="acc-heat__key">
        <span>{t('pages.accounts.heat.less')}</span>
        <i className="acc-heat__cell--down-3" /><i className="acc-heat__cell--down-1" /><i className="acc-heat__cell--up-1" /><i className="acc-heat__cell--up-3" />
        <span>{t('pages.accounts.heat.more')}</span>
        <span className="acc-heat__note">{t('pages.accounts.heat.note')}</span>
      </div>
    </section>
  )
}
