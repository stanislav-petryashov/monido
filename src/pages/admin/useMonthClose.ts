import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { accountKey, tracksTransfers, type AccountKey } from '../../domain/accounts'
import { newDraftAccount, problemsIn, typedLoanLines, type AccountInfo, type AllocationExcess, type DraftLoanPayment, type DraftRow, type MonthDraft, type NewAccountProblem } from '../../domain/monthClose'
import { t } from '../../i18n/client'
import { errorText, useConfirm, useToast } from '../../lib/notifyState'
import type { DraftRequest, DraftRevisionRequest, MonthCloseState } from '../../domain/api'
import { ApiError, apiSend } from '../../lib/api'
import { refreshSnapshot } from '../../lib/useFinanceData'
import { monthCloseQuery, useLoadFailedToast } from './adminQuery'
import { useSingleFlight } from './useSingleFlight'

/** The pause after the last edit, after which the draft saves itself */
const AUTOSAVE_MS = 800

export type NumberField = 'balance' | 'active' | 'passive' | 'expense'
const flowFields = ['active', 'passive', 'expense'] as const
const keyOf = (row: DraftRow): AccountKey => accountKey(row.name, row.member)

const send = (url: string, method: 'PUT' | 'POST', body?: DraftRequest | DraftRevisionRequest) => apiSend<MonthCloseState>(url, method, body)

/** PUT of a month's draft: the rows and the loan lines; the answer is the new queue (the setup's accounts step writes it too) */
export const saveDraftRequest = (month: string, rows: DraftRow[], loans: NonNullable<MonthDraft['loans']>, expectedRevision: string) =>
  send(`/api/month-close/${month}/draft`, 'PUT', { rows, loans, expectedRevision })

/**
 * A read still in flight (the re-read after a failed close) would land over a save adopted after it started: every write
 * cancels it first (`onMutate`), and its answer is dropped.
 */
export const cancelMonthCloseReads = (queryClient: QueryClient) => queryClient.cancelQueries({ queryKey: monthCloseQuery.queryKey })

/** The draft changed on the server since it was read (another tab or device): the screen stops writing until a reload */
export const isDraftConflict = (e: unknown) => e instanceof ApiError && (e.code === 'draft_conflict' || e.code === 'invalid_draft_revision')

/**
 * Sends the local edits until the generation sent is the newest (an edit made during a write is written too) or `stop`;
 * the last answer, null when a write failed (its error is the mutation's to report).
 */
export async function resendWhileEdited<T>(generation: () => number, send: (sent: number) => Promise<T>, stop: () => boolean): Promise<T | null> {
  let answer: T
  let sent: number
  do {
    sent = generation()
    try { answer = await send(sent) } catch { return null }
  } while (sent !== generation() && !stop())
  return answer
}

/** The id of a loan's amount among the unreadable fields */
export const loanFieldId = (name: string) => `loan:${name}|amount`

interface DraftSave {
  expectedRevision: string
  month: string
  rows: DraftRow[]
  loans: NonNullable<MonthDraft['loans']>
  /** How many edits had been made when it was sent */
  version: number
}

const PROBLEM_TEXT: Record<NewAccountProblem, string> = {
  nameRequired: 'data.close.nameRequired',
  currencyRequired: 'data.close.currencyRequired',
  duplicate: 'data.close.duplicate',
}

/**
 * AccountForm's values as a new draft row by the draft's rules (newDraftAccount), or the error text for the form: one rule for
 * Close month and the setup's accounts step.
 */
export function draftAccountOrError(values: AccountInfo, rows: DraftRow[]): { row: DraftRow } | { error: string } {
  const added = newDraftAccount(values, rows)
  return 'problem' in added ? { error: t(PROBLEM_TEXT[added.problem]) } : added
}

/**
 * The wizard's state: the queue comes from the server (the query ['admin', 'month-close']),
 * the month's rows stay local until saved to the draft.
 */
export function useMonthClose() {
  const toast = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const query = useQuery(monthCloseQuery)
  useLoadFailedToast(query)
  const [closedResult, setClosedResult] = useState<{ month: string; rows: DraftRow[]; loans: DraftLoanPayment[]; flows: boolean } | null>(null)
  const [base, setBase] = useState<MonthCloseState | null>(null)
  const state = base ?? query.data ?? null
  /** The month's rows as edited here since the server's state was last adopted; null — the server's rows */
  const [edited, setEdited] = useState<DraftRow[] | null>(null)
  const rows = edited ?? state?.rows ?? []
  /** Loan amounts typed here since the server's state was last adopted, by loan name; null — the server's lines */
  const [editedLoans, setEditedLoans] = useState<Record<string, number | null> | null>(null)
  const loanPayments: DraftLoanPayment[] = (state?.loanPayments ?? []).map(l => (editedLoans && l.name in editedLoans ? { ...l, amount: editedLoans[l.name] } : l))
  const dirty = edited !== null || editedLoans !== null
  const [unchanged, setUnchanged] = useState<ReadonlyMap<AccountKey, { month: string; balance: number; currency: string; flows: boolean }>>(new Map())
  const [savedSequence, setSavedSequence] = useState(0)
  const [editSequence, setEditSequence] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Fields holding text that is not a number: `${account key}|${field}` */
  const [unreadable, setUnreadable] = useState<string[]>([])
  /** Marks the field as holding text that is not a number, or clears the mark */
  const markUnreadable = (id: string, invalid: boolean) => setUnreadable(list => (invalid ? [...new Set([...list, id])] : list.filter(x => x !== id)))
  // How many times the rows were edited: a save response must not overwrite what was typed while it was in flight.
  const version = useRef(0)
  // Pin the revision of the displayed input while dirty, even if another query refreshes the cache.
  const editRevision = useRef<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const conflicted = useRef(false)
  const heldInput = useRef({ owners: new Set<string>(), generation: 0 })
  const latest = useRef({ state, rows, loanPayments, editedLoans, dirty })
  useEffect(() => { latest.current = { state, rows, loanPayments, editedLoans, dirty } })

  /** A state from the server becomes the screen's: its rows replace the edited ones */
  const adopt = (next: MonthCloseState, ownSave = false) => {
    if (!ownSave) setUnchanged(new Map())
    queryClient.setQueryData(monthCloseQuery.queryKey, next)
    setBase(heldInput.current.owners.size > 0 ? next : null)
    setEdited(null)
    setEditedLoans(null)
    latest.current = { state: next, rows: next.rows, loanPayments: next.loanPayments, editedLoans: null, dirty: false }
    setSaveError(null)
    editRevision.current = heldInput.current.owners.size > 0 ? next.draftRevision : null
    conflicted.current = false
    setConflict(false)
  }

  const cancelReads = () => cancelMonthCloseReads(queryClient)

  const draft = useMutation({
    onMutate: cancelReads,
    mutationFn: ({ month, rows, loans, expectedRevision }: DraftSave) => saveDraftRequest(month, rows, loans, expectedRevision),
    onSuccess: (next, { version: sent }) => {
      if (version.current === sent) return adopt(next, true)
      // Only this write's acknowledgment advances the base of newer local edits.
      queryClient.setQueryData(monthCloseQuery.queryKey, next)
      setBase(next)
      latest.current.state = next
      editRevision.current = next.draftRevision
      setSaveError(null)
    },
    onError: e => {
      if (isDraftConflict(e)) {
        conflicted.current = true
        setConflict(true)
        setBase(latest.current.state)
      }
      setSaveError(errorText(e) || t('data.close.noConnection'))
    },
  })
  const saving = draft.isPending
  /** Closing or reopening a month: the answer is the new queue */
  const decide = useMutation({
    onMutate: cancelReads,
    mutationFn: ({ month, action, expectedRevision }: { month: string; action: 'close' | 'reopen'; expectedRevision?: string }) => send(`/api/month-close/${month}/${action}`, 'POST', action === 'close' ? { expectedRevision: expectedRevision! } : undefined),
    // the queue changed: the snapshot's open months (the menu's badge) follow at once, not on leaving the page
    onSuccess: next => {
      adopt(next)
      void refreshSnapshot(queryClient)
    },
  })

  /** A failed close can refresh a clean queue; dirty input is never replaced implicitly. */
  async function reload() {
    if (latest.current.dirty || conflicted.current || heldInput.current.owners.size > 0) return
    const sent = version.current
    const heldGeneration = heldInput.current.generation
    // Recovery continues after a failed terminal response unlocks the screen; a read rejection stays local.
    const fresh = await query.refetch().catch(() => null)
    if (fresh?.isSuccess && version.current === sent && heldInput.current.generation === heldGeneration && heldInput.current.owners.size === 0 && !conflicted.current) adopt(fresh.data)
  }

  const [runReload, reloading, isReloading] = useSingleFlight()
  /** Confirm and stage required reads before replacing input; an optional coordinator commits related local edits. */
  async function reloadDiscardingEdits(prepare?: () => Promise<(() => boolean) | null>): Promise<boolean> {
    return (await runReload(async () => {
      if (!(await confirm({ title: t('data.close.reloadTitle'), text: t('data.close.reloadText'), confirmLabel: t('data.close.reloadConfirm'), tone: 'warning' }))) return false
      setBase(latest.current.state)
      const sent = version.current
      const heldGeneration = heldInput.current.generation
      // Capture numeric and child edit generations at confirmation; staged reads may not discard later input.
      const prepared = prepare ? prepare() : Promise.resolve(() => true)
      // The draft read follows pending writes, including a response lost after commit.
      await inFlight.current
      const [fresh, commit] = await Promise.all([query.refetch(), prepared])
      if (!fresh.isSuccess || !commit || version.current !== sent || heldInput.current.generation !== heldGeneration || !commit()) return false
      version.current += 1
      savedVersion.current = version.current
      setUnreadable([])
      adopt(fresh.data)
      return true
    })) ?? false
  }

  function pinBase() {
    const current = latest.current
    if (!current.dirty && current.state) setBase(current.state)
    editRevision.current ??= current.state?.draftRevision ?? null
  }
  /** Independent child editors pin their month/revision without marking unchanged numeric rows dirty. */
  const holdInput = useCallback((owner: string, held: boolean) => {
    const { owners } = heldInput.current
    const hadInput = owners.size > 0
    if (held || owners.has(owner)) heldInput.current.generation += 1
    if (held) owners.add(owner)
    else owners.delete(owner)
    if (owners.size > 0 && !hadInput) {
      setBase(current => current ?? latest.current.state)
      editRevision.current ??= latest.current.state?.draftRevision ?? null
    } else if (owners.size === 0 && !latest.current.dirty && !conflicted.current) {
      setBase(null)
      editRevision.current = null
    }
  }, [])
  function change(update: (rows: DraftRow[]) => DraftRow[]) {
    pinBase()
    version.current += 1
    setEditSequence(n => n + 1)
    const next = update(latest.current.rows)
    latest.current = { ...latest.current, rows: next, dirty: true }
    setEdited(next)
  }
  function forgetUnchanged(key: AccountKey) {
    setUnchanged(marks => {
      if (!marks.has(key)) return marks
      const next = new Map(marks)
      next.delete(key)
      return next
    })
  }
  function patch(key: AccountKey, part: Partial<DraftRow>) {
    forgetUnchanged(key)
    change(rs => rs.map(r => keyOf(r) === key ? { ...r, ...part } : r))
  }
  const invalidRow = (row: DraftRow) => unreadable.some(id => id.startsWith(keyOf(row) + '|'))
  function canMarkUnchanged(row: DraftRow) {
    return !!state?.month && !!state.lastClosed && Number.isFinite(state.hints[keyOf(row)]) && !row.added && !row.closing &&
      row.balance === null && flowFields.every(field => row[field] === null) && row.deposited == null && !invalidRow(row)
  }
  function canUndoUnchanged(row: DraftRow) {
    const mark = unchanged.get(keyOf(row))
    return !!mark && mark.month === state?.month && mark.currency === row.currency && mark.flows === state.flows &&
      row.balance === mark.balance && flowFields.every(field => row[field] === (mark.flows ? 0 : null)) &&
      (tracksTransfers(row.class) ? row.deposited === 0 : row.deposited == null) && !invalidRow(row)
  }
  function canFillEmptyFlows(row: DraftRow) {
    return !!state?.flows && flowFields.some(field => row[field] === null) && !invalidRow(row)
  }
  const currentRow = (key: AccountKey) => latest.current.rows.find(r => keyOf(r) === key)

  /** One drain owns all PUTs. Callers wait for the newest local generation, never overlap it. */
  const inFlight = useRef<Promise<MonthCloseState | null> | null>(null)
  const savedVersion = useRef<number | null>(null)
  const acknowledged = useRef<MonthCloseState | null>(null)
  function save(): Promise<MonthCloseState | null> {
    if (conflicted.current || isReloading() || !latest.current.state?.month) return Promise.resolve(null)
    if (inFlight.current) return inFlight.current
    const hadEdits = latest.current.dirty
    const startVersion = version.current
    const month = latest.current.state.month
    const drain = () => resendWhileEdited(() => version.current, async sent => {
      const current = latest.current
      const next = await draft.mutateAsync({
        month: current.state!.month!, rows: current.rows,
        loans: typedLoanLines(current.loanPayments, current.editedLoans),
        version: sent, expectedRevision: editRevision.current ?? current.state?.draftRevision ?? '',
      })
      acknowledged.current = next
      savedVersion.current = sent
      return next
    }, () => conflicted.current)
    const promise = drain().then(answer => {
      if (answer && (hadEdits || version.current !== startVersion) && savedVersion.current === version.current && latest.current.state?.month === month && !conflicted.current && !isReloading()) setSavedSequence(n => n + 1)
      return answer
    }).finally(() => { if (inFlight.current === promise) inFlight.current = null })
    inFlight.current = promise
    return promise
  }

  async function saveIfDirty(): Promise<boolean> {
    if (conflicted.current || isReloading()) return false
    if (inFlight.current) return (await inFlight.current) !== null
    if (savedVersion.current === version.current || !latest.current.dirty) return true
    return (await save()) !== null
  }

  // a double click would send a second save and close of a month the first one has closed: "Could not close the month"
  const [runClose, closing] = useSingleFlight()
  /** `beforeClose` runs once the draft is saved and before the month is closed (the breakdown's lines); false — not closed */
  const close = (beforeClose?: () => Promise<boolean>) => runClose(() => closeOnce(beforeClose))
  async function closeOnce(beforeClose?: () => Promise<boolean>) {
    if (!latest.current.state?.month || conflicted.current) return
    const month = latest.current.state.month
    const sent = latest.current.rows
    let saved = await save()
    if (!saved) return
    // The server closes the saved draft, not the screen. If it knows a different list of accounts
    // (an account was deleted or renamed in another tab), show that list instead of closing blindly.
    const keys = (list: DraftRow[]) => list.map(keyOf).sort().join('\n')
    if (keys(saved.rows) !== keys(sent)) {
      adopt(saved)
      toast.error(t('data.close.listChanged'), t('data.close.listChangedText'))
      return
    }
    // Repeat if totals changed while category lines were being saved, so both settle together.
    let settled: number
    do {
      settled = version.current
      if (beforeClose && !(await beforeClose())) {
        toast.error(t('data.close.closeFailed'), t('data.close.breakDownFailedText'))
        return
      }
      if (!(await saveIfDirty()) || conflicted.current) return
    } while (settled !== version.current)
    saved = acknowledged.current
    if (!saved || saved.month !== month) return
    try {
      await decide.mutateAsync({ month, action: 'close', expectedRevision: saved.draftRevision! })
      setClosedResult({ month, rows: saved.rows, loans: saved.loanPayments, flows: saved.flows })
      return month
    } catch (e) {
      toast.error(t('data.close.closeFailed'), e)
      if (isDraftConflict(e)) {
        conflicted.current = true
        setConflict(true)
        setBase(latest.current.state)
        setSaveError(errorText(e))
        return
      }
      // most often the month is already closed in another tab — show the queue as it is
      void reload()
    }
  }

  const [runReopen, reopening] = useSingleFlight()
  const reopen = (month: string) => runReopen(() => reopenOnce(month))
  async function reopenOnce(month: string) {
    if (conflicted.current) return false
    // A draft write started before the confirmation must settle before the month is reopened.
    if (inFlight.current) await inFlight.current
    if (conflicted.current) return false
    // the reopened month has its own figures: a "not a number" mark of the month left behind is not about them
    try { await decide.mutateAsync({ month, action: 'reopen' }); setClosedResult(null); setUnreadable([]); return true }
    catch (e) { toast.error(t('data.close.reopenFailed'), e); void reload(); return false }
  }

  // An edit made with a button ("No movements", close an account, a new account) does not move focus out of a field —
  // the draft saves itself after a pause following the last edit.
  const onIdle = useEffectEvent(() => { if (!saving && !closing && !reopening) void save() })
  useEffect(() => {
    // after an error it does not retry by itself, or it would hit the server every second; from there on it is "Retry" or leaving the field
    if (!dirty || saving || saveError || closing || reopening) return
    const timer = setTimeout(onIdle, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [dirty, edited, editedLoans, saving, saveError, closing, reopening])

  return {
    /** Takes a state the server returned elsewhere (the catch-up grid's close) as the screen's own */
    adopt,
    state, rows, closedResult, loanPayments, saving, saveError, savedSequence, editSequence, dirty, conflict, reloading, reopening,
    reloadDiscardingEdits,
    holdInput,
    saveIfDirty,
    /** "Close month" is under way: the button is off until it ends */
    closing,
    /** The screen's own read has finished: a state cached on an earlier visit is not shown for editing */
    loaded: query.isFetchedAfterMount,
    /** Until the state is loaded, flows count as enabled */
    flows: state?.flows ?? true,
    /** What blocks closing; `excess` — the accounts whose lines by category exceed a total (the breakdown's) */
    problemsWith: (excess: readonly AllocationExcess[] = []) => problemsIn(rows, state?.flows ?? true, loanPayments, excess),
    unreadable,
    /** invalid — the field holds text that is not a number: the value is not replaced by a guess, the field is marked */
    edit(key: AccountKey, field: NumberField | 'deposited', value: number | null, invalid = false) {
      const id = `${key}|${field}`
      markUnreadable(id, invalid)
      patch(key, { [field]: value })
    },
    /** invalid — the field holds text that is not a number; the amount stays empty and the field is marked */
    setLoanPayment(name: string, value: number | null, invalid = false) {
      const id = loanFieldId(name)
      markUnreadable(id, invalid)
      pinBase()
      version.current += 1
      setEditSequence(n => n + 1)
      const next = { ...latest.current.editedLoans, [name]: value }
      latest.current = { ...latest.current, editedLoans: next, loanPayments: latest.current.loanPayments.map(l => l.name === name ? { ...l, amount: value } : l), dirty: true }
      setEditedLoans(next)
    },
    canMarkUnchanged, canUndoUnchanged, canFillEmptyFlows,
    markUnchanged(key: AccountKey) {
      const row = currentRow(key)
      if (!row || !state?.month || !canMarkUnchanged(row)) return
      const balance = state.hints[key]
      const { flows, month } = state
      patch(key, {
        balance, ...(flows && { active: 0, passive: 0, expense: 0 }),
        ...(tracksTransfers(row.class) && { deposited: 0 }),
      })
      setUnchanged(marks => new Map(marks).set(key, { balance, currency: row.currency, month, flows }))
    },
    undoUnchanged(key: AccountKey) {
      const row = currentRow(key)
      if (!row || !canUndoUnchanged(row)) return
      patch(key, { balance: null, active: null, passive: null, expense: null, ...(tracksTransfers(row.class) && { deposited: null }) })
    },
    fillEmptyFlows(key: AccountKey) {
      const row = currentRow(key)
      if (!row || !canFillEmptyFlows(row)) return
      patch(key, { active: row.active ?? 0, passive: row.passive ?? 0, expense: row.expense ?? 0 })
    },
    setClosing: (key: AccountKey, closing: boolean) => patch(key, { closing }),
    remove(key: AccountKey) {
      forgetUnchanged(key)
      setUnreadable(list => list.filter(x => !x.startsWith(`${key}|`)))
      change(rs => rs.filter(r => keyOf(r) !== key))
    },
    /** false — this account is already in the month */
    add(row: DraftRow): boolean {
      if (rows.some(r => keyOf(r) === keyOf(row))) return false
      change(rs => [...rs, row])
      return true
    },
    save, close, reopen,
  }
}
