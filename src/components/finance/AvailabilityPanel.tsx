import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountValue, FinanceSnapshot } from '../../domain/types'
import { availabilityParts, confirmationProgress, reserveSpendingBaseline } from '../../domain/availability'
import { zoneThresholds } from '../../domain/health'
import { Link } from '../ui/Link'
import { Card } from '../ui/Card'
import { Disclosure } from '../ui/Disclosure'
import { useAvailability } from '../../lib/useAvailability'
import { useCan } from '../../lib/rights'
import { useMoney, usePrivacy } from '../../lib/privacy'
import { useDiscardGuard } from '../../lib/useUnsavedChanges'
import { fmtCurrency, fmtMonth } from '../../lib/formatters'
import { AvailabilityHero } from './availability/AvailabilityHero'
import { AccountRow } from './availability/AccountRow'
import { AssessmentEditor } from './availability/AssessmentEditor'
import '../../styles/availability.css'

const keyOf = (a: { name: string; member: string }) => `${a.name}\u0000${a.member}`

/** Available money: the free amount and where the money sits, then the month's accounts with the confirmation in place, then the stored confirmations. */
export function AvailabilityPanel({ snapshot }: { snapshot: FinanceSnapshot }) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const canEdit = useCan('edit')
  const money = useMoney()
  const { query, aggregate, save, remove } = useAvailability(snapshot)
  const [open, setOpen] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // the stored answer the open editor started from while the person types: a refetch then leaves their input alone
  const [typedOver, setTypedOver] = useState<string | null>(null)
  const { discard } = useDiscardGuard(dirty && open !== null, () => save.isPending)
  const month = snapshot.asOf.capitalDate?.slice(0, 7)
  if (!month) return <Card><p>{t('availability.missingBalances')}</p></Card>
  if (query.isPending) return <Card><p>{t('availability.loading')}</p></Card>
  if (query.isError) return <Card><p role="alert">{t('availability.loadError')}</p></Card>

  const parts = availabilityParts(aggregate)
  const progress = confirmationProgress(aggregate)
  const editable = canEdit && !hidden
  const links = {
    reserve: <Link to="/health#emergency_months" className="link-accent">{t('availability.healthLink')}</Link>,
    goals: <Link to="/goals" className="link-accent">{t('availability.goalsLink')}</Link>,
  }
  const blockedNote = progress.waiting.length > 0 ? null : aggregate.incomplete ? t('availability.missingBalances') : progress.confirmed > 0 && aggregate.accounts.some(r => r.status === 'missingFx') ? t('availability.missingRate') : null
  const show = (key: string | null) => discard(() => { setOpen(key); setDirty(false); setTypedOver(null); save.reset() })
  const saved = (account: AccountValue) => {
    // the next unconfirmed account opens: after this one in the list, else from the top
    const at = progress.waiting.findIndex(a => keyOf(a) === keyOf(account))
    const rest = progress.waiting.filter(a => keyOf(a) !== keyOf(account))
    const next = (at >= 0 ? rest[at] : undefined) ?? rest[0]
    setDirty(false)
    setTypedOver(null)
    setOpen(next ? keyOf(next) : null)
  }

  return <>
    <AvailabilityHero month={month} baseCurrency={snapshot.baseCurrency} parts={parts} progress={progress} perMonth={reserveSpendingBaseline(snapshot)?.perMonth ?? null}
      goalMonths={zoneThresholds('emergency_months')[2]} blockedNote={blockedNote} links={links} money={money}
      editing={open !== null} onConfirm={editable && progress.waiting.length > 0 ? () => show(keyOf(progress.waiting[0])) : undefined} />
    <section className="card card--p avail-accounts" aria-labelledby="avail-accounts-title">
      <div className="avail-accounts__head">
        <h2 id="avail-accounts-title" className="card-hd">{t('availability.accountsTitle', { month: fmtMonth(month) })}</h2>
        <span className="avail-accounts__meta">{t('availability.accountsMeta', { confirmed: progress.confirmed, total: progress.total })}</span>
      </div>
      <ul className="avail-rows">
        {aggregate.accounts.map(({ account, assessment, status }) => {
          const key = keyOf(account)
          const isOpen = editable && open === key
          // an untouched editor starts again from what the server holds now (another device saved meanwhile)
          const stored = assessment ? [assessment.month, assessment.currency, assessment.balance, assessment.available, assessment.reserve, assessment.goals, assessment.commitments].join('|') : ''
          return <AccountRow key={key} account={account} assessment={assessment} status={status} month={month} members={snapshot.members} money={money} open={isOpen}
            onAction={editable && account.value >= 0 ? () => show(isOpen ? null : key) : undefined}>
            {isOpen && <AssessmentEditor key={typedOver ?? stored} account={account} prior={assessment} month={month} balanceDate={snapshot.asOf.capitalDate!} pending={save.isPending} error={save.error} money={money}
              onDirty={d => { setDirty(d); setTypedOver(was => d ? was ?? stored : null) }} onCancel={() => show(null)} onSave={value => save.mutate(value, { onSuccess: () => saved(account) })} />}
          </AccountRow>
        })}
      </ul>
      {!hidden && !!query.data.assessments.length && <Disclosure variant="inline" className="avail-history" title={t('availability.history')}>
        <p>{t('availability.historyNote')}</p>
        <ul>{query.data.assessments.map(item => <li key={`${item.month}\u0000${keyOf(item)}`}>
          <span>{t('availability.historicalItem', { name: item.name, member: item.member, month: fmtMonth(item.month), amount: fmtCurrency(item.balance, item.currency) })}</span>
          {canEdit && <button type="button" className="btn btn--quiet" disabled={remove.isPending || save.isPending} onClick={() => remove.mutate(item)} aria-label={t('availability.clearHistorical', { name: item.name, member: item.member, month: fmtMonth(item.month) })}>{t('availability.clear')}</button>}
        </li>)}</ul>
      </Disclosure>}
      {remove.error && <p role="alert" className="avail-error">{remove.error.message}</p>}
    </section>
  </>
}
