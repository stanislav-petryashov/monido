
export type AccountClass = 'bank' | 'broker' | 'crypto' | 'other'
export const ACCOUNT_CLASSES: readonly AccountClass[] = ['bank', 'broker', 'crypto', 'other']
/** Investment accounts: Close month asks what was put in or taken out (account_transfers), for the account's return. */
export const RETURN_CLASSES: readonly AccountClass[] = ['broker', 'crypto']
export const tracksTransfers = (c: AccountClass): boolean => RETURN_CLASSES.includes(c)

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
  return matches.size === 1 ? [...matches][0] ?? null : null
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

// NFD splits a letter from its accent (the Russian yo becomes ye, é becomes e); accents, spaces and punctuation then go, word breaks stay as one space
const normalWords = (name: string) => name.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    // prev and row hold b.length + 1 entries, filled left to right: every index read here is set
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]!
}

/**
 * The existing names that look like `name` (in their order, once each). Compared after lower case and dropping accents,
 * spaces and punctuation: equal; one is whole words of the other (at least 3 characters); or a typo apart (both at least
 * 3 characters: 1 edit up to 6, else 2). Claude asks before adding a look-alike account or loan.
 */
export function similarNames(name: string, existing: readonly string[]): string[] {
  const words = normalWords(name)
  const joined = words.replaceAll(' ', '')
  if (!joined) return []
  return [...new Set(existing)].filter(other => {
    const otherWords = normalWords(other)
    const otherJoined = otherWords.replaceAll(' ', '')
    if (!otherJoined) return false
    if (joined === otherJoined) return true
    const [short, long] = joined.length <= otherJoined.length ? [words, otherWords] : [otherWords, words]
    const shortLength = Math.min(joined.length, otherJoined.length)
    if (shortLength < 3) return false
    return ` ${long} `.includes(` ${short} `) || editDistance(joined, otherJoined) <= (shortLength <= 6 ? 1 : 2)
  })
}
