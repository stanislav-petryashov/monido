import copy from './locales/ru-RU.json'
import { useState } from 'react'
import { applyFamilyLanguage } from '../src/i18n/client'
import type { Language } from '../src/i18n/languages'
import { usePrivacy } from '../src/lib/privacy'
import { useThemeMode } from '../src/lib/themeState'
import { Catalog } from './Catalog'

/** The catalog: a bar of switches over the sections */
export function DesignPage() {
  const { mode, setMode } = useThemeMode()
  const { hidden, toggle } = usePrivacy()
  const [lang, setLang] = useState<Language>('ru-RU')
  const switchLang = (next: Language) => { setLang(next); void applyFamilyLanguage(next) }
  return (
    <div className="dc">
      <header className="dc__bar">
        <h1><img src="/favicon.svg" alt="" /> Monido</h1><span>{copy.designSystem}</span>
        <label>{copy.theme} <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="system">{copy.system}</option><option value="light">{copy.light}</option><option value="dark">{copy.dark}</option>
        </select></label>
        <label><input type="checkbox" checked={hidden} onChange={toggle} /> {copy.hideAmounts}</label>
        <label>{copy.sampleLanguage} <select value={lang} onChange={e => switchLang(e.target.value as Language)}>
          <option value="en-US">en-US</option><option value="ru-RU">ru-RU</option>
        </select></label>
      </header>
      <details className="dc__note"><summary>{copy.settingsHelp}</summary><p className="note">{copy.settingsNote}</p></details>
      <Catalog language={lang} settingsKey={mode + String(hidden)} />
    </div>
  )
}
