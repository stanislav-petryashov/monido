import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { shiftMonth } from '../../../domain/dates'
import { round2 } from '../../../domain/fx'
import { fmtMonthYear, fmtNum } from '../../../lib/formatters'
import { PHONE, useMedia } from '../../../lib/media'
import { signed } from '../../../lib/pageHelpers'
import { PRIVACY_MASK, usePrivacy } from '../../../lib/privacy'

/** One month of an account: its balance row and its flow row (null rowid — none) */
export interface MonthRecord {
  ym: string
  balance: number; balanceRowid: number | null
  active_income: number; passive_income: number; expense: number
  cfRowid: number | null
}

/** The newest months the table shows before "Show all" */
const CAP = 12

interface MonthTableProps {
  /** The account's months, newest first */
  history: MonthRecord[]
  currency: string
  /** Months after it are marked not closed; null — unknown */
  closedThrough: string | null
  /** The income and expense columns: the account has a non-zero flow */
  hasFlows: boolean
  /** The note that the account keeps only its balance (cash flow on, no flows) */
  balanceOnly: boolean
  /** «Correct» on each row, which opens the month editor; null — the viewer cannot edit */
  onCorrect: ((rec: MonthRecord) => void) | null
  /** The month editor, drawn above the table */
  editor?: ReactNode
}

/**
 * «Monthly history»: month, balance, the change against the month before («—» for the first month and after a gap),
 * income and expenses when the account has any, «Correct»; newest first, the last 12 until «Show all N months».
 * Keyed by the account, so a new account starts folded.
 */
export function MonthTable({ history, currency, closedThrough, hasFlows, balanceOnly, onCorrect, editor }: MonthTableProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const titleId = useId()
  const [all, setAll] = useState(false)
  const shown = all ? history : history.slice(0, CAP)
  // the exact figures, cents when there are some; the currency is in the headers
  const money = (v: number) => (hidden ? PRIVACY_MASK : fmtNum(v, 2))
  const phone = useMedia(PHONE)
  const inCurrency = (label: string) => (phone ? label : t('data.field.inCurrency', { label, currency }))
  const changeOf = (i: number): number | null => {
    const rec = history[i]; const prev = history[i + 1]
    if (!prev || rec.balanceRowid === null || prev.balanceRowid === null || prev.ym !== shiftMonth(rec.ym, -1)) return null
    return round2(rec.balance - prev.balance)
  }
  return (
    <section className="admin-panel" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('data.accounts.history')}</h2>
        {history.length > 0 && <span className="acc-card__meta">{all || history.length <= CAP ? t('pages.accounts.table.metaAll', { n: history.length }) : t('pages.accounts.table.metaLast', { n: CAP })}
          {phone && <> · {t('pages.accounts.table.amountsIn', { currency })}</>}</span>}
      </div>
      {editor}
      {balanceOnly && <p className="acc-months__note">{t('pages.accounts.table.noFlows')}</p>}
      {history.length > 0 ? (
        <div className="admin-table-scroll">
          <table className="admin-table acc-months">
            <thead>
              <tr>
                <th>{t('data.field.month')}</th>
                <th className="td-num">{inCurrency(t('data.field.balance'))}</th>
                <th className="td-num">{inCurrency(t('pages.accounts.table.change'))}</th>
                {hasFlows && <>
                  <th className="td-num acc-months__flow">{inCurrency(t('pages.accounts.flows.income'))}</th>
                  <th className="td-num acc-months__flow">{inCurrency(t('pages.accounts.flows.expense'))}</th>
                </>}
                {onCorrect && <th className="td-actions"><span className="sr-only">{t('pages.accounts.table.correct')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((rec, i) => {
                const change = changeOf(i)
                return (
                  <tr key={rec.ym}>
                    <td className="td-name">
                      {fmtMonthYear(rec.ym)}
                      {closedThrough && rec.ym > closedThrough && <span className="close-table__meta">{t('data.accounts.notClosed')}</span>}
                    </td>
                    <td className="td-num">{rec.balanceRowid === null ? '—' : money(rec.balance)}</td>
                    <td className={change === null ? 'td-num td-muted' : 'td-num'}>{change === null ? '—' : signed(change, money)}</td>
                    {hasFlows && <>
                      <td className="td-num acc-months__flow">{rec.cfRowid === null ? '—' : money(rec.active_income + rec.passive_income)}</td>
                      <td className="td-num acc-months__flow">{rec.cfRowid === null ? '—' : money(rec.expense)}</td>
                    </>}
                    {onCorrect && (
                      <td className="td-actions">
                        <button type="button" className="btn btn--quiet acc-months__fix" aria-label={t('data.accounts.correctMonth', { month: fmtMonthYear(rec.ym) })}
                          onClick={() => onCorrect(rec)}>{t('pages.accounts.table.correct')}</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">{t('data.accounts.noMonths')}</div>
      )}
      {history.length > CAP && (
        <button type="button" className="btn btn--ghost acc-months__more" onClick={() => setAll(!all)}>
          {all ? t('data.accounts.showFewer', { count: CAP }) : t('data.accounts.showAll', { count: history.length })}
        </button>
      )}
    </section>
  )
}
