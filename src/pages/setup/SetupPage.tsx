import { useEffect } from 'react'
import { Card } from '../../components/ui/Card'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { useAuth } from '../../lib/authState'
import { useCan, useCanRunSetup } from '../../lib/rights'
import { navigate } from '../../lib/router'
import { SetupWizard } from './SetupWizard'

/**
 * The /setup route: the setup wizard again, under the page header (DataPage), for a family that has run it or skipped it.
 * Only for a person who may run it (manage and edit): the demo goes to the dashboard, anyone else reads which right is missing.
 */
export function SetupPage() {
  const demo = useAuth().mode === 'demo'
  const canRun = useCanRunSetup()
  const canManage = useCan('manage')
  useEffect(() => { if (demo) navigate('/', { replace: true }) }, [demo])
  if (demo) return null
  if (!canRun) return <ViewOnlyNote right={canManage ? 'edit' : 'manage'} />
  return <Card className="setup-card controls--square"><SetupWizard again /></Card>
}
