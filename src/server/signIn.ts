// Personal accounts apart from the way they sign in: the Telegram and the provider modes both give each person an account
// with their own rights; which link lets that account sign in on the site depends on the mode.
import type { AppConfig } from './config'

export type PersonalMode = 'telegram' | 'oidc'

/** The link that lets a person sign in on the site: their Telegram account, or their account at the configured provider. */
export type SignInLink = { method: 'telegram' } | { method: 'oidc'; issuer: string }

export const isPersonal = (mode: string): mode is PersonalMode => mode === 'telegram' || mode === 'oidc'

/** The sign-in link of `mode`; null for a mode without personal accounts, or the provider mode with no provider set. */
export function signInLinkOf(mode: string, config: AppConfig): SignInLink | null {
  if (mode === 'telegram') return { method: 'telegram' }
  if (mode === 'oidc' && config.oidc) return { method: 'oidc', issuer: config.oidc.issuer }
  return null
}

/** A manager who can sign in through `link`: one row or none, for a synchronous caller (the sign-in runtime's settle) too. */
export function signInManagerSql(link: SignInLink): { sql: string; params: string[] } {
  if (link.method === 'telegram') {
    return { sql: 'SELECT 1 FROM users WHERE can_manage = 1 AND telegram_id IS NOT NULL AND telegram_sign_in = 1 LIMIT 1', params: [] }
  }
  return {
    sql: 'SELECT 1 FROM users u JOIN user_identities i ON i.user_id = u.id WHERE u.can_manage = 1 AND i.issuer = ? LIMIT 1',
    params: [link.issuer],
  }
}
