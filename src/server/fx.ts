// Exchange rates for the snapshot: downloads from Frankfurter cached in fx_rates, plus the family's manual rates
// (fx_manual_rates). Every rate is units of a currency per 1 USD; USD itself is never stored.
import type { Database } from './db'
import type { RateLookup, Rates, Warning } from '../domain/types'

/** Cap on rate requests for one snapshot; the rest is filled on later loads. */
const MAX_FETCHES = 20
const FETCH_TIMEOUT_MS = 3000
const DEFAULT_API_URL = 'https://api.frankfurter.dev'
/** After a failed download nothing is asked for this long: every snapshot would otherwise wait out the timeout again. */
const FAILURE_BACKOFF_MS = 5 * 60_000

/** One downloaded rate: `perUsd` units of `currency` per 1 USD, dated `sourceDate` by the source. */
interface DownloadedRate { currency: string; perUsd: number; sourceDate: string }

/** Requests left for this snapshot; `refused` collects the codes Frankfurter does not know, so they are not asked for again. */
interface FetchBudget { left: number; refused?: Set<string> }

/**
 * Kept until restart: codes Frankfurter refused, `${date}|${currency}` pairs a successful answer left out (neither is
 * asked again), today's rates Frankfurter dated earlier (not stored, so the day is asked again once it has passed) and
 * the time of the last failed download (`failedAt`, ms).
 */
const memory = { refused: new Set<string>(), leftOut: new Set<string>(), provisional: new Map<string, number>(), failedAt: -Infinity }

/** @public Test seam: forgets what `memory` holds. */
export const forgetFxMemory = () => {
  memory.refused.clear()
  memory.leftOut.clear()
  memory.provisional.clear()
  memory.failedAt = -Infinity
}

/** Frankfurter's address: FX_API_URL (a self-hosted instance) or the public API. */
const apiUrl = () => (process.env.FX_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, '')

const ratesUrl = (date: string, quotes: string[]) =>
  `${apiUrl()}/v2/rates?base=USD&date=${date}&quotes=${quotes.map(encodeURIComponent).join(',')}`

/** The codes of a 422 answer, `{ "message": "invalid currency: ABC,XYZ" }`; empty when the answer says something else. */
async function refusedCodes(res: Response): Promise<string[]> {
  const body = await res.json().catch(() => null) as { message?: unknown } | null
  const m = typeof body?.message === 'string' ? /invalid currency: (.+)$/.exec(body.message) : null
  return m ? m[1].split(',').map(c => c.trim()) : []
}

function parseRates(body: unknown, quotes: string[]): DownloadedRate[] {
  if (!Array.isArray(body)) throw new Error('unexpected answer')
  const rates = new Map<string, DownloadedRate>()
  for (const row of body as { date?: unknown; quote?: unknown; rate?: unknown }[]) {
    const { date, quote, rate } = row ?? {}
    if (typeof quote !== 'string' || !quotes.includes(quote) || typeof rate !== 'number' || !(rate > 0) || typeof date !== 'string') continue
    rates.set(quote, { currency: quote, perUsd: rate, sourceDate: date.slice(0, 10) })
  }
  return [...rates.values()]
}

/**
 * Frankfurter's rates of `currencies` against USD for `date`, in one request. Codes Frankfurter does not know are
 * dropped and the rest asked again; null when nothing came back. A network error or a bad answer ends fetching for
 * the whole snapshot (budget.left = 0): stored and fallback rates still serve lookups. A date Frankfurter lacks comes
 * back as an empty list, so a 404 means a wrong FX_API_URL and is a bad answer too.
 */
export async function fetchRates(
  date: string, currencies: string[], budget: FetchBudget, fetchImpl: typeof fetch = fetch,
): Promise<DownloadedRate[] | null> {
  let quotes = currencies.filter(c => c !== 'USD' && !budget.refused?.has(c))
  while (quotes.length && budget.left > 0) {
    budget.left--
    try {
      const res = await fetchImpl(ratesUrl(date, quotes), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (res.status === 422) {
        const refused = (await refusedCodes(res)).filter(c => quotes.includes(c))
        if (refused.length) {
          for (const c of refused) budget.refused?.add(c)
          quotes = quotes.filter(c => !refused.includes(c))
          continue
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseRates(await res.json(), quotes)
    } catch (error) {
      console.error('[fx] rate download failed', date, error)
      memory.failedAt = Date.now()
      budget.left = 0
      return null
    }
  }
  return null
}

interface FxContext {
  lookup: RateLookup
  /** Filled while `lookup` runs: read it after the snapshot is built. */
  warnings: Warning[]
}

/** Rates of one currency by day. */
type Series = Map<string, number>

async function readSeries(db: Database, table: 'fx_rates' | 'fx_manual_rates'): Promise<Map<string, Series>> {
  const { results } = await db.prepare(`SELECT currency, date, per_usd FROM ${table}`).all<{ currency: string; date: string; per_usd: number }>()
  const byCurrency = new Map<string, Series>()
  for (const r of results) addRate(byCurrency, String(r.currency), String(r.date).slice(0, 10), Number(r.per_usd))
  return byCurrency
}

const addRate = (to: Map<string, Series>, currency: string, date: string, perUsd: number) =>
  to.set(currency, (to.get(currency) ?? new Map<string, number>()).set(date, perUsd))

/** The latest of the sorted `days` on or before `date`. */
const onOrBefore = (days: string[], date: string) => days.filter(d => d <= date).at(-1)

/**
 * Downloads the rates the snapshot lacks and returns the lookup over everything known.
 * For each date (clamped to today), only the currencies other than USD that have neither a stored rate for that
 * date nor a manual rate on or before it are asked for. Lookup of (date, currency): the latest manual rate on or
 * before the date; else the stored rate of the date; else the nearest earlier, else the nearest later stored rate,
 * with an `fx_fallback` warning once the currency is read; else no key.
 * `fetchImpl` null is offline (the demo): no request at all, the lookup serves what the database holds. So is the
 * FAILURE_BACKOFF_MS after a failed download.
 */
export async function ensureRates(
  db: Database, dates: string[], currencies: string[], today: string, fetchImpl: typeof fetch | null = fetch,
): Promise<FxContext> {
  const clamp = (d: string) => (d > today ? today : d)
  const [stored, manual] = await Promise.all([readSeries(db, 'fx_rates'), readSeries(db, 'fx_manual_rates')])
  const days = (series: Map<string, Series>) => new Map([...series].map(([currency, rates]) => [currency, [...rates.keys()].sort()]))
  const manualDays = days(manual)
  /** A manual rate on or before `date` answers for the currency: no download needed. */
  const coveredByManual = (currency: string, date: string) => onOrBefore(manualDays.get(currency) ?? [], date) !== undefined
  const wanted = [...new Set(currencies)].filter(c => c !== 'USD')

  // Offline (null): nothing is downloaded, the lookup serves what the database holds.
  if (fetchImpl) {
    for (const [key, perUsd] of memory.provisional) {
      const [date, currency] = key.split('|')
      if (date === today && !stored.get(currency)?.has(date)) addRate(stored, currency, date, perUsd)
    }
    const budget: FetchBudget = { left: Date.now() - memory.failedAt < FAILURE_BACKOFF_MS ? 0 : MAX_FETCHES, refused: memory.refused }
    // Newest first: today's rate matters most (goals, the snapshot's currency).
    for (const date of [...new Set(dates.map(clamp))].sort().reverse()) {
      if (budget.left <= 0) break
      const missing = wanted.filter(c => !memory.refused.has(c) && !memory.leftOut.has(`${date}|${c}`)
        && !stored.get(c)?.has(date) && !coveredByManual(c, date))
      if (!missing.length) continue
      const rates = await fetchRates(date, missing, budget, fetchImpl)
      if (!rates) continue
      for (const c of missing) if (!memory.refused.has(c) && !rates.some(r => r.currency === c)) memory.leftOut.add(`${date}|${c}`)
      // Today's rate dated earlier (not yet published) would stand for that day forever once stored.
      const provisional = rates.filter(r => date === today && r.sourceDate < date)
      for (const r of provisional) memory.provisional.set(`${date}|${r.currency}`, r.perUsd)
      const final = rates.filter(r => !provisional.includes(r))
      if (final.length) {
        await db.batch(final.map(r => db.prepare('INSERT OR REPLACE INTO fx_rates (date, currency, per_usd, source_date) VALUES (?, ?, ?, ?)')
          .bind(date, r.currency, r.perUsd, r.sourceDate)))
      }
      for (const r of rates) addRate(stored, r.currency, date, r.perUsd)
    }
  }

  const storedDays = days(stored)
  /** The rate of `currency` on `date` and, when another day's download stands in for it, that day. */
  const resolve = (currency: string, date: string): { perUsd: number; used?: string } | undefined => {
    const manualDay = onOrBefore(manualDays.get(currency) ?? [], date)
    if (manualDay) return { perUsd: manual.get(currency)!.get(manualDay)! }
    const rates = stored.get(currency)
    const exact = rates?.get(date)
    if (exact !== undefined) return { perUsd: exact }
    const known = storedDays.get(currency) ?? []
    const used = onOrBefore(known, date) ?? known.find(d => d > date)
    return used === undefined ? undefined : { perUsd: rates!.get(used)!, used }
  }

  const warnings: Warning[] = []
  const currenciesKnown = [...new Set([...stored.keys(), ...manual.keys()])].filter(c => c !== 'USD')
  const cache = new Map<string, Rates>()
  const lookup: RateLookup = raw => {
    const date = clamp(raw)
    const cached = cache.get(date)
    if (cached) return cached
    const rates: Record<string, number> = {}
    for (const currency of currenciesKnown) {
      const rate = resolve(currency, date)
      if (!rate) continue
      const { perUsd, used } = rate
      if (!used) {
        rates[currency] = perUsd
        continue
      }
      // A fallback is reported only for a currency the snapshot actually reads.
      Object.defineProperty(rates, currency, {
        enumerable: true,
        get() {
          const ref = `${currency} ${date}`
          if (!warnings.some(w => w.ref === ref)) warnings.push({ code: 'fx_fallback', ref, params: { currency, date, used } })
          return perUsd
        },
      })
    }
    cache.set(date, rates)
    return rates
  }
  return { lookup, warnings }
}
