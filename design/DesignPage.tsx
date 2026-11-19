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
  const [lang, setLang] = useState<Language>('en-US')
  const switchLang = (next: Language) => { setLang(next); void applyFamilyLanguage(next) }
  return (
    <div className="dc">
      <header className="dc__bar">
        <strong>Monido design catalog</strong>
        <label>Theme <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
        </select></label>
        <label><input type="checkbox" checked={hidden} onChange={toggle} /> Privacy</label>
        <label>Language <select value={lang} onChange={e => switchLang(e.target.value as Language)}>
          <option value="en-US">en-US</option><option value="ru-RU">ru-RU</option>
        </select></label>
      </header>
      <p className="note dc__note">All the app's CSS is loaded at once here, so the cascade may differ from a page that loads its CSS lazily.</p>
      <Catalog />
    </div>
  )
}
