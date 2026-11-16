import { useEffect, useRef, useState } from 'react'
import { IconLanguage } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, languageName, type Language } from '../../i18n/languages'
import { applyFamilyLanguage } from '../../i18n/client'
import { RadioMenu } from '../ui/RadioMenu'

/**
 * Choosing a language remounts the whole tree below the query client (see App), this menu included;
 * the flag lets the new instance take the focus back instead of leaving it on the page body.
 */
let focusAfterSwitch = false

/** The sign-in screen's language menu (demo only); options are labelled in each language's own name. */
export function LanguageMenu() {
  const { t, i18n: active } = useTranslation()
  const [refocus] = useState(() => focusAfterSwitch) // a pure read: StrictMode renders twice
  useEffect(() => { focusAfterSwitch = false }, [])
  // Still mounted after the language changed: this instance was not replaced (the login screen sits
  // above the remount), so nobody will consume the flag — drop it, or the next menu would steal the focus.
  const shownLanguage = useRef(active.language)
  useEffect(() => {
    if (shownLanguage.current === active.language) return
    shownLanguage.current = active.language
    focusAfterSwitch = false
  }, [active.language])

  function choose(lang: Language) {
    if (lang === active.language) return // already active: nothing to switch, and no focus to take back
    focusAfterSwitch = true
    applyFamilyLanguage(lang).catch((e: unknown) => {
      // the language stays as it was; the menu keeps working
      focusAfterSwitch = false
      console.error('[language] switch failed', e)
    })
  }

  return (
    <RadioMenu
      value={active.language as Language}
      options={LANGUAGES.map(l => ({ value: l, label: languageName(l) }))}
      onChange={choose}
      label={t('language.label')}
      triggerIcon={IconLanguage}
      focusOnMount={refocus}
    />
  )
}
