import { Trans, useTranslation } from 'react-i18next'
import type { AccountFinding, AccountStats } from '../../../domain/accountStats'
import { fmtInMonth, fmtMonthYear } from '../../../lib/formatters'
import { useMoney } from '../../../lib/privacy'

/** The track's ends: the minimum at 4%, the maximum at 96%, so the dot at either end stays on the track */
const EDGE = 4

interface UsualRangeProps {
  range: NonNullable<AccountStats['range']>
  /** The balance now; null — none in the last closed month (no dot) */
  last: number | null
  currency: string
}

/**
 * The balance's usual range over 12 months: «from A to B, on average C», a track with the min–max band, the average's
 * tick and a dot at the balance now, the ends captioned «minimum · <month>», «now X», «maximum».
 */
export function UsualRange({ range, last, currency }: UsualRangeProps) {
  const { t } = useTranslation()
  const masked = useMoney()
  const money = (v: number) => masked(v, currency)
  const span = range.max - range.min
  // a flat year: everything in the middle
  const pos = (v: number) => `${span ? EDGE + ((v - range.min) / span) * (100 - 2 * EDGE) : 50}%`
  return (
    <div className="acc-range">
      <div className="acc-range__hd">
        <span><Trans i18nKey="pages.accounts.range.title" values={{ min: money(range.min), max: money(range.max) }} components={{ b: <b className="num" /> }} /></span>
        <span className="num">{t('pages.accounts.range.avg', { avg: money(range.avg) })}</span>
      </div>
      <div className="acc-range__bar" role="img" aria-label={t('pages.accounts.range.label', { amount: last === null ? '—' : money(last) })}>
        <span className="acc-range__band" />
        <span className="acc-range__avg" style={{ left: pos(range.avg) }} />
        {last !== null && <span className="acc-range__now" style={{ left: pos(last) }} />}
      </div>
      <div className="acc-range__ends">
        <span>{t('pages.accounts.range.min', { month: fmtMonthYear(range.minMonth) })}</span>
        {last !== null && <span className="num">{t('pages.accounts.range.now', { amount: money(last) })}</span>}
        <span>{t('pages.accounts.range.max')}</span>
      </div>
    </div>
  )
}

/** A finding's params as the sentence reads them: `month` as «in <month> <year>», the amounts in the account's currency */
function findingValues(params: AccountFinding['params'], money: (v: number) => string): Record<string, string | number> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k,
    k === 'month' ? `${fmtInMonth(String(v))} ${String(v).slice(0, 4)}` : k === 'amount' || k === 'average' ? money(Number(v)) : v]))
}

/** What stands out about the account, each line only when the domain found it true (`accountStats().findings`). */
export function AccountFindings({ findings, currency }: { findings: AccountFinding[]; currency: string }) {
  const masked = useMoney()
  if (findings.length === 0) return null
  const money = (v: number) => masked(v, currency)
  return (
    <ul className="acc-findings">
      {findings.map(f => (
        <li key={f.key}><Trans i18nKey={f.key} values={findingValues(f.params, money)} components={{ b: <b /> }} /></li>
      ))}
    </ul>
  )
}
