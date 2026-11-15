// The Close month wizard's breakdown by category: every account's lines of the month being closed, edited in the row's
// panel (AllocationEditor) and saved by themselves, a pause after the last edit or when the panel is left.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountKey, type AccountKey } from '../../domain/accounts'
import type { SpendingRecords } from '../../domain/api'
import type { AllocationExcess, DraftRow } from '../../domain/monthClose'
import { allocatedByFlow, allocationExcess } from '../../domain/spending'
import type { CategoryFlow } from '../../domain/types'
import { ApiError, apiSend } from '../../lib/api'
import { errorText } from '../../lib/notifyState'
import { useLoadFailedToast } from '../../pages/admin/adminQuery'
import { useSingleFlight } from '../../pages/admin/useSingleFlight'
import type { AllocationItem, TypedLine } from './AllocationEditor'
import { SPENDING_BASE, spendingQuery } from './spendingWrites'

/** The pause after the last edit, after which an account's lines save themselves (the draft's own pause) */
const AUTOSAVE_MS = 800
const NONE: Record<CategoryFlow, number> = { active: 0, passive: 0, expense: 0 }
/** No lines: one array, so the panel does not take a new empty list on every render for an edit from outside */
const NO_LINES: AllocationItem[] = []

/** Lines edited here and not saved yet, of one account; `base` — the stored lines the edit started from */
interface Edit { name: string; member: string; items: AllocationItem[]; invalid: boolean; typed: TypedLine[]; base: AllocationItem[] }

/** The map without one account */
const without = <T,>(all: Record<AccountKey, T>, key: AccountKey): Record<AccountKey, T> => {
  const rest = { ...all }
  delete rest[key]
  return rest
}

/** A read whose answer is the records (a test or an old server may answer something else): the breakdown is then empty */
const isRecords = (data: unknown): data is SpendingRecords =>
  !!data && Array.isArray((data as SpendingRecords).categories) && Array.isArray((data as SpendingRecords).accounts)

interface Options {
  /** The month being closed; null — none */
  month: string | null
  /** Cash flow on and the person may edit: otherwise nothing is read */
  enabled: boolean
  /**
   * Runs before lines are sent: the server caps them by the saved draft, so a total typed and not saved yet goes
   * first. false — the draft could not be saved, the lines wait.
   */
  beforeSave: () => Promise<boolean>
  /** Acquire the parent's month hold in the edit event, before any refetch can replace its queue. */
  onPendingChange?: (pending: boolean) => void
}

export function useAllocations({ month, enabled, beforeSave, onPendingChange }: Options) {
  const queryClient = useQueryClient()
  // Claude may file a statement's lines while the wizard is open: they appear on coming back to the tab
  const query = useQuery({ ...spendingQuery, enabled, refetchOnWindowFocus: true })
  useLoadFailedToast(query)
  const [base, setBase] = useState<SpendingRecords | null>(null)
  const records = base ?? (isRecords(query.data) ? query.data : null)
  const categories = records?.categories ?? []
  const [edited, setEdited] = useState<Record<AccountKey, Edit>>({})
  const [savedSequence, setSavedSequence] = useState(0)
  const [editSequence, setEditSequence] = useState(0)
  const currentMonth = useRef(month)
  currentMonth.current = month
  const [saving, setSaving] = useState<AccountKey[]>([])
  const [errors, setErrors] = useState<Record<AccountKey, string>>({})
  /** Saves refused because the lines changed elsewhere, per account: the panel's key, so it opens again on the stored lines */
  const [conflicts, setConflicts] = useState<Record<AccountKey, number>>({})
  /** Edits per account: an answer to an older save does not clear what was typed while it was in flight */
  const versions = useRef<Record<AccountKey, number>>({})
  const generation = useRef(0)
  const [runTransition, transitioning, isTransitioning] = useSingleFlight()
  const latest = useRef({ edited, beforeSave, records })
  useEffect(() => { latest.current = { edited, beforeSave, records } })
  useEffect(() => () => { onPendingChange?.(false) }, [onPendingChange])

  // another month: nothing typed for the one before stays
  const [seenMonth, setSeenMonth] = useState(month)
  if (month !== seenMonth) {
    setSeenMonth(month)
    setEdited({})
    setErrors({})
  }

  const stored = (name: string, member: string) => records?.accounts.find(a => a.month === month && a.bank === name && a.member === member)
  const linesOf = (name: string, member: string): AllocationItem[] => edited[accountKey(name, member)]?.items ?? stored(name, member)?.items ?? NO_LINES

  const put = useMutation({
    mutationFn: ({ name, member, items, base }: Edit) =>
      apiSend<SpendingRecords>(`${SPENDING_BASE}/months/${month}/account`, 'PUT', { bank: name, member, items, base }),
    onSuccess: next => {
      // A recovery awaiting this write can resume before React runs the cache/state synchronization effect.
      latest.current.records = next
      queryClient.setQueryData(spendingQuery.queryKey, next)
      setBase(current => current ? next : null)
    },
  })

  const inFlight = useRef<Partial<Record<AccountKey, Promise<boolean>>>>({})
  /** A per-account drain waits for newer edits instead of letting old responses finish a flush early. */
  function save(key: AccountKey): Promise<boolean> {
    const pending = inFlight.current[key]
    if (pending) return pending
    if (isTransitioning()) return Promise.resolve(false)
    const drain = async () => {
      setSaving(list => [...new Set([...list, key])])
      try {
        while (true) {
          const entry = latest.current.edited[key]
          if (!entry || !month) return true
          if (entry.invalid) return false
          const sent = versions.current[key]
          if (!(await latest.current.beforeSave())) return false
          await put.mutateAsync(entry)
          setErrors(all => without(all, key))
          if (versions.current[key] === sent) {
            latest.current.edited = without(latest.current.edited, key)
            setEdited(all => without(all, key))
            if (currentMonth.current === month && !isTransitioning()) setSavedSequence(n => n + 1)
            return true
          }
          // typed on while it was saving: the next save starts from what this one stored
          const rebase = (all: Record<AccountKey, Edit>) => (all[key] ? { ...all, [key]: { ...all[key], base: entry.items } } : all)
          latest.current.edited = rebase(latest.current.edited)
          setEdited(rebase)
        }
      } catch (e) {
        setErrors(all => ({ ...all, [key]: errorText(e) }))
        // the lines changed elsewhere (Claude, another device): the edit is dropped and the panel shows them, read again
        if (e instanceof ApiError && e.code === 'row_changed') {
          latest.current.edited = without(latest.current.edited, key)
          setEdited(all => without(all, key))
          setConflicts(all => ({ ...all, [key]: (all[key] ?? 0) + 1 }))
          void queryClient.invalidateQueries({ queryKey: spendingQuery.queryKey })
        }
        return false
      } finally {
        setSaving(list => list.filter(k => k !== key))
      }
    }
    const promise = drain().finally(() => {
      delete inFlight.current[key]
      onPendingChange?.(Object.keys(latest.current.edited).length > 0 || Object.keys(inFlight.current).length > 0)
    })
    inFlight.current[key] = promise
    return promise
  }

  // the pause after the last edit; an account whose save failed waits for the next edit or the leaving of its panel
  const onIdle = useEffectEvent(() => {
    for (const key of Object.keys(edited)) {
      if (!saving.includes(key) && !errors[key] && !edited[key].invalid) void save(key)
    }
  })
  useEffect(() => {
    if (transitioning || Object.keys(edited).length === 0) return
    const timer = setTimeout(onIdle, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [edited, transitioning])

  return {
    transitioning, savedSequence, editSequence,
    /** A confirmed month transition waits for old writes; only its success discards input and releases this owner. */
    async discardAfterTransition(transition: () => Promise<boolean>): Promise<boolean> {
      return (await runTransition(async () => {
        const sent = generation.current
        await Promise.all(Object.values(inFlight.current).filter((pending): pending is Promise<boolean> => pending !== undefined))
        if (generation.current !== sent || !(await transition())) return false
        generation.current += 1
        latest.current.edited = {}
        setEdited({})
        setErrors({})
        setBase(null)
        onPendingChange?.(false)
        return true
      })) ?? false
    },
    /** Stage a fresh category read; only the coordinator's successful commit discards local lines. */
    async prepareReload(): Promise<(() => boolean) | null> {
      const sent = generation.current
      await Promise.all(Object.values(inFlight.current).filter((pending): pending is Promise<boolean> => pending !== undefined))
      if (generation.current !== sent) return null
      if (!enabled) return () => true
      setBase(latest.current.records)
      const fresh = await query.refetch()
      if (!fresh.isSuccess || !isRecords(fresh.data) || generation.current !== sent) return null
      return () => {
        if (generation.current !== sent) return false
        latest.current.edited = {}
        latest.current.records = fresh.data
        setEdited({})
        setErrors({})
        setBase(null)
        onPendingChange?.(Object.keys(inFlight.current).length > 0)
        return true
      }
    },
    loaded: !!records,
    saving: saving.length > 0,
    categories,
    linesOf,
    /** The lines' sum per flow: the server's for stored lines, summed here only for lines typed and not saved */
    allocatedOf(name: string, member: string): Record<CategoryFlow, number> {
      const edit = edited[accountKey(name, member)]
      return edit ? allocatedByFlow(edit.items, categories) : stored(name, member)?.allocated ?? NONE
    },
    /** The lines as typed while one is not a number: a panel opened again shows the field to fix; null — none such */
    typedOf: (name: string, member: string): TypedLine[] | null => {
      const edit = edited[accountKey(name, member)]
      return edit?.invalid ? edit.typed : null
    },
    /** The account has lines (stored or typed) */
    hasLines: (name: string, member: string) => linesOf(name, member).length > 0,
    /** The accounts whose lines exceed a total of the row, for the wizard's list of what blocks closing */
    excessOf: (rows: readonly DraftRow[]): AllocationExcess[] => rows.flatMap(r =>
      allocationExcess(linesOf(r.name, r.member), categories, { active: r.active, passive: r.passive, expense: r.expense })
        .map(e => ({ name: r.name, member: r.member, ...e }))),
    /** The accounts whose panel holds text that is not a number */
    invalid: Object.values(edited).filter(e => e.invalid).map(e => ({ name: e.name, member: e.member })),
    /** Something typed is not saved yet, or a save is in flight or failed */
    pending: Object.keys(edited).length > 0 || saving.length > 0,
    /** The first account's failed save, said in the wizard's bar (each panel says its own) */
    failure: Object.values(errors)[0] ?? null,
    savingOf: (name: string, member: string) => saving.includes(accountKey(name, member)),
    /** The panel's key: it changes when a save was refused because the lines changed elsewhere, so the panel drops its own */
    panelKey: (name: string, member: string) => `${accountKey(name, member)}#${conflicts[accountKey(name, member)] ?? 0}`,
    errorOf: (name: string, member: string): string | null => errors[accountKey(name, member)] ?? null,
    edit(name: string, member: string, items: AllocationItem[], invalid: boolean, typed: TypedLine[]) {
      if (isTransitioning()) return
      onPendingChange?.(true)
      const key = accountKey(name, member)
      generation.current += 1
      setEditSequence(n => n + 1)
      versions.current[key] = (versions.current[key] ?? 0) + 1
      const base = latest.current.edited[key]?.base ?? stored(name, member)?.items ?? NO_LINES
      const next = { ...latest.current.edited, [key]: { name, member, items, invalid, typed, base } }
      latest.current.edited = next
      setEdited(next)
      // an edit is a new try: the error of the last one goes
      setErrors(all => without(all, key))
    },
    /** The panel was left: its lines save at once */
    commit: (name: string, member: string) => save(accountKey(name, member)),
    /** Saves every account's lines not saved yet (before the month is closed); false — one did not save */
    async flush(): Promise<boolean> {
      do {
        const keys = [...new Set([...Object.keys(latest.current.edited), ...Object.keys(inFlight.current)])]
        const results = await Promise.all(keys.map(save))
        if (!results.every(Boolean)) return false
      } while (Object.keys(latest.current.edited).length > 0)
      return true
    },
  }
}
