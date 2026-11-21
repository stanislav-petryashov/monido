// The server side of reminders: /api/reminders*, the hourly run and the /start that links a chat.
import { errorJson, guard, readJson, requireRight } from '../../server/http'
import type { ServerModule } from '../server'
import { beginPairing, getReminders, linkChat, linkFromStart, runScheduled, saveSchedule, sendTest, unlinkChat } from './reminders'

export const remindersServer: ServerModule = {
  key: 'reminders',
  async api(request, { db, env, url, actor }) {
    const match = url.pathname.match(/^\/api\/reminders(?:\/(link|pairing|test|test-recipient))?$/)
    if (!match) return null
    const route = `${request.method} ${match[1] ?? ''}`
    return guard(request, { tag: 'reminders' }, async () => {
      if (route === 'GET ') return getReminders(db, env)
      // the core does not know this module's paths, so it checks its own writes
      if (request.method !== 'GET') requireRight(actor, 'manage')
      if (route === 'PUT ') return saveSchedule(db, env, await readJson(request))
      if (route === 'POST pairing') return beginPairing(db, env)
      if (route === 'POST link') return linkChat(db, env, await readJson(request))
      if (route === 'DELETE link') return unlinkChat(db, env)
      if (route === 'POST test-recipient') {
        const body = await readJson(request) as { recipientId?: unknown } | null
        return sendTest(db, env, new Date(), undefined, body?.recipientId ?? null)
      }
      if (route === 'POST test') return sendTest(db, env)
      return errorJson('method_not_allowed', 405)
    })
  },
  async scheduled({ db, env }) { await runScheduled(db, env) },
  onBotUpdate: (update, { db }) => linkFromStart(db, update),
}
