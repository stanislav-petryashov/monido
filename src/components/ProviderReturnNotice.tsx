import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/authState'
import { useToast } from '../lib/notifyState'
import { providerErrorKey, takeProviderReturn } from '../lib/providerReturn'

/** What a provider flow came back with while signed in (an invitation, a refused binding): said once, as a notification */
export function ProviderReturnNotice() {
  const { t } = useTranslation()
  const { me, provider } = useAuth()
  const toast = useToast()
  useEffect(() => {
    const { error, invited } = takeProviderReturn()
    const name = provider ?? t('auth.oidcInvite.provider')
    if (error !== null) toast.error(t(providerErrorKey(error)))
    else if (invited) toast.success(me?.name ? t('auth.oidc.linkedAs', { provider: name, member: me.name }) : t('auth.oidc.invited', { provider: name }))
    // once, when the app opens on the address the provider sent the browser back to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
