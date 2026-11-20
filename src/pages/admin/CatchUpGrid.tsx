import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CatchUpState } from '../../domain/api'
import { accountKey } from '../../domain/accounts'
import { catchUpProblems, cellHint, type CatchUpRow } from '../../domain/catchUp'
import { shiftMonth } from '../../domain/dates'
import { balanceCheck } from '../../domain/monthClose'
import { fmtInMonth, fmtMonth, fmtNum } from '../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { parseAmount } from './amount'
import { EntryTable } from './ui/EntryTable'
import { NumberInput } from './ui/NumberInput'
import type { CatchUpCells } from './useCatchUp'

interface CatchUpGridProps {
  state: CatchUpState
  closing: boolean
  onClose: (rows: CatchUpCells[]) => void
  onBack: () => void
}

/** The months' span in words: "June 2031" or "June 2031 – August 2031" */
const span = (months: readonly string[]) => (months.length === 1 ? fmtMonth(months[0]) : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`)

/**
 * After a pause: every missed month but the newest on one grid of month-end balances (accounts × months). Nothing is filled
 * in by itself: the last known balance is a grey hint under an empty cell. Closing writes them all; the newest month then
 * goes through the wizard.
 */
export function CatchUpGrid({ state, closing, onClose, onBack }: CatchUpGridProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const titleId = useId()
  // what each cell holds as typed (canonical text), so an unfinished number stays as it was typed
  const [texts, setTexts] = useState<string[][]>(() => state.rows.map(r => r.cells.map(c => (c === null ? '' : String(c)))))
  const rows: CatchUpRow[] = state.rows.map((r, ri) => ({ ...r, cells: texts[ri].map(text => parseAmount(text).value) }))
  const unreadable = texts.some(row => row.some(text => parseAmount(text).invalid))
  const problems = catchUpProblems(state.months, rows)
  const months = span(state.months)
  const type = (ri: number, ci: number, text: string) => setTexts(all => all.map((row, r) => (r === ri ? row.map((cell, c) => (c === ci ? text : cell)) : row)))

  return (
    <section className="admin-panel catch-up" aria-labelledby={titleId}>
      <h2 id={titleId} className="admin-panel__name">{t('data.close.catchUp.title', { months })}</h2>
      <p className="note note--help">{t('data.close.catchUp.lead')}</p>
      <p className="note note--help">{t('data.close.catchUp.loansFirst')}</p>
      {state.leftOut && <p className="note note--help">{t('data.close.catchUp.leftOut', { month: fmtMonth(state.leftOut) })}</p>}
      <EntryTable label={t('data.close.catchUp.title', { months })} className="catch-up__grid">
          <thead>
            <tr>
              <th scope="col">{t('data.close.catchUp.account')}</th>
              {state.months.map(m => <th key={m} scope="col" className="td-num">{fmtMonth(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const key = accountKey(row.name, row.member)
              return (
                <tr key={key}>
                  <th scope="row" className="td-name catch-up__account">
                    {row.name}
                    <span className="note">{`${row.member} · ${row.currency}`}</span>
                  </th>
                  {state.months.map((month, ci) => {
                    const value = row.cells[ci]
                    const hint = cellHint(row, ci, state.lastKnown[key])
                    // the month the hint is from: the nearest typed cell to the left, else the month before the grid
                    const typedBefore = row.cells.slice(0, ci).map((c, i) => (c === null ? -1 : i)).filter(i => i >= 0).pop()
                    const hintMonth = typedBefore === undefined ? shiftMonth(state.months[0], -1) : state.months[typedBefore]
                    const check = value !== null && hint !== undefined ? balanceCheck(value, hint) : null
                    const warning = check?.warning === 'magnitude'
                      ? t(Math.abs(value!) > Math.abs(hint!) ? 'data.close.checkMagnitude' : 'data.close.checkMagnitudeLess', { count: check.times, times: fmtNum(check.times, 0), month: fmtInMonth(hintMonth) })
                      : check?.warning === 'sign' ? t('data.close.checkSign', { month: fmtInMonth(hintMonth) }) : null
                    return (
                      <td key={month} className="td-num">
                        <NumberInput label={t('data.close.catchUp.cell', { account: row.name, month: fmtMonth(month) })} value={texts[ri][ci]} decimals={2} signed guessThousands
                          onChange={text => type(ri, ci, text)}
                          hint={value === null && hint !== undefined ? t('data.close.catchUp.hint', { month: fmtMonth(hintMonth), amount: hidden ? PRIVACY_MASK : fmtNum(hint, 2) }) : undefined} />
                        {warning && <p className="field__check">{warning}</p>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
      </EntryTable>
      {problems.length > 0 && (
        <ul className="note note--help catch-up__missing">
          {problems.map(p => <li key={p.month}>{t('data.close.catchUp.missing', { month: fmtMonth(p.month), count: p.missing })}</li>)}
        </ul>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn--quiet" onClick={onBack}>{t('data.close.catchUp.back')}</button>
        <span className="note">{t('data.close.catchUp.then', { month: fmtMonth(state.newest) })}</span>
        <button type="button" className="btn btn--primary" disabled={problems.length > 0 || unreadable || closing}
          onClick={() => onClose(rows.map(r => ({ name: r.name, member: r.member, cells: r.cells })))}>
          {t('data.close.catchUp.close', { months })}
        </button>
      </div>
    </section>
  )
}
