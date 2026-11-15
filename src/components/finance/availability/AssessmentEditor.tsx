import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountValue } from '../../../domain/types'
import { accountParts, validAssessment, type AvailabilityAssessment } from '../../../domain/availability'
import { fmtDayYear, fmtInMonth, fmtMonth, fmtNum } from '../../../lib/formatters'
import { amountText, parseAmount } from '../../../pages/admin/amount'
import { NumberInput } from '../../../pages/admin/ui/NumberInput'
import { SegmentedPills } from '../../ui/SegmentedPills'
// the fields' own look (.admin-input, its hint and error lines) lives with the Records screens' forms
import '../../../styles/admin.css'

const FIELDS = ['reserve', 'goals', 'commitments'] as const
type Amounts = Record<typeof FIELDS[number], string>

interface AssessmentEditorProps {
  account: AccountValue
  /** The account's latest assessment (this month's or an earlier one): prefilled while the balance is the same, else a placeholder */
  prior?: AvailabilityAssessment
  month: string
  /** The balances' day ('YYYY-MM-DD') */
  balanceDate: string
  pending: boolean
  error: Error | null
  money: (value: number, currency?: string) => string
  onSave: (assessment: AvailabilityAssessment) => void
  onCancel: () => void
  /** Whether the input differs from what the editor opened with */
  onDirty: (dirty: boolean) => void
}

/**
 * One account's monthly confirmation in its row, in the account's currency: available at once or not, then the three
 * earmarks and the free rest, live. An empty field is zero; the same balance as last time prefills last time's values,
 * a changed one only shows them as placeholders. Takes the focus when it opens.
 */
export function AssessmentEditor({ account, prior, month, balanceDate, pending, error, money, onSave, onCancel, onDirty }: AssessmentEditorProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLFormElement>(null)
  const prefill = prior && prior.currency === account.currency && prior.balance === account.value ? prior : undefined
  const textOf = (a: AvailabilityAssessment | undefined) => Object.fromEntries(FIELDS.map(f => [f, a?.[f] ? amountText(a[f]) : ''])) as Amounts
  // a new account starts as not available: a bare confirm then counts nothing as free
  const [initial] = useState(() => ({ available: prior?.available ?? false, amounts: textOf(prefill) }))
  const [available, setAvailable] = useState(initial.available)
  const [amounts, setAmounts] = useState(initial.amounts)
  const dirty = available !== initial.available || FIELDS.some(f => amounts[f] !== initial.amounts[f])
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
  }, [])

  const parsed = Object.fromEntries(FIELDS.map(f => [f, parseAmount(amounts[f])])) as Record<typeof FIELDS[number], ReturnType<typeof parseAmount>>
  // a changed balance shows last time's amounts as placeholders only: an empty field over a non-zero one is not a silent 0
  const missing = Object.fromEntries(FIELDS.map(f => [f, available && !prefill && !!prior?.[f] && amounts[f].trim() === ''])) as Record<typeof FIELDS[number], boolean>
  const unread = available && FIELDS.some(f => parsed[f].invalid || missing[f])
  const assessment: AvailabilityAssessment = { month, name: account.name, member: account.member, currency: account.currency, balance: account.value, available,
    ...Object.fromEntries(FIELDS.map(f => [f, available ? parsed[f].value ?? 0 : 0])) as Record<typeof FIELDS[number], number> }
  const valid = !unread && validAssessment(assessment)
  const free = accountParts(account, assessment)?.free ?? 0
  const before = prior && prior.month !== month
    ? prior.balance === account.value && prior.currency === account.currency ? t('availability.sameAs', { month: fmtInMonth(prior.month) }) : t('availability.wasIn', { month: fmtInMonth(prior.month), amount: money(prior.balance, prior.currency) })
    : null
  const monthName = t(`dates.month.${Number(month.slice(5, 7))}`)

  return <form ref={ref} className="avail-ed" aria-label={t('availability.confirmName', { name: account.name })} onSubmit={event => { event.preventDefault(); if (valid && !pending) onSave(assessment) }}>
    <SegmentedPills items={['available', 'unavailable'] as const} active={available ? 'available' : 'unavailable'} ariaLabel={t('availability.switchLabel')}
      label={item => t(item === 'available' ? 'availability.availableNow' : 'availability.notAvailable')} onSelect={item => setAvailable(item === 'available')} />
    {prior && !prefill && <button type="button" className="btn btn--quiet avail-ed__reuse" onClick={() => { setAvailable(prior.available); setAmounts(textOf(prior)) }}>
      {t('availability.useValues', { month: fmtMonth(prior.month) })}
    </button>}
    {available && <div className="avail-ed__fields">
      {FIELDS.map(f => <label key={f} className="avail-ed__field"><span>{t(`availability.${f}`)}</span>
        <NumberInput label={`${t(`availability.${f}`)} (${account.currency})`} value={amounts[f]} onChange={text => setAmounts(a => ({ ...a, [f]: text }))} decimals={2} guessThousands
          invalid={parsed[f].invalid || missing[f]} errorLine={!missing[f]} hint={missing[f] ? t('availability.enterAmount') : undefined} placeholder={prior && !prefill ? fmtNum(prior[f], 2) : '0'} />
      </label>)}
      <div className={`avail-ed__left${free < 0 ? ' is-bad' : ''}`} aria-live="polite">
        {t('availability.freeOnAccount')}<b className="num">{money(free, account.currency)}</b>{free < 0 ? t('availability.overAllocated') : t('availability.ofBalance', { amount: money(account.value, account.currency) })}
      </div>
    </div>}
    {error && <p role="alert" className="avail-ed__error">{error.message}</p>}
    <div className="avail-ed__acts">
      <span className="avail-ed__note">{[t('availability.balanceOn', { date: fmtDayYear(balanceDate), amount: money(account.value, account.currency) }), before].filter(Boolean).join(' · ')}</span>
      <button type="button" className="btn btn--quiet" onClick={onCancel}>{t('common.cancel')}</button>
      <button type="submit" className="btn btn--primary" disabled={!valid || pending}>{t('availability.confirmMonth', { month: monthName })}</button>
    </div>
  </form>
}

