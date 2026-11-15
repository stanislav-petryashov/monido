import { useAdminRows } from './useAdminRows'

/** The rows of the Parameters tables as the screens read them (`useAdminRows<...>`) */
export type Parameter = { key: string; value: number; rowid: number }
export type Currency = { code: string; rowid: number; inflation?: number }
export type Member = { name: string; rowid: number }

/** The options of a list, plus the current value when it is no longer in it (still shown, as one more option); an empty value adds nothing. */
export const withCurrent = (value: string, list: string[]): string[] => (value && !list.includes(value) ? [value, ...list] : list)

/** Reference lists for forms: currency codes and member names, alphabetically; `queries` expose persistent read recovery. */
export function useReferenceLists() {
  const currencies = useAdminRows<{ code: string }>('currencies')
  const members = useAdminRows<{ name: string }>('members')
  return {
    currencies: currencies.rows.map(r => r.code).sort(),
    members: members.rows.map(r => r.name).sort(),
    queries: [currencies.query, members.query],
    ready: currencies.query.data !== undefined && members.query.data !== undefined,
  }
}
