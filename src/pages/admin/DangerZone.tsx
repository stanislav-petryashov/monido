import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Disclosure } from '../../components/ui/Disclosure'
import { Notice } from '../../components/ui/Notice'
import { IconTrash } from '@tabler/icons-react'
import { apiSend } from '../../lib/api'
import { useAuth } from '../../lib/authState'
import { useCan } from '../../lib/rights'
import { afterDemoData, useDemoDataAvailability } from '../../lib/demoData'
import { navigate } from '../../lib/router'
import { useAdminWrite } from './adminQuery'
import { DangerDialog } from './DangerDialog'
import { DemoDataDialog } from './DemoDataDialog'
import { useBackupDownload } from './useBackupDownload'

/**
 * The last block of the Backup page, set apart: what a wipe deletes and keeps, "Load test data" (DemoDataDialog with the
 * typed word) and "Delete all
 * family data" behind a typed confirmation word (POST /api/wipe). The database copy is the page's own button above; the confirmation windows offer it again. After either every query is dropped and read again and the app
 * opens on Overview. Both buttons are disabled while either operation runs. Not shown in the demo.
 */
export function DangerZone() {
  const { t } = useTranslation()
  const demo = useAuth().mode === 'demo'
  const canManage = useCan('manage')
  const queryClient = useQueryClient()
  /** The copy and the wipe: nothing to refetch here (a wipe resets every query itself) */
  const write = useAdminWrite([])
  const [asking, setAsking] = useState(false)
  const [askingDemo, setAskingDemo] = useState(false)
  const [writing, setBusy] = useState(false)
  const backup = useBackupDownload()
  const busy = writing || backup.busy
  const availability = useDemoDataAvailability()
  // the manage note of the page sits on the Restore block, above
  if (demo || !canManage) return null

  async function answer(yes: boolean) {
    setAsking(false)
    if (!yes) return
    setBusy(true)
    const done = await write(() => apiSend('/api/wipe', 'POST', { confirm: true }), [t('data.danger.done'), t('data.danger.doneText')], t('data.danger.failed'))
    setBusy(false)
    if (!done) return
    // the wizard that follows starts at Welcome, not at a step stored by an earlier run in this tab; the wipe clears the
    // first-run flag: the app reads it before it opens on Overview (the gate then draws the wizard)
    await afterDemoData(queryClient, navigate)
  }

  async function demoDone() {
    setAskingDemo(false)
    setBusy(true)
    await afterDemoData(queryClient, navigate)
    setBusy(false)
  }

  return (
    <>
      <Disclosure className="data-danger" title={t('data.danger.title')}>
        <Notice tone="warning">{t('data.danger.backupFirst')}</Notice>
        <div className="data-task">
          <div><h3>{t('data.danger.demo.title')}</h3><p className="note">{t('data.danger.demo.summary')}</p></div>
          <button type="button" className="btn btn--ghost" disabled={busy || askingDemo || !availability.available} onClick={() => setAskingDemo(true)}>{t('data.danger.demo.load')}</button>
        </div>
        <div className="data-task">
          <div><h3>{t('data.danger.deleteTitle')}</h3><p className="note">{t('data.danger.deleteNote')}</p></div>
          <button type="button" className="btn btn--danger" disabled={busy || askingDemo} onClick={() => setAsking(true)}>{t('data.danger.delete')}</button>
        </div>
        <Disclosure variant="inline" title={t('data.danger.details')}>
          <p className="note">{t('data.danger.text')}</p>
        </Disclosure>
      </Disclosure>
      {asking && (
        <DangerDialog
          icon={IconTrash}
          title={t('data.danger.confirmTitle')}
          text={<Trans i18nKey="data.danger.confirmText" values={{ word: t('data.danger.word') }} components={{ strong: <strong /> }} />}
          confirmLabel={t('data.danger.confirm')}
          requireWord
          onBackup={backup.download}
          busy={busy}
          onAnswer={answer}
        />
      )}
      <DemoDataDialog open={askingDemo} confirmation="word" onDone={demoDone} onClose={() => setAskingDemo(false)} />
    </>
  )
}
