import { ASSET_PERIODS } from '../../domain/types'
// The Income and expenses page's own state, kept in the address (`?p=quarter&m=2026-07&category=11`) so the title row's
// finding (rendered by the shell, outside the page) reads the same period, and a reload or a shared link keeps it.
import { setQueryParams, useQuerySearch } from '../../lib/queryAddress'
import { MONTH_RE } from '../../domain/dates'
import type { AssetPeriod } from '../../domain/types'


export interface PageState {
  kind: AssetPeriod
  /** The period's last month; null — the default, the last closed month */
  month: string | null
  /** The category opened under its row (its own screen on a phone); null — none */
  category: number | null
}

/** The state as the address holds it; anything malformed is the default */
export function readState(search: string): PageState {
  const q = new URLSearchParams(search)
  const kind = ASSET_PERIODS.find(p => p === q.get('p')) ?? 'month'
  const month = q.get('m') ?? ''
  const category = Number(q.get('category'))
  return { kind, month: MONTH_RE.test(month) ? month : null, category: Number.isSafeInteger(category) && category > 0 ? category : null }
}

/** The page state and its setter (a change replaces the address: the period is not a history step) */
export function usePageState(): [PageState, (change: Partial<PageState>) => void] {
  const search = useQuerySearch()
  const state = readState(search)
  const set = (change: Partial<PageState>) => {
    const next = { ...readState(window.location.search), ...change }
    setQueryParams({ p: next.kind === 'month' ? null : next.kind, m: next.month, category: next.category === null ? null : String(next.category) })
  }
  return [state, set]
}
