import { CLIENT_MODULES } from '../modules/client'

/** The records screen of each kind of asset or debt: accounts are the core's, the others come from a module. */
export function assetRecordPaths(): Partial<Record<'account' | 'realEstate' | 'loan', string>> {
  const paths: Partial<Record<'account' | 'realEstate' | 'loan', string>> = { account: '/accounts' }
  for (const m of CLIENT_MODULES) if (m.assetRecords) paths[m.assetRecords.kind] = m.assetRecords.path
  return paths
}
