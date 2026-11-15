// What a loan may be secured by: a property of this module (registered in ../collateral.ts). Server only.
import type { Database } from '../../server/db'

/** Whether a property of this name exists (one of its valuation rows) */
export const propertyExists = async (db: Database, name: string): Promise<boolean> =>
  !!(await db.prepare('SELECT 1 FROM real_estate WHERE name = ? LIMIT 1').bind(name).first())
