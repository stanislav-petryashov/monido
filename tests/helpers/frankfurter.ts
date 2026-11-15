import { jsonResponse } from './http'
import { vi } from 'vitest'

/**
 * fetch() stub for Frankfurter's `/v2/rates?base=USD&date=…&quotes=…`: `published[date][currency]` is units per 1 USD.
 * A date answers with the requested currencies it has (an empty list when none); a currency in `unknown` makes the
 * whole request a 422, as the real API answers a code it does not know.
 */
export function fakeFrankfurter(published: Record<string, Record<string, number>>, unknown: string[] = []) {
  return vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input))
    const date = url.searchParams.get('date') ?? ''
    const quotes = (url.searchParams.get('quotes') ?? '').split(',').filter(Boolean)
    const refused = quotes.filter(q => unknown.includes(q))
    if (refused.length) return jsonResponse({ status: 422, message: `invalid currency: ${refused.join(',')}` }, 422)
    const day = published[date] ?? {}
    return jsonResponse(quotes.filter(q => q in day).map(quote => ({ date, base: 'USD', quote, rate: day[quote] })))
  })
}
