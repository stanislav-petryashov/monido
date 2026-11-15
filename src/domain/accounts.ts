
export type AccountClass = 'bank' | 'broker' | 'crypto' | 'other'
export const ACCOUNT_CLASSES: readonly AccountClass[] = ['bank', 'broker', 'crypto', 'other']

/** Maps stored assets.class values, including legacy ones, onto account types. */
export function normalizeClass(value: string): AccountClass {
  if ((ACCOUNT_CLASSES as readonly string[]).includes(value)) return value as AccountClass
  return value === 'investments' ? 'broker' : 'other'
}

/** An opaque account identity from the exact name/member tuple; no member is an empty string. */
export type AccountKey = string
export const accountKey = (name: string, member?: string | null): AccountKey => JSON.stringify([name, member ?? ''])

/** Current links win; an old pipe-joined link is usable only when it identifies one account. */
export function resolveAccountLink(key: string, accounts: readonly { name: string; member?: string | null }[]): AccountKey | null {
  if (accounts.some(a => accountKey(a.name, a.member) === key)) return key
  const matches = new Set(accounts.filter(a => `${a.name}|${a.member ?? ''}` === key).map(a => accountKey(a.name, a.member)))
  return matches.size === 1 ? [...matches][0] : null
}

export interface AccountBalanceRow { date: string; class: string; name: string; currency: string; member: string | null }
export interface AccountRef { bank: string; member: string; currency: string; class: AccountClass }

/** The latest row of each account (name + member), in the order accounts first appear. */
export function latestPerAccount<T extends { date: string; name: string; member: string | null }>(rows: T[]): T[] {
  const latest = new Map<AccountKey, T>()
  for (const row of rows) {
    const key = accountKey(row.name, row.member)
    const prev = latest.get(key)
    if (!prev || row.date >= prev.date) latest.set(key, row)
  }
  return [...latest.values()]
}

/** One entry per (name, member); currency and type come from the most recent row. */
export function listAccounts(rows: AccountBalanceRow[]): AccountRef[] {
  return latestPerAccount(rows)
    .map(r => ({ bank: r.name, member: r.member ?? '', currency: r.currency, class: normalizeClass(r.class) }))
    .sort((a, b) => a.member.localeCompare(b.member) || a.bank.localeCompare(b.bank))
}
