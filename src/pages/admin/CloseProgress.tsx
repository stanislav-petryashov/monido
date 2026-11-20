import { Trans, useTranslation } from 'react-i18next'
import { accountKey, type AccountKey } from '../../domain/accounts'
import type { DraftRow } from '../../domain/monthClose'
import { fmtMonth, fmtNum } from '../../lib/formatters'
import { Disclosure } from '../../components/ui/Disclosure'
import { rowLabel } from './closeRows'

interface CloseProgressProps {
  rows: DraftRow[]
  filledOf: (row: DraftRow) => boolean
  month: string
  /** The family tracks income and expenses: the wizard asks for them too */
  flows: boolean
  /** There are loan lines: the entry help says a loan payment is an expense of its own */
  loans: boolean
  /** A segment's click goes to its account's fields; without it (a viewer, who has no fields) the segments are marks */
  onJump?: (key: AccountKey) => void
}

/**
 * The top of Close month: how many accounts are filled, one segment per account (a click goes to its fields, for who can edit), the
 * names still missing, and what to enter.
 */
export function CloseProgress({ rows, filledOf, month, flows, loans, onJump }: CloseProgressProps) {
  const { t } = useTranslation()
  const done = rows.filter(filledOf).length
  const missingRows = rows.filter(r => !filledOf(r))
  const missing = missingRows.map(r => rowLabel(r, rows))
  return (
    <section className="card card--p close-progress" aria-label={t('data.close.progress', { month: fmtMonth(month) })}>
      {rows.length > 0 && (
        <div className="close-progress__fig">
          <span className="close-progress__value">{t('data.close.filledFigure', { filled: fmtNum(done, 0), count: fmtNum(rows.length, 0) })}</span>
          <span className="figure-label">{t('data.close.filledLabel', { count: rows.length })}</span>
        </div>
      )}
      <div className="close-progress__body">
        {rows.length > 0 && (
          rows.length > 12 ? <progress className="close-progress__bar" max={rows.length} value={done} aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={done} aria-label={t('data.close.filledLabel', { count: rows.length })} /> : <div className="close-segs">
            {rows.map(r => {
              const key = accountKey(r.name, r.member)
              const on = filledOf(r)
              const label = t(on ? 'data.close.segFilled' : 'data.close.segMissing', { account: rowLabel(r, rows) })
              return onJump
                ? <button key={key} type="button" className={on ? 'close-seg close-seg--on' : 'close-seg'} aria-label={label} onClick={() => onJump(key)} />
                : <i key={key} className={on ? 'close-seg close-seg--on' : 'close-seg'} role="img" aria-label={label} />
            })}
          </div>
        )}
        {missing.length > 0 && (
          <p className="close-progress__missing">
            <Trans i18nKey="data.close.missingList" values={{ names: missing.slice(0, 3).join(', ') }} components={{ names: <span className="close-progress__names" /> }} />
          </p>
        )}
        {missing.length > 3 || (rows.length > 12 && missing.length > 0) ? <>
          {missing.length > 3 && <span>{t('data.close.missingMore', { count: missing.length - 3 })}</span>}
          <Disclosure variant="inline" title={t('data.close.showMissing')}>
            <ul>{missingRows.map(r => {
              const key = accountKey(r.name, r.member)
              return <li key={key}>{onJump ? <button type="button" className="link-quiet" onClick={() => onJump(key)}>{rowLabel(r, rows)}</button> : rowLabel(r, rows)}</li>
            })}</ul>
          </Disclosure>
        </> : null}
        <p className="close-progress__intro">{t(flows ? 'data.close.introFlows' : 'data.close.introBalance')}</p>
        <Disclosure variant="inline" className="close-entry-help" title={t(flows ? 'data.close.entryHelp' : 'data.close.entryHelpBalance')}>
          <p>{t(flows ? 'data.close.hintFlows' : 'data.close.hintBalance')}</p>
          {flows && loans && <p>{t('monthClose.loans.expenseHint')}</p>}
        </Disclosure>
      </div>
    </section>
  )
}
