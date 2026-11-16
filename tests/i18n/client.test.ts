import { applyFamilyLanguage, currentLanguage, i18n, initClientI18n, loadLocaleChunk, t } from '../../src/i18n/client'
import advisorEn from '../../src/locales/advisor/en-US.json'
import advisorRu from '../../src/locales/advisor/ru-RU.json'
import { stubStorage } from '../helpers/storage'

const KEY = 'modules.advisor.use.title'

function stubBrowserLanguages(languages: string[]) {
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true })
}

afterEach(async () => {
  delete (navigator as { languages?: unknown }).languages // back to the jsdom getter
  await initClientI18n('en-US')
})

describe('initClientI18n', () => {
  it('takes the browser language before the server answers', async () => {
    stubBrowserLanguages(['ru-RU'])
    await initClientI18n()
    expect(currentLanguage()).toBe('ru-RU')
    expect(document.documentElement.lang).toBe('ru-RU')
  })

  it('falls back to English when no browser language is offered', async () => {
    stubBrowserLanguages(['xx'])
    await initClientI18n()
    expect(currentLanguage()).toBe('en-US')
  })

  it('ignores a language stored by an older version', async () => {
    stubStorage('local', { 'ff-lang': 'ru-RU' })
    stubBrowserLanguages(['en-US'])
    await initClientI18n()
    expect(currentLanguage()).toBe('en-US')
  })

  it('prefers an explicit language over the browser', async () => {
    stubBrowserLanguages(['ru-RU'])
    await initClientI18n('en-US')
    expect(currentLanguage()).toBe('en-US')
  })
})

describe('applyFamilyLanguage', () => {
  it('switches the language and sets <html lang>, storing nothing', async () => {
    const stored = stubStorage('local')
    await applyFamilyLanguage('ru-RU')
    expect(currentLanguage()).toBe('ru-RU')
    expect(document.documentElement.lang).toBe('ru-RU')
    expect(stored.size).toBe(0)
    expect(t('language.label')).not.toBe(t('language.label', { lng: 'en-US' }))
  })
})

describe('loadLocaleChunk', () => {
  it('adds the chunk to the current language and to English, the fallback', async () => {
    await initClientI18n('ru-RU')
    expect(i18n.exists(KEY)).toBe(false)
    await loadLocaleChunk('advisor')
    expect(t(KEY)).toBe(advisorRu.modules.advisor.use.title)
    expect(t(KEY, { lng: 'en-US' })).toBe(advisorEn.modules.advisor.use.title)
  })

  it('keeps the main texts: the chunk is merged into the same namespace', async () => {
    const before = t('modules.advisor.title')
    await loadLocaleChunk('advisor')
    expect(t('modules.advisor.title')).toBe(before)
    expect(t(KEY)).toBe(advisorEn.modules.advisor.use.title)
  })

  it('leaves the imported locale files as they are: a new instance starts without the chunk', async () => {
    await initClientI18n('ru-RU')
    await loadLocaleChunk('advisor')
    await initClientI18n('ru-RU')
    expect(i18n.exists(KEY)).toBe(false)
    expect(i18n.exists(KEY, { lng: 'en-US' })).toBe(false)
  })

  it('a later language switch loads the chunk for the new language before switching', async () => {
    await loadLocaleChunk('advisor')
    await applyFamilyLanguage('ru-RU')
    expect(t(KEY)).toBe(advisorRu.modules.advisor.use.title)
  })

  it('a chunk asked for during a switch is loaded for the language being switched to', async () => {
    const switching = applyFamilyLanguage('ru-RU')
    await loadLocaleChunk('advisor')
    await switching
    expect(t(KEY)).toBe(advisorRu.modules.advisor.use.title)
  })

  it('a chunk asked for after the switch has loaded its chunks, before it changes the language, is loaded for the new one too', async () => {
    const change = i18n.changeLanguage.bind(i18n)
    let asked: Promise<void> | undefined
    // a lazy page opened at that moment: its loader asks for the chunk while i18n is still in English
    const spy = vi.spyOn(i18n, 'changeLanguage').mockImplementation((...args) => { asked = loadLocaleChunk('advisor'); return change(...args) })
    await applyFamilyLanguage('ru-RU')
    spy.mockRestore()
    await asked
    expect(t(KEY)).toBe(advisorRu.modules.advisor.use.title)
  })
})
