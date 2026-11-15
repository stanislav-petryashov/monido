import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useFamilyLanguage } from '../../../lib/familySettings'
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
  const [asking, setAsking] = useState(false)
  const titleId = useId()
  const hasData = wizard.setup?.hasData ?? true
  const language = useFamilyLanguage() ?? undefined
  const testing = choice === 'test'

  function submit(e: FormEvent) {
    e.preventDefault()
    if (testing) setAsking(true)
    else wizard.next()
  }

  return (
    <>
      <form className="form-stack" onSubmit={submit}>
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
        {availability.failed && <SetupLoadError text={t('data.setup.data.testCheckFailed')} onRetry={availability.retry} />}
        <SetupBar onBack={wizard.back} primary={testing ? t('data.setup.data.load') : t('data.setup.next')} />
      </form>
      <DemoDataDialog
        open={asking}
        confirmation={hasData ? 'word' : 'plain'}
        language={language}
        onDone={() => { setAsking(false); void afterDemoData(queryClient, navigate) }}
        onClose={() => setAsking(false)}
      />
    </>
  )
}
