import { Hono } from 'hono'
import type { AuthVariables } from './auth'
import type { AuthRuntime } from './authSettings'
import type { Database } from './db'
import { guard, json, readJson, requireRight } from './http'
import { beginGroupPairing, familyTelegramView, saveTelegramGroup, saveTelegramPreferences } from './familyTelegram'

export function familyTelegramRoutes({ db, auth, botUsername }: { db: Database; auth: AuthRuntime; botUsername: () => string | null }) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('/api/family-telegram*', async (c, next) => {
    return guard(c.req, { tag: 'family-telegram' }, async () => { requireRight(c.get('actor'), 'manage'); await next(); return c.res })
  })
  app.get('/api/family-telegram', async () => json(await familyTelegramView(db)))
  app.put('/api/family-telegram/users/:id', c => guard(c.req, { tag: 'family-telegram' }, async () => json(await saveTelegramPreferences(db, Number(c.req.param('id')), await readJson(c.req.raw), auth.mode(), c.get('actor')))))
  app.post('/api/family-telegram/pairing', c => guard(c.req, { tag: 'family-telegram' }, async () => json(await beginGroupPairing(db, botUsername()))))
  app.put('/api/family-telegram/groups/:chatId', c => guard(c.req, { tag: 'family-telegram' }, async () => json(await saveTelegramGroup(db, c.req.param('chatId'), await readJson(c.req.raw)))))
  app.delete('/api/family-telegram/groups/:chatId', async c => {
    await db.prepare('DELETE FROM family_telegram_groups WHERE chat_id = ?').bind(c.req.param('chatId')).run()
    return json({ ok: true })
  })
  return app
}
