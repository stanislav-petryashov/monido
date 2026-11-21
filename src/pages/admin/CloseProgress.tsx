import { useTranslation } from 'react-i18next'
import { accountKey, type AccountKey } from '../../domain/accounts'
import { monthEnd } from '../../domain/dates'
import type { DraftRow } from '../../domain/monthClose'
import { fmtDayYear } from '../../lib/formatters'
import { Disclosure } from '../../components/ui/Disclosure'
import { rowLabel } from './closeRows'

interface CloseProgressProps {
  rows: DraftRow[]
  filledOf: (row: DraftRow) => boolean
  month: string
  flows: boolean
  loans: boolean
  onJump?: (key: AccountKey) => void
}

export function CloseProgress({ rows, filledOf, month, flows, loans, onJump }: CloseProgressProps) {
  const { t } = useTranslation()
  const missing = rows.length > 12 ? rows.filter(r => !filledOf(r)) : []
  return (
    <header className="close-intro">
      <h2 className="close-intro__title">{t('data.close.periodTitle', { month: t(`dates.monthOf.${Number(month.slice(5, 7))}`) })}</h2>
      <p className="close-intro__description">
        {t(flows ? 'data.close.periodIntro' : 'data.close.periodIntroBalance', { date: fmtDayYear(monthEnd(month)) })}
      </p>
      <div className="close-intro__tools">
        <Disclosure variant="inline" className="close-entry-help" title={t(flows ? 'data.close.entryHelp' : 'data.close.entryHelpBalance')}>
          <p>{t(flows ? 'data.close.hintFlows' : 'data.close.hintBalance')}</p>
          <p>{t(flows ? 'data.close.unchangedHelp' : 'data.close.unchangedHelpBalance')}</p>
          {flows && loans && <p>{t('monthClose.loans.expenseHint')}</p>}
        </Disclosure>
        {missing.length > 0 && <Disclosure variant="inline" title={t('data.close.showMissing')}>
          <ul>{missing.map(r => {
            const key = accountKey(r.name, r.member)
            return <li key={key}>{onJump ? <button type="button" className="link-quiet" onClick={() => onJump(key)}>{rowLabel(r, rows)}</button> : rowLabel(r, rows)}</li>
          })}</ul>
        </Disclosure>}
      </div>
    </header>
  )
}
