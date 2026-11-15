// The core's own bot handler: an invite link links a Telegram account to a user, and a sign-in link asks that user
// to confirm. Only the Confirm press approves, and only from the linked account in its own private chat: a person sent
// someone else's sign-in link must not let the sender in with one tap on /start.
import { telegramPreferences } from '../familyTelegram'
import type { Database } from '../db'
import type { LoginAttempts } from '../loginAttempts'
import { acceptInvite, findUser } from '../users'
import { answerCallback, editMessage, sendButtons, sendMessage, TelegramError } from './telegram'
import { familyT, rightsLines } from './texts'
import type { BotUpdate } from './updates'

interface SignInContext { db: Database; token: string; logins: LoginAttempts; fetchImpl?: typeof fetch; now?: Date }

const START = /^\/start (link|login)_([\w-]+)$/
const CONFIRM = /^login:([\w-]+)$/

/** A reply that does not arrive is logged by its code (never the token) and changes nothing already done. */
async function reply(what: string, send: () => Promise<unknown>): Promise<void> {
  try {
    await send()
  } catch (err) {
    console.error(`[bot] sign-in ${what} failed: ${err instanceof TelegramError ? err.code : 'unknown error'}`)
  }
}

/** true: the update was a link, a sign-in or a Confirm press; anything else is left to the modules. */
export async function handleSignIn(update: BotUpdate, ctx: SignInContext): Promise<boolean> {
  const { db, token, logins, fetchImpl, now } = ctx
  // a private chat's id is the person's own: a press in anyone else's chat (a group, another person's) approves nothing
  const ownChat = update.chatId === update.from.id

  if (update.kind === 'message') {
    const start = update.chatType === 'private' && ownChat ? START.exec(update.text) : null
    if (!start) return false
    const [, kind, code] = start
    const { t } = await familyT(db)
    if (kind === 'link') {
      const result = await acceptInvite(db, code, update.from, now)
      const text = result.status === 'linked' ? `${t('bot.link.done', { name: result.user.member })}\n\n${rightsLines(t, result.user.rights)}`
        : result.status === 'linked_elsewhere' ? t('bot.link.linkedElsewhere', { member: result.member })
          : t('bot.link.invalid')
      await reply('link reply', () => sendMessage(token, update.chatId, text, fetchImpl))
      return true
    }
    const linked = await findUser(db, { telegramId: update.from.id })
    if (!logins.targeted(code) && (!linked || !(await telegramPreferences(db, linked.id))?.signIn)) {
      await reply('login reply', () => sendMessage(token, update.chatId, t('bot.login.notInvited'), fetchImpl))
      return true
    }
    // nothing is approved here: the person still has to press Confirm, after reading the warning
    await reply('login question', () => sendButtons(token, update.chatId, t('bot.login.ask'), [[{ text: t('bot.login.confirm'), data: `login:${code}` }]], fetchImpl))
    return true
  }

  const confirm = CONFIRM.exec(update.data)
  if (!confirm) return false
  if (ownChat && logins.targeted(confirm[1])) {
    const { t } = await familyT(db)
    const text = await logins.confirm(confirm[1], update.from) ? t('bot.login.done') : t('bot.login.expired')
    await reply('login answer', () => editMessage(token, update.chatId, update.messageId, text, fetchImpl))
    await reply('button answer', () => answerCallback(token, update.id, fetchImpl))
    return true
  }
  const user = ownChat ? await findUser(db, { telegramId: update.from.id }) : null
  if (user && (await telegramPreferences(db, user.id))?.signIn) {
    const { t } = await familyT(db)
    const text = logins.approve(confirm[1], user.id) ? t('bot.login.done') : t('bot.login.expired')
    await reply('login answer', () => editMessage(token, update.chatId, update.messageId, text, fetchImpl))
  }
  await reply('button answer', () => answerCallback(token, update.id, fetchImpl))
  return true
}
