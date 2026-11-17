import './settings-navigation.css'
import './data-settings.css'
import { DangerZone } from '../admin/DangerZone'
import { BackupView } from './BackupView'
import { HistoryImport } from './HistoryImport'
import { SetupBlock } from './SetupBlock'

/** Everything about the family's data as a whole: copies and export, the history from a sheet, running the setup again, and starting over last. */
export function DataView() {
  return (
    <div className="general-settings data-settings controls--square controls--compact">
      <BackupView />
      <HistoryImport />
      <SetupBlock />
      <DangerZone />
    </div>
  )
}
