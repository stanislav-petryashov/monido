import { accountKey } from '../domain/accounts'
import type { assetRecordPaths } from './assetRecords'

type RecordPaths = ReturnType<typeof assetRecordPaths>

/**
 * Links to one record of a records screen: `/accounts#<encoded key>`. The hash is a selection key, not an element id:
 * the screen reads it once, when it opens, and selects that record.
 */

/** The address of a records screen with one record named in the hash. */
export function recordHref(path: string, key: string): string {
  return `${path}#${encodeURIComponent(key)}`
}

/** The record key the address names; null — none (or a malformed hash such as `#%`). */
export function recordFromHash(): string | null {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) || null
  } catch {
    return null
  }
}

/** Accounts need the owner in their identity; other records use their name. */
export function holdingHref(paths: RecordPaths, row: { kind: keyof RecordPaths; name: string; member: string }): string | null {
  const path = paths[row.kind]
  return path ? recordHref(path, row.kind === 'account' ? accountKey(row.name, row.member) : row.name) : null
}
