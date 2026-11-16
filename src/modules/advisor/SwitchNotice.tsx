import { useTranslation } from 'react-i18next'
import { Notice } from '../../components/ui/Notice'
import { useConnector } from './useConnector'

/** Before a sign-in switch (Family and access): Claude's connections end with it, so say so while there are any. */
export function SwitchNotice() {
  const { t } = useTranslation()
  const connector = useConnector(false)
  // an unreadable answer (or none yet) warns of nothing: the switch itself still works
  if (!connector.data?.connected?.length) return null
  return <Notice tone="warning">{t('modules.advisor.switchNotice')}</Notice>
}
