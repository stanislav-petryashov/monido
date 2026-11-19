import { useTranslation } from 'react-i18next'
import type { MonthRecap, RecapRowKey } from '../../domain/monthRecap'
import { fmtMonths, fmtNum } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import '../../styles/finance.css'

/** The closed month in figures: this month, against the month before and a year ago; a dash for what is not known */
export function MonthRecapTable({ recap, fmt, fmtIn }: {
  recap: MonthRecap; fmt: (v: number) => string; fmtIn: (amount: number, currency: string) => string
}) {
  const { t } = useTranslation()
  const cell = (key: RecapRowKey, v: number | null, diff: boolean) => {
    if (v === null) return '—'
    // a fund change under a tenth of a month keeps two decimals: a non-zero figure is never drawn as 0
    const months = (x: number) => (x !== 0 && Math.abs(x) < 0.05 ? t('units.months', { count: x, value: fmtNum(x, 2) }) : fmtMonths(x))
    const draw = key === 'fund' ? months : fmt
    return diff ? signed(v, draw) : draw(v)
  }
  const note = recap.note?.key === 'firstAbove'
    ? t('data.close.recap.firstAbove', { amount: fmtIn(recap.note.amount, recap.note.currency) })
    : recap.note?.key === 'highest' ? t('data.close.recap.highest') : null
  // a phone scrolls the table sideways: the region is reachable by keyboard and named by the caption
  return <div className="recap" role="region" aria-labelledby={`recap-${recap.month}`} tabIndex={0}>
    <table className="recap__table">
      <caption id={`recap-${recap.month}`} className="recap__caption">{t('data.close.recap.title')}</caption>
      <thead><tr>
        <th scope="col"><span className="sr-only">{t('data.close.recap.figure')}</span></th>
        <th scope="col" className="num">{t('data.close.recap.now')}</th>
        <th scope="col" className="num">{t('data.close.recap.vsPrev')}</th>
        <th scope="col" className="num">{t('data.close.recap.vsYear')}</th>
      </tr></thead>
      <tbody>{recap.rows.map(r => <tr key={r.key}>
        <th scope="row">{t(`data.close.recap.rows.${r.key}`)}</th>
        <td className="num">{cell(r.key, r.now, false)}</td>
        <td className="num">{cell(r.key, r.vsPrev, true)}</td>
        <td className="num">{cell(r.key, r.vsYear, true)}</td>
      </tr>)}</tbody>
    </table>
    {note && <p className="recap__note">{note}</p>}
  </div>
}
