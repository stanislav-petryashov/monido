import { FALLBACK_LANGUAGE, LANGUAGES, isLanguage, languageName, languageOr, loadMessages, matchLanguage } from '../../src/i18n/languages'

describe('isLanguage', () => {
  it('accepts only the shipped locale codes', () => {
    expect(isLanguage('en-US')).toBe(true)
    expect(isLanguage('ru-RU')).toBe(true)
    expect(isLanguage('xx-XX')).toBe(false)
    expect(isLanguage('ru')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })
})

describe('LANGUAGES', () => {
  it('ships seven languages, English first', () => {
    expect(LANGUAGES).toEqual(['en-US', 'ru-RU', 'de-DE', 'es-ES', 'fr-FR', 'pt-BR', 'zh-CN'])
  })
})

describe('matchLanguage', () => {
  it('matches regional variants to the shipped language', () => {
    expect(matchLanguage(['es-MX'])).toBe('es-ES')
    expect(matchLanguage(['pt-PT'])).toBe('pt-BR')
    expect(matchLanguage(['de-AT'])).toBe('de-DE')
    expect(matchLanguage(['zh-TW'])).toBe('zh-CN')
    expect(matchLanguage(['fr-CA'])).toBe('fr-FR')
  })

  it('matches by the primary subtag when there is no exact match', () => {
    expect(matchLanguage(['ru'])).toBe('ru-RU')
    expect(matchLanguage(['en-GB'])).toBe('en-US')
  })

  it('skips tags without a locale and takes the first one that matches', () => {
    expect(matchLanguage(['xx-XX', 'ru-UA'])).toBe('ru-RU')
    expect(matchLanguage(['ru-RU', 'en-US'])).toBe('ru-RU')
  })

  it('returns null when nothing matches', () => {
    expect(matchLanguage(['xx'])).toBeNull()
    expect(matchLanguage([])).toBeNull()
  })
})

describe('loadMessages', () => {
  it('loads every listed language, English being the fallback', async () => {
    expect(FALLBACK_LANGUAGE).toBe('en-US')
    for (const lang of LANGUAGES) {
      const messages = await loadMessages(lang)
      expect(messages).toHaveProperty('language.label')
    }
  })
})

describe('languageName', () => {
  it('names each language in itself, from Intl, without loading its messages', () => {
    expect(languageName('en-US')).toBe('English')
    // Cyrillic stays out of source files: the Russian name by code point
    expect(languageName('ru-RU')).toBe(String.fromCodePoint(0x420, 0x443, 0x441, 0x441, 0x43a, 0x438, 0x439))
    expect(languageName('de-DE')).toBe('Deutsch')
    expect(languageName('es-ES')).toBe('Español')
    expect(languageName('fr-FR')).toBe('Français')
    expect(languageName('pt-BR')).toBe('Português')
    expect(languageName('zh-CN')).toBe('中文')
  })
})

describe('languageOr', () => {
  it('falls back to English for a code this build does not ship', () => {
    expect(languageOr('xx-XX')).toBe('en-US')
  })
})
