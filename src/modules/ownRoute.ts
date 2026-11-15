// Whether a write is a module's own compound write rather than the rows API. Server only.
import { AsyncLocalStorage } from 'node:async_hooks'

const ownRoute = new AsyncLocalStorage<true>()

/**
 * Runs a module's own compound write — a rename that moves every link to the old name in the same transaction. The row
 * checks (./rowChecks.ts) refuse such a rename through the rows API, which moves nothing; inside `run` isOwnRoute() is true.
 */
export const byOwnRoute = <T>(run: () => Promise<T>): Promise<T> => ownRoute.run(true, run)
export const isOwnRoute = (): boolean => ownRoute.getStore() === true
