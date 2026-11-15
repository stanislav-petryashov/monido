// What a loan may be secured by, by the module that keeps it (real estate: a property). Server only. Kept apart from
// SERVER_MODULES (./server.ts) as ./rowChecks.ts is: the loans row check calls it, and the server modules reach rows.ts.
import type { Database } from '../server/db'
import { propertyExists } from './real-estate/collateral'

const COLLATERAL: readonly ((db: Database, name: string) => Promise<boolean>)[] = [propertyExists]

/** Whether `name` is something a module lets a loan be secured by */
export async function collateralExists(db: Database, name: string): Promise<boolean> {
  for (const exists of COLLATERAL) if (await exists(db, name)) return true
  return false
}
