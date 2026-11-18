import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useFamilyLanguage } from '../../../lib/familySettings'
import { setupQuery } from '../../../lib/setup'
import { afterDemoData, useDemoDataAvailability } from '../../../lib/demoData'
import { navigate } from '../../../lib/router'
import { DemoDataDialog } from '../../admin/DemoDataDialog'
import { ChoiceCard } from '../ChoiceCard'
import { SetupBar, type StepProps } from '../SetupBar'
import { SetupLoadError } from '../SetupLoadError'

type Choice = 'own' | 'test'

/** Choose existing data or load the test family. A failed setup read assumes data exists to require confirmation. */
export function DataStep({ wizard }: StepProps) {
  const { t } = useTranslation()
  const Heading = wizard.again ? 'h2' : 'h1'
  const queryClient = useQueryClient()
  const availability = useDemoDataAvailability()
  const [choice, setChoice] = useState<Choice>('own')
  // the dialog asks with what the server says now: the step's read may be old (data added from a phone or by Claude meanwhile)
  const [asking, setAsking] = useState<{ hasData: boolean } | null>(null)
  const titleId = useId()
  const hasData = wizard.setup?.hasData ?? true
  const language = useFamilyLanguage() ?? undefined
  const testing = choice === 'test'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!testing) { wizard.next(); return }
    // a failed read counts as data: the typed word is asked rather than skipped
    const fresh = await queryClient.fetchQuery(setupQuery).then(view => view.hasData, () => true)
    setAsking({ hasData: fresh })
  }

  return (
    <>
      <form className="form-stack" onSubmit={e => void submit(e)}>
        <Heading id={titleId} className="setup-card__title" tabIndex={-1}>{t('data.setup.data.title')}</Heading>
        <fieldset className="setup-choice__group" aria-labelledby={titleId}>
          <ChoiceCard name="setup-data" value="own" checked={choice === 'own'} onChange={() => setChoice('own')}
            title={t(hasData ? 'data.setup.data.keep' : 'data.setup.data.own')}>
            {t(hasData ? 'data.setup.data.keepText' : 'data.setup.data.ownText')}
          </ChoiceCard>
          <ChoiceCard name="setup-data" value="test" checked={choice === 'test'} disabled={!availability.available} onChange={() => setChoice('test')}
            title={t('data.setup.data.test')}>
            {t('data.setup.data.testText')}{hasData ? ` ${t('data.setup.data.testTextWipe')}` : ''}
          </ChoiceCard>
        </fieldset>
        {choice === 'own' && !hasData && <p className="note">{t('data.setup.data.importHint')}</p>}
        {availability.failed && <SetupLoadError text={t('data.setup.data.testCheckFailed')} onRetry={availability.retry} />}
        <SetupBar onBack={wizard.back} primary={testing ? t('data.setup.data.load') : t('data.setup.next')} />
      </form>
      <DemoDataDialog
        open={asking !== null}
        confirmation={asking?.hasData === false ? 'plain' : 'word'}
        language={language}
        onDone={() => { setAsking(null); void afterDemoData(queryClient, navigate) }}
        onClose={() => setAsking(null)}
      />
    </>
  )
}
