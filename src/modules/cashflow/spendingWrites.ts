// The Breakdown screen's data: the one query ['admin', 'spending'] (GET /api/spending) and its writes, shared with
// Settings → General, which shows the manual amount block (ManualAmount.tsx) over the same query and writes.
import { useTranslation } from 'react-i18next'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SpendingRecords } from '../../domain/api'
import type { CategoryFlow, SpendingCategory } from '../../domain/types'
import { textInEveryLanguage } from '../../i18n/client'
import { apiFetch, apiSend } from '../../lib/api'
import { useFamilySettings } from '../../lib/familySettings'
import { fmtMoney } from '../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { refreshSnapshot } from '../../lib/useFinanceData'
import { useSingleFlight } from '../../pages/admin/useSingleFlight'
import { ADMIN_QUERY, useAdminWrite } from '../../pages/admin/adminQuery'
import { useAdminRows } from '../../pages/admin/useAdminRows'

const P = 'modules.cashflow.spending'

export const SPENDING_BASE = '/api/spending'
/** The Breakdown screen's one query: the categories, the accounts' lines, the free sources and the manual amount */
export const spendingQuery = queryOptions({ queryKey: ['admin', 'spending'], queryFn: () => apiFetch<SpendingRecords>(SPENDING_BASE), ...ADMIN_QUERY })

/**
 * A spending write: the notification, the spending query read again, and on success the snapshot too (the health score and
 * the cash flow depend on these tables). Resolves to true when it succeeded.
 */
export function useSpendingWrite() {
  const queryClient = useQueryClient()
  const write = useAdminWrite([spendingQuery.queryKey])
  return async (request: () => Promise<unknown>, ok: string | [string, string], fail: string, handled?: (e: unknown) => boolean): Promise<boolean> => {
    const done = await write(request, ok, fail, handled)
    if (done) void refreshSnapshot(queryClient)
    return done
  }
}

/** The title of a category: the reserved one has no name of its own to show (its stored name is a key) */
export function useCategoryTitle() {
  const { t } = useTranslation()
  return (c: SpendingCategory) => (c.kind === 'loan_payment' ? t(`${P}.loanPayments`) : c.name)
}

/** The standard categories (the names are the locale keys `spending.defaults.<key>`), in the order they are added */
interface Standard { key: string; flow: CategoryFlow; kind?: 'mandatory' | 'optional'; oneOff?: boolean }
const DEFAULTS: Standard[] = [
  ...['housing', 'utilities', 'groceries', 'transport', 'health', 'children', 'insurance'].map(key => ({ key, flow: 'expense' as const, kind: 'mandatory' as const })),
  ...['cafes', 'entertainment', 'shopping', 'travel', 'other'].map(key => ({ key, flow: 'expense' as const, kind: 'optional' as const })),
  // income: a salary and a business are active, a bonus is active and does not repeat; dividends, interest, rent and benefits (a pension too) are passive
  ...['salary', 'business'].map(key => ({ key, flow: 'active' as const })),
  { key: 'bonus', flow: 'active' as const, oneOff: true },
  ...['dividends', 'interest', 'rent', 'benefits'].map(key => ({ key, flow: 'passive' as const })),
]
/** The standard names in every language, in the order of DEFAULTS: a family may have added them in either */
const standardNamesQuery = queryOptions({
  queryKey: ['i18n', 'spendingDefaults'],
  queryFn: () => Promise.all(DEFAULTS.map(d => textInEveryLanguage(`${P}.defaults.${d.key}`))),
  staleTime: Infinity,
})

/**
 * "Add standard categories", shared by the Breakdown screen and the Close month wizard's breakdown: the standard ones the
 * family does not have yet (`missing`, by their name in any language) and the write that adds them.
 */
export function useStandardCategories(categories: SpendingCategory[]) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const send = useSpendingWrite()
  const title = useCategoryTitle()
  const standardNames = useQuery(standardNamesQuery).data
  const taken = new Set(categories.map(c => title(c).toLocaleLowerCase()))
  // a standard category is there when its name in any language is (until the other locales load, the UI language's name)
  const missing = DEFAULTS.map((d, i) => ({ ...d, name: t(`${P}.defaults.${d.key}`), names: standardNames?.[i] }))
    .filter(d => !(d.names ?? [d.name]).some(n => taken.has(n.toLocaleLowerCase())))
  // one run at a time: a double click started two loops over the same list, the second failing on names the first added
  const [once, adding] = useSingleFlight()
  const addStandard = () => once(() => send(async () => {
    try {
      for (const { name, flow, kind, oneOff } of missing) {
        // an expense category has a kind, an income one a flow (and may not repeat); the server refuses the other combination
        await apiSend(`${SPENDING_BASE}/categories`, 'POST', flow === 'expense' ? { name, kind } : { name, flow, ...(oneOff ? { oneOff } : {}) })
      }
    } finally {
      // a failure midway leaves some categories added: read the list again, or a retry would offer them a second time
      await queryClient.invalidateQueries({ queryKey: spendingQuery.queryKey })
    }
  }, t(`${P}.categories.standardAdded`, { count: missing.length }), t('data.common.saveFailed')))
  return { missing, addStandard, adding }
}

/** ManualAmount's two writes: save the amount in a currency, clear it. */
export function useManualAmountWrites() {
  const { t } = useTranslation()
  const send = useSpendingWrite()
  return {
    onSave: (amount: number, currency: string) =>
      send(() => apiSend(`${SPENDING_BASE}/manual`, 'PUT', { amount, currency }), t(`${P}.manual.saved`), t('data.common.saveFailed')),
    onClear: () => send(() => apiSend(`${SPENDING_BASE}/manual`, 'DELETE'), t(`${P}.manual.cleared`), t('data.common.deleteFailed')),
  }
}

/**
 * What the spending forms pick from: the project's currencies, the family currency (the settings one while it is in the
 * project, else the first), `ready` once both are read, `money` (masked in privacy mode), and the queries for persistent read recovery.
 */
export function useSpendingLists() {
  const currencyRows = useAdminRows<{ code: string }>('currencies')
  const settings = useFamilySettings()
  const { hidden } = usePrivacy()
  const currencies = currencyRows.rows.map(r => r.code).sort()
  const familyCurrency = typeof settings.data?.currency === 'string' && currencies.includes(settings.data.currency) ? settings.data.currency : (currencies[0] ?? '')
  return {
    currencies,
    familyCurrency,
    ready: currencyRows.query.data !== undefined && settings.data !== undefined,
    money: (amount: number, currency: string) => (hidden ? PRIVACY_MASK : `${fmtMoney(amount)} ${currency}`),
    queries: [currencyRows.query, settings] as const,
  }
}
