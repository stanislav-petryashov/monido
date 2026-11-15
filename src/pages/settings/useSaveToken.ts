import { useTranslation } from 'react-i18next'
import { apiSend } from '../../lib/api'
import { useToast } from '../../lib/notifyState'
import type { AdminWrite } from '../admin/adminQuery'

/** Saves a bot token (the server asks Telegram first); true when it was stored, announced by the bot's name */
export function useSaveToken(write: AdminWrite) {
  const { t } = useTranslation()
  const toast = useToast()
  return async (token: string) => {
    let username = ''
    const ok = await write(async () => { ({ username } = await apiSend<{ username: string }>('/api/auth-settings/bot-token', 'POST', { token })) }, null, t('data.common.saveFailed'))
    if (ok) toast.success(t('users.signIn.bot.saved', { username: `@${username}` }))
    return ok
  }
}
