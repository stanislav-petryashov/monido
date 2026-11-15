// Async read/validation preflight followed by a synchronous guarded SQLite commit.
import { DbReadConflict, type Database, type PreparedStatement } from './db'
import { InputError } from './http'

export interface MutationPlan<T> {
  statements: PreparedStatement[]
  result: T
}

/** Builders must not write: only internal read conflicts rerun their preflight, at most three times. */
export async function commitMutation<T>(db: Database, build: () => Promise<MutationPlan<T>>, conflictCode = 'data_conflict'): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = db.readToken()
    try {
      const plan = await build()
      await db.guardedBatch(token, plan.statements)
      return plan.result
    } catch (error) {
      if (!(error instanceof DbReadConflict)) throw error
    }
  }
  throw new InputError(conflictCode, 409)
}
