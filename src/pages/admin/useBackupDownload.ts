import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadFile } from '../../lib/api'
import { useAdminWrite } from './adminQuery'

/** "Download a database copy" (GET /api/backup) with its toast; `busy` while the file is being fetched */
export function useBackupDownload(): { busy: boolean; download: () => Promise<void> } {
  const { t } = useTranslation()
  /** A download changes nothing to refetch */
  const write = useAdminWrite([])
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    await write(() => downloadFile('/api/backup'), t('data.params.backupSaved'), t('data.params.backupFailed'))
    setBusy(false)
  }
  return { busy, download }
}
