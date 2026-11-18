import { Fragment, useCallback, useId, useState, type FocusEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { IconCheck } from '@tabler/icons-react'
import { accountKey, tracksTransfers, type AccountKey } from '../../domain/accounts'
import { monthOf, shiftMonth } from '../../domain/dates'
import { balanceCheck, draftTotals, type DraftRow } from '../../domain/monthClose'
import { currentLanguage } from '../../i18n/client'
import { problemText } from '../../i18n/core'
import { classLabel, fmtCurrencyCents, fmtDay, fmtInMonth, fmtMoney, fmtMonth, fmtNum } from '../../lib/formatters'
import { useConfirm, useToast } from '../../lib/notifyState'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useCan } from '../../lib/rights'
import { PHONE, useMedia } from '../../lib/media'
import { useSnapshot } from '../../lib/useFinanceData'
import { Link } from '../../components/ui/Link'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { AllocationEditor } from '../../modules/cashflow/AllocationEditor'
import { useAllocations } from '../../modules/cashflow/useAllocations'
import { AccountForm, type AccountFormValues } from './AccountForm'
import { LoadingScreen } from './ui/LoadingScreen'
import { RowMenu } from './ui/RowMenu'
import { amountText, compactHint, parseAmount } from './amount'
import { NumberInput } from './ui/NumberInput'
import { draftAccountOrError, loanFieldId, useMonthClose } from './useMonthClose'
import { Disclosure } from '../../components/ui/Disclosure'
import { Chip } from '../../components/ui/Chip'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { CloseProgress } from './CloseProgress'
import { useMonthCloseAnnouncement } from './useMonthCloseAnnouncement'
import { closeColumns, loanInputId, rowFilled, rowInputId, rowLabel } from './closeRows'

/** A flow above zero: there is something to break down by category */
const hasFlow = (r: DraftRow) => [r.active, r.passive, r.expense].some(v => (v ?? 0) > 0)
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Puts the cursor in a field and brings it to the middle of the screen, clear of the floating bar */
function jumpTo(id: string) {
  const field = document.getElementById(id)
  field?.focus({ preventScroll: true })
  field?.scrollIntoView?.({ block: 'center' })
}

/** One line of the obstacles card: its text, with the account's name as a link to the account's fields where there is one */
interface Obstacle { id: string; line: ReactNode }

const signed = (n: number) => (n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n))
const signedNum = (n: number) => (n > 0 ? `+${fmtNum(n, 2)}` : fmtNum(n, 2))

interface AmountProps {
  label: string
  /** The field's id: a row's first field is what the progress card's segment jumps to */
  id?: string
  value: number | null
  /** Negative where it is not allowed: the field is marked like an unreadable one */
  wrong: boolean
  /** A negative value is allowed (the balance): a mouse keeps the keyboard with a minus, a touchscreen gets the ± button */
  signed: boolean
  /** The account's currency: a large amount is repeated under the field in short */
  currency: string
  /** For the balance: last month's balance and that month — the difference and a likely typo are said under the field */
  previous?: { value: number; month: string }
  /** Shown in the empty field: last month's balance, masked in privacy mode */
  placeholder?: string
  /** The row is started and this field is still empty: "not filled" is said under it */
  missing?: boolean
  /** For a flow: last closed month's figure, said under the empty field; a steady one is offered by a button (flowHintsFor) */
  suggestion?: { value: number; month: string; steady: boolean }
  /** The list of what blocks closing: a marked field points at it, where its problem is said in words */
  problemsId: string
  onChange: (value: number | null, invalid: boolean) => void
}

/**
 * An amount field, a NumberInput (grouped as typed, two decimals, the ± on a touchscreen) without its own error line: the
 * problem is said in the list of what blocks closing. It keeps its own canonical text, so
 * "9500." does not lose its dot mid-typing, and takes a value from outside ("No activity", a server answer) unless it
 * equals what was typed. Under the balance: the difference from last month and, once the field is left, a warning when a
 * zero or the sign looks wrong (never a blocker); under a flow, or a balance with nothing to compare, a large amount in
 * short.
 */
function Amount({ id, label, value, wrong, signed, currency, previous, placeholder, missing = false, suggestion, problemsId, onChange }: AmountProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const warningId = useId()
  const missingId = useId()
  const [text, setText] = useState(amountText(value))
  const [seen, setSeen] = useState(value)
  // being typed: a warning waits until the field is left, so "4", "41", "412"… do not each cry "check the zeros"
  const [editing, setEditing] = useState(false)
  // the value came from outside — show it unless it equals what was typed
  if (value !== seen) {
    setSeen(value)
    if (parseAmount(text).value !== value) setText(amountText(value))
  }
  const typed = (next: string) => {
    setText(next)
    setEditing(true)
    const parsed = parseAmount(next)
    onChange(parsed.value, parsed.invalid)
  }
  const { value: amount, invalid } = parseAmount(text)
  const marked = wrong || invalid
  // text that is not a number is said in the list of what blocks closing, not as "not filled"
  const unfilled = missing && !invalid
  let line = compactHint(amount, currency, hidden)
  const offered = suggestion && amount === null && !invalid ? suggestion : undefined
  const offeredFigure = offered && (hidden ? PRIVACY_MASK : fmtNum(offered.value, 2))
  if (offered) line = t('data.close.lastFlow', { inMonth: fmtInMonth(offered.month), value: offeredFigure })
  // accepting a suggestion is typing it: the same draft edit, saved the same way
  const use = (v: number) => {
    setText(amountText(v))
    setSeen(v)
    onChange(v, false)
  }
  let warning: string | null = null
  if (previous && amount !== null) {
    const check = balanceCheck(amount, previous.value)
    const month = fmtInMonth(previous.month)
    line = hidden ? undefined : t('data.close.diff', { value: signedNum(check.diff) })
    if (!editing && check.warning === 'sign') warning = t('data.close.checkSign', { month })
    if (!editing && check.warning === 'magnitude') {
      const key = Math.abs(amount) > Math.abs(previous.value) ? 'data.close.checkMagnitude' : 'data.close.checkMagnitudeLess'
      warning = t(key, { count: check.times, times: fmtNum(check.times, 0), month })
    }
  }
  return (
    <>
      {/* the problem is said in the list of what blocks closing, not in a line under the field */}
      <NumberInput id={id} label={label} value={text} onChange={typed} decimals={2} signed={signed} guessThousands hint={line} placeholder={placeholder}
        invalid={marked} errorLine={false} onBlur={() => setEditing(false)}
        describedBy={[warning ? warningId : '', unfilled ? missingId : '', marked ? problemsId : ''].filter(Boolean).join(' ') || undefined} />
      {offered?.steady && (
        <div className="field__hint">
          <button type="button" className="link-button" aria-label={t('data.close.useValueFor', { value: offeredFigure, field: label })} onClick={() => use(offered.value)}>
            {t('data.close.useValue', { value: offeredFigure })}
          </button>
        </div>
      )}
      {unfilled && <div id={missingId} className="field__hint close-table__unfilled">{t('data.close.fieldMissing')}</div>}
      {warning && <div id={warningId} className="field__hint close-check">{warning}</div>}
    </>
  )
}

/** The month-close wizard: one finished month at a time, strictly in order. */
export function MonthCloseView() {
  const { t } = useTranslation()
  const problemsId = useId()
  const loansId = useId()
  const toast = useToast()
  const confirm = useConfirm()
  const m = useMonthClose()
  const canEdit = useCan('edit')
  const { hidden } = usePrivacy()
  const [adding, setAdding] = useState(false)
  const [accountDirty, setAccountDirty] = useState(false)
  const holdAccountInput = m.holdInput
  const onAccountDirty = useCallback((dirty: boolean) => {
    setAccountDirty(dirty)
    holdAccountInput('new-account', dirty)
  }, [holdAccountInput])
  const onAllocationPending = useCallback((pending: boolean) => {
    holdAccountInput('allocation-lines', pending)
  }, [holdAccountInput])
  const panelsId = useId()
  // the breakdown by category (the Cash flow module's lines): the draft is saved first, the lines are capped by it
  const alloc = useAllocations({
    month: m.state?.month ?? null,
    enabled: m.loaded && !!m.state?.flows && canEdit,
    beforeSave: m.saveIfDirty,
    onPendingChange: onAllocationPending,
  })
  const [reloadVersion, setReloadVersion] = useState(0)
  const terminalBusy = alloc.transitioning || m.closing || m.reopening
  const announcement = useMonthCloseAnnouncement({
    scope: m.state?.month ? `${m.state.month}:${reloadVersion}` : null,
    dirty: accountDirty || m.dirty || alloc.pending,
    busy: m.saving || alloc.saving,
    blocked: !m.loaded || !m.state || (m.flows && canEdit && !alloc.loaded) || !!m.saveError || !!alloc.failure || m.conflict || m.reloading || terminalBusy || m.unreadable.length > 0 || alloc.invalid.length > 0,
    completed: `${m.savedSequence}:${alloc.savedSequence}`,
    edited: `${m.editSequence}:${alloc.editSequence}`,
  })
  const { confirmDiscard } = useUnsavedChanges(terminalBusy || accountDirty || m.dirty || m.saving || m.unreadable.length > 0 || alloc.pending || alloc.invalid.length > 0)
  /** The account whose breakdown is open: one at a time */
  const [open, setOpen] = useState<AccountKey | null>(null)
  const excess = m.state?.flows ? alloc.excessOf(m.rows) : []
  // an account whose lines came to exceed a total opens its panel, where the fix is
  const offending = [...new Set(excess.map(e => accountKey(e.name, e.member)))]
  const [seenOffending, setSeenOffending] = useState<AccountKey[]>([])
  if (offending.join('\n') !== seenOffending.join('\n')) {
    setSeenOffending(offending)
    const fresh = offending.find(k => !seenOffending.includes(k))
    if (fresh && (open === null || !offending.includes(open))) setOpen(fresh)
  }
  const problems = m.problemsWith(excess)
  const obstaclesTitleId = useId()
  // the family in its own order (the snapshot's, as Overview tints it); the wizard's list is sorted by name
  const familyOrder = useSnapshot(s => s.members).data
  const narrow = useMedia('(max-width: 1199px)')
  const phone = useMedia(PHONE)

  if (!m.loaded || !m.state) return <LoadingScreen action={t('routes.close')} />
  const { state, rows } = m
  const loans = m.loanPayments
  const unreadableLoan = (name: string) => m.unreadable.includes(loanFieldId(name))
  // without the cash-flow module the wizard asks for the balance only
  const columns = closeColumns(m.flows)
  const month = state.month
  const repeated = (name: string) => rows.filter(r => r.name === name).length > 1
  const label = (r: DraftRow) => rowLabel(r, rows)
  const filledOf = (r: DraftRow) => rowFilled(r, columns)
  const named = (name: string, member: string) => (repeated(name) && member ? t('data.close.quotedMember', { name, member }) : t('data.close.quoted', { name }))
  // What blocks closing: unreadable fields (only the screen knows them) and the completeness rules
  const notFilled = rows.filter(r => !filledOf(r)).length
  /** The fields a row still lacks */
  const missingOf = (key: string) => problems.find(p => p.key === key && p.problem.code === 'missing')?.problem.fields ?? []
  // "not filled" under a field is only for a partly filled row (some fields have a value, some do not); an untouched row is counted in the progress card only
  const partlyMissingOf = (key: string) => {
    const missing = missingOf(key)
    return missing.length < columns.length ? missing : []
  }
  /** No field of the row has a value yet */
  const untouched = (key: string) => missingOf(key).length === columns.length
  // a field typed but unreadable makes the row started: its own "not a number" line names it
  const notStarted = rows.filter(r => untouched(accountKey(r.name, r.member)) && !m.unreadable.some(id => id.startsWith(`${accountKey(r.name, r.member)}|`)))
  /** An account's (or a loan's) name in an obstacle line: a link to its first field */
  const link = (name: string, target: string) => (
    <a href={`#${target}`} className="close-problems__link" onClick={e => { e.preventDefault(); jumpTo(target) }}>{name}</a>
  )
  const obstacles: Obstacle[] = [
    ...rows.flatMap(r => columns
      .filter(([field]) => m.unreadable.includes(`${accountKey(r.name, r.member)}|${field}`))
      .map(([field]) => ({
        id: `${accountKey(r.name, r.member)}|${field}`,
        line: <Trans i18nKey="data.close.notNumber" values={{ field: t(`monthClose.field.${field}`) }} components={{ account: link(named(r.name, r.member), rowInputId(accountKey(r.name, r.member))) }} />,
      }))),
    ...rows.filter(r => m.unreadable.includes(`${accountKey(r.name, r.member)}|deposited`)).map(r => ({
      id: `${accountKey(r.name, r.member)}|deposited`,
      line: <Trans i18nKey="data.close.notNumber" values={{ field: t('data.close.deposited') }} components={{ account: link(named(r.name, r.member), rowInputId(accountKey(r.name, r.member))) }} />,
    })),
    ...loans.filter(l => unreadableLoan(l.name)).map(l => ({
      id: loanFieldId(l.name),
      line: <Trans i18nKey="data.close.notNumber" values={{ field: t('monthClose.loans.amount') }} components={{ account: link(t('data.close.quoted', { name: l.name }), loanInputId(l.name)) }} />,
    })),
    ...alloc.invalid.map(a => ({
      id: `${accountKey(a.name, a.member)}|lines`,
      line: <Trans i18nKey="data.close.breakDownNotNumber" components={{ account: link(named(a.name, a.member), rowInputId(accountKey(a.name, a.member))) }} />,
    })),
    // an untouched account goes in the one "Not started" line below, a started one says what it still lacks
    ...problems.filter(p => !(p.problem.code === 'missing' && untouched(p.key)) && !(p.problem.code === 'loan_payment' && unreadableLoan(p.problem.name ?? ''))).map(p => {
      // privacy hides the amounts a problem names (lines over a total), as everywhere else on the screen
      const text = problemText(t, p.problem, hidden ? PRIVACY_MASK : undefined)
      return {
        id: `${p.key}|${text}`,
        line: p.name
          ? <Trans i18nKey="data.close.obstacleLine" values={{ text }} components={{ account: link(named(p.name, p.member), rowInputId(accountKey(p.name, p.member))) }} />
          : capital(text),
      }
    }),
    ...(notStarted.length > 0 ? [{
      id: 'not-started',
      line: <Trans i18nKey="data.close.notStarted" components={{ names: <>{notStarted.map((r, i) => {
        const key = accountKey(r.name, r.member)
        return <Fragment key={key}>{i > 0 && ', '}{link(label(r), rowInputId(key))}</Fragment>
      })}</> }} />,
    }] : []),
  ]

  async function close() {
    if (accountDirty && !(await confirmDiscard())) return
    const closed = await m.close(alloc.flush)
    if (closed) { setAdding(false); toast.success(t('data.close.closedToast', { month: capital(fmtMonth(closed)) })) }
  }

  async function reopen(target: string) {
    const title = fmtMonth(target)
    if (!(await confirm({
      title: t('data.close.reopenTitle', { month: title }),
      text: t(accountDirty || m.dirty || m.unreadable.length > 0 || alloc.pending || alloc.invalid.length > 0 ? 'common.unsaved.text' : 'data.close.reopenText'),
      confirmLabel: t('data.close.reopenConfirm'), tone: 'warning',
    }))) return
    if (await alloc.discardAfterTransition(async () => (await m.reopen(target)) ?? false)) {
      setAdding(false)
      setOpen(null)
      toast.success(t('data.close.reopenedToast', { month: capital(title) }))
    }
  }

  function addAccount(values: AccountFormValues): string | null {
    const added = draftAccountOrError(values, m.rows)
    if ('error' in added) return added.error
    // draftAccountOrError has already refused a duplicate; m.add keeps its own guard for its other caller (a suggested account)
    m.add(added.row)
    setAdding(false)
    return null
  }

  // The draft saves when focus leaves a field: start on the phone, finish on the computer.
  function onBlur(e: FocusEvent<HTMLFieldSetElement>) {
    if (!terminalBusy && canEdit && m.dirty && !m.saving && e.target instanceof HTMLInputElement) void m.save()
  }

  const blocked = obstacles.length > 0 || notFilled > 0 || m.conflict || m.reloading || alloc.transitioning
  const whyId = `${problemsId}-why`
  const showObstacles = canEdit && obstacles.length > 0 && rows.length > 0
  const reopenable = canEdit && state.lastClosed?.reopenable ? state.lastClosed.month : null

  /** An account's row of its member's table, and its breakdown panel when open */
  const accountRow = (r: DraftRow, index: number) => {
    const key = accountKey(r.name, r.member)
    const hint = state.hints[key]
    const flowHint = m.flows ? state.flowHints[key] : undefined
    // the steady figures of the fields still empty: the row menu fills them all at once
    const steady = (['active', 'passive', 'expense'] as const).flatMap(f => (flowHint?.[f]?.steady && r[f] === null ? [[f, flowHint[f].last] as const] : []))
    const previous = hint !== undefined && state.lastClosed ? { value: hint, month: state.lastClosed.month } : undefined
    const lastFigure = previous && (hidden ? PRIVACY_MASK : fmtNum(previous.value, 2))
    const kind = classLabel(r.class)
    const panelId = `${panelsId}-${index}`
    const breakable = m.flows && canEdit && alloc.loaded && (hasFlow(r) || alloc.hasLines(r.name, r.member))
    const expanded = breakable && open === key
    const missing = canEdit ? partlyMissingOf(key) : []
    const toggleBreakdown = () => setOpen(expanded ? null : key)
    // a filled row with no money moving says so in a grey chip, in place of the button that would set it
    const still = m.flows && filledOf(r) && r.active === 0 && r.passive === 0 && r.expense === 0
    return (
      <Fragment key={key}>
      <tr>
        <td>
          <span className="close-table__account">
            {filledOf(r) && <IconCheck className="close-table__filled" size={16} stroke={2} role="img" aria-label={t('data.close.rowFilled')} />}
            {r.name}
          </span>
          <span className="close-table__meta">
            {previous
              ? t('data.close.rowMeta', { currency: r.currency, kind, lastMonth: fmtInMonth(previous.month), value: lastFigure })
              : [r.currency, kind].filter(Boolean).join(' · ')}
          </span>
          {r.closing && <span className="close-table__meta">{t('data.close.closingNow')}</span>}
          {r.added && <span className="close-table__meta">{t('data.close.newAccount')}</span>}
          {((m.flows && r.class === 'broker') || (canEdit && tracksTransfers(r.class))) && (
            <Disclosure variant="inline" className="close-table__help" title={t('ux.details')}>
              {m.flows && r.class === 'broker' && <span className="close-table__meta">{t('data.close.brokerHint')}</span>}
              {canEdit && tracksTransfers(r.class) && <span className="close-table__meta">{t('data.close.depositedHint')}</span>}
            </Disclosure>
          )}
        </td>
        {columns.map(([field, titleKey], column) => (
          <td key={field} className={field === 'balance' ? 'td-num close-table__balance' : 'td-num'} data-label={t(titleKey)}>
            {canEdit ? (
              <Amount
                id={column === 0 ? rowInputId(key) : undefined} label={`${t(titleKey)}: ${label(r)}`} value={r[field]}
                wrong={field !== 'balance' && (r[field] ?? 0) < 0} signed={field === 'balance'} currency={r.currency} problemsId={problemsId}
                previous={field === 'balance' ? previous : undefined} placeholder={field === 'balance' ? lastFigure : undefined}
                missing={missing.includes(field)}
                suggestion={field !== 'balance' && flowHint?.[field] && state.lastClosed ? { ...flowHint[field], value: flowHint[field].last, month: state.lastClosed.month } : undefined}
                onChange={(v, invalid) => m.edit(key, field, v, invalid)}
              />
            ) : r[field] === null ? '—' : hidden ? PRIVACY_MASK : fmtNum(r[field], 2)}
            {field === 'balance' && canEdit && tracksTransfers(r.class) && (
              // an investment account: what was put in or taken out, for its return; never blocks closing
              <div className="close-table__deposit">
                <span className="close-table__meta">{t('data.close.deposited')}</span>
                <Amount label={`${t('data.close.deposited')}: ${label(r)}`} value={r.deposited ?? null} signed currency={r.currency} problemsId={problemsId}
                  wrong={false} onChange={(v, invalid) => m.edit(key, 'deposited', v, invalid)} />
              </div>
            )}
          </td>
        ))}
        <td className="td-actions">
          {canEdit && <div className="close-table__actions">
            {still ? <Chip>{t('data.close.noMovementChip')}</Chip> : m.flows && (
              <button type="button" className="btn btn--quiet" aria-label={t('data.close.noMovementFor', { account: label(r) })} onClick={() => m.noMovement(key)}>
                {t('data.close.noMovement')}
              </button>
            )}
            {breakable && (
              <button type="button" className="btn btn--quiet" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
                aria-label={t('data.close.breakDownFor', { account: label(r) })} onClick={toggleBreakdown}>
                {t('data.close.breakDown')}
              </button>
            )}
            {/* below 1200px the text actions hide (CSS) and the row menu offers them instead */}
            <RowMenu label={label(r)} items={[
              ...(narrow && m.flows && !still ? [{ label: t('data.close.noMovement'), onSelect: () => { if (!terminalBusy) m.noMovement(key) } }] : []),
              ...(narrow && breakable ? [{ label: t(expanded ? 'data.close.hideBreakDown' : 'data.close.breakDown'), onSelect: () => { if (!terminalBusy) toggleBreakdown() } }] : []),
              ...(steady.length ? [{ label: t('data.close.fillSteady', { count: steady.length }), onSelect: () => { if (!terminalBusy) for (const [f, v] of steady) m.edit(key, f, v, false) } }] : []),
              r.closing
                ? { label: t('data.close.keepAccount'), onSelect: () => { if (!terminalBusy) m.setClosing(key, false) } }
                : { label: t('data.close.accountClosing'), onSelect: () => { if (!terminalBusy) m.setClosing(key, true) } },
              // a removed new account takes its lines by category with it: left stored, they would close the month as orphans
              ...(r.added ? [{ label: t('data.close.remove'), onSelect: () => {
                if (terminalBusy) return
                if (alloc.hasLines(r.name, r.member)) { alloc.edit(r.name, r.member, [], false, []); void alloc.commit(r.name, r.member) }
                m.remove(key)
              }, danger: true }] : []),
            ]} />
          </div>}
        </td>
      </tr>
      {expanded && (
        <tr className="close-table__panel">
          <td colSpan={columns.length + 2}>
            <AllocationEditor
              key={alloc.panelKey(r.name, r.member)} id={panelId} account={label(r)} categories={alloc.categories} mode="autosave"
              totals={{ active: r.active, passive: r.passive, expense: r.expense }}
              items={alloc.linesOf(r.name, r.member)} usual={alloc.steadyOf(r.name, r.member)} typed={alloc.typedOf(r.name, r.member)} allocated={alloc.allocatedOf(r.name, r.member)}
              onChange={(items, invalid, typed, base) => alloc.edit(r.name, r.member, items, invalid, typed, base)}
              onCommit={() => void alloc.commit(r.name, r.member)}
              status={alloc.savingOf(r.name, r.member) ? 'saving' : null} error={alloc.errorOf(r.name, r.member)}
            />
          </td>
        </tr>
      )}
      </Fragment>
    )
  }

  // one table per member, in the rows' order; the tint is the member's place in the family, as on Overview
  const owners = [...new Set(rows.map(r => r.member))]
  const order = familyOrder ?? state.members
  const ownerHeadId = (o: number) => `${panelsId}-owner-${o}`

  const totals = state.totals.length > 0 && (
    <div className="close-bar__totals">
      {state.totals.map(total => (
        <div key={total.currency} className="close-bar__total">
          <span className="close-bar__currency">{total.currency}</span>
          <span className="num">{t(m.flows ? 'data.close.totalsFlows' : 'data.close.totals', { income: hidden ? PRIVACY_MASK : fmtMoney(total.income), expense: hidden ? PRIVACY_MASK : fmtMoney(total.expense), change: hidden ? PRIVACY_MASK : signed(total.balanceChange) })}</span>
        </div>
      ))}
    </div>
  )

  return (
    <>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    <fieldset key={reloadVersion} className="close-view" disabled={terminalBusy} onBlur={onBlur}>
      <ViewOnlyNote right="edit" />
      {m.closedResult && <div className="admin-panel">
        <h2 className="admin-panel__name">{t('data.close.closedToast', { month: capital(fmtMonth(m.closedResult.month)) })}</h2>
        {draftTotals(m.closedResult.rows, {}, m.closedResult.flows, m.closedResult.loans).map(({ currency, income, expense, balanceChange: balance }) => {
          const saved = m.closedResult!
          const money = (n: number) => hidden ? PRIVACY_MASK : fmtCurrencyCents(n, currency)
          return <div key={currency}>
            <p>{t('data.close.resultBalances', { currency })}: {money(balance)}</p>
            {saved.flows && <p>{t(income - expense < -0.005 ? 'data.close.resultOverspent' : 'data.close.resultFlow', { income: money(income), expense: money(expense), net: money(Math.abs(income - expense)) })}</p>}
          </div>
        })}
        <Link to={`/?month=${m.closedResult.month}`} className="btn btn--primary">{t('data.close.viewResults')}</Link>
      </div>}

      {/* the open months, and the undo of the last closed one as a button after them (the closed month is not a tab) */}
      {(state.queue.length > 0 || reopenable) && (
        <div className="close-head">
          {state.queue.length > 0 && (
            <ol className="close-queue" aria-label={t('data.close.queue')}>
              {state.queue.map((q, i) => (
                <li key={q} aria-current={i === 0 ? 'step' : undefined}>
                  <span className="close-queue__month">{fmtMonth(q)}</span>
                  {` · ${t(i === 0 ? 'data.close.closing' : 'data.close.waiting')}`}
                </li>
              ))}
            </ol>
          )}
          {reopenable && (
            <button className="btn btn--quiet close-head__reopen" disabled={alloc.transitioning || m.reopening || m.closing || m.conflict || m.reloading} aria-label={t('data.close.reopen', { month: fmtMonth(reopenable) })} onClick={() => reopen(reopenable)}>
              {t('data.close.reopen', { month: fmtMonth(reopenable) })}
            </button>
          )}
        </div>
      )}

      {!month && state.nextOpensOn && (
        <div className="admin-panel">
          <div className="admin-panel__name">{t('data.close.allClosed')}</div>
          <p className="close-note">
            {t('data.close.nextOne', { month: fmtMonth(shiftMonth(monthOf(state.nextOpensOn), -1)), day: fmtDay(state.nextOpensOn) })}
          </p>
        </div>
      )}

      {month && (
        <>
          <CloseProgress rows={rows} filledOf={filledOf} month={month} flows={m.flows} loans={loans.length > 0}
            onJump={canEdit ? key => jumpTo(rowInputId(key)) : undefined} />
          {state.strayRows > 0 && (
            <p className="close-note">
              {t('data.close.stray', { count: state.strayRows })}
            </p>
          )}

          {rows.length === 0 ? (
            <div className="admin-empty">{t('data.close.addFirst', { month: fmtMonth(month) })}</div>
          ) : (
            owners.map((member, o) => {
              const name = member || t('pages.netWorth.noMember')
              const headId = ownerHeadId(o)
              return (
                <section key={member} className="card card--p close-owner" aria-labelledby={owners.length > 1 ? headId : undefined}>
                  {owners.length > 1 && (
                    <div className="close-owner__head">
                      <OwnerAvatar member={member} members={order} name={name} />
                      <h2 id={headId} className="close-owner__name">{name}</h2>
                    </div>
                  )}
                  <div className="admin-table-scroll">
                    <table className="admin-table close-table">
                      <thead>
                        <tr>
                          <th>{t('data.close.account')}</th>
                          {columns.map(([, title]) => (
                            <th key={title} className="td-num">{t(title)}</th>
                          ))}
                          <th className="td-actions"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, index) => r.member === member && accountRow(r, index))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })
          )}

          {!canEdit ? null : adding ? (
            <AccountForm
              members={state.members} currencies={state.currencies}
              suggestions={[...new Set([...rows.map(r => r.name), ...state.suggested.map(a => a.name)])]}
              onAdd={addAccount} onCancel={() => setAdding(false)}
              onDirtyChange={onAccountDirty} beforeCancel={accountDirty ? confirmDiscard : undefined}
              busy={alloc.transitioning || m.closing || m.reopening}
            />
          ) : (
            <div className="admin-toolbar admin-toolbar--tight">
              <button className="btn btn--ghost" onClick={() => setAdding(true)}>{t('data.accounts.add')}</button>
            </div>
          )}

          {canEdit && state.suggested.length > 0 && (
            <div className="close-suggest">
              <span>{t('data.close.suggested')}</span>
              {state.suggested.filter(a => !rows.some(r => accountKey(r.name, r.member) === accountKey(a.name, a.member))).map(a => {
                const title = a.member ? `${a.name} · ${a.member}` : a.name
                return (
                  <button key={accountKey(a.name, a.member)} type="button" className="btn btn--ghost" aria-label={t('data.close.addSuggested', { name: title })}
                    onClick={() => m.add({ ...a, balance: null, active: null, passive: null, expense: null, closing: false, added: true })}>
                    + {title}
                  </button>
                )
              })}
            </div>
          )}

          {/* loans are not accounts: their card follows the accounts, their "+ Account" and suggestions; the same ruled table */}
          {m.flows && loans.length > 0 && (
            <section className="card card--p close-loans" aria-labelledby={loansId}>
              <h2 id={loansId} className="close-loans__title">{t('monthClose.loans.title')}</h2>
              <p className="close-note">{t('monthClose.loans.note')}</p>
              <div className="admin-table-scroll">
                <table className="admin-table close-table close-table--loans">
                  <thead>
                    <tr><th>{t('monthClose.loans.loan')}</th><td className="close-loan__sched" /><th className="td-num">{t('monthClose.loans.amount')}</th></tr>
                  </thead>
                  <tbody>
                    {loans.map(l => (
                      <tr key={l.name}>
                        <td>
                          <span className="close-table__account">{l.name}</span>
                          <span className="close-table__meta">{l.currency}</span>
                        </td>
                        <td className="close-loan__sched">{t('monthClose.loans.scheduled', { amount: hidden ? PRIVACY_MASK : fmtMoney(l.scheduled) })}</td>
                        <td className="td-num" data-label={t('monthClose.loans.amount')}>
                          {canEdit ? (
                            <Amount
                              id={loanInputId(l.name)} label={`${t('monthClose.loans.amount')}: ${l.name}`} value={l.amount}
                              wrong={l.amount === null || l.amount < 0} signed={false} currency={l.currency} problemsId={problemsId}
                              onChange={(v, invalid) => m.setLoanPayment(l.name, v, invalid)}
                            />
                          ) : l.amount === null ? '—' : hidden ? PRIVACY_MASK : fmtNum(l.amount, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {showObstacles && (
            <div id={problemsId} className="alert alert--warning close-problems">
              <h2 id={obstaclesTitleId} className="close-problems__title">{t('data.close.obstacles')}</h2>
              <ul aria-labelledby={obstaclesTitleId}>
                {obstacles.map(o => <li key={o.id}>{o.line}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {state.incomplete.length > 0 && (
        <Disclosure variant="inline" className="close-old" title={t('data.close.old')}>
          <ul>
            {state.incomplete.map(x => (
              <li key={x.month}>
                {t('data.close.oldMissing', { month: fmtMonth(x.month), count: x.missing })}
              </li>
            ))}
          </ul>
          <p>
            <Trans i18nKey="data.close.oldNote" components={{ accounts: <Link to="/accounts" className="link-accent" /> }} />
          </p>
        </Disclosure>
      )}

      {month && state.totals.length > 0 && <Disclosure className="close-mobile-summary" title={t('data.close.monthSummary')}>
        {totals}
      </Disclosure>}

      {/* one floating bar: how far the filling is, the month's totals, the save state and the two actions */}
      {month && (rows.length > 0 || state.totals.length > 0) && (
        <div className="close-bar" role="region" aria-label={t('data.close.totalsLabel')}>
          {rows.length > 0 && (
            <div className="close-bar__fig">
              <span className="close-bar__value">{t('data.close.filledFigure', { filled: fmtNum(rows.length - notFilled, 0), count: fmtNum(rows.length, 0) })}</span>
              <span className="close-bar__label">{t('data.close.filledLabel', { count: rows.length })}</span>
            </div>
          )}
          <div className="close-bar__body">
            {totals}
            {canEdit && (
              <p className="close-bar__status">
                {/* "Saved" only once both the draft and the breakdown's lines are through */}
                {m.saveError
                  ? <span className="close-foot__error" role="alert">{t('data.close.notSaved', { error: m.saveError })}</span>
                  : alloc.failure ? <span className="close-foot__error">{t('data.close.breakDownFailed', { error: alloc.failure })}</span>
                  : m.saving || alloc.saving ? t('data.close.saving')
                  : accountDirty || m.dirty || alloc.pending || m.unreadable.length > 0 ? t('data.close.unsaved')
                  : state.draftSavedAt ? t('data.close.savedAtAuto', { time: new Date(state.draftSavedAt).toLocaleTimeString(currentLanguage(), { hour: '2-digit', minute: '2-digit' }) })
                  : t('data.close.autosave')}
              </p>
            )}
            {canEdit && m.saveError && <p className="close-bar__note">{t('data.close.saveUncertain')}</p>}
            {/* the reason a blocked close is off, for a screen reader: the eye has the progress card and the obstacles */}
            {canEdit && blocked && <span id={whyId} className="sr-only">{t(notFilled > 0 ? 'data.close.cannotClose' : 'data.close.cannotCloseInvalid', { month: fmtMonth(month) })}</span>}
          </div>
          {canEdit && (
            <div className="close-bar__actions">
              {(m.saveError || alloc.pending || alloc.failure) && (
                <button className="btn btn--ghost close-bar__reload" disabled={m.saving || m.closing || m.reloading} onClick={async () => {
                  if (await m.reloadDiscardingEdits(alloc.prepareReload)) { setReloadVersion(v => v + 1); setOpen(null) }
                }}>{t('data.close.reloadDraft')}</button>
              )}
              {/* on a phone the save is a text button beside the figure: the bar keeps one filled button */}
              <button className={phone ? 'btn btn--quiet close-bar__save' : 'btn btn--ghost close-bar__save'} disabled={m.saving || m.conflict || m.reloading} onClick={() => void m.save()}>
                {m.saveError ? t('data.close.retry') : t('data.close.saveDraft')}
              </button>
              {/* blocked, the close stays focusable (aria-disabled) so its reason is read out; a press does nothing */}
              <button className="btn btn--primary close-bar__close" disabled={m.closing || m.reopening} aria-disabled={blocked || undefined}
                aria-describedby={blocked ? [whyId, showObstacles ? problemsId : ''].filter(Boolean).join(' ') : undefined}
                onClick={() => { if (!blocked) void close() }}>
                <span className="btn__well"><IconCheck size={16} stroke={2} aria-hidden="true" /></span>
                {t('data.close.closeMonth', { month: fmtMonth(month) })}
              </button>
            </div>
          )}
        </div>
      )}
    </fieldset>
    </>
  )
}
