import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app'
import { readFamilySettings, saveFamilySetting } from '../../src/server/familySettings'
import type { Actor } from '../../src/server/http'
import { deleteRow, insertRow, revertChange, updateRow } from '../../src/server/rows'
import { getSnapshot } from '../../src/server/snapshot'
import { createTestDb, testConfig } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../helpers/session'

const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const currencyRow = (db: ReturnType<typeof createTestDb>, code: string) =>
  db.sqlite.prepare('SELECT rowid FROM currencies WHERE code = ?').get(code) as { rowid: number }

describe('family settings', () => {
  it('saves and validates the date order independently of language and supports reverting it', async () => {
    const db = createTestDb()
    expect((await readFamilySettings(db)).dateFormat).toBe('dmy')
    for (const dateFormat of ['mdy', 'ymd', 'dmy'] as const) {
      expect(await saveFamilySetting(db, { dateFormat }, actor)).toMatchObject({ dateFormat })
    }
    await expect(saveFamilySetting(db, { dateFormat: 'bad' } as never, actor)).rejects.toMatchObject({ code: 'invalid_value', status: 400 })
    const row = db.sqlite.prepare('SELECT id FROM change_log ORDER BY id DESC LIMIT 1').get() as { id: number }
    await revertChange(db, row.id, actor)
    expect((await readFamilySettings(db)).dateFormat).toBe('ymd')
  })

  it('saves and logs a change', async () => {
    const db = createTestDb()
    expect(await saveFamilySetting(db, { language: 'ru-RU', currency: 'EUR' }, actor)).toEqual({ language: 'ru-RU', currency: 'EUR', trackFlows: true, dateFormat: 'dmy' })
    expect(await readFamilySettings(db)).toEqual({ language: 'ru-RU', currency: 'EUR', trackFlows: true, dateFormat: 'dmy' })
    const log = db.sqlite.prepare('SELECT * FROM change_log ORDER BY id').all() as Record<string, string>[]
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ table_name: 'app_settings', op: 'update', actor: 'owner@example.com' })
    expect(JSON.parse(log[0].before_json)).toEqual({ key: 'language', value: 'en-US' })
    expect(JSON.parse(log[0].after_json)).toEqual({ key: 'language', value: 'ru-RU' })
  })

  it('"Track income and expenses": on by default, saved as track_flows with a journal entry, read by the snapshot, revertible', async () => {
    const db = createTestDb()
    expect((await readFamilySettings(db)).trackFlows).toBe(true)
    expect(await saveFamilySetting(db, { trackFlows: false }, actor)).toMatchObject({ trackFlows: false })
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'track_flows'").get()).toEqual({ value: '0' })
    expect((await getSnapshot(db, { download: false })).trackFlows).toBe(false)
    const { id, after_json } = db.sqlite.prepare('SELECT id, after_json FROM change_log').get() as { id: number; after_json: string }
    expect(JSON.parse(after_json)).toEqual({ key: 'track_flows', value: '0' })
    await revertChange(db, id, actor)
    expect((await readFamilySettings(db)).trackFlows).toBe(true)
    await expect(saveFamilySetting(db, { trackFlows: 'no' } as never, actor)).rejects.toMatchObject({ code: 'invalid_value', status: 400 })
  })

  it('reverting a language change restores the old language', async () => {
    const db = createTestDb()
    await saveFamilySetting(db, { language: 'ru-RU' }, actor)
    const { id } = db.sqlite.prepare('SELECT id FROM change_log').get() as { id: number }
    await revertChange(db, id, actor)
    expect((await readFamilySettings(db)).language).toBe('en-US')
    expect(db.sqlite.prepare("SELECT op FROM change_log WHERE reverts_id = ?").get(id)).toEqual({ op: 'revert' })
  })

  it('reverting a family setting needs manage, not only enter data', async () => {
    const db = createTestDb()
    await saveFamilySetting(db, { currency: 'EUR' }, actor)
    const { id } = db.sqlite.prepare('SELECT id FROM change_log').get() as { id: number }
    const editor: Actor = { ...actor, rights: { edit: true, vote: true, manage: false } }
    await expect(revertChange(db, id, editor)).rejects.toMatchObject({ code: 'no_right_manage', status: 403 })
    expect((await readFamilySettings(db)).currency).toBe('EUR')
    await revertChange(db, id, actor)
    expect((await readFamilySettings(db)).currency).toBe('USD')
  })

  it('PUT /api/settings ignores auth_* keys', async () => {
    const db = createTestDb()
    await saveFamilySetting(db, { auth_mode: 'telegram' } as never, actor)
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'auth_mode'").get()).toBeUndefined()
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()).toEqual({ n: 0 })
  })

  it('rejects an unknown language or currency', async () => {
    const db = createTestDb()
    await expect(saveFamilySetting(db, { language: 'xx-XX' as never }, actor)).rejects.toMatchObject({ code: 'invalid_language', status: 400 })
    await expect(saveFamilySetting(db, { currency: 'XXX' }, actor)).rejects.toMatchObject({ code: 'unknown_currency', status: 400 })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()).toEqual({ n: 0 })
  })

  it('refuses to delete the family currency', async () => {
    const db = createTestDb()
    await expect(deleteRow(db, 'currencies', currencyRow(db, 'USD').rowid, actor)).rejects.toMatchObject({ code: 'family_currency_in_use', status: 409 })
    await deleteRow(db, 'currencies', currencyRow(db, 'EUR').rowid, actor)
    expect(db.sqlite.prepare("SELECT 1 FROM currencies WHERE code = 'EUR'").get()).toBeUndefined()
  })

  it('refuses to rename or revert away the family currency', async () => {
    const db = createTestDb()
    await expect(updateRow(db, 'currencies', currencyRow(db, 'USD').rowid, { code: 'XYZ' }, actor)).rejects.toMatchObject({ code: 'family_currency_in_use', status: 409 })
    await insertRow(db, 'currencies', { code: 'GBP' }, actor)
    await saveFamilySetting(db, { currency: 'GBP' }, actor)
    const { id } = db.sqlite.prepare("SELECT id FROM change_log WHERE table_name = 'currencies'").get() as { id: number }
    await expect(revertChange(db, id, actor)).rejects.toMatchObject({ code: 'family_currency_in_use', status: 409 })
    expect(db.sqlite.prepare("SELECT 1 FROM currencies WHERE code = 'GBP'").get()).toBeDefined()
  })

  it('falls back when the family currency is gone', async () => {
    const db = createTestDb()
    db.sqlite.exec("UPDATE app_settings SET value = 'GBP' WHERE key = 'currency'")
    expect((await readFamilySettings(db)).currency).toBe('USD')
    db.sqlite.exec("UPDATE app_settings SET value = 'xx' WHERE key = 'language'")
    expect((await readFamilySettings(db)).language).toBe('en-US')
  })

  it('guards the same fallback currency the settings show', async () => {
    const db = createTestDb()
    // no USD, the stored family currency gone: the fallback is the first code, EUR. SQLite returns an unordered SELECT
    // in reverse here, so a read that leans on the row order picks another currency than the settings
    db.sqlite.exec('PRAGMA reverse_unordered_selects = ON')
    db.sqlite.exec("DELETE FROM currencies; INSERT INTO currencies (code) VALUES ('RUB'), ('EUR'); UPDATE app_settings SET value = 'GBP' WHERE key = 'currency'")
    expect((await readFamilySettings(db)).currency).toBe('EUR')
    await expect(deleteRow(db, 'currencies', currencyRow(db, 'EUR').rowid, actor)).rejects.toMatchObject({ code: 'family_currency_in_use', status: 409 })
    await deleteRow(db, 'currencies', currencyRow(db, 'RUB').rowid, actor)
    expect(db.sqlite.prepare("SELECT 1 FROM currencies WHERE code = 'RUB'").get()).toBeUndefined()
  })

  it('the snapshot opens in the family currency', async () => {
    const db = createTestDb()
    await saveFamilySetting(db, { currency: 'EUR' }, actor)
    expect((await getSnapshot(db, { download: false })).baseCurrency).toBe('EUR')
    expect((await getSnapshot(db, { download: false, currency: 'USD' })).baseCurrency).toBe('USD')
    // a quick view does not change which currency is the family's
    expect((await getSnapshot(db, { download: false, currency: 'USD' })).familyCurrency).toBe('EUR')
  })

  it('serves and saves through /api/settings', async () => {
    const db = createTestDb()
    const config = testConfig({ password: FAMILY_PASSWORD })
    const auth = authFor(config)
    const app = createApp({ db, config, auth })
    const headers = { Cookie: await familyCookie(auth), 'Content-Type': 'application/json' }
    expect(await (await app.request('/api/settings', { headers })).json()).toEqual({ language: 'en-US', currency: 'USD', trackFlows: true, dateFormat: 'dmy' })
    const put = await app.request('/api/settings', { method: 'PUT', headers, body: '{"language":"ru-RU"}' })
    expect(await put.json()).toEqual({ language: 'ru-RU', currency: 'USD', trackFlows: true, dateFormat: 'dmy' })
    expect((await app.request('/api/settings', { method: 'PUT', headers, body: '{"language":"zz"}' })).status).toBe(400)
  })

  it('/api/auth carries the family language', async () => {
    const db = createTestDb()
    await saveFamilySetting(db, { language: 'ru-RU' }, actor)
    const app = createApp({ db, config: testConfig({ password: 'correct horse battery' }), auth: authFor(testConfig({ password: 'correct horse battery' })) })
    expect(await (await app.request('/api/auth')).json()).toEqual({ mode: 'password', authenticated: false, language: 'ru-RU', me: null })
  })
})
