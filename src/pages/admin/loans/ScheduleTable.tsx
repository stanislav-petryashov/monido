import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleRow } from '../../../domain/loans'
import { IconArrowBigDownLines } from '@tabler/icons-react'
import { fmtDayNumeric } from '../../../lib/formatters'
import { useMoney } from '../../../lib/privacy'
import { useCents } from './view/money'

interface ScheduleTableProps {
  schedule: ScheduleRow[]
  /** Index of the current (nearest) row; -1 — the loan is paid off */
  currentIdx: number
  /** The loan's currency */
  currency: string
}

/** How many rows before the current one and from it on the near view shows */
const BEFORE = 2
const FROM = 4

/**
 * The payment schedule: the two rows before the current one (grey), the current one (here-and-now) and the three after
 * it; a paid-off loan shows its last rows. «Full schedule» opens every row in place, scrolled to the current one. An early
 * payment is marked with an icon. On a phone each row groups the payment, its breakdown and the closing balance.
 */
export function ScheduleTable({ schedule, currentIdx, currency }: ScheduleTableProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [all, setAll] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRowRef = useRef<HTMLTableRowElement>(null)
  const masked = useMoney()
  const cents = useCents()
  const money = (v: number) => masked(v, currency)

  useEffect(() => {
    const box = scrollRef.current
    const row = currentRowRef.current
    if (all && box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2)
  }, [all, currentIdx])

  const paid = currentIdx === -1
  const from = all ? 0 : paid ? Math.max(0, schedule.length - BEFORE - FROM) : Math.max(0, currentIdx - BEFORE)
  const rows = all ? schedule : schedule.slice(from, paid ? schedule.length : currentIdx + FROM)
  const next = paid ? null : schedule[currentIdx]

  return (
    <section className="admin-panel admin-chart ln-payment-section" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('data.loans.schedule.title')}</h2>
        {schedule.length > 0 && <span className="acc-card__meta">{next
          ? t('data.loans.schedule.next', { date: fmtDayNumeric(next.date), currency })
          : t('data.loans.schedule.lastOn', { date: fmtDayNumeric(schedule[schedule.length - 1].date), currency })}</span>}
      </div>
      {schedule.length === 0 ? <p className="empty">{t('data.loans.schedule.empty')}</p> : (
        <>
          <div className={all ? 'admin-table-scroll admin-table-scroll--schedule' : 'admin-table-scroll'} ref={scrollRef} role="region" aria-labelledby={titleId} tabIndex={0}>
            <table className="re-vals ln-sched" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th className="ln-ph">№</th><th>{t('data.field.date')}</th>
                  <th className="re-vals__n ln-ph">{t('data.loans.schedule.payment')}</th>
                  <th className="re-vals__n ln-ph">{t('data.loans.schedule.principal')}</th>
                  <th className="re-vals__n">{t('data.loans.schedule.interest')}</th>
                  <th className="re-vals__n ln-ph">{t('data.loans.schedule.early')}</th>
                  <th className="re-vals__n">{t('data.loans.schedule.closing')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map(row => {
                  const idx = row.rowNum - 1
                  const isNext = idx === currentIdx
                  const isPast = !paid && idx < currentIdx
                  return (
                    <tr role="row" key={row.rowNum} ref={isNext ? currentRowRef : undefined} className={isNext ? 'is-current' : isPast ? 'is-past' : undefined} aria-current={isNext ? 'true' : undefined}>
                      <td role="cell" className="ln-ph">{row.rowNum}</td>
                      <td role="cell" className="ln-payment-date"><time dateTime={row.date}>{fmtDayNumeric(row.date)}</time>{isNext && <span className="ln-payment-next">{t('data.loans.schedule.nextLabel')}</span>}</td>
                      <td role="cell" className="re-vals__n num ln-payment-amount" data-label={t('data.loans.schedule.payment')}>{cents(row.scheduledPayment, currency)}</td>
                      <td role="cell" className="re-vals__n num ln-payment-detail ln-payment-principal" data-label={t('data.loans.schedule.principal')}>{cents(row.principalPart, currency)}</td>
                      <td role="cell" className="re-vals__n num ln-payment-detail" data-label={t('data.loans.schedule.interest')}>{cents(row.interest, currency)}</td>
                      <td role="cell" className={`re-vals__n num ln-payment-detail${row.earlyPayment > 0 ? '' : ' ln-payment-empty'}`} data-label={t('data.loans.schedule.early')}>
                        {row.earlyPayment > 0
                          ? <span className="early-mark"><IconArrowBigDownLines size={14} stroke={2} aria-hidden="true" />{cents(row.earlyPayment, currency)}</span>
                          : '—'}
                      </td>
                      <td role="cell" className="re-vals__n num ln-payment-detail ln-payment-balance" data-label={t('data.loans.schedule.balanceAfter')}>{money(row.closingBalance)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="ln-foot">
            <span>{all ? t('data.loans.schedule.allRows', { count: schedule.length }) : paid ? t('data.loans.schedule.recent') : t('data.loans.schedule.near', { count: schedule.length })}</span>
            {schedule.length > rows.length || all ? (
              <button type="button" className="btn btn--ghost" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? t('data.loans.schedule.less') : t('data.loans.schedule.all')}</button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
