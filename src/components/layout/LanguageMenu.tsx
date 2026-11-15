import { useEffect, useRef, useState } from 'react'
import { IconLanguage } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type Language } from '../../i18n/languages'
import { i18n, loadLanguageNames, applyFamilyLanguage } from '../../i18n/client'
import { RadioMenu } from '../ui/RadioMenu'

/** Names of the languages whose messages are already loaded; the rest show their code until the first open loads them. */
function knownNames(): Record<Language, string> {
  return Object.fromEntries(LANGUAGES.map(l => [l, i18n.hasResourceBundle(l, 'translation') ? i18n.getFixedT(l)('language.name') : l])) as Record<Language, string>
}

/**
 * Choosing a language remounts the whole tree below the query client (see App), this menu included;
 * the flag lets the new instance take the focus back instead of leaving it on the page body.
 */
let focusAfterSwitch = false

/** The sign-in screen's language menu (demo only); options are labelled in each language's own name. */
export function LanguageMenu() {
  const { t, i18n: active } = useTranslation()
  const [names, setNames] = useState(knownNames)
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
      options={LANGUAGES.map(l => ({ value: l, label: names[l] }))}
      onChange={choose}
      label={t('language.label')}
      triggerIcon={IconLanguage}
      onOpen={() => {
        // a locale that cannot load keeps its code as the label; the language itself can still be tried
        loadLanguageNames().then(setNames).catch((e: unknown) => console.error('[language] names failed to load', e))
      }}
      focusOnMount={refocus}
    />
  )
}
