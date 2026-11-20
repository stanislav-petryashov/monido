// "Breakdown by month" on the Categories screen: every account's income and expenses of a month with what of each total
// the categories split, the AllocationEditor opened in place under its row, the loan payments (split by themselves), the
// accounts without movement in one line, and the free sources ("Other sources") that are not accounts.
import { Fragment, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { Trans, useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { accountKey } from '../../domain/accounts'
import { monthTotals } from '../../domain/cashflow'
import type { SpendingRecords } from '../../domain/api'
import { MONTH_RE } from '../../domain/dates'
import { STATEMENT_SOURCE_PREFIX } from '../../domain/statements'
import { allocationSummary } from '../../domain/spending'
import type { CategoryDirection, SpendingCategory } from '../../domain/types'
import { apiSend } from '../../lib/api'
import { fmtInMonth, fmtMoney, fmtMonth, fmtPct } from '../../lib/formatters'
import { useConfirm, useToast } from '../../lib/notifyState'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../lib/privacy'
import { useSnapshot } from '../../lib/useFinanceData'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { Link } from '../../components/ui/Link'
import { AllocationMeter } from '../../components/finance/AllocationMeter'
import { useLoadFailedToast, monthCloseQuery } from '../../pages/admin/adminQuery'
import { RowMenu } from '../../pages/admin/ui/RowMenu'
import { SettingsSection } from '../../pages/admin/ui/SettingsSection'
import { MonthOverview } from './MonthOverview'
import { monthCoverage, type MonthCoverage } from './monthCoverage'
import { AllocationEditor, type AllocationItem } from './AllocationEditor'
import { SourceDialog, type Source, type SourceItem } from './SourceDialog'
import { SPENDING_BASE, useSpendingLists, useSpendingWrite } from './spendingWrites'

const P = 'modules.cashflow.flows.breakdown'
type Account = SpendingRecords['accounts'][number]
const INCOME: CategoryDirection = 'income'
const EXPENSE: CategoryDirection = 'expense'
/** An account with nothing to split this month: every total zero and no line */
const still = (a: Account) => !a.orphaned && !a.items.length && !!a.totals && Object.values(a.totals).every(v => v === 0)

const accountName = (a: Pick<Account, 'bank' | 'member'>) => (a.member ? `${a.bank} · ${a.member}` : a.bank)

export function BreakdownBlock({ data, canEdit }: { data: SpendingRecords; canEdit: boolean }) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const send = useSpendingWrite()
  const { hidden } = usePrivacy()
  const lists = useSpendingLists()
  const wizard = useQuery(monthCloseQuery)
  useLoadFailedToast(wizard)
  // the base-currency view of each closed month (the coverage and what is left), and the loan payments: the snapshot's
  const snapshot = useSnapshot().data
  const money = useMoney()
  /** An amount of the snapshot, in its base currency */
  const fmt = (v: number) => money(v, snapshot?.baseCurrency)
  const [editing, setEditing] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(() => {
    const value = new URLSearchParams(window.location.search).get('month') ?? ''
    return MONTH_RE.test(value) ? value : null
  })
  /** The free source's window: `new` — empty (on the selected month), a source — opened on its month to edit */
  const [sourceDialog, setSourceDialog] = useState<{ edit: Source | null; month?: string } | null>(null)

  const categories = data.categories
  const expenseCategories = categories.filter(c => c.flow === 'expense')
  const usable = categories.some(c => c.kind !== 'loan_payment')
  const ready = lists.ready
  const coverage = monthCoverage(data, wizard.data)
  // the screen opens on the last closed month with something left to split (not the open one), else the last closed one
  const closed = coverage.filter(item => item.selectable && item.status !== 'notClosed')
  const fallbackMonth = (closed.find(item => item.status === 'unallocated') ?? closed[0] ?? coverage.find(item => item.selectable) ?? coverage[0])?.month ?? ''
  const month = coverage.some(item => item.month === selectedMonth) ? selectedMonth! : fallbackMonth
  const hasLines = data.accounts.some(a => a.items.length > 0) || data.sources.length > 0
  const ofMonth = (source: { month: string; coveragePct: number | null; unallocatedBase: number | null }[] | undefined, ym: string) => source?.find(m => m.month === ym)
  const share = (ym: string) => ({ expense: ofMonth(snapshot?.spending?.months, ym)?.coveragePct ?? null, income: ofMonth(snapshot?.income?.months, ym)?.coveragePct ?? null })

  function cell(a: Account, direction: CategoryDirection) {
    return <AllocationMeter summary={allocationSummary(a.allocated, a.totals, direction)} currency={a.currency} label={`${t(`${P}.${direction === 'income' ? 'income' : 'expenses'}`)}: ${accountName(a)}`} />
  }

  const label = (a: Account) => `${accountName(a)}, ${fmtMonth(a.month)}`
  const keyOf = (a: Account) => `${a.month}|${accountKey(a.bank, a.member)}`

  /** Open the saved month so its updated rows are visible in the timeline. */
  async function revealing(month: string, saved: Promise<boolean>): Promise<boolean> {
    const done = await saved
    if (done) setSelectedMonth(month)
    return done
  }

  /** `base` — the lines the edit started from: the server refuses the save (409 row_changed) when they changed meanwhile */
  async function saveAccount(month: string, a: Pick<Account, 'bank' | 'member'>, items: AllocationItem[], base: AllocationItem[], ok: string): Promise<boolean> {
    return revealing(month, send(() => apiSend(`${SPENDING_BASE}/months/${month}/account`, 'PUT', { bank: a.bank, member: a.member, items, base }),
      [ok, `${accountName(a)}, ${fmtMonth(month)}`], t('data.common.saveFailed')))
  }

  async function clearLines(a: Account, orphan: boolean) {
    const name = label(a)
    const key = orphan ? 'delete' : 'clear'
    if (!(await confirm({ title: t(`${P}.${key}Title`, { name }), text: t(`${P}.${key}Text`), confirmLabel: t(`${P}.${key}`), tone: 'danger' }))) return
    await saveAccount(a.month, a, [], a.items, t(`${P}.${orphan ? 'deleted' : 'cleared'}`))
  }

  async function saveSource(ym: string, source: string, items: SourceItem[], base: SourceItem[]): Promise<boolean> {
    if (!ready) return false
    return revealing(ym, send(() => apiSend(`${SPENDING_BASE}/months/${ym}/${encodeURIComponent(source)}`, 'PUT', { items, base }), [t('modules.cashflow.spending.months.saved'), `${source}, ${fmtMonth(ym)}`], t('data.common.saveFailed')))
  }

  /** `base` — the lines shown: the server refuses the delete (409 row_changed) when they changed meanwhile */
  async function deleteSource(ym: string, source: string, base: SourceItem[]) {
    const name = `${source}, ${fmtMonth(ym)}`
    if (!(await confirm({ title: t('modules.cashflow.spending.months.deleteTitle', { name }), text: t('modules.cashflow.spending.months.deleteText'), confirmLabel: t('data.common.delete'), tone: 'danger' }))) return
    await send(() => apiSend(`${SPENDING_BASE}/months/${ym}/${encodeURIComponent(source)}`, 'DELETE', { base }), [t('modules.cashflow.spending.months.deleted'), name], t('data.common.deleteFailed'))
  }

  const actions = (<th className="td-actions"><span className="sr-only">{t('modules.cashflow.spending.actions')}</span></th>)
  const columns = canEdit ? 4 : 3

  /** The month's head: what of its expenses and income the categories split, in the base currency, and what is left */
  function head(ym: string) {
    const expense = ofMonth(snapshot?.spending?.months, ym), income = ofMonth(snapshot?.income?.months, ym)
    if (!expense && !income) return null
    const parts = [
      expense?.coveragePct != null ? t(`${P}.headExpenses`, { pct: fmtPct(expense.coveragePct) }) : null,
      income?.coveragePct != null ? t(`${P}.headIncome`, { pct: fmtPct(income.coveragePct) }) : null,
    ].filter(Boolean)
    const left = [expense?.unallocatedBase, income?.unallocatedBase].filter((v): v is number => v != null && v > 0.005)
    return <p className="month-ledger__head">{[parts.join(' · '), left.length ? t(`${P}.headLeft`, { amounts: left.map(v => fmt(v)).join(' · ') }) : t(`${P}.headDone`)].filter(Boolean).join(' · ')}</p>
  }

  function renderMonth(item: MonthCoverage) {
    const month = item.month
    const accounts = data.accounts.filter(a => a.month === month)
    const shown = accounts.filter(a => !still(a))
    const quiet = accounts.filter(still)
    const sources = data.sources.filter(s => s.month === month)
    const loans = (snapshot?.cashflow?.rows ?? []).filter(r => r.loan && r.month === month)
    // null — a payment has no rate
    const loanTotal = monthTotals(loans, month)?.expense ?? null
    return <>
      {item.status !== 'notClosed' && head(month)}
      {item.status === 'notClosed' && <p className="note month-ledger__notice">{t('data.accounts.notClosed')}{' '}<Link className="link-accent" to="/close">{t(`modules.cashflow.flows.coverage.${(wizard.data?.month ?? wizard.data?.queue?.[0]) === item.month ? 'fill' : 'close'}`)}</Link></p>}
      {(item.status === 'noRecords' || item.status === 'missingTotals') && <p className="note month-ledger__notice">{t('modules.cashflow.flows.coverage.noRecordsNote')}{' '}<Link className="link-accent" to="/accounts">{t('modules.cashflow.flows.coverage.accounts')}</Link></p>}
      {item.selectable && (
        <div className="admin-table-wrap">
          <div className="admin-table-scroll">
            <table className="admin-table admin-table--fit spending-table spending-table--3 breakdown-table" aria-label={t(`${P}.title`)}>
              <caption className="sr-only">{month && fmtMonth(month)}</caption>
              <thead>
                <tr>
                  <th>{t(`${P}.account`)}</th><th className="td-num">{t(`${P}.income`)}</th><th className="td-num">{t(`${P}.expenses`)}</th>
                  {canEdit && actions}
                </tr>
              </thead>
              <tbody>
                {shown.map(a => (
                  <Fragment key={`a|${keyOf(a)}`}>
                    <tr className={editing === keyOf(a) ? 'breakdown-table__open' : undefined}>
                      <td className="td-wrap" data-label={t(`${P}.account`)}>
                        <span className="breakdown-account">
                          {a.member ? <OwnerAvatar member={a.member} members={[...(snapshot?.members ?? [])]} /> : <span className="lane__avatar" aria-hidden="true" />}
                          <span><strong className="record-identity__name">{a.bank}</strong>{' '}
                          <span className="record-identity__meta">{[a.member, a.currency].filter(Boolean).join(' · ')}</span>
                          {a.orphaned && <span className="close-table__meta">{t(`${P}.orphaned`)}</span>}</span>
                        </span>
                      </td>
                      <td className="td-num" data-label={t(`${P}.income`)}>{a.orphaned ? '—' : cell(a, INCOME)}</td>
                      <td className="td-num" data-label={t(`${P}.expenses`)}>{a.orphaned ? '—' : cell(a, EXPENSE)}</td>
                      {canEdit && (
                        <td className="td-actions">
                          {!a.orphaned && editing !== keyOf(a) && <button type="button" className="btn btn--ghost" aria-label={`${t(`${P}.breakDown`)}: ${label(a)}`} onClick={() => setEditing(keyOf(a))}>{t(`${P}.breakDown`)}</button>}
                          {(a.orphaned || a.items.length > 0) && <RowMenu label={label(a)} items={a.orphaned
                            ? [{ label: t(`${P}.delete`), danger: true, onSelect: () => void clearLines(a, true) }]
                            : [{ label: t(`${P}.clear`), danger: true, onSelect: () => void clearLines(a, false) }]} />}
                        </td>
                      )}
                    </tr>
                    {canEdit && editing === keyOf(a) && (
                      <tr className="breakdown-table__editor"><td colSpan={columns}>
                        <InlineEditor account={a} categories={categories} onCancel={() => setEditing(null)}
                          onSave={async (items, base) => { const done = await saveAccount(a.month, a, items, base, t('modules.cashflow.allocation.saved')); if (done) setEditing(null); return done }} />
                      </td></tr>
                    )}
                  </Fragment>
                ))}
                {loans.length > 0 && (
                  <tr>
                    <td className="td-wrap" data-label={t(`${P}.account`)}><strong className="record-identity__name">{t('modules.cashflow.spending.loanPayments')}</strong>{' '}<span className="record-identity__meta">{loans.map(r => r.bank).join(', ')}</span></td>
                    <td className="td-num" data-label={t(`${P}.income`)}>—</td>
                    <td className="td-num" data-label={t(`${P}.expenses`)}><div className="allocation-meter"><div className="allocation-meter__amount"><strong>{loanTotal === null ? '—' : fmt(loanTotal)}</strong></div><p className="note note--help">{t(`${P}.loansAuto`)}</p></div></td>
                    {canEdit && <td className="td-actions" />}
                  </tr>
                )}
                {sources.map(s => (
                  <tr key={`s|${month}|${s.source}`}>
                    <td className="td-wrap" data-label={t(`${P}.account`)}>
                      <strong className="record-identity__name">{s.source}</strong>
                      <span className="close-table__meta">{t(`${P}.otherSource`)}</span>
                    </td>
                    <td className="td-num" data-label={t(`${P}.income`)}>—</td>
                    <td className="td-num td-wrap" data-label={t(`${P}.expenses`)}>{s.totals.map(x => (hidden ? PRIVACY_MASK : `${fmtMoney(x.amount)} ${x.currency}`)).join(' · ')}</td>
                    {canEdit && (
                      <td className="td-actions">
                        <RowMenu label={`${s.source}, ${fmtMonth(s.month)}`} items={[
                          // a legacy statement source: the server refuses a save under that name, it can only be deleted
                          ...(s.source.startsWith(STATEMENT_SOURCE_PREFIX) ? [] : [{ label: t('data.common.edit'), onSelect: () => setSourceDialog({ edit: s }) }]),
                          { label: t('data.common.delete'), danger: true, onSelect: () => void deleteSource(s.month, s.source, s.items) },
                        ]} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {quiet.length > 0 && <p className="note">{t(`${P}.noMovement`, { month: fmtInMonth(month), names: quiet.map(a => a.bank).join(', ') })}</p>}
      {canEdit && ready && usable && <div className="form-actions"><button type="button" className="btn btn--quiet" onClick={() => setSourceDialog({ edit: null, month })}>{t(`${P}.addSource`)}</button></div>}
    </>
  }

  return (
    <SettingsSection title={t(`${P}.title`)} stacked>
      <p className="note month-ledger__help">{t(`${P}.text`)}</p>
      {coverage.length === 0 && canEdit && ready && usable && <div className="form-actions"><button type="button" className="btn btn--quiet" onClick={() => setSourceDialog({ edit: null })}>{t(`${P}.addSource`)}</button></div>}
      {coverage.length > 0 ? <MonthOverview items={coverage} selected={month} onSelect={m => { setEditing(null); setSelectedMonth(m) }} share={share}>{renderMonth}</MonthOverview> : <p className="note"><Trans i18nKey={`${P}.noMonths`} components={{ close: <Link to="/close" className="link-accent" /> }} /></p>}
      {!hasLines && data.accounts.length > 0 && <p className="note">{t(`${P}.empty`)}</p>}
      {canEdit && ready && !usable && <p className="note">{t('modules.cashflow.spending.months.needCategories')}</p>}

      {canEdit && sourceDialog && (
        <SourceDialog ready={ready} categories={expenseCategories} currencies={lists.currencies} currency={lists.familyCurrency} entries={data.sources}
          edit={sourceDialog.edit} month={sourceDialog.month} onSave={saveSource} onCancel={() => setSourceDialog(null)} />
      )}
    </SettingsSection>
  )
}

/**
 * The editor in place under its account's row, with an explicit Save: the account's two directions side by side, the
 * remainders updating as one types, the lines replaced as a whole on Save. Enter saves, Escape cancels (asking first
 * when something was typed); a refused save (409 row_changed) keeps it open with what was typed.
 */
function InlineEditor({ account, categories, onSave, onCancel }: {
  account: Account
  categories: SpendingCategory[]
  /** `base` — the lines as they were when the editor opened: lines saved meanwhile elsewhere make the server refuse (409) */
  onSave: (items: AllocationItem[], base: AllocationItem[]) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  // the lines the edit starts from, fixed when the editor opens: a refetch with another device's lines does not move them
  const [base] = useState(account.items)
  const [allocated] = useState(account.allocated)
  const [edit, setEdit] = useState<{ items: AllocationItem[]; invalid: boolean }>({ items: base, invalid: false })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const { confirmDiscard } = useUnsavedChanges(dirty && !busy)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (edit.invalid) { toast.error(t('data.common.saveFailed'), t('data.common.notNumber')); return }
    setBusy(true)
    const done = await onSave(edit.items, base)
    setBusy(false)
    if (done) setDirty(false)
  }
  async function cancel() {
    if (dirty && !(await confirmDiscard())) return
    onCancel()
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    void cancel()
  }
  return (
    <form className="breakdown-editor" onSubmit={e => void submit(e)} onKeyDown={onKeyDown} aria-label={t(`${P}.breakDownTitle`, { name: accountName(account), month: fmtMonth(account.month) })}>
      <AllocationEditor account={accountName(account)} categories={categories} totals={account.totals} items={base} allocated={allocated}
        mode="explicit" onChange={(items, invalid) => { setDirty(true); setEdit({ items, invalid }) }} />
      <div className="breakdown-editor__foot">
        <p className="note">{t(`${P}.editorNote`)}</p>
        <button type="button" className="btn btn--quiet" onClick={() => void cancel()}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn--primary" disabled={busy}>{t('data.common.save')}</button>
      </div>
    </form>
  )
}
