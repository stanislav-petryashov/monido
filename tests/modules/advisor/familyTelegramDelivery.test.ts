import { describe, expect, it } from 'vitest'
import { councilFamily, creditEvaluation, creditInput } from '../../helpers/council'
import { fakeTelegram } from '../../helpers/telegram'
import { propose, withdraw } from '../../../src/modules/advisor/council/store'
import { deliverPending } from '../../../src/modules/advisor/council/delivery'
import { saveTelegramPreferences, saveTelegramGroup } from '../../../src/server/familyTelegram'

const env = { TELEGRAM_BOT_TOKEN: 'token', APP_URL: 'https://family.example' }
const now = new Date('2031-10-03T11:00:00Z')
describe('family council delivery', () => {
  it('honors proposal opt-outs for both newly queued and already queued personal messages', async () => {
    const { db, ids, actor } = councilFamily()
    await saveTelegramPreferences(db, ids.annika, { proposals: false }, 'password')
    await propose(db, creditInput(await creditEvaluation(db)), actor('Ryan'), now)
    expect(db.sqlite.prepare('SELECT 1 FROM proposal_messages WHERE user_id = ?').get(ids.annika)).toBeUndefined()
    await saveTelegramPreferences(db, ids.mila, { proposals: false }, 'password')
    const tg = fakeTelegram()
    await deliverPending(db, env, now, tg.fetchImpl)
    expect(tg.calls.map(c => c.body.chat_id)).toEqual(['101'])
  })
  it('delivers new proposal and result notices to paired opted-in groups without voting buttons, then respects opt-out', async () => {
    const { db, actor } = councilFamily()
    db.sqlite.exec("INSERT INTO family_telegram_groups (chat_id, title, proposals) VALUES ('-100', 'Family', 1)")
    const proposal = await propose(db, creditInput(await creditEvaluation(db)), actor('Ryan'), now)
    const tg = fakeTelegram()
    await deliverPending(db, env, now, tg.fetchImpl)
    const notices = () => tg.calls.filter(c => c.body.chat_id === '-100')
    expect(notices()).toHaveLength(1)
    expect(notices()[0].body.reply_markup).toBeUndefined()
    await withdraw(db, proposal.id, actor('Ryan'), new Date(now.getTime() + 1000))
    await deliverPending(db, env, now, tg.fetchImpl)
    expect(notices()).toHaveLength(2)
    expect(notices()[1].body.text).toContain('Withdrawn')
    await saveTelegramGroup(db, '-100', { proposals: false })
    await propose(db, creditInput(await creditEvaluation(db)), actor('Ryan'), now)
    await deliverPending(db, env, now, tg.fetchImpl)
    expect(notices()).toHaveLength(2)
  })
})
