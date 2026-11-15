import { AdminReadNotice } from './ui/AdminReadNotice'
import { IconArrowLeft } from '@tabler/icons-react'
import { useRecordPane } from './useRecordPane'
import { Suspense, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFamilyCurrency } from '../../lib/familySettings'
import { useReferenceLists } from './shared'
import { ApiError, apiSend } from '../../lib/api'
import { useDiscardGuard } from '../../lib/useUnsavedChanges'
import { useSingleFlight } from './useSingleFlight'
import type { AccountMonthRequest, AccountUpdateRequest, Row } from '../../domain/api'
import { accountKey, resolveAccountLink, listAccounts, type AccountRef } from '../../domain/accounts'
import { accountStats } from '../../domain/accountStats'
import { monthEnd, monthOf } from '../../domain/dates'
import { fmtMonth, fmtMonthYear } from '../../lib/formatters'
import { PHONE, mediaMatches, useMedia } from '../../lib/media'
import { navigate } from '../../lib/router'
import { useSnapshot } from '../../lib/useFinanceData'
import { holdingTones } from '../assets/tones'
import { useConfirm, useToast } from '../../lib/notifyState'
import { CLIENT_MODULES } from '../../modules/client'
import { useCan } from '../../lib/rights'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { monthCloseQuery, tableQuery, useSnapshotWrite } from './adminQuery'
import { useAdminRows } from './useAdminRows'
import { useRecordSelection } from './useRecordSelection'
import { amountText, parseAmount } from './amount'
import { AmountInput } from './ui/AmountInput'
import { Field } from './ui/Field'
import { AccountFields } from './AccountForm'
import { EMPTY_ACCOUNT, requiredAccountFields, withListDefaults } from './accountValues'
import { FormDialog } from './ui/FormDialog'
import { PageAction } from './ui/PageAction'
import { AccountHead } from './accounts/AccountHead'
import { AccountKpis } from './accounts/AccountKpis'
import { BalanceCard, type AccountWindow } from './accounts/BalanceCard'
import { FlowsChart } from './accounts/FlowsChart'
import { MonthHeatmap } from './accounts/MonthHeatmap'
import { MonthTable, type MonthRecord } from './accounts/MonthTable'
import { AccountFindings, UsualRange } from './accounts/UsualRange'
import { AccountList, OwnerChips } from './accounts/AccountList'
import { listOrder, listType, ownersOf, type ListAccount } from './accounts/listOrder'
import { onEscape } from './ui/onEscape'

type BankAccount = AccountRef

/** What the screen's writes change: balances, flows, the wizard's draft and the availability answers (a rename moves them) */
const WRITES = [tableQuery('assets').queryKey, tableQuery('monthly_cashflow').queryKey, monthCloseQuery.queryKey, ['admin', 'availability']]

const accKey = (a: BankAccount) => accountKey(a.bank, a.member)
const accTitle = (a: BankAccount) => `${a.bank} · ${a.member}`
const isBalanceOf = (acc: BankAccount) => (r: Row) => String(r['name']) === acc.bank && String(r['member'] ?? '') === acc.member
const isFlowOf = (acc: BankAccount) => (r: Row) => String(r['bank']) === acc.bank && String(r['member'] ?? '') === acc.member

/** A month's stored values as a correction names them (`expected`); null — no balance or no flow row */
const expectedOf = (rec: MonthRecord): AccountMonthRequest['expected'] => {
  const flow = (v: number) => (rec.cfRowid !== null ? v : null)
  return { balance: rec.balanceRowid !== null ? rec.balance : null, active: flow(rec.active_income), passive: flow(rec.passive_income), expense: flow(rec.expense) }
}

/** The account's months, newest first: the balance row and the flow row of each */
function historyOf(acc: BankAccount, assetRows: Row[], flowRows: Row[]): MonthRecord[] {
  const aRows = assetRows.filter(isBalanceOf(acc))
  const cfRows = flowRows.filter(isFlowOf(acc))
  const yms = new Set<string>([
    ...aRows.map(r => monthOf(String(r['date']))),
    ...cfRows.map(r => monthOf(String(r['date']))),
  ])
  return [...yms].sort().reverse().map(ym => {
    const aRow  = aRows.find(r => monthOf(String(r['date'])) === ym)
    const cfRow = cfRows.find(r => monthOf(String(r['date'])) === ym)
    return {
      ym,
      balance:       Number(aRow?.['value']          ?? 0),
      balanceRowid:  aRow  ? Number(aRow['rowid'])   : null,
      active_income: Number(cfRow?.['active_income'] ?? 0),
      passive_income:Number(cfRow?.['passive_income']?? 0),
      expense:       Number(cfRow?.['expense']       ?? 0),
      cfRowid:       cfRow ? Number(cfRow['rowid'])  : null,
    }
  })
}


export function AccountsView() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  // the list's subtotals, tones and the title row read the snapshot: a write refreshes it
  const write = useSnapshotWrite(WRITES)
  const queryClient = useQueryClient()
  const canEdit = useCan('edit')
  const { opened: paneOpened, visible: paneVisible, open: openPane, back: backPane, containerRef } = useRecordPane(true)
  const assets = useAdminRows('assets')
  const { members, currencies, queries: listQueries, ready: referencesReady } = useReferenceLists()
  const [referencesSettled, setReferencesSettled] = useState(false)
  if (!referencesSettled && !listQueries.some(q => q.isPending)) setReferencesSettled(true)
  const familyCurrency = useFamilyCurrency()
  // the wizard knows which months are closed; without it the screen works but does not mark open ones (and says nothing)
  const wizard = useQuery(monthCloseQuery)
  /** The last closed month; null — none (or the wizard is unavailable) */
  const closedThrough = wizard.data?.lastClosed?.month ?? null
  const accounts = useMemo(() => listAccounts(assets.rows.map(r => ({
    date: String(r['date']), class: String(r['class']), name: String(r['name']),
    currency: String(r['currency'] ?? ''), member: r['member'] == null ? null : String(r['member']),
  }))), [assets.rows])
  const snapshot = useSnapshot().data
  const capital = snapshot?.capital ?? null
  /** The family in its order (the owners' tints); the sorted list until the snapshot comes */
  const familyOrder = snapshot?.members ?? members
  /**
   * Each account's list entry: the balance and the change of the last closed month (the newest balance while the
   * account has none there, or no month is known closed) and its base value there.
   */
  const listItems = useMemo((): ListAccount[] => accounts.map(acc => {
    const balances = assets.rows.filter(isBalanceOf(acc)).map(r => ({ month: monthOf(String(r['date'])), value: Number(r['value']) }))
    const newest = balances.reduce<{ month: string; value: number } | undefined>((a, b) => (!a || b.month > a.month ? b : a), undefined)
    const stats = newest ? accountStats(balances, [], closedThrough ?? newest.month) : null
    const held = capital?.accounts.find(a => a.name === acc.bank && a.member === acc.member)
    return {
      key: accKey(acc), acc, balance: stats?.last ?? newest?.value, change: stats?.monthChange ?? null,
      olderMonth: closedThrough && newest && newest.month < closedThrough ? newest.month : null,
      valueBase: held?.valueBase ?? null, noRate: held !== undefined && held.valueBase === null,
    }
  }), [accounts, assets.rows, closedThrough, capital])
  const [who, setWho] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const needle = search.trim().toLocaleLowerCase()
  const filteredItems = listItems.filter(a => !needle || a.acc.bank.toLocaleLowerCase().includes(needle) || a.acc.member.toLocaleLowerCase().includes(needle))
  // the chosen owner has no account left (deleted, renamed to another owner): back to everyone
  if (who !== null && !listItems.some(a => a.acc.member === who)) setWho(null)
  const toneOf = useMemo(() => holdingTones(listItems.map(a => (
    { kind: 'account' as const, name: a.acc.bank, member: a.acc.member, type: listType(a.acc), valueBase: a.valueBase ?? 0 }
  ))), [listItems])
  const namesId = useId()
  const selection = useRecordSelection(useMemo(() => listOrder(listItems).map(a => a.key), [listItems]), !assets.query.isFetching,
    key => resolveAccountLink(key, accounts.map(a => ({ name: a.bank, member: a.member }))))
  /** The account the user last picked or wrote: shown while the list does not know it yet (a new one, before the re-read) */
  const [pickedAccount, setPickedAccount] = useState<BankAccount | null>(null)
  const pick = (acc: BankAccount) => { setPickedAccount(acc); selection.pick(accKey(acc)); openPane() }
  /** The chosen account; until one is chosen (and after a deletion) — the one the address names, else the first */
  const selectedAccount = accounts.find(a => accKey(a) === selection.selected) ?? (pickedAccount && accKey(pickedAccount) === selection.selected ? pickedAccount : null)
  const [monthAccount, setMonthAccount] = useState<BankAccount | null>(null)
  const [editTarget, setEditTarget] = useState<BankAccount | null>(null)
  const sel = monthAccount ?? editTarget ?? selectedAccount
  const flows = useAdminRows('monthly_cashflow', sel !== null)
  const historyReady = sel !== null && flows.query.data !== undefined
  const history = useMemo(
    () => (sel && historyReady ? historyOf(sel, assets.rows, flows.rows) : []),
    [sel, historyReady, assets.rows, flows.rows],
  )
  const [addingAcc, setAddingAcc] = useState(false)
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [newAcc, setNewAcc]       = useState(EMPTY_ACCOUNT)
  /** New records use the family currency when listed; explicit choices win. */
  const newAccount = withListDefaults(newAcc, members, currencies, familyCurrency)
  const [addingMonth, setAddingMonth] = useState(false)
  const [editingYM, setEditingYM]     = useState<string | null>(null)
  const [mForm, setMForm] = useState({ ym: '', balance: '0', active: '0', passive: '0', expense: '0', balanceRequired: false })
  const [runMonth, savingM, monthPending] = useSingleFlight()
  const [editingAcc, setEditingAcc]   = useState<BankAccount | null>(null)
  const [editAccForm, setEditAccForm] = useState(EMPTY_ACCOUNT)
  const [runAccount, savingAcc, accountPending] = useSingleFlight()
  const [runCreate, creating, createPending] = useSingleFlight()
  const [monthBaseline, setMonthBaseline] = useState(mForm)
  /** The month's stored values as the form opened them: the save names them, so a change made meanwhile is refused */
  const monthExpected = useRef<AccountMonthRequest['expected']>(undefined)
  /** The month editor sits above the table, far below the head's «Correct»: it comes into view when it opens */
  const monthFormRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!addingMonth) return
    monthFormRef.current?.scrollIntoView?.({ block: 'center', behavior: mediaMatches('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth' })
  }, [addingMonth, editingYM])
  const [accountBaseline, setAccountBaseline] = useState(editAccForm)
  const [newBaseline, setNewBaseline] = useState(newAcc)
  const formRisk =
    savingM || savingAcc || creating ||
    (addingAcc && JSON.stringify(newAccount) !== JSON.stringify(withListDefaults(newBaseline, members, currencies, familyCurrency))) ||
    (addingMonth && JSON.stringify(mForm) !== JSON.stringify(monthBaseline)) ||
    (editingAcc !== null && JSON.stringify(editAccForm) !== JSON.stringify(accountBaseline))
  const { discard, confirmDiscard } = useDiscardGuard(formRisk, monthPending, accountPending, createPending)
  const cancelMonth = () => { setAddingMonth(false); setEditingYM(null); setMonthAccount(null) }
  const cancelAccount = () => { setEditingAcc(null); setEditTarget(null) }

  const submitMonth = (e: FormEvent) => { e.preventDefault(); void runMonth(saveMonth) }
  const submitEditAccount = (e: FormEvent) => { e.preventDefault(); setValidationAttempt(n => n + 1); if (!requiredAccountFields(editAccForm).length) void runAccount(saveEditAccount) }

  async function createAccount(): Promise<boolean> {
    if (!referencesReady) return false
    const { member, currency } = newAccount
    if (!newAcc.name.trim() || !member || !currency) {
      toast.error(t('data.common.saveFailed'), t('data.accounts.needFields'))
      return false
    }
    // A zero balance goes to the last closed month: from the next month the wizard asks for the account.
    // While no month is closed there is nowhere to write: the row would land in a month the dashboard does not see.
    if (!closedThrough) {
      toast.error(t('data.accounts.firstInWizard'))
      return false
    }
    const date = monthEnd(closedThrough)
    const acc: BankAccount = { bank: newAcc.name.trim(), member, currency, class: newAcc.class }
    const saved = await write(
      () => apiSend('/api/admin/assets', 'POST', { date, class: acc.class, name: acc.bank, value: 0, currency: acc.currency, member: acc.member }),
      [t('data.accounts.added'), accTitle(acc)], t('data.common.saveFailed'),
    )
    if (!saved) return false
    setAddingAcc(false)
    setNewAcc(EMPTY_ACCOUNT)
    pick(acc)
    return true
  }

  // A module refresh may hide a flow-only month; keep this form's scope and balance rule until it closes.
  function startEditMonth(rec: MonthRecord) {
    if (!sel) return
    cancelAccount()
    setMonthAccount(sel)
    const data = { ym: rec.ym, balance: rec.balanceRowid === null ? '' : amountText(rec.balance), active: amountText(rec.active_income), passive: amountText(rec.passive_income), expense: amountText(rec.expense), balanceRequired: rec.balanceRowid !== null }
    setMonthBaseline(data)
    monthExpected.current = expectedOf(rec)
    setMForm(data)
    setEditingYM(rec.ym); setAddingMonth(true)
  }

  async function saveMonth() {
    // a new month appears only in the month-close wizard; here existing ones are edited
    if (!monthAccount || !editingYM) return
    // an amount that does not read is not saved as 0: the field says so
    if (monthFields.some(f => f.key !== 'ym' && parseAmount(mForm[f.key]).invalid)) return
    // a cleared balance is not a zero: the month keeps its balance until a number is typed
    if (mForm.balanceRequired && parseAmount(mForm.balance).value === null) {
      toast.error(t('data.common.saveFailed'), t('data.accounts.needBalance'))
      return
    }
    const request: AccountMonthRequest = {
      account: { name: monthAccount.bank, member: monthAccount.member }, month: mForm.ym,
      balance: parseAmount(mForm.balance).value,
      active: parseAmount(mForm.active).value ?? 0,
      passive: parseAmount(mForm.passive).value ?? 0,
      expense: parseAmount(mForm.expense).value ?? 0,
      expected: monthExpected.current,
    }
    let changedElsewhere = false
    const saved = await write(() => apiSend('/api/accounts/month', 'POST', request),
      [t('data.accounts.monthSaved'), `${monthAccount.bank} · ${fmtMonth(mForm.ym)}`], t('data.common.saveFailed'),
      e => { changedElsewhere = e instanceof ApiError && e.code === 'row_changed'; return false })
    if (!saved) {
      // the error said so and the rows were read again: the next save starts from the month as it is now
      if (changedElsewhere) {
        const rows = (table: string) => queryClient.getQueryData(tableQuery(table).queryKey)?.rows ?? []
        const fresh = historyOf(monthAccount, rows('assets'), rows('monthly_cashflow')).find(r => r.ym === mForm.ym)
        monthExpected.current = fresh ? expectedOf(fresh) : undefined
      }
      return
    }
    cancelMonth()
  }

  function startEditAccount(acc: BankAccount) {
    cancelMonth()
    setEditTarget(acc)
    setEditingAcc(acc)
    setValidationAttempt(0)
    const data = withListDefaults({ name: acc.bank, member: acc.member, currency: acc.currency, class: acc.class }, members, currencies)
    setAccountBaseline(data)
    setEditAccForm(data)
    pick(acc)
  }

  async function saveEditAccount() {
    if (!referencesReady) return
    // spaces around the name would turn one account into two for the wizard
    const name = editAccForm.name.trim()
    if (!editingAcc || !name) return
    const from = editingAcc
    const updated: BankAccount = { bank: name, member: editAccForm.member, currency: editAccForm.currency, class: editAccForm.class }
    const request: AccountUpdateRequest = { from: { name: from.bank, member: from.member }, values: { name: updated.bank, member: updated.member, currency: updated.currency, class: updated.class } }
    const saved = await write(() => apiSend('/api/accounts/update', 'POST', request), [t('data.accounts.saved'), accTitle(updated)], t('data.common.saveFailed'))
    if (!saved) return
    cancelAccount()
    pick(updated)
  }

  async function deleteAccount(acc: BankAccount) {
    if (!(await confirm({ title: t('data.accounts.deleteTitle', { name: accTitle(acc) }), text: t('data.accounts.deleteText'), confirmLabel: t('data.common.delete'), tone: 'danger' }))) return
    const done = await write(() => apiSend('/api/accounts/delete', 'POST', { name: acc.bank, member: acc.member }), [t('data.accounts.deleted'), accTitle(acc)], t('data.common.deleteFailed'))
    if (!done) return
    if (sel && accKey(sel) === accKey(acc)) { selection.clear(); backPane() }
  }

  /** The month the detail's figures are of: the last closed one (the newest balance while the wizard is unknown) */
  const lastMonth = closedThrough ?? history.find(rec => rec.balanceRowid !== null)?.ym ?? null
  /** «Correct <month>»: that month, when the account has a balance there */
  const correctRec = history.find(rec => rec.ym === lastMonth && rec.balanceRowid !== null)
  /** The account's balances and flows up to that month, oldest first: what the figures and the charts read */
  const series = useMemo(() => {
    const months = [...history].reverse().filter(h => lastMonth !== null && h.ym <= lastMonth)
    return {
      balances: months.filter(h => h.balanceRowid !== null).map(h => ({ month: h.ym, value: h.balance })),
      flows: months.filter(h => h.cfRowid !== null).map(h => ({ month: h.ym, income: h.active_income + h.passive_income, expense: h.expense })),
    }
  }, [history, lastMonth])
  const stats = useMemo(() => (lastMonth === null ? null : accountStats(series.balances, series.flows, lastMonth)), [series, lastMonth])
  const [chartWindow, setChartWindow] = useState<AccountWindow>('12')
  const phone = useMedia(PHONE)
  // the snapshot's value and share are of its month: a different month (the wizard unknown, or one closed since) gives none
  const held = sel ? capital?.accounts.find(a => a.name === sel.bank && a.member === sel.member) : undefined
  /** An account is closed in the wizard: say so and offer to go there */
  async function closeInWizard(acc: BankAccount) {
    if (await confirm({ title: t('data.accounts.closeTitle'), text: t('data.accounts.closeText', { name: acc.bank }), confirmLabel: t('data.accounts.closeOpen'), tone: 'warning' })) navigate('/close')
  }
  const editingSel = !!editingAcc && !!sel && accKey(editingAcc) === accKey(sel)
  const monthFields = [
    { label: t('data.field.month'), key: 'ym', type: 'month' },
    { label: t('data.field.balance'), key: 'balance', type: 'number' },
    { label: t('data.field.active'), key: 'active', type: 'number' },
    { label: t('data.field.passive'), key: 'passive', type: 'number' },
    { label: t('data.field.expense'), key: 'expense', type: 'number' },
  ] as const
  // while income and expenses are not tracked the month editor is balance-only, as in Close month
  const trackFlows = snapshot?.trackFlows ?? true
  const shownMonthFields = trackFlows ? monthFields : monthFields.filter(f => f.key === 'ym' || f.key === 'balance')

  return (
    <>
    <AdminReadNotice queries={[assets.query, ...listQueries, ...(sel !== null ? [flows.query] : [])]} />
    <div ref={containerRef} className={`admin-split acc-split${paneOpened && sel ? ' admin-split--detail' : ''}`}>
    {assets.query.data !== undefined && referencesSettled && <>
      <ViewOnlyNote right="edit" />
      {canEdit && (
        <PageAction>
          <button className="btn btn--primary" disabled={!referencesReady} onClick={() => void discard(() => { cancelMonth(); cancelAccount(); setNewAcc(EMPTY_ACCOUNT); setNewBaseline(EMPTY_ACCOUNT); setValidationAttempt(0); setAddingAcc(true) })}>{t('data.accounts.add')}</button>
        </PageAction>
      )}

      {canEdit && addingAcc && (
        <FormDialog title={t('data.accounts.newTitle')} submitLabel={t('data.accounts.create')} onSubmit={async () => { setValidationAttempt(n => n + 1); if (requiredAccountFields(newAccount, { memberRequired: true }).length) return false; return (await runCreate(createAccount)) ?? false }} busy={creating} beforeCancel={formRisk ? confirmDiscard : undefined} onCancel={() => setAddingAcc(false)}>
          <AccountFields validationAttempt={validationAttempt} invalidFields={validationAttempt ? requiredAccountFields(newAccount, { memberRequired: true }) : []} values={newAccount} onChange={patch => setNewAcc(a => ({ ...a, ...patch }))} members={members} currencies={currencies}
            nameHint={t('data.accounts.nameHint')} namesId={namesId} />
        </FormDialog>
      )}
      <datalist id={namesId}>{[...new Set(accounts.map(a => a.bank))].map(n => <option key={n} value={n} />)}</datalist>

      <AccountList
        ownerFilter={ownersOf(listItems, familyOrder).length > 1 ? <OwnerChips accounts={listItems} members={familyOrder} who={who} onChange={setWho} /> : null}
        label={t('data.accounts.list')}
        accounts={filteredItems}
        query={search}
        onQuery={setSearch}
        members={familyOrder}
        baseCurrency={capital ? snapshot?.baseCurrency ?? null : null}
        who={who}
        selected={sel ? accKey(sel) : null}
        onSelect={key => { if (sel && key === accKey(sel)) { openPane(); return }; void discard(() => { cancelMonth(); cancelAccount(); selection.choose(key); openPane() }) }}
        empty={t(needle ? 'data.accounts.noResults' : 'data.accounts.empty')}
      />

      {sel && paneVisible ? (
        <div className="record-detail">
          {needle && !filteredItems.some(a => a.key === accKey(sel)) && <p className="note">{t('data.accounts.outsideResults')}</p>}
          <button type="button" className="btn btn--ghost record-detail__back" onClick={() => void discard(() => { cancelMonth(); cancelAccount(); backPane() })}><IconArrowLeft size={16} aria-hidden="true" />{t('data.accounts.list')}</button>
          <div className="admin-panel">
            {canEdit && editingSel ? (
              <form onSubmit={submitEditAccount} onKeyDown={onEscape(() => void discard(cancelAccount))} noValidate>
                <div className="form-card__title">{t('data.accounts.editTitle')}</div>
                <fieldset className="form-grid" disabled={savingAcc}>
                  <AccountFields validationAttempt={validationAttempt} invalidFields={validationAttempt ? requiredAccountFields(editAccForm) : []} values={editAccForm} onChange={patch => setEditAccForm(f => ({ ...f, ...patch }))} members={members} currencies={currencies} />
                </fieldset>
                <div className="form-actions">
                  <button type="button" className="btn btn--ghost" disabled={savingAcc} onClick={() => void discard(cancelAccount)}>{t('common.cancel')}</button>
                  <button type="submit" className="btn btn--primary" disabled={savingAcc || !referencesReady}>
                    {savingAcc ? t('data.common.saving') : t('data.common.save')}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <AccountHead acc={sel} members={familyOrder}
                  tone={toneOf({ kind: 'account', name: sel.bank, member: sel.member, type: listType(sel) })}
                  correct={canEdit && correctRec ? { label: t('data.accounts.correctMonth', { month: fmtMonthYear(correctRec.ym) }), onClick: () => void discard(() => startEditMonth(correctRec)) } : null}
                  menu={canEdit ? [
                    { label: t('data.accounts.settings'), onSelect: () => void discard(() => startEditAccount(sel)) },
                    { label: t('data.accounts.close'), onSelect: () => void closeInWizard(sel) },
                    { label: t('data.common.delete'), danger: true, onSelect: () => void deleteAccount(sel) },
                  ] : []} />
                {stats && lastMonth && <>
                  <AccountKpis stats={stats} month={lastMonth} currency={sel.currency}
                    base={capital && snapshot && monthOf(capital.date) === lastMonth ? { valueBase: held?.valueBase ?? null, currency: snapshot.baseCurrency, assets: capital.assets, date: capital.date } : null} />
                  {stats.range && <UsualRange range={stats.range} last={stats.last} currency={sel.currency} />}
                  <AccountFindings findings={stats.findings} currency={sel.currency} />
                </>}
              </>
            )}
          </div>

          {stats && lastMonth && <>
            <BalanceCard name={sel.bank} currency={sel.currency} balances={series.balances} lastMonth={lastMonth} window={chartWindow} onWindow={setChartWindow} compact={phone} />
            <MonthHeatmap stats={stats} lastMonth={lastMonth} currency={sel.currency} compact={phone} />
            {stats.hasFlows && <FlowsChart name={sel.bank} currency={sel.currency} flows={series.flows} lastMonth={lastMonth} window={chartWindow} firstMonth={series.balances[0]?.month ?? null} compact={phone} />}
            {/* the modules' blocks (Income and expenses: the categories); each is lazy and draws nothing without data */}
            {CLIENT_MODULES.flatMap(({ key, accountDetail: Detail }) => (Detail ? [
              <Suspense key={key} fallback={null}><Detail account={{ name: sel.bank, member: sel.member, currency: sel.currency }} lastMonth={lastMonth} /></Suspense>,
            ] : []))}
          </>}

          <MonthTable key={accKey(sel)} history={history} currency={sel.currency} closedThrough={closedThrough}
            hasFlows={stats?.hasFlows ?? false} balanceOnly={historyReady && stats !== null && !stats.hasFlows}
            onCorrect={canEdit ? rec => void discard(() => startEditMonth(rec)) : null}
            editor={
              canEdit && addingMonth && (
              <form key={editingYM ?? ''} ref={monthFormRef} className="form-card" onSubmit={submitMonth} onKeyDown={onEscape(() => void discard(cancelMonth))} noValidate>
                <div className="form-card__title">{t('data.accounts.editMonth', { month: editingYM ? fmtMonth(editingYM) : '' })}</div>
                <fieldset className="form-grid" disabled={savingM}>
                  {shownMonthFields.map(({ label, key }) => (
                    <Field key={key} label={label}>
                      {key === 'ym'
                        ? <input type="month" value={mForm.ym} disabled className="admin-input" onChange={() => undefined} />
                        : <AmountInput label={label} signed={key === 'balance'} autoFocus={key === 'balance'} value={mForm[key]} onChange={text => setMForm(f => ({ ...f, [key]: text }))} />}
                    </Field>
                  ))}
                </fieldset>
                {/* a brokerage account's flows: what is income and expense there, and what is only the balance */}
                {trackFlows && sel.class === 'broker' && <p className="note">{t('data.close.brokerHint')}</p>}
                <div className="form-actions">
                  <button type="button" className="btn btn--ghost" disabled={savingM} onClick={() => void discard(cancelMonth)}>{t('common.cancel')}</button>
                  <button type="submit" className="btn btn--primary" disabled={savingM}>
                    {savingM ? t('data.common.saving') : t('data.common.save')}
                  </button>
                </div>
              </form>
              )
            } />
        </div>
      ) : (
        <div className="admin-empty record-empty">{accounts.length > 0 ? t('data.accounts.pick') : t('data.accounts.addFirst')}</div>
      )}
    </>}
    </div>
    </>
  )
}
