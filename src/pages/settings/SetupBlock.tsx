import { useTranslation } from 'react-i18next'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { useAuth } from '../../lib/authState'
import { useCan, useCanRunSetup } from '../../lib/rights'
import { navigate } from '../../lib/router'
import { SettingsSection } from '../admin/ui/SettingsSection'

/** The "Setup wizard" block of Settings → Data: opens /setup to walk through the family's settings again. Not shown in the demo. */
export function SetupBlock() {
  const { t } = useTranslation()
  const demo = useAuth().mode === 'demo'
  const canRun = useCanRunSetup()
  const canManage = useCan('manage')
  // without the manage right the page says once that it is view only, on Restore above
  if (demo || (!canRun && !canManage)) return null
  return (
    <SettingsSection title={t('data.setup.block.title')} description={canRun ? t('data.setup.block.text') : undefined}>
      {canRun
        ? <><div className="form-actions form-actions--start"><button type="button" className="btn btn--ghost" onClick={() => navigate('/setup')}>{t('data.setup.block.run')}</button></div><p className="note">{t('data.setup.block.note')}</p></>
        : <ViewOnlyNote right="edit" />}
    </SettingsSection>
  )
}
