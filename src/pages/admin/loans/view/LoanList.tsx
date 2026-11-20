import { useTranslation } from 'react-i18next'
import { fmtCurrency, fmtDayNumeric, fmtMonthYear, fmtNum, fmtPct } from '../../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../../lib/privacy'
import { OwnerAvatar } from '../../../../components/ui/OwnerAvatar'
import { EndsTimeline } from './EndsTimeline'
import { loanTone, useCents } from './money'
import '../../../../styles/accounts.css'
import '../../../../styles/real-estate.css'
import '../../../../styles/loans.css'

/** A loan as the list shows it */
export interface ListLoan {
  name: string
  member: string
  currency: string
  rate: number
  /** Owed today (balanceToday), the principal for a loan not issued yet; null — closed by today */
  balance: number | null
  /** The next payment; null — none left */
  payment: number | null
  issueDate: string
  /** The schedule's last payment; null — no schedule */
  last: string | null
  /** % of the principal repaid; null — unknown */
  repaid: number | null
  /** Status closed: the day, '' — none stored; null — open */
  closed: string | null
}

/** The family figures above and under the rows */
export interface ListTotals {
  /** Today, 'YYYY-MM-DD' */
  date: string
  /** The totals' currency; null — several and no snapshot */
  currency: string | null
  balance: number | null
  payment: number | null
  /** The closed month's debt (capital.liabilities) and its month; null — no closed month */
  capital: { month: string; amount: number; currency: string } | null
  /** Payments to income, % (health.debt_payment_ratio); null — unknown */
  share: number | null
  endsNext: { from: string; paymentAfter: number } | null
  /** The loans still paying and their next payment in the totals' currency (null — no rate): the payments track */
  payments: { name: string; payment: number | null }[]
}

interface LoanListProps {
  label: string
  loans: ListLoan[]
  members: string[]
  totals: ListTotals | null
  selected: string | null
  onSelect: (name: string) => void
  empty: string
}

/**
 * The Loans list: «Owed on <today>» with the family total and the closed month's figure under it, a row per loan — the
 * owner, the name, the balance today; «owner · rate» and the payment a month; «until <last payment> · N% repaid» (a
 * closed loan dimmed, «closed <date>», no balance) — then the payments a month as one track and, with two or more paying
 * loans, «When they end». Keeps `side-list` / `side-list__item`: the record pane hides and refocuses through them.
 */
export function LoanList({ label, loans, members, totals, selected, onSelect, empty }: LoanListProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const cents = useCents()
  const money = (v: number | null, currency: string | null) => (hidden ? PRIVACY_MASK : v === null || currency === null ? '—' : fmtCurrency(v, currency))
  const open = loans.filter(l => l.balance !== null)
  // the loans still paying: a loan its schedule repaid (not closed yet) is listed, but has no segment and no bar
  const paying = (totals?.payments ?? []).filter(p => p.payment !== null && p.payment > 0)
  const running = open.filter(l => totals?.payments.some(p => p.name === l.name))
  const paymentSum = paying.reduce((s, p) => s + p.payment!, 0)
  const tone = (name: string) => loanTone(running.findIndex(l => l.name === name))
  return (
    <div className="side-list acc-list ln-list" role="group" aria-label={label}>
      {totals && open.length > 0 && (
        <div className="ln-total">
          <div className="ln-total__l">{t('modules.loans.owedOn', { date: fmtDayNumeric(totals.date) })}</div>
          <div className="ln-total__v num" tabIndex={0}>{money(totals.balance, totals.currency)}</div>
          {totals.capital && <div className="ln-total__m">{t('modules.loans.inCapital', { month: t(`dates.monthOf.${Number(totals.capital.month.slice(5, 7))}`), amount: money(totals.capital.amount, totals.capital.currency) })}</div>}
        </div>
      )}
      {loans.map(l => (
        <button key={l.name} type="button" aria-current={l.name === selected ? 'true' : undefined}
          className={`side-list__item record-row${l.closed !== null ? ' ln-row--closed' : ''}`} onClick={() => onSelect(l.name)}>
          <OwnerAvatar member={l.member} members={members} />
          <span className="record-row__name">{l.name}</span>
          <span className="record-row__bal num">{l.balance === null ? '' : money(l.balance, l.currency)}</span>
          <span className="record-row__meta">{l.balance === null ? l.member : t('data.loans.listing.meta', { member: l.member, rate: `${fmtNum(l.rate, 2)}%` })}</span>
          <span className="record-row__chg num">{l.balance !== null && l.payment ? t('data.loans.listing.perMonth', { amount: cents(l.payment, l.currency) }) : ''}</span>
          <span className="ln-row__end">{[
            l.closed !== null && (l.closed ? t('data.loans.listing.closed', { date: fmtDayNumeric(l.closed) }) : t('data.loans.closedShort')),
            l.balance !== null && l.last && t('data.loans.listing.until', { date: fmtDayNumeric(l.last), share: l.repaid === null ? '—' : fmtPct(l.repaid) }),
          ].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
      {loans.length === 0 && <p className="empty">{empty}</p>}
      {totals && paying.length > 0 && (
        <div className="re-share">
          <div className="re-share__l">
            <span>{t('data.loans.listing.payments')}</span>
            <b className="num">{totals.share === null ? money(totals.payment, totals.currency)
              : t('data.loans.listing.paymentsShare', { payment: money(totals.payment, totals.currency), share: fmtPct(totals.share) })}</b>
          </div>
          <div className="re-track" role="img" aria-label={t('data.loans.listing.paymentsTrack')}>
            {paying.map(p => <i key={p.name} className={tone(p.name)} style={{ width: `${(p.payment! / paymentSum) * 100}%` }} title={p.name} />)}
          </div>
          {running.length >= 2 && (
            <div className="ln-ends">
              <div className="re-share__l">
                <span>{t('data.loans.listing.ends')}</span>
                {totals.endsNext && <b className="num">{t('data.loans.listing.endsNext', { month: fmtMonthYear(totals.endsNext.from), payment: money(totals.endsNext.paymentAfter, totals.currency) })}</b>}
              </div>
              <EndsTimeline loans={running.map(l => ({ name: l.name, from: l.issueDate, to: l.last!, tone: tone(l.name) }))} today={totals.date} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
