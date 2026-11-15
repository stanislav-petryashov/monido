import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { LoanRow } from '../../../../domain/loans'
import { fmtDayNumeric, fmtNum } from '../../../../lib/formatters'
import { recordHref } from '../../../../lib/recordLink'
import { OwnerAvatar } from '../../../../components/ui/OwnerAvatar'
import { RowMenu, type MenuItem } from '../../ui/RowMenu'
import { LOAN_TYPE_OPTIONS } from '../loanForm'

/** Loan type → locale key of its caption */
const LOAN_TYPE_LABEL: Record<string, string> = Object.fromEntries(LOAN_TYPE_OPTIONS)

interface LoanHeadProps {
  loan: LoanRow
  members: string[]
  /** Whether the collateral is a property the records hold: only then a link */
  collateral: boolean
  /** «Early payment»: the screen's one primary, white while an editor is open; null — none (a viewer, a repaid or closed loan) */
  early: { quiet: boolean; onClick: () => void } | null
  /** The «···» menu; empty — none (a viewer) */
  menu: MenuItem[]
  /** The lines under the head: the payoff with «Close loan», the reopening, the closing-day correction */
  children?: ReactNode
}

/**
 * The loan's head: the name, the tags — owner, type, currency, rate, issue day, payment day, the collateral as a link to
 * Real estate, «Closed <date>» for a closed loan — the one primary and the «···» menu.
 */
export function LoanHead({ loan, members, collateral, early, menu, children }: LoanHeadProps) {
  const { t } = useTranslation()
  const type = LOAN_TYPE_LABEL[String(loan.type ?? '')]
  const day = Number(loan.payment_day)
  return (
    <>
      <div className="acc-head re-head ln-head">
        <div className="acc-head__text">
          <h2 className="acc-head__name">{loan.name}</h2>
          <ul className="acc-head__tags" aria-label={t('data.loans.head.tags')}>
            <li className="acc-tag"><OwnerAvatar member={loan.member} members={members} />{loan.member}</li>
            <li className="acc-tag">{type ? t(type) : String(loan.type ?? '—')}</li>
            <li className="acc-tag">{loan.currency}</li>
            <li className="acc-tag">{t('data.loans.head.rate', { rate: `${fmtNum(Number(loan.rate), 2)}%` })}</li>
            {loan.issue_date && <li className="acc-tag">{t('data.loans.head.issued', { date: fmtDayNumeric(String(loan.issue_date)) })}</li>}
            {day >= 1 && day <= 31 && <li className="acc-tag">{t('data.loans.head.payDay', { day })}</li>}
            {loan.secured_by && (
              <li className="acc-tag">
                {collateral
                  ? <Trans i18nKey="data.loans.head.collateral" components={{ link: <a className="re-link" href={recordHref('/real-estate', loan.secured_by)}>{loan.secured_by}</a> }} />
                  : t('data.loans.head.collateralText', { name: loan.secured_by })}
              </li>
            )}
            {loan.status === 'closed' && <li className="acc-tag">{loan.closed_date ? t('data.loans.closedOn', { date: fmtDayNumeric(loan.closed_date) }) : t('data.loans.statusClosed')}</li>}
          </ul>
        </div>
        {(early || menu.length > 0) && (
          <div className="acc-head__actions re-head__actions">
            {early && <button type="button" className={early.quiet ? 'btn btn--ghost' : 'btn btn--primary'} onClick={early.onClick}>{t('data.loans.ep.addTitle')}</button>}
            {menu.length > 0 && <RowMenu label={loan.name} ariaLabel={t('data.loans.head.menu')} items={menu} />}
          </div>
        )}
      </div>
      {children}
    </>
  )
}
