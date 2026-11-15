import type { AccountRef } from '../../../domain/accounts'

/** The list's groups, in this order: an account's type, crypto counted as other (as on the Assets page) */
export const LIST_TYPES = ['bank', 'broker', 'other'] as const
type ListType = typeof LIST_TYPES[number]
export const listType = (acc: AccountRef): ListType => (acc.class === 'crypto' ? 'other' : acc.class)

export interface ListAccount {
  key: string
  acc: AccountRef
  /** The balance of the last closed month in the account's currency, unmasked (the newest while the account has none there); undefined — none */
  balance?: number
  /** The month of `balance` when it is older than the last closed month (the account has none there); null — it is that month's */
  olderMonth: string | null
  /** The change over the last closed month in the account's currency; null — not known */
  change: number | null
  /** The balance of the last closed month in the snapshot's currency; null — none or no rate */
  valueBase: number | null
  /** The snapshot holds the account but has no rate for its currency */
  noRate: boolean
}

const byValue = (a: ListAccount, b: ListAccount) => (b.valueBase ?? 0) - (a.valueBase ?? 0)
/** The accounts as the list shows them: by type, largest first */
export const listOrder = (accounts: ListAccount[]): ListAccount[] =>
  LIST_TYPES.flatMap(type => accounts.filter(a => listType(a.acc) === type).sort(byValue))

/** The accounts' owners in the family's order, then strangers by name */
export const ownersOf = (accounts: ListAccount[], members: string[]): string[] =>
  [...new Set(accounts.map(a => a.acc.member))].sort((a, b) => members.indexOf(a) - members.indexOf(b) || a.localeCompare(b))
