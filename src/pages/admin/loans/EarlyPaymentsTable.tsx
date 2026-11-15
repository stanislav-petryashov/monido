import { Fragment, useId, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LoanEarlyPayment } from '../../../domain/loans'
import { STRATEGY_LABEL } from './loanForm'
import { RowMenu } from '../ui/RowMenu'
import { fmtDayNumeric } from '../../../lib/formatters'
import { useMoney } from '../../../lib/privacy'
import { useCents } from './view/money'

/** Locale key of a strategy's caption; an unknown one counts as "Reduce payment" */
const strategyKey = (strategy: string) => STRATEGY_LABEL[strategy] ?? STRATEGY_LABEL['reduce_payment']

interface EarlyPaymentsTableProps {
  selectedEPs: LoanEarlyPayment[]
  /** The loan's currency */
  currency: string
  /** Their sum (the meta line) */
  total: number
  /** A new payment's editor, drawn as the top row */
  adding: ReactNode
  /** The payment being edited and its editor in its row */
  editing: { rowid: number; editor: ReactNode } | null
  /** The row menu's actions; null — none (a viewer) */
  actions: { edit: (ep: LoanEarlyPayment) => void; remove: (id: number) => void } | null
}

/**
 * A loan's early payments, newest first: date, amount, strategy, the bank's new payment and principal credit, note,
 * «···». The editor opens in place (EarlyPaymentEditor). On a phone each payment groups its amount, strategy, bank figures and note.
 */
export function EarlyPaymentsTable({ selectedEPs, currency, total, adding, editing, actions }: EarlyPaymentsTableProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const masked = useMoney()
  const cents = useCents()
  const newestFirst = useMemo(() => selectedEPs.slice().sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date))), [selectedEPs])
  const amount = (v: unknown) => cents(Number(v), currency)
  return (
    <section className="admin-panel admin-chart ln-payment-section" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('data.loans.ep.title')}</h2>
        {selectedEPs.length > 0 && <span className="acc-card__meta">{t('data.loans.ep.meta', { count: selectedEPs.length, total: masked(total, currency) })}</span>}
      </div>
      {selectedEPs.length === 0 && !adding ? <p className="ln-empty">{t('data.loans.ep.empty')}</p> : (
        <div className="admin-table-scroll" role="region" aria-label={t('data.loans.ep.title')} tabIndex={0}>
      <table className="re-vals ln-eps" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th>{t('data.field.date')}</th><th className="re-vals__n">{t('data.field.amount')}</th><th>{t('data.loans.ep.strategy')}</th>
              <th className="re-vals__n ln-ph">{t('data.loans.ep.newPayment')}</th><th className="re-vals__n ln-ph">{t('data.loans.ep.credited')}</th>
              <th className="re-vals__note">{t('data.loans.ep.note')}</th>
              <th><span className="sr-only">{t('data.loans.ep.actions')}</span></th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {adding}
            {newestFirst.map(ep => (editing?.rowid === ep.rowid ? <Fragment key={ep.rowid}>{editing.editor}</Fragment> : (
              <tr role="row" className="ln-payment-row" key={ep.rowid}>
                <td role="cell" className="ln-payment-date">{fmtDayNumeric(String(ep.payment_date))}</td>
                <td role="cell" className="re-vals__n num ln-payment-amount" data-label={t('data.loans.ep.paid')}>{amount(ep.amount)}</td>
                <td role="cell" className="ln-payment-strategy" data-label={t('data.loans.ep.method')}>{t(strategyKey(ep.strategy))}</td>
                <td role="cell" className={`re-vals__n num ln-payment-detail${Number(ep.new_payment) > 0 ? '' : ' ln-payment-empty'}`} data-label={t('data.loans.ep.newPayment')}>{Number(ep.new_payment) > 0 ? amount(ep.new_payment) : '—'}</td>
                <td role="cell" className={`re-vals__n num ln-payment-detail${Number(ep.principal_credit) > 0 ? '' : ' ln-payment-empty'}`} data-label={t('data.loans.ep.credited')}>{Number(ep.principal_credit) > 0 ? amount(ep.principal_credit) : '—'}</td>
                <td role="cell" className={`re-vals__note ln-eps__note${ep.notes ? '' : ' ln-payment-empty'}`} data-label={t('data.loans.ep.note')}>{ep.notes ?? ''}</td>
                <td role="cell" className="re-vals__act">
                  {actions && <RowMenu label={`${fmtDayNumeric(String(ep.payment_date))} · ${amount(ep.amount)}`} items={[
                    { label: t('data.common.edit'), onSelect: () => actions.edit(ep) },
                    { label: t('data.common.delete'), onSelect: () => actions.remove(ep.rowid), danger: true },
                  ]} />}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}
