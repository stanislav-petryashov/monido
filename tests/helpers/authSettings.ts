import type { AuthSettingsView } from '../../src/domain/api'

/**
 * GET /api/auth-settings as the client reads it: by default a password-mode family with a stored app password, no bot,
 * nothing locked; `over` replaces whole fields.
 */
export const authSettingsView = (over: Partial<AuthSettingsView> = {}): AuthSettingsView => ({
  mode: 'password', stored: 'password', locked: false, password: { set: true, source: 'app' },
  bot: { source: null, username: null, problem: null },
  switchToTelegram: { bot: false, linkedManager: false, proof: null },
  switchToOidc: { configured: false, problem: null, provider: null, redirectUri: null, linkedManager: false, proof: null },
  fallback: null,
  ...over,
})

/** A bot saved in the app (@family_bot) and a manager with a linked Telegram: the switch to Telegram waits only for the test sign-in. */
export const BOT_READY = {
  bot: { source: 'app', username: 'family_bot', problem: null },
  switchToTelegram: { bot: true, linkedManager: true, proof: null },
} satisfies Partial<AuthSettingsView>
