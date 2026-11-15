import { AdminReadNotice } from './ui/AdminReadNotice'
import './journal-mobile.css'
import { IconArrowLeft } from '@tabler/icons-react'
import { useRecordPane } from './useRecordPane'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { balanceToday, currentPaymentIndex, earlyPaymentsEffect, isScheduleDone, earlyPaymentConflict, MAX_TERM_MONTHS, owedOn, payoffDate, repaidShare, summariseSchedule, type LoanRow, type LoanEarlyPayment } from '../../domain/loans'
import { useReferenceLists } from './shared'
import { useRecordSelection } from './useRecordSelection'
import { apiSend } from '../../lib/api'
import type { LoanUpdateRequest } from '../../domain/api'
import { isDay, isoDate, monthOf } from '../../domain/dates'
import { fmtDayNumeric, fmtNum } from '../../lib/formatters'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../lib/privacy'
import { useConfirm, useToast } from '../../lib/notifyState'
import { PHONE, useMedia } from '../../lib/media'
import { useSnapshot } from '../../lib/useFinanceData'
import { useFamilyCurrency } from '../../lib/familySettings'
import { tableQuery, useSnapshotWrite } from './adminQuery'
import { useAdminRows } from './useAdminRows'
import { useSingleFlight } from './useSingleFlight'
import { changed, useDiscardGuard } from '../../lib/useUnsavedChanges'
import { amountText, readable } from './amount'
import { epAmount, epAmountInvalid, epPayload, LOAN_FIELDS, loanAmountInvalid, normaliseLoanData, termTooLong, withoutUnchangedTerm, type Fields } from './loans/loanForm'
import { familyTotals, loanItems, withRowid, type LoanItem, type StoredPayment } from './loans/figures'
import { EarlyPaymentsTable } from './loans/EarlyPaymentsTable'
import { ScheduleTable } from './loans/ScheduleTable'
import { BalanceChart } from './loans/view/BalanceChart'
import { EarlyPaymentEditor } from './loans/view/EarlyPaymentEditor'
import { LoanForm } from './loans/view/LoanForm'
import { LoanHead } from './loans/view/LoanHead'
import { LoanKpis } from './loans/view/LoanKpis'
import { LoanList, type ListLoan } from './loans/view/LoanList'
import { NewLoanDialog } from './loans/view/NewLoanDialog'
import { useQuery } from '@tanstack/react-query'
import { PageAction } from './ui/PageAction'
import type { MenuItem } from './ui/RowMenu'
import { useCan } from '../../lib/rights'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'

const LOANS = tableQuery<LoanRow>('loans')
const PAYMENTS = tableQuery<StoredPayment>('loan_early_payments')
/** Every write of the screen refetches both tables */
const WRITES = [LOANS.queryKey, PAYMENTS.queryKey]
/**
 * The Loans screen: the list of loans with the family total owed today, the payments a month and when they end, beside
 * the chosen loan — its head with «Early payment» and the «···» menu, the KPI strip, progress and the early payments'
 * effect; the balance chart; the early payments with their editor in place; the schedule near today. On a phone
 * (useRecordPane) the list and the loan are two screens. The figures are the domain's (loans.ts) over the rows.
 */
export function LoansView() {
  const { t } = useTranslation()
  const canEdit = useCan('edit')
  const pane = useRecordPane()
  const phone = useMedia(PHONE)
  const toast = useToast()
  const confirm = useConfirm()
  const { hidden } = usePrivacy()
  const masked = useMoney()
  const write = useSnapshotWrite(WRITES)
  const snapshot = useSnapshot().data
  /** The edit form's save: a second submit while one is being written is ignored */
  const [runSave, saving, savePending] = useSingleFlight()
  const [runNew, creating, newPending] = useSingleFlight()
  const [runEP, savingEP, epPending] = useSingleFlight()
  const { data: propertyData } = useQuery(tableQuery('real_estate'))
  const propertyNames = [...new Set(propertyData?.rows.map(row => String(row.name)) ?? [])]
  const loanRows = useAdminRows<LoanRow>('loans')
  const paymentRows = useAdminRows<StoredPayment>('loan_early_payments')
  const { currencies, members, queries: listQueries, ready: referencesReady } = useReferenceLists()
  const familyCurrency = useFamilyCurrency()
  // a new loan is in the family currency, as a new account or goal; the first one when it is not listed
  const defaultCurrency = currencies.includes(familyCurrency) ? familyCurrency : currencies[0] ?? ''
  const [referencesSettled, setReferencesSettled] = useState(false)
  if (!referencesSettled && !listQueries.some(q => q.isPending)) setReferencesSettled(true)
  const loans = loanRows.rows
  const earlyPayments = useMemo(() => withRowid(paymentRows.rows), [paymentRows.rows])
  const today = new Date()
  const todayIso = isoDate(today)
  // largest debt today first, as Real estate's largest property: the list and the first pick follow it
  const items = useMemo(() => {
    const day = new Date()
    const owed = (i: LoanItem) => balanceToday(i.loan, i.schedule, day) ?? -1
    return loanItems(loans, earlyPayments).sort((a, b) => owed(b) - owed(a))
  }, [loans, earlyPayments])
  const selection = useRecordSelection(useMemo(() => items.map(i => i.loan.name), [items]), !loanRows.query.isFetching)
  /** The chosen loan; until one is chosen (and after a deletion) — the one the address names, else the first */
  const [loanTarget, setLoanTarget] = useState<LoanRow | null>(null)
  const selectedName = loanTarget?.name ?? selection.selected
  /** Payoff, reopening and closing-day correction share one synchronous flight guard. */
  const [runFix, fixingDate] = useSingleFlight()
  const [addingLoan, setAddingLoan]           = useState(false)
  const [newLoan, setNewLoan]                 = useState<Fields>({})
  const [editingLoan, setEditingLoan]         = useState(false)
  const [editLoanData, setEditLoanData]       = useState<Fields>({})
  /** The early-payment editor: null — closed, `id: null` — a new payment, a number — editing that one; epData is its form */
  const [epForm, setEpForm]                   = useState<{ id: number | null; expectedIdentity?: { loan_name: string; payment_date: string } } | null>(null)
  const [epData, setEpData]                   = useState<Fields>({ strategy: 'reduce_term' })
  const [loanBaseline, setLoanBaseline] = useState<Fields>({})
  const [epBaseline, setEpBaseline] = useState<Fields>({})
  const [newBaseline, setNewBaseline] = useState<Fields>({})
  const newDefaults = (data: Fields) => ({ currency: defaultCurrency, member: members[0] ?? '', type: 'consumer', ...data })
  const formRisk = saving || savingEP || creating || (addingLoan && changed(newDefaults(newLoan), newDefaults(newBaseline))) || (editingLoan && changed(editLoanData, loanBaseline)) || (epForm !== null && changed(epData, epBaseline))
  const { discard, confirmDiscard } = useDiscardGuard(formRisk, savePending, epPending, newPending)
  function cancelEditors() { setEditingLoan(false); setEpForm(null); setLoanTarget(null) }

  /** False, with the notification, when the form has no name: the loan is chosen and its early payments are tied by it */
  function named(data: Fields): boolean {
    if ((data['name'] ?? '').trim()) return true
    toast.error(t('data.common.saveFailed'), t('data.loans.needName'))
    return false
  }

  /** False, with the notification, when the term is over MAX_TERM_MONTHS (35 years): the server refuses it too */
  function termFits(data: Fields): boolean {
    if (!termTooLong(data)) return true
    toast.error(t('data.common.saveFailed'), t('data.loans.termTooLong', { months: fmtNum(MAX_TERM_MONTHS), years: fmtNum(MAX_TERM_MONTHS / 12) }))
    return false
  }

  async function addLoan(): Promise<boolean> {
    if (!referencesReady) return false
    if (!named(newLoan) || !readable(newLoan, loanAmountInvalid(newLoan), toast, t) || !termFits(newLoan)) return false
    const name = newLoan['name'] ?? null
    // the form shows the default currency, the first member and the consumer type as chosen: send what it shows
    const shown: Fields = { ...newLoan, currency: newLoan['currency'] || defaultCurrency, member: newLoan['member'] || members[0] || '', type: newLoan['type'] || 'consumer' }
    const saved = await write(() => apiSend('/api/admin/loans', 'POST', normaliseLoanData(shown)), [t('data.loans.added'), name ?? undefined], t('data.common.saveFailed'))
    if (!saved) return false
    setAddingLoan(false)
    setNewLoan({})
    if (name) { selection.pick(name); pane.open() }
    return true
  }

  async function updateLoan() {
    if (!referencesReady || paymentRows.query.data === undefined) return
    if (!selectedName) return
    const loan = loanTarget
    if (!loan) return
    // an unchanged term is neither checked nor sent: a loan stored with a longer one before the limit stays editable
    const data = withoutUnchangedTerm(editLoanData, loan.term_months)
    if (!named(data) || !readable(data, loanAmountInvalid(data), toast, t) || !termFits(data)) return
    const newName = data['name'] ?? selectedName
    // only the fields the form changed: an untouched one is not rewritten over a change made on another device
    const edited = Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== (loanBaseline[k] ?? '')))
    if (!Object.keys(edited).length) { setEditingLoan(false); setLoanTarget(null); return }
    const body: LoanUpdateRequest = { ...normaliseLoanData(edited), expectedName: loan.name }
    const saved = await write(() => apiSend(`/api/loans/${loan.rowid}`, 'PUT', body), [t('data.loans.saved'), newName], t('data.common.saveFailed'))
    if (!saved) return
    setEditingLoan(false)
    setLoanTarget(null)
    selection.pick(newName)
  }

  /** Sets the stored closing day to the schedule's payoff day (a plain loan edit: journalled, revertible from Change history) */
  async function applySchedulePayoff(loan: LoanRow, payoff: string) {
    await runFix(() => write(() => apiSend(`/api/loans/${loan.rowid}`, 'PUT', { expectedName: loan.name, closed_date: payoff }), [t('data.loans.saved'), loan.name], t('data.common.saveFailed')))
  }

  async function applyLoanStatus(loan: LoanRow, closed: boolean, payoff: string | null = null) {
    await runFix(async () => {
      if (!(await confirm({
        title: t(closed ? 'data.loans.closeTitle' : 'data.loans.reopenTitle', { name: loan.name }),
        text: closed && payoff ? `${t('data.loans.closeConfirm', { date: fmtDayNumeric(payoff) })} ${t('data.loans.closeTotals', { paid: money(summary.totalPaid), interest: money(summary.overpayment) })}` : undefined,
        confirmLabel: t(closed ? 'data.loans.closeAction' : 'data.loans.reopenAction'),
        tone: 'warning',
      }))) return
      await write(() => apiSend(`/api/loans/${loan.rowid}`, 'PUT', { expectedName: loan.name, status: closed ? 'closed' : 'active', closed_date: closed ? payoff : null }), [t('data.loans.saved'), loan.name], t('data.common.saveFailed'))
    })
  }

  async function deleteLoan() {
    if (!selectedName) return
    const loan = loans.find(l => l.name === selectedName)
    if (!loan) return
    if (!(await confirm({ title: t('data.loans.deleteTitle', { name: loan.name }), confirmLabel: t('data.common.delete'), tone: 'danger' }))) return
    const done = await write(() => apiSend(`/api/loans/${loan.rowid}`, 'DELETE'), [t('data.loans.deleted'), loan.name], t('data.common.deleteFailed'))
    if (done) { selection.clear(); pane.back() }
  }

  /**
   * False, with the notification, when the form's payment would leave an early payment that reduces nothing
   * (earlyPaymentConflict): itself, after the loan is repaid by the others, or another one, after the loan is repaid by
   * it. `stored`: the payment being edited, whose fields the form leaves out. The server refuses it too (the loans
   * module's row check).
   */
  function beforePayoff(others: LoanEarlyPayment[], stored?: LoanEarlyPayment): boolean {
    const date = epData['payment_date'] ?? ''
    if (!selectedLoan || !date) return true
    const payment = { rowid: 0, id: 0, notes: null, ...stored, loan_name: selectedLoan.name, ...epPayload(epData), strategy: epData['strategy'] ?? 'reduce_term' } as LoanEarlyPayment
    const conflict = earlyPaymentConflict(selectedLoan, others, payment)
    if (conflict === null) return true
    toast.error(t('data.common.saveFailed'), conflict.late === date
      ? t('data.loans.ep.afterPayoff', { date: fmtDayNumeric(conflict.payoff) })
      : t('data.loans.ep.repaysBefore', { date: fmtDayNumeric(conflict.payoff), payment: fmtDayNumeric(conflict.late) }))
    return false
  }

  async function addEarlyPayment(): Promise<boolean> {
    if (!selectedName) return false
    if (!readable(epData, epAmountInvalid(epData), toast, t) || !beforePayoff(selectedEPs)) return false
    const amount = epAmount(epData['amount']) ?? 0
    const maxAllowed = limitOn(epData['payment_date'] ?? '')
    if (maxAllowed !== null && amount > Math.ceil(maxAllowed)) {
      toast.error(t('data.common.saveFailed'), t('data.loans.overBalance', { amount: fmtNum(amount, 2), max: hidden ? PRIVACY_MASK : fmtNum(maxAllowed, 0) }))
      return false
    }
    const loanName = selectedName
    const saved = await write(
      () => apiSend('/api/admin/loan_early_payments', 'POST', { ...epPayload(epData), loan_name: loanName }),
      [t('data.loans.ep.added'), loanName], t('data.common.saveFailed'),
    )
    if (!saved) return false
    setEpForm(null)
    setLoanTarget(null)
    return true
  }

  async function updateEarlyPayment(id: number): Promise<boolean> {
    if (!readable(epData, epAmountInvalid(epData), toast, t) || !beforePayoff(selectedEPs.filter(ep => (ep.rowid ?? ep.id) !== id), selectedEPs.find(ep => (ep.rowid ?? ep.id) === id))) return false
    const amount = epAmount(epData['amount']) ?? 0
    if (selectedLoan && amount > Number(selectedLoan.principal)) {
      toast.error(t('data.common.saveFailed'), t('data.loans.overPrincipal', { amount: fmtNum(amount, 2), max: hidden ? PRIVACY_MASK : fmtNum(Number(selectedLoan.principal), 0) }))
      return false
    }
    const prev = paymentRows.rows
    // the row takes the read numbers, not the typed text: "6400,5" would show as NaN until the refetch
    paymentRows.setRows(eps => eps.map(ep => (ep.rowid ?? ep.id) === id ? { ...ep, ...epPayload(epData) } as StoredPayment : ep))
    const saved = await write(() => apiSend(`/api/admin/loan_early_payments/${id}`, 'PUT', { ...epPayload(epData), expectedIdentity: epForm?.expectedIdentity }), t('data.loans.ep.saved'), t('data.common.saveFailed'))
    if (!saved) { paymentRows.setRows(prev); return false }
    setEpForm(null)
    setLoanTarget(null)
    return true
  }

  function startEarlyPayment() {
    if (!selectedLoan) return
    void discard(() => { setEditingLoan(false); setLoanTarget(selectedLoan); const data = { strategy: 'reduce_term' }; setEpBaseline(data); setEpData(data); setEpForm({ id: null }) })
  }

  function openEarlyPaymentEdit(ep: LoanEarlyPayment) {
    if (!selectedLoan) return
    setEditingLoan(false)
    setLoanTarget(selectedLoan)
    const data = {
      payment_date: String(ep.payment_date), amount: amountText(ep.amount), strategy: ep.strategy,
      new_payment: Number(ep.new_payment) > 0 ? amountText(ep.new_payment) : '',
      principal_credit: Number(ep.principal_credit) > 0 ? amountText(ep.principal_credit) : '',
      notes: String(ep.notes ?? ''),
    }
    setEpBaseline(data)
    setEpData(data)
    setEpForm({ id: ep.rowid, expectedIdentity: { loan_name: ep.loan_name, payment_date: ep.payment_date } })
  }

  function startEditLoan() {
    if (!selectedLoan) return
    const loan = selectedLoan
    void discard(() => {
      setEpForm(null)
      setLoanTarget(loan)
      setEditingLoan(true)
      const data = {
        ...Object.fromEntries(LOAN_FIELDS.map(([f]) =>
          [f, f === 'principal' || f === 'monthly_payment' ? amountText(loan[f] as number | null) : String(loan[f] ?? '')])),
        secured_by: loan.secured_by ?? '',
      }
      setLoanBaseline(data)
      setEditLoanData(data)
    })
  }

  async function deleteEarlyPayment(id: number) {
    const prev = paymentRows.rows
    paymentRows.setRows(eps => eps.filter(ep => (ep.rowid ?? ep.id) !== id))
    const done = await write(() => apiSend(`/api/admin/loan_early_payments/${id}`, 'DELETE'), t('data.loans.ep.deleted'), t('data.common.deleteFailed'))
    if (!done) { paymentRows.setRows(prev); return }
  }

  const selectedLoan = loanTarget ?? (selectedName ? loans.find(l => l.name === selectedName) ?? null : null)
  const selectedItem = selectedLoan ? items.find(i => i.loan === selectedLoan) ?? loanItems([selectedLoan], earlyPayments)[0] : null
  const selectedEPs = selectedItem?.payments ?? []
  const schedule = selectedItem?.schedule ?? []
  const currentIdx = currentPaymentIndex(schedule, today)
  const summary = summariseSchedule(schedule, currentIdx, selectedEPs, today)
  const notIssued = selectedLoan ? String(selectedLoan.issue_date ?? '').slice(0, 10) > todayIso : false
  const owedToday = selectedLoan ? owedOn(selectedLoan, schedule, today) : null
  /** Most an early payment may be on `date`: the balance by the schedule on that day (today's while the date is unread) */
  const limitOn = (date: string) => {
    const day = new Date(`${date}T00:00:00Z`)
    if (!selectedLoan || !isDay(date) || Number.isNaN(day.getTime())) return owedToday
    return balanceToday({ ...selectedLoan, status: 'active' }, schedule, day) ?? Number(selectedLoan.principal)
  }
  const effect = selectedLoan ? earlyPaymentsEffect(selectedLoan, selectedEPs) : null

  // a closed loan whose stored closing day is not the day the schedule says it was repaid (old Refresh rule, earlier auto-sync)
  // only once the schedule has ended: a loan closed before that was closed on purpose
  const scheduleReady = loanRows.query.data !== undefined && paymentRows.query.data !== undefined
  const scheduleDone = isScheduleDone(schedule, today)
  const payoff = scheduleReady && scheduleDone ? payoffDate(schedule) : null
  const storedClosed = selectedLoan?.closed_date ? String(selectedLoan.closed_date).slice(0, 10) : null
  const closeMismatch = selectedLoan?.status === 'closed' && payoff !== null && storedClosed !== payoff
  const closed = selectedLoan?.status === 'closed'
  /** Repaid by its schedule, or closed: the strip and the chart answer what it cost */
  const repaid = closed || scheduleDone

  const money = (v: number) => masked(v, selectedLoan?.currency ?? '')
  const capital = snapshot?.capital ?? null
  const totals = familyTotals(items, snapshot, today)

  const listed: ListLoan[] = items.map(({ loan, schedule: rows }) => {
    const isClosed = loan.status === 'closed'
    const owed = owedOn(loan, rows, today)
    const idx = currentPaymentIndex(rows, today)
    return {
      name: loan.name, member: loan.member, currency: loan.currency, rate: Number(loan.rate),
      balance: scheduleReady ? owed : null, payment: !scheduleReady || idx === -1 ? null : rows[idx].scheduledPayment, issueDate: String(loan.issue_date ?? ''),
      last: scheduleReady && rows.length > 0 ? rows[rows.length - 1].date : null, repaid: !scheduleReady || owed === null ? null : repaidShare(owed, Number(loan.principal)),
      closed: isClosed ? (loan.closed_date ? String(loan.closed_date).slice(0, 10) : '') : null,
    }
  })

  const editorOpen = editingLoan || epForm !== null
  const menu: MenuItem[] = canEdit && selectedLoan ? [
    { label: t('data.loans.editTitle'), onSelect: startEditLoan },
    { label: t('data.loans.head.delete'), danger: true, onSelect: () => void deleteLoan() },
  ] : []
  const held = selectedLoan ? capital?.loans.find(l => l.name === selectedLoan.name) : undefined

  return (
    <>
    <AdminReadNotice queries={[loanRows.query, paymentRows.query, ...listQueries]} />
    {loanRows.query.data !== undefined && referencesSettled ? <div className={`admin-split re-split${pane.opened && selectedLoan ? ' admin-split--detail' : ''}`}>
      <ViewOnlyNote right="edit" />
      {canEdit && (
        <PageAction>
          <button className="btn btn--ghost" disabled={!referencesReady} onClick={() => void discard(() => { cancelEditors(); setNewBaseline({}); setNewLoan({}); setAddingLoan(true) })}>{t('data.loans.add')}</button>
        </PageAction>
      )}

      {canEdit && addingLoan && (
        <NewLoanDialog data={newLoan} setData={setNewLoan} currencies={currencies} members={members} defaultCurrency={defaultCurrency} propertyNames={propertyNames}
          busy={creating} onSubmit={async () => (await runNew(addLoan)) ?? false} beforeCancel={formRisk ? confirmDiscard : undefined} onCancel={() => setAddingLoan(false)} />
      )}

      <LoanList
        label={t('data.loans.list')}
        loans={listed}
        members={snapshot?.members ?? members}
        totals={scheduleReady ? {
          date: todayIso, currency: totals.currency, balance: totals.balance, payment: totals.payment, endsNext: totals.endsNext,
          capital: capital && snapshot ? { month: monthOf(capital.date), amount: capital.liabilities, currency: snapshot.baseCurrency } : null,
          share: snapshot?.health?.metrics.debt_payment_ratio?.value ?? null, payments: totals.payments,
        } : null}
        selected={pane.visible ? selectedName : null}
        onSelect={name => { if (name === selectedName) { pane.open(); return }; void discard(() => { cancelEditors(); selection.choose(name); pane.open() }) }}
        empty={t('data.loans.empty')}
      />

      {selectedName && selectedLoan && pane.visible ? (
        <div className="record-detail">
          <button type="button" className="btn btn--ghost record-detail__back" onClick={() => void discard(() => { cancelEditors(); pane.back() })}><IconArrowLeft size={16} aria-hidden="true" />{t('modules.loans.title')}</button>
          <section className="admin-panel">
            {canEdit && editingLoan ? (
              <LoanForm data={editLoanData} setData={setEditLoanData} currencies={currencies} members={members} defaultCurrency={defaultCurrency} propertyNames={propertyNames}
                payments={selectedEPs.length} saving={saving} submitDisabled={!referencesReady || !scheduleReady} termInvalid={termTooLong(withoutUnchangedTerm(editLoanData, selectedLoan.term_months))} onSubmit={() => void runSave(updateLoan)} onCancel={() => void discard(cancelEditors)} />
            ) : (
              <>
                <LoanHead loan={selectedLoan} members={snapshot?.members ?? members} collateral={!!selectedLoan.secured_by && propertyNames.includes(selectedLoan.secured_by)}
                  early={canEdit && scheduleReady && !repaid ? { quiet: editorOpen, onClick: startEarlyPayment } : null} menu={menu}>
                  {!closed && payoff && (
                    <p className="ln-payoff">
                      <span>{t('data.loans.payoffSuggestion', { date: fmtDayNumeric(payoff) })}</span>
                      {canEdit && <button type="button" className="btn btn--primary" disabled={fixingDate} onClick={() => applyLoanStatus(selectedLoan, true, payoff)}>{t('data.loans.closeAction')}</button>}
                    </p>
                  )}
                  {canEdit && scheduleReady && closed && !scheduleDone && (
                    <p className="ln-payoff"><button type="button" className="btn btn--ghost" disabled={fixingDate} onClick={() => applyLoanStatus(selectedLoan, false)}>{t('data.loans.reopenAction')}</button></p>
                  )}
                  {closeMismatch && payoff && (
                    <p className="ln-payoff">
                      <span>{storedClosed
                        ? t('data.loans.closedMismatch', { stored: fmtDayNumeric(storedClosed), payoff: fmtDayNumeric(payoff) })
                        : t('data.loans.closedMismatchNoDate', { payoff: fmtDayNumeric(payoff) })}</span>
                      {canEdit && <button type="button" className="btn btn--ghost" disabled={fixingDate} onClick={() => applySchedulePayoff(selectedLoan, payoff)}>{t('data.loans.useCloseDate', { date: fmtDayNumeric(payoff) })}</button>}
                    </p>
                  )}
                </LoanHead>
                {scheduleReady && schedule.length > 0 && (
                  <LoanKpis currency={selectedLoan.currency} principal={Number(selectedLoan.principal)} balance={owedToday ?? 0} notIssued={notIssued}
                    repaid={repaid} repaidOn={payoff ?? storedClosed} today={todayIso}
                    paidOn={currentIdx > 0 ? schedule[currentIdx - 1].date : null}
                    capital={held && capital ? { month: monthOf(capital.date), balance: held.balance } : null}
                    next={currentIdx === -1 ? null : { date: schedule[currentIdx].date, payment: schedule[currentIdx].scheduledPayment, interest: schedule[currentIdx].interest }}
                    summary={summary} effect={effect} early={{ count: selectedEPs.length, total: effect?.total ?? 0 }} />
                )}
              </>
            )}
          </section>

          {scheduleReady && <>
          <BalanceChart loan={selectedLoan} schedule={schedule} payments={selectedEPs} effect={repaid ? null : effect} today={todayIso} compact={phone} />

          <EarlyPaymentsTable
            selectedEPs={selectedEPs}
            currency={selectedLoan.currency}
            total={effect?.total ?? 0}
            actions={canEdit ? { edit: ep => void discard(() => openEarlyPaymentEdit(ep)), remove: id => void deleteEarlyPayment(id) } : null}
            adding={canEdit && epForm?.id === null ? (
              <EarlyPaymentEditor loan={selectedLoan} others={selectedEPs} data={epData} setData={setEpData} max={limitOn(epData['payment_date'] ?? '')} today={today}
                saving={savingEP} onSave={() => void runEP(addEarlyPayment)} onCancel={() => void discard(cancelEditors)} />
            ) : null}
            editing={canEdit && epForm && epForm.id !== null ? {
              rowid: epForm.id,
              editor: <EarlyPaymentEditor loan={selectedLoan} others={selectedEPs.filter(ep => ep.rowid !== epForm.id)} data={epData} setData={setEpData} max={null} today={today}
                saving={savingEP} onSave={() => void runEP(() => updateEarlyPayment(epForm.id!))} onCancel={() => void discard(cancelEditors)} />,
            } : null}
          />

          <ScheduleTable key={selectedLoan.name} schedule={schedule} currentIdx={currentIdx} currency={selectedLoan.currency} />
          </>}
        </div>
      ) : (
        <div className="admin-empty record-empty">{loans.length > 0 ? t('data.loans.pick') : t('data.loans.addFirst')}</div>
      )}
    </div> : null}
    </>
  )
}
