import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { monthEnd } from '../../domain/dates'
import { fmtDay } from '../../lib/formatters'
import { EntryTable } from './ui/EntryTable'

interface CloseOwnerGroupProps {
  member: string
  members: string[]
  month: string
  flows: boolean
  children: ReactNode
}

export function CloseOwnerGroup({ member, members, month, flows, children }: CloseOwnerGroupProps) {
  const { t } = useTranslation()
  const headingId = useId()
  const name = member || t('pages.netWorth.noMember')
  return (
    <section className="card card--p close-owner" aria-labelledby={headingId}>
      <div className="close-owner__head">
        <OwnerAvatar member={member} members={members} name={name} />
        <h2 id={headingId} className="close-owner__name">{name}</h2>
        <span aria-hidden="true" className="close-owner__column">{t('data.close.balanceAt', { date: fmtDay(monthEnd(month)) })}</span>
        {flows && <span aria-hidden="true" className="close-owner__column">{t('data.close.operations')}</span>}
      </div>
      <EntryTable label={name} className="close-table close-table--owners">
        <thead><tr>
          <th>{t('data.close.account')}</th>
          <th>{t('data.field.balance')}</th>
          {flows && <th>{t('data.close.operations')}</th>}
          <th className="td-actions"><span className="sr-only">{t('data.common.actions')}</span></th>
        </tr></thead>
        <tbody>{children}</tbody>
      </EntryTable>
    </section>
  )
}
