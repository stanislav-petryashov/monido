import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { clearBootstrapLanguage } from '../../../lib/bootstrapLanguage'
import { applyFamilyLanguage, currentLanguage } from '../../../i18n/client'
import { LANGUAGES, languageName, type Language } from '../../../i18n/languages'
import { useFamilyLanguage, useFamilySettings, useSaveFamilySetting } from '../../../lib/familySettings'
import { DateFormatField } from '../../admin/ui/DateFormatField'
import { useToast } from '../../../lib/notifyState'
import { Field } from '../../admin/ui/Field'
import { OptionPicker } from '../../admin/ui/OptionPicker'
import { isOptionGroup } from '../../admin/ui/optionGroup'
import { SetupBar, type StepProps } from '../SetupBar'
import { SetupLoadError } from '../SetupLoadError'

/** Set by a pick that switches the language: the remount it causes puts the focus back on the language control. */
let refocusPick = false

/**
 * Step 1: what the setup does and the family language. A pick switches the page at once (the language in force is the
 * pick, so a remount on the switch starts from it, with the focus back on the language control); "Start" and "Skip for
 * now" save it when it differs from the stored one.
 */
export function WelcomeStep({ wizard }: StepProps) {
  const { t } = useTranslation()
  const Heading = wizard.again ? 'h2' : 'h1'
  const settings = useFamilySettings()
  const save = useSaveFamilySetting()
  const toast = useToast()
  const [picked, setPicked] = useState<Language>(currentLanguage)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!refocusPick) return
    refocusPick = false
    formRef.current?.querySelector<HTMLElement>('.option-picker__input:checked, select')?.focus()
  }, [])
  const stored = useFamilyLanguage()

  function pick(language: Language) {
    setPicked(language)
    refocusPick = language !== currentLanguage()
    applyFamilyLanguage(language).catch((e: unknown) => {
      refocusPick = false
      console.error('[language] switch failed', e)
      // the page stays in the language it has: the pick goes back to it, or Start would save a language that was never applied
      setPicked(currentLanguage())
      toast.error(t('data.setup.languageFailed'), e)
    })
  }

  /** The pick saved when it differs from the stored language; false when the write failed (its toast is the hook's). */
  async function saveLanguage(): Promise<boolean> {
    if (picked === stored) { clearBootstrapLanguage(); return true }
    try {
      await save.mutateAsync({ language: picked })
      clearBootstrapLanguage()
      return true
    } catch {
      return false
    }
  }

  async function run(then: () => void | Promise<void>) {
    if (busy || save.isPending) return
    setBusy(true)
    try {
      if (await saveLanguage()) await then()
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(wizard.next)
  }

  return (
    <form ref={formRef} className="form-stack" onSubmit={submit}>
      <Heading className="setup-card__title" tabIndex={-1}>{t('data.setup.welcomeTitle')}</Heading>
      <p className="setup-card__intro">{t(wizard.again ? 'data.setup.introAgain' : 'data.setup.intro')}</p>
      <Field label={t('data.params.language')} hint={t('data.params.languageHint')} group={isOptionGroup(LANGUAGES.length)}>
        <OptionPicker options={LANGUAGES.map(l => ({ value: l, label: languageName(l) }))} value={picked} disabled={busy} onChange={pick} />
      </Field>
      <DateFormatField value={settings.data?.dateFormat ?? 'dmy'} disabled={busy || save.isPending || !settings.data} onChange={dateFormat => save.mutate({ dateFormat })} />
      {wizard.readFailed && <SetupLoadError text={t('data.setup.stateFailed')} onRetry={wizard.retryReads} />}
      <SetupBar
        primary={t('data.setup.start')}
        busy={busy}
        disabled={settings.isPending || save.isPending}
        // both wait for the stored settings: before them every pick looks new and would be written
        // a re-run has nothing to skip: leaving needs no write, and `skipped` would undo a finished setup
        left={wizard.again ? undefined : <button type="button" className="btn btn--ghost setup-bar__skip" disabled={busy || settings.isPending || save.isPending} onClick={() => void run(wizard.skip)}>{t('data.setup.skip')}</button>}
      />
    </form>
  )
}
