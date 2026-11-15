import { useEffect, type ReactNode } from 'react'
import { IconLogout } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import '../../styles/admin.css'
// its own .setup* classes: not only through SetupWizard (the same lazy chunk, so no extra request)
import '../../styles/setup.css'
import { Card } from '../../components/ui/Card'
import { currentLanguage } from '../../i18n/client'
import { useFamilySettings, useSaveFamilySetting } from '../../lib/familySettings'
import { useConfirm } from '../../lib/notifyState'
import { SetupWizard } from './SetupWizard'
import { useSetupWizard } from './useSetupWizard'

/**
 * The first run, standalone (no sidebar, no title row: there is nothing to navigate to yet): a slim header with the product,
 * the theme, the account menu and "Exit setup" (which, like "Skip for now", saves a picked language first), then the wizard's card. SetupGate draws it while the setup is pending and
 * hands over the shell's own pieces (`brand`: the logo; `tools`: the theme switch and the account menu): imported here, they
 * would be split out of the first bundle into a chunk shared with this lazy page, which costs the first load more than they weigh.
 */
export function SetupScreen({ brand, tools }: { brand: ReactNode; tools: ReactNode }) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  // only its way out is used here: the wizard below keeps the steps (the reads are shared through the query cache)
  const { skip } = useSetupWizard({ again: false })
  const settings = useFamilySettings()
  const save = useSaveFamilySetting()
  // index.html carries the English title; the shell sets its own once it is in
  useEffect(() => { document.title = t('app.title') }, [t])

  async function exit() {
    const ok = await confirm({ title: t('data.setup.exitTitle'), text: t('data.setup.exitText'), confirmLabel: t('data.setup.exitConfirm'), tone: 'warning' })
    if (!ok) return
    // as "Skip for now" does: the language picked on Welcome (the one in force) is saved when it differs from the stored one
    const picked = currentLanguage()
    if (settings.data && settings.data.language !== picked) {
      try {
        await save.mutateAsync({ language: picked })
      } catch {
        return // the hook's toast says so; the setup stays
      }
    }
    await skip()
  }

  return (
    <main className="setup">
      <div className="setup__head">
        <span className="setup__brand">{brand}{t('app.title')}</span>
        <div className="setup__tools">
          {tools}
          {/* waits for the stored settings like Skip for now: before them a picked language could not be compared, nor saved */}
          {/* on a phone only the icon stays, so the header is one row: the name is the aria-label there */}
          <button type="button" className="btn btn--ghost setup__exit" aria-label={t('data.setup.exit')} disabled={settings.isPending} onClick={() => void exit()}>
            <IconLogout size={18} stroke={1.75} aria-hidden="true" className="setup__exit-icon" />
            <span className="setup__exit-label">{t('data.setup.exit')}</span>
          </button>
        </div>
      </div>
      <Card className="setup-card controls--square"><SetupWizard again={false} /></Card>
    </main>
  )
}
