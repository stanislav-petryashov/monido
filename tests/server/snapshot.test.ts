import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/server/app'
import { pickCurrency } from '../../src/server/familyCurrency'
import { getSnapshot } from '../../src/server/snapshot'
import { closeHistory, createTestDb, testConfig } from '../helpers/db'
import { fakeFrankfurter } from '../helpers/frankfurter'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../helpers/session'

/** 80 RUB and 80/88 EUR per 1 USD (the cross rate 88 RUB per 1 EUR). */
const RATES = { RUB: 80, EUR: 80 / 88 }

describe('pickCurrency', () => {
  it('takes the requested project currency, else USD, else the first project currency', () => {
    expect(pickCurrency('RUB', ['EUR', 'RUB', 'USD'])).toBe('RUB')
    expect(pickCurrency('GBP', ['EUR', 'RUB', 'USD'])).toBe('USD')
    expect(pickCurrency(undefined, ['EUR', 'RUB', 'USD'])).toBe('USD')
    expect(pickCurrency('GBP', ['EUR', 'RUB'])).toBe('EUR')
    expect(pickCurrency('GBP', [])).toBe('USD')
  })
})

describe('getSnapshot', () => {
  it('carries the family members in the order they were added, whatever their names sort to', async () => {
    const db = createTestDb()
    db.sqlite.exec(`DELETE FROM members; INSERT INTO members (name) VALUES ('Zed'), ('Annika'), ('Marcus')`)
    const snapshot = await getSnapshot(db, { now: new Date('2031-09-23T09:00:00Z'), download: false })
    expect(snapshot.members).toEqual(['Zed', 'Annika', 'Marcus'])
  })

  it('shows a month only after it is closed', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'Quillmark Bank', 160000, 'RUB', 'Robin');
      INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency)
        VALUES ('2031-08-01', 'Quillmark Bank', 'Robin', 240000, 0, 160000, 'RUB');
    `)
    const fetchImpl = fakeFrankfurter({ '2031-08-31': RATES, '2031-08-01': RATES, '2031-09-23': RATES })
    const now = new Date('2031-09-23T09:00:00Z')
    const open = await getSnapshot(db, { now, fetchImpl })
    expect(open.capital).toBeNull()
    expect(open.asOf.openMonths).toEqual(['2031-08'])
    expect(open.warnings.map(w => w.code)).toContain('open_month_rows')
    db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-08', 't', 'owner@example.com')`)
    const closed = await getSnapshot(db, { now, fetchImpl })
    expect(closed.capital?.netWorth).toBe(2000)
    expect(closed.asOf.openMonths).toEqual([])
  })

  it('passes the wizard\'s account closures: an account closed last month is not reported missing', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES
        ('2031-07-31', 'bank', 'Quillmark Bank', 1000, 'USD', 'Robin'), ('2031-07-31', 'bank', 'Old Bank', 0, 'USD', 'Robin'),
        ('2031-08-31', 'bank', 'Quillmark Bank', 1000, 'USD', 'Robin');
      INSERT INTO account_closures (name, member, closed_month) VALUES ('Old Bank', 'Robin', '2031-07');
    `)
    closeHistory(db)
    const s = await getSnapshot(db, { now: new Date('2031-09-23T09:00:00Z'), download: false })
    expect(s.warnings.map(w => w.code)).not.toContain('missing_balance')
  })

  it('builds the snapshot from database rows and caches the rates it used', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'Quillmark Bank', 160000, 'RUB', 'Robin');
      INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency)
        VALUES ('2031-08-01', 'Quillmark Bank', 'Robin', 240000, 0, 160000, 'RUB');
      INSERT INTO goals (id, name, target, current, target_date, emoji, currency) VALUES ('fire', 'FIRE', 100000, 10000, '2040-12-31', NULL, 'USD');
    `)
    closeHistory(db)
    const fetchImpl = fakeFrankfurter({ '2031-08-31': RATES, '2031-08-01': RATES, '2031-09-23': RATES })
    const s = await getSnapshot(db, { now: new Date('2031-09-23T09:00:00Z'), fetchImpl })
    expect(s.asOf).toEqual({ capitalDate: '2031-08-31', closedMonth: '2031-08', openMonths: [], today: '2031-09-23' })
    expect(s.capital?.netWorth).toBe(2000)
    expect(s.cashflow.closedMonth).toMatchObject({ income: 3000, expense: 2000, net: 1000 })
    expect(s.baseCurrency).toBe('USD')
    expect(s.currencies).toEqual(['EUR', 'RUB', 'USD'])
    expect(s.rates).toBeNull()
    expect(s.goals.fire?.progressPct).toBe(10)
    expect(s.warnings.map(w => w.code)).toEqual(['short_history'])
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM fx_rates').get()).toEqual({ n: 6 })
  })

  it('converts to another currency with the downloaded rates', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'Quillmark Bank', 160000, 'RUB', 'Robin');
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'Brisaluna Bank', 100, 'EUR', 'Noa');
    `)
    closeHistory(db)
    const fetchImpl = fakeFrankfurter({ '2031-08-31': RATES, '2031-09-23': RATES })
    const s = await getSnapshot(db, { now: new Date('2031-09-23T09:00:00Z'), fetchImpl, currency: 'RUB' })
    expect(s.baseCurrency).toBe('RUB')
    expect(s.capital?.netWorth).toBe(168800)
    expect(s.rates).toEqual({ date: '2031-09-23', perUsd: 80 })
  })

  it('converts a currency Frankfurter does not publish with a manual rate', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO currencies (code) VALUES ('ARS');
      INSERT INTO fx_manual_rates (currency, date, per_usd) VALUES ('ARS', '2031-01-01', 1500);
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'Ombu Bank', 300000, 'ARS', 'Robin');
    `)
    closeHistory(db)
    const fetchImpl = fakeFrankfurter({ '2031-08-31': RATES, '2031-09-23': RATES })
    const s = await getSnapshot(db, { now: new Date('2031-09-23T09:00:00Z'), fetchImpl })
    expect(s.capital?.netWorth).toBe(200)
    expect(s.warnings.map(w => w.code)).not.toContain('fx_unknown_currency')
    for (const [input] of fetchImpl.mock.calls) expect(new URL(String(input)).searchParams.get('quotes')).not.toContain('ARS')
  })

  it('downloads a currency an account uses even when it left the project list', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'Thistle Bank', 750, 'GBP', 'Robin');
    `)
    closeHistory(db)
    const fetchImpl = fakeFrankfurter({ '2031-08-31': { ...RATES, GBP: 0.75 }, '2031-09-23': { ...RATES, GBP: 0.75 } })
    const s = await getSnapshot(db, { now: new Date('2031-09-23T09:00:00Z'), fetchImpl })
    expect(s.currencies).not.toContain('GBP')
    expect(s.capital?.netWorth).toBe(1000)
    expect(fetchImpl.mock.calls.some(([input]) => new URL(String(input)).searchParams.get('quotes')?.split(',').includes('GBP'))).toBe(true)
  })
})

describe('GET /api/snapshot', () => {
  it('serves the snapshot to authorized users only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    const DB = createTestDb()
    const config = testConfig({ password: FAMILY_PASSWORD })
    const auth = authFor(config)
    const app = createApp({ db: DB, config, auth })
    const headers = { Cookie: await familyCookie(auth) }
    const ok = await app.request('/api/snapshot', { headers })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Cache-Control')).toBe('no-store')
    const body = await ok.json() as { baseCurrency: string; rates: unknown }
    expect(body.baseCurrency).toBe('USD')
    expect(body.rates).toBeNull()
    expect((await app.request('/api/snapshot')).status).toBe(401)
  })
})
