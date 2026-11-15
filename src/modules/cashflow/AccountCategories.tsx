import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { shiftMonth } from '../../domain/dates'
import { round2 } from '../../domain/fx'
import { directionOf, type CategoryDirection } from '../../domain/types'
import { fmtPct } from '../../lib/formatters'
import { useMoney } from '../../lib/privacy'
import type { AccountDetailProps } from '../client'
import { spendingQuery, useCategoryTitle } from './spendingWrites'

const P = 'modules.cashflow.accountCategories'
const SIDES: CategoryDirection[] = ['income', 'expense']

interface Side { total: number; byCategory: Map<number, number> }

/**
 * «Where the money comes from and goes» in an account's detail (the module's `accountDetail`): the account's lines by
 * category over the 12 months up to the last closed one, income and expenses apart, each with its share of the side's
 * total; what the lines leave of the months' totals is «Uncategorised». Nothing without a line in those months.
 */
export function AccountCategories({ account, lastMonth }: AccountDetailProps) {
  const { t } = useTranslation()
  const masked = useMoney()
  const title = useCategoryTitle()
  const titleId = useId()
  const data = useQuery(spendingQuery).data
  if (!data) return null
  const from = shiftMonth(lastMonth, -11)
  const months = data.accounts.filter(a => a.totals && a.bank === account.name && a.member === account.member && a.month >= from && a.month <= lastMonth)
  if (!months.some(m => m.items.length > 0)) return null

  const sides: Record<CategoryDirection, Side> = { income: { total: 0, byCategory: new Map() }, expense: { total: 0, byCategory: new Map() } }
  for (const m of months) {
    sides.income.total += (m.totals?.active ?? 0) + (m.totals?.passive ?? 0)
    sides.expense.total += m.totals?.expense ?? 0
    for (const item of m.items) {
      const category = data.categories.find(c => c.id === item.categoryId)
      if (!category) continue
      const side = sides[directionOf(category.flow)].byCategory
      side.set(category.id, (side.get(category.id) ?? 0) + item.amount)
    }
  }
  const money = (v: number) => masked(v, account.currency)

  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t(`${P}.title`)}</h2>
        <span className="acc-card__meta">{t(`${P}.meta`)}</span>
      </div>
      <div className="acc-where">
        {SIDES.map(key => {
          const side = sides[key]
          const items = [...side.byCategory].map(([id, sum]) => ({ id, sum: round2(sum) })).sort((a, b) => b.sum - a.sum)
          const known = items.reduce((s, i) => s + i.sum, 0)
          const total = round2(side.total)
          if (total <= 0 && known <= 0) return null
          const rest = round2(Math.max(0, total - known))
          const base = Math.max(total, known)
          const rows = [
            ...items.map(i => ({ key: i.id, name: title(data.categories.find(c => c.id === i.id)!), sum: i.sum, rest: false })),
            // the rest's key: no category has id -1
            ...(rest > 0 ? [{ key: -1, name: t(`${P}.uncategorised`), sum: rest, rest: true }] : []),
          ]
          const max = Math.max(...rows.map(r => r.sum))
          return (
            <div key={key}>
              <h3 className="acc-where__hd">{t(`${P}.${key}`)}<span>{money(total)}</span></h3>
              <ul className="acc-where__list">
                {rows.map(r => (
                  <li key={r.key} className={r.rest ? 'acc-where__row acc-where__row--rest' : 'acc-where__row'}>
                    <span>{r.name}</span>
                    <span className="acc-where__v">{t(`${P}.value`, { amount: money(r.sum), share: fmtPct(r.sum / base * 100, { digits: 0 }) })}</span>
                    <span className="acc-where__bar" aria-hidden="true">
                      <i className={r.rest ? 'acc-where__fill--rest' : `acc-where__fill--${key}`} style={{ width: `${max > 0 ? r.sum / max * 100 : 0}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
