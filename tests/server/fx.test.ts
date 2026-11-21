import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureRates, fetchRates, forgetFxMemory } from '../../src/server/fx'
import { createTestDb, type TestDb } from '../helpers/db'
import { fakeFrankfurter } from '../helpers/frankfurter'
import { jsonResponse } from '../helpers/http'

const silenceErrors = () => vi.spyOn(console, 'log').mockImplementation(() => {})
const requested = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map(([input]) => new URL(String(input)))
const quotes = (url: URL) => (url.searchParams.get('quotes') ?? '').split(',').sort()
const stored = (db: TestDb) => db.sqlite.prepare('SELECT date, currency, per_usd, source_date FROM fx_rates ORDER BY date, currency').all()
const manual = (db: TestDb, currency: string, date: string, perUsd: number) =>
  db.sqlite.prepare('INSERT INTO fx_manual_rates (currency, date, per_usd) VALUES (?, ?, ?)').run(currency, date, perUsd)
const cache = (db: TestDb, date: string, currency: string, perUsd: number, sourceDate = date) =>
  db.sqlite.prepare('INSERT INTO fx_rates (date, currency, per_usd, source_date) VALUES (?, ?, ?, ?)').run(date, currency, perUsd, sourceDate)

describe('fetchRates', () => {
  it('asks Frankfurter for the quotes of one date against USD', async () => {
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 84, GBP: 0.75 } })
    const budget = { left: 20 }
    expect(await fetchRates('2026-09-30', ['RUB', 'GBP'], budget, f)).toEqual([
      { currency: 'RUB', perUsd: 84, sourceDate: '2026-09-30' },
      { currency: 'GBP', perUsd: 0.75, sourceDate: '2026-09-30' },
    ])
    const [url] = requested(f)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.frankfurter.dev/v2/rates')
    expect(url.searchParams.get('base')).toBe('USD')
    expect(budget.left).toBe(19)
  })

  it('uses FX_API_URL', async () => {
    vi.stubEnv('FX_API_URL', 'http://fx.local')
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 84 } })
    await fetchRates('2026-09-30', ['RUB'], { left: 20 }, f)
    expect(String(f.mock.calls[0][0])).toMatch(/^http:\/\/fx\.local\/v2\/rates\?/)
  })

  it('passes a timeout signal to the request', async () => {
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 84 } })
    await fetchRates('2026-09-30', ['RUB'], { left: 20 }, f)
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('asks again without the currencies Frankfurter does not know, and remembers them', async () => {
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 84 } }, ['XAA', 'XBB'])
    const budget = { left: 20, refused: new Set<string>() }
    expect(await fetchRates('2026-09-30', ['XAA', 'RUB', 'XBB'], budget, f)).toEqual([{ currency: 'RUB', perUsd: 84, sourceDate: '2026-09-30' }])
    expect(requested(f).map(quotes)).toEqual([['RUB', 'XAA', 'XBB'], ['RUB']])
    expect([...budget.refused].sort()).toEqual(['XAA', 'XBB'])
    expect(budget.left).toBe(18)
  })

  it('stops fetching after a network error', async () => {
    const error = silenceErrors()
    const budget = { left: 20 }
    expect(await fetchRates('2026-09-30', ['RUB'], budget, vi.fn().mockRejectedValue(new Error('offline')))).toBeNull()
    expect(budget.left).toBe(0)
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({ event_name: 'monido.fx.download_failed', attributes: { 'error.type': 'Error' } })
  })

  it('treats a 404 as a wrong FX_API_URL: logs it and stops fetching', async () => {
    // Frankfurter answers a date it lacks with an empty list, so only a wrong address gives a 404.
    const error = silenceErrors()
    const budget = { left: 20 }
    const f = vi.fn<typeof fetch>(async () => jsonResponse({ message: 'not found' }, 404))
    expect(await fetchRates('2026-09-30', ['RUB'], budget, f)).toBeNull()
    expect(budget.left).toBe(0)
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({ event_name: 'monido.fx.download_failed', attributes: { 'http.response.status_code': 404 } })
  })
})

describe('ensureRates', () => {
  beforeEach(forgetFxMemory)

  it('downloads the missing currencies of a date in one request', async () => {
    const db = createTestDb()
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 84, GBP: 0.75 } })
    const fx = await ensureRates(db, ['2026-09-30'], ['USD', 'RUB', 'GBP'], '2026-10-21', f)
    expect(f).toHaveBeenCalledTimes(1)
    const [url] = requested(f)
    expect(url.searchParams.get('base')).toBe('USD')
    expect(url.searchParams.get('date')).toBe('2026-09-30')
    expect(quotes(url)).toEqual(['GBP', 'RUB'])
    expect(stored(db)).toEqual([
      { date: '2026-09-30', currency: 'GBP', per_usd: 0.75, source_date: '2026-09-30' },
      { date: '2026-09-30', currency: 'RUB', per_usd: 84, source_date: '2026-09-30' },
    ])
    expect(fx.lookup('2026-09-30')).toEqual({ RUB: 84, GBP: 0.75 })
    expect(fx.warnings).toEqual([])
  })

  it('asks only for the currencies a date lacks', async () => {
    const db = createTestDb()
    cache(db, '2026-09-30', 'RUB', 84)
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 99, GBP: 0.75 } })
    const fx = await ensureRates(db, ['2026-09-30'], ['RUB', 'GBP'], '2026-10-21', f)
    expect(requested(f).map(quotes)).toEqual([['GBP']])
    expect(fx.lookup('2026-09-30')).toEqual({ RUB: 84, GBP: 0.75 })
    await ensureRates(db, ['2026-09-30'], ['RUB', 'GBP'], '2026-10-21', f)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('clamps future dates to today', async () => {
    const f = fakeFrankfurter({ '2026-10-21': { RUB: 84 } })
    const fx = await ensureRates(createTestDb(), ['2026-10-31'], ['RUB'], '2026-10-21', f)
    expect(requested(f).map(u => u.searchParams.get('date'))).toEqual(['2026-10-21'])
    expect(fx.lookup('2026-10-31')).toEqual({ RUB: 84 })
    expect(fx.warnings).toEqual([])
  })

  it('spends at most 20 requests, newest dates first', async () => {
    const days = Array.from({ length: 25 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)
    const f = fakeFrankfurter(Object.fromEntries(days.map(d => [d, { RUB: 90 }])))
    await ensureRates(createTestDb(), days, ['RUB'], '2026-07-25', f)
    expect(f).toHaveBeenCalledTimes(20)
    expect(requested(f)[0].searchParams.get('date')).toBe('2026-07-25')
  })

  it('a manual rate is a step until the next one', async () => {
    const db = createTestDb()
    manual(db, 'ARS', '2026-01-01', 1500)
    manual(db, 'ARS', '2026-06-01', 1800)
    const f = fakeFrankfurter({})
    const fx = await ensureRates(db, ['2026-03-31', '2026-07-31'], ['ARS'], '2026-10-21', f)
    expect(fx.lookup('2026-03-31').ARS).toBe(1500)
    expect(fx.lookup('2026-07-31').ARS).toBe(1800)
    expect(fx.warnings).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('a manual rate overrides the downloaded one for its currency', async () => {
    const db = createTestDb()
    cache(db, '2026-07-31', 'ARS', 1300)
    cache(db, '2026-07-31', 'RUB', 84)
    manual(db, 'ARS', '2026-06-01', 1800)
    const fx = await ensureRates(db, ['2026-07-31'], ['ARS', 'RUB'], '2026-10-21', fakeFrankfurter({}))
    expect(fx.lookup('2026-07-31')).toEqual({ ARS: 1800, RUB: 84 })
  })

  it('before the first manual rate the download is used', async () => {
    const db = createTestDb()
    manual(db, 'ARS', '2026-06-01', 1800)
    const f = fakeFrankfurter({ '2026-03-31': { ARS: 1200 } })
    const fx = await ensureRates(db, ['2026-03-31', '2026-07-31'], ['ARS'], '2026-10-21', f)
    expect(requested(f).map(u => u.searchParams.get('date'))).toEqual(['2026-03-31'])
    expect(fx.lookup('2026-03-31').ARS).toBe(1200)
    expect(fx.lookup('2026-07-31').ARS).toBe(1800)
  })

  it('falls back to the nearest earlier rate with a warning', async () => {
    const db = createTestDb()
    cache(db, '2026-07-31', 'RUB', 80)
    cache(db, '2026-08-31', 'RUB', 82)
    cache(db, '2026-10-31', 'RUB', 85)
    const fx = await ensureRates(db, ['2026-09-30'], ['RUB'], '2026-11-30', fakeFrankfurter({}))
    expect(fx.lookup('2026-09-30').RUB).toBe(82)
    fx.lookup('2026-09-30')
    expect(fx.warnings).toEqual([
      { code: 'fx_fallback', ref: 'RUB 2026-09-30', params: { currency: 'RUB', date: '2026-09-30', used: '2026-08-31' } },
    ])
  })

  it('falls back to the nearest later rate when there is no earlier one', async () => {
    const db = createTestDb()
    cache(db, '2026-08-31', 'RUB', 82)
    const fx = await ensureRates(db, ['2026-07-31'], ['RUB'], '2026-10-21', fakeFrankfurter({}))
    expect(fx.lookup('2026-07-31').RUB).toBe(82)
    expect(fx.warnings).toEqual([
      { code: 'fx_fallback', ref: 'RUB 2026-07-31', params: { currency: 'RUB', date: '2026-07-31', used: '2026-08-31' } },
    ])
  })

  it('warns about a fallback only for a currency that is read', async () => {
    const db = createTestDb()
    cache(db, '2026-08-31', 'RUB', 82)
    cache(db, '2026-08-31', 'EUR', 0.9)
    cache(db, '2026-09-30', 'EUR', 0.91)
    const fx = await ensureRates(db, ['2026-09-30'], ['RUB', 'EUR'], '2026-10-21', fakeFrankfurter({}))
    expect(fx.lookup('2026-09-30').EUR).toBe(0.91)
    expect(fx.warnings).toEqual([])
  })

  it('has no key for a currency without any rate', async () => {
    const db = createTestDb()
    manual(db, 'ARS', '2026-06-01', 1800)
    const fx = await ensureRates(db, ['2026-03-31'], ['ARS', 'GBP'], '2026-10-21', fakeFrankfurter({}))
    expect(Object.keys(fx.lookup('2026-03-31'))).toEqual([])
  })

  it('does not ask again in the same request for a currency Frankfurter refused', async () => {
    const f = fakeFrankfurter({ '2026-08-31': { RUB: 82 }, '2026-09-30': { RUB: 84 } }, ['XAA'])
    const fx = await ensureRates(createTestDb(), ['2026-08-31', '2026-09-30'], ['RUB', 'XAA'], '2026-10-21', f)
    expect(requested(f).map(quotes)).toEqual([['RUB', 'XAA'], ['RUB'], ['RUB']])
    expect(fx.lookup('2026-08-31')).toEqual({ RUB: 82 })
  })

  it('offline (fetchImpl null): asks nothing, serves stored and manual rates', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    // offline is a mode, not a failure: nothing is attempted, so nothing is logged
    const error = vi.spyOn(console, 'log').mockImplementation(() => {})
    const db = createTestDb()
    cache(db, '2026-08-31', 'EUR', 0.9)
    manual(db, 'ARS', '2026-06-01', 1800)
    const fx = await ensureRates(db, ['2026-08-31', '2026-09-30', '2026-10-21'], ['EUR', 'ARS', 'GBP'], '2026-10-21', null)
    expect(f).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(stored(db)).toEqual([{ date: '2026-08-31', currency: 'EUR', per_usd: 0.9, source_date: '2026-08-31' }])
    expect(fx.lookup('2026-08-31')).toEqual({ EUR: 0.9, ARS: 1800 })
    expect(fx.lookup('2026-09-30')).toEqual({ EUR: 0.9, ARS: 1800 })
  })

  it('a failing download stops fetching and serves stored rates', async () => {
    silenceErrors()
    const db = createTestDb()
    cache(db, '2026-08-31', 'RUB', 82)
    const f = vi.fn().mockRejectedValue(new Error('offline'))
    const fx = await ensureRates(db, ['2026-08-31', '2026-09-30', '2026-10-21'], ['RUB', 'EUR'], '2026-10-21', f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(fx.lookup('2026-08-31')).toEqual({ RUB: 82 })
    expect(fx.lookup('2026-09-30').RUB).toBe(82)
  })
  it('after a failed download asks nothing for 5 minutes', async () => {
    silenceErrors()
    vi.useFakeTimers({ now: new Date('2026-10-21T10:00:00Z'), toFake: ['Date'] })
    try {
      const f = vi.fn().mockRejectedValue(new Error('offline'))
      await ensureRates(createTestDb(), ['2026-10-21'], ['RUB'], '2026-10-21', f)
      vi.setSystemTime(new Date('2026-10-21T10:04:59Z'))
      await ensureRates(createTestDb(), ['2026-10-21'], ['RUB'], '2026-10-21', f)
      expect(f).toHaveBeenCalledTimes(1)
      vi.setSystemTime(new Date('2026-10-21T10:05:00Z'))
      await ensureRates(createTestDb(), ['2026-10-21'], ['RUB'], '2026-10-21', f)
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remembers refused codes and left-out currencies across snapshots', async () => {
    const f = fakeFrankfurter({ '2026-09-30': { RUB: 84 } }, ['XAA'])
    await ensureRates(createTestDb(), ['2026-09-30'], ['RUB', 'XAA', 'GBP'], '2026-10-21', f)
    expect(requested(f).map(quotes)).toEqual([['GBP', 'RUB', 'XAA'], ['GBP', 'RUB']])
    await ensureRates(createTestDb(), ['2026-09-30'], ['RUB', 'XAA', 'GBP'], '2026-10-21', f)
    expect(requested(f).map(quotes)).toEqual([['GBP', 'RUB', 'XAA'], ['GBP', 'RUB'], ['RUB']])
  })

  it('does not store today\'s rate that Frankfurter dated earlier, but serves it until restart', async () => {
    const db = createTestDb()
    const f = vi.fn<typeof fetch>(async () => jsonResponse([{ date: '2026-10-20', base: 'USD', quote: 'RUB', rate: 84 }]))
    const fx = await ensureRates(db, ['2026-10-21'], ['RUB'], '2026-10-21', f)
    expect(fx.lookup('2026-10-21')).toEqual({ RUB: 84 })
    expect(stored(db)).toEqual([])
    const again = await ensureRates(db, ['2026-10-21'], ['RUB'], '2026-10-21', f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(again.lookup('2026-10-21')).toEqual({ RUB: 84 })
  })
})
