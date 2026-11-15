/** Which browser storage: `local` is per browser, `session` per tab */
type StorageKind = 'local' | 'session'

// the storage is looked up at the call, not at load: a test (or a privacy tool) may replace it
const storageOf = (kind: StorageKind): Storage => (kind === 'local' ? localStorage : sessionStorage)

/** The stored text; null when there is none, or when the storage is blocked (private mode). */
export function readItem(kind: StorageKind, key: string): string | null {
  try {
    return storageOf(kind).getItem(key)
  } catch {
    return null
  }
}

/** Stores the text, or forgets the key for `null`. A blocked storage is tolerated: the choice then lives until a reload. */
export function writeItem(kind: StorageKind, key: string, value: string | null): void {
  try {
    if (value === null) storageOf(kind).removeItem(key)
    else storageOf(kind).setItem(key, value)
  } catch {
    // storage is blocked
  }
}
