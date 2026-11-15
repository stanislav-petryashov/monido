import { useId, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { IconTrash } from '@tabler/icons-react'
import { Notice } from '../../components/ui/Notice'
import { Avatar } from '../../components/ui/Avatar'
import { Dialog } from '../../components/ui/Dialog'
import { useModalDialog } from '../../components/ui/useModalDialog'
import { apiFetch, apiUpload, downloadFile } from '../../lib/api'
import { useAuth } from '../../lib/authState'
import { fmtDayTime } from '../../lib/formatters'
import { useCan } from '../../lib/rights'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { SettingsSection } from '../admin/ui/SettingsSection'
import { ADMIN_QUERY, useAdminWrite } from '../admin/adminQuery'
import { useBackupDownload } from '../admin/useBackupDownload'

/**
 * The restore section of the deployment guide, in the published repository (the one the image is built from).
 * A fork runs scripts/set-repo.mjs, which lists this file, to point it at its own slug.
 * @public
 */
export const RESTORE_DOCS_URL = 'https://github.com/stanislav-petryashov/monido/blob/master/docs/deploy-docker.md#backup-and-restore'

/** How long the "restored" notification shows before the page reloads with the restored data. */
const RELOAD_DELAY_MS = 1500

type Busy = 'csv' | 'restore' | 'preview' | 'kept' | null
interface Preview { lastPeriod: string | null; accounts: number; goals: number }
interface RestoreResult { kept: string; restoredAt: string }

interface RestoreDialogProps {
  /** Downloads a database copy (the page's own handler: the same toast and busy state) */
  onBackup: () => void
  /** A download is running */
  busy: boolean
  /** Restores the exact file shown in this preview */
  onConfirm: () => void
  file: File
  preview: Preview
  onClose: () => void
}

/** A verified file preview; only the explicit confirmation authorizes replacement. */
function RestoreDialog({ onBackup, busy, onConfirm, onClose, file, preview }: RestoreDialogProps) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  // the focus starts on Cancel: an accidental Enter replaces nothing
  const { dialogRef, close } = useModalDialog(cancelRef)
  const titleId = useId()
  const textId = useId()

  return (
    <Dialog dialogRef={dialogRef} className="confirm-dialog restore-dialog" aria-labelledby={titleId} aria-describedby={textId} onClose={onClose} onCancel={e => { if (busy) e.preventDefault() }} onDismiss={() => { if (!busy) close() }}>
      <div className="confirm-dialog__panel">
        <Avatar icon={IconTrash} color="error" size="lg" />
        <h2 id={titleId} className="confirm-dialog__title">{t('data.params.restoreTitle')}</h2>
        <p id={textId} className="confirm-dialog__text">{t('data.params.restoreText')}</p>
        <p className="confirm-dialog__text">{t('data.params.previewNote')}</p>
        <dl className="restore-preview">
          <dt>{t('data.params.previewFile')}</dt><dd>{file.name}</dd>
          <dt>{t('data.params.previewModified')}</dt><dd>{fmtDayTime(file.lastModified)}</dd>
          <dt>{t('data.params.previewPeriod')}</dt><dd>{preview.lastPeriod ?? t('data.params.previewEmpty')}</dd>
          <dt>{t('data.params.previewAccounts')}</dt><dd>{preview.accounts}</dd>
          <dt>{t('data.params.previewGoals')}</dt><dd>{preview.goals}</dd>
        </dl>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onBackup}>{t('data.params.backupDownload')}</button>
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} disabled={busy} type="button" className="btn btn--ghost" onClick={() => close()}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--danger-solid" disabled={busy} onClick={onConfirm}>{t('data.params.restoreConfirm')}</button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * The "Backup" page: the whole database as one file (/api/backup), the data as CSV files (/api/export/csv) and a restore
 * from a backup file (/api/backup/restore). The database copy, restore and CSV export are not offered in the demo.
 */
export function BackupView() {
  const { t } = useTranslation()
  const demo = useAuth().mode === 'demo'
  const canManage = useCan('manage')
  /** Downloads and the restore: nothing to refetch (a restore reloads the page) */
  const write = useAdminWrite([])
  const [working, setBusy] = useState<Busy>(null)
  const backup = useBackupDownload()
  const busy = working !== null || backup.busy
  const [selected, setSelected] = useState<{ file: File; preview: Preview } | null>(null)
  const [completed, setCompleted] = useState<RestoreResult | null>(null)
  const resultQuery = useQuery({
    queryKey: ['admin', 'restore-result'],
    queryFn: () => apiFetch<{ result: RestoreResult | null }>('/api/backup/result'),
    enabled: canManage && !demo,
    ...ADMIN_QUERY,
  })
  const result = completed ?? resultQuery.data?.result
  const picker = useRef<HTMLInputElement>(null)

  async function downloadCsv() {
    setBusy('csv')
    await write(() => downloadFile('/api/export/csv'), t('data.params.csvSaved'), t('data.params.csvFailed'))
    setBusy(null)
  }

  async function previewFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSelected(null)
    setBusy('preview')
    await write(async () => {
      const preview = await apiUpload<Preview>('/api/backup/preview', file)
      setSelected({ file, preview })
    }, null, t('data.params.previewFailed'))
    setBusy(null)
  }

  async function restore() {
    if (!selected || busy) return
    setBusy('restore')
    let kept = ''
    const done = await write(async () => { kept = (await apiUpload<{ kept: string }>('/api/backup/restore', selected.file)).kept }, null, t('data.params.restoreFailed'))
    if (!done) { setBusy(null); return }
    setSelected(null)
    setCompleted({ kept, restoredAt: new Date().toISOString() })
    setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
  }

  async function downloadKept() {
    if (!result) return
    setBusy('kept')
    await write(() => downloadFile(`/api/backup/kept/${encodeURIComponent(result.kept)}`), null, t('data.params.backupFailed'))
    setBusy(null)
  }

  return (
    <>
      <SettingsSection title={t('data.params.backupSection')}>
        {canManage && !demo && <div className="data-task">
          <div><h3>{t('data.params.backupTitle')}</h3><p className="note">{t('data.params.backupNote')}</p></div>
          <button className="btn btn--primary" disabled={busy} onClick={backup.download}>{t('data.params.backupDownload')}</button>
        </div>}
        {!demo && <div className="data-task">
          <div><h3>{t('data.params.csvTitle')}</h3><p className="note">{t('data.params.csvNote')}</p></div>
          <button className="btn btn--ghost" disabled={busy} onClick={downloadCsv}>{t('data.params.csvExport')}</button>
        </div>}
        {canManage && !demo && <Notice tone="subtle">{t('data.params.backupPrivacy')}</Notice>}
        {demo && <a className="link-accent" href={RESTORE_DOCS_URL} target="_blank" rel="noopener noreferrer">{t('data.params.backupRestore')}</a>}
      </SettingsSection>
      {!demo && (
        <SettingsSection title={t('data.params.restoreSection')} description={canManage ? t('data.params.restoreNote') : undefined}>
          {!canManage && <ViewOnlyNote right="manage" />}
          {canManage && <>
            <div className="form-actions form-actions--start">
              <button className="btn btn--ghost" disabled={busy} onClick={() => picker.current?.click()}>{t('data.params.restoreFromFile')}</button>
              <a className="link-accent" href={RESTORE_DOCS_URL} target="_blank" rel="noopener noreferrer">{t('data.params.backupRestore')}</a>
            </div>
            <Notice tone="warning">{t('data.params.restoreWarning')}</Notice>
            {selected && <RestoreDialog onBackup={backup.download} busy={busy} file={selected.file} preview={selected.preview} onConfirm={restore} onClose={() => { if (!busy) setSelected(null) }} />}
            {result && <div className="data-restore-result" role="status">
              <h3>{t('data.params.restored')}</h3>
              <p className="note">{t('data.params.restoreResultDate', { date: fmtDayTime(result.restoredAt) })}</p>
              <p className="note">{t('data.params.restoredText', { kept: result.kept })}</p>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={downloadKept}>{t('data.params.keptDownload')}</button>
            </div>}
            <input ref={picker} className="sr-only" type="file" accept=".sqlite,application/vnd.sqlite3" hidden data-testid="restore-file" onChange={previewFile} />
          </>}
        </SettingsSection>
      )}
    </>
  )
}
