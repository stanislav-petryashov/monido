import { describe, expect, it } from 'vitest'
import { familyT } from '../../../src/server/bot/texts'
import { createTestDb } from '../../helpers/db'
import { ru } from '../../helpers/i18n'

describe('familyT', () => {
  it('familyT knows the advisor chunk keys in English and in Russian', async () => {
    const db = createTestDb()
    const params = { author: 'Ryan', title: 'A car on credit' }
    const { t: en, lang } = await familyT(db)
    expect(lang).toBe('en-US')
    expect(en('modules.advisor.bot.card.title', params)).toBe('Ryan proposes: A car on credit')
    // the main files are still there, and the records chunk too
    expect(en('bot.login.done')).toBe('Signed in.')
    expect(en('data.journal.viaTelegram', { actor: 'Noa' })).toBe('Noa via Telegram')

    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', 'ru-RU')")
    const russian = await familyT(db)
    expect(russian.lang).toBe('ru-RU')
    expect(russian.t('modules.advisor.bot.card.title', params)).toBe(ru('modules.advisor.bot.card.title', params))
    expect(russian.t('modules.advisor.bot.card.title', params)).not.toBe(en('modules.advisor.bot.card.title', params))
    expect(russian.t('bot.login.done')).toBe(ru('bot.login.done'))
    // the English one keeps its language
    expect(en('modules.advisor.bot.card.title', params)).toBe('Ryan proposes: A car on credit')
  })

  it('the merged texts are built once per language, and the language comes with its t', async () => {
    const db = createTestDb()
    const first = await familyT(db)
    expect((await familyT(createTestDb())).t).toBe(first.t)
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', 'ru-RU')")
    const russian = await familyT(db)
    expect(russian.t).not.toBe(first.t)
    expect((await familyT(db)).t).toBe(russian.t)
  })
})
