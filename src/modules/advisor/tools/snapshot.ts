import { isoDate } from '../../../domain/dates'
import type { FinanceSnapshot, Rates } from '../../../domain/types'
import { ensureRates } from '../../../server/fx'
import { getSnapshot } from '../../../server/snapshot'
import type { ToolContext } from './registry'

/** The snapshot every tool weighs a family against: the family currency, today's rates (downloaded only when the request may). */
export function advisorSnapshot(ctx: ToolContext): Promise<FinanceSnapshot> {
  return getSnapshot(ctx.db, { now: ctx.now, download: ctx.download })
}

/** Today's rates for `currencies` (downloaded only when the request may); a currency with no stored rate is simply absent. */
export async function todayRates(ctx: ToolContext, currencies: string[]): Promise<Rates> {
  const today = isoDate(ctx.now)
  const fx = await ensureRates(ctx.db, [today], currencies, today, ctx.download ? fetch : null)
  return fx.lookup(today)
}
