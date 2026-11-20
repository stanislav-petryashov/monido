/** The codes a provider flow comes back with in the address (`sign_in_error`) that have their own sentence */
const PROVIDER_ERRORS = new Set(['oidc_not_linked', 'oidc_unavailable', 'oidc_failed', 'oidc_expired', 'oidc_wrong_host', 'oidc_taken', 'oidc_already_bound', 'oidc_stale_login', 'unauthorized'])

/** The key of the sentence for a returned code: its own, the API's for a used invitation, else the generic refusal */
export const providerErrorKey = (code: string): string =>
  PROVIDER_ERRORS.has(code) ? `auth.oidc.error.${code}` : code === 'oidc_invite_invalid' ? 'errors.invite_invalid' : 'auth.oidc.error.oidc_failed'

/** What the provider flow came back with (`tested`: a test sign-in that went through), read once and taken out of the address, so a reload does not repeat it */
export function takeProviderReturn(): { error: string | null; invited: boolean; tested: boolean } {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('sign_in_error')
  const invited = params.get('oidc_invite') === 'bound'
  const tested = params.has('oidc_test')
  if (error !== null || invited || tested) {
    for (const key of ['sign_in_error', 'oidc_invite', 'oidc_test']) params.delete(key)
    const query = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }
  return { error, invited, tested }
}
