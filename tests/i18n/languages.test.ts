import { FALLBACK_LANGUAGE, LANGUAGES, isLanguage, loadMessages, matchLanguage } from '../../src/i18n/languages'

describe('isLanguage', () => {
  it('accepts only the shipped locale codes', () => {
    expect(isLanguage('en-US')).toBe(true)
    expect(isLanguage('ru-RU')).toBe(true)
    expect(isLanguage('de-DE')).toBe(false)
    expect(isLanguage('ru')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })
})

describe('matchLanguage', () => {
  it('matches by the primary subtag when there is no exact match', () => {
    expect(matchLanguage(['ru'])).toBe('ru-RU')
    expect(matchLanguage(['en-GB'])).toBe('en-US')
  })

  it('skips tags without a locale and takes the first one that matches', () => {
    expect(matchLanguage(['de-DE', 'ru-UA'])).toBe('ru-RU')
    expect(matchLanguage(['ru-RU', 'en-US'])).toBe('ru-RU')
  })

  it('returns null when nothing matches', () => {
    expect(matchLanguage(['de'])).toBeNull()
    expect(matchLanguage([])).toBeNull()
  })
})

describe('loadMessages', () => {
  it('loads every listed language, English being the fallback', async () => {
    expect(FALLBACK_LANGUAGE).toBe('en-US')
    for (const lang of LANGUAGES) {
      const messages = await loadMessages(lang)
      expect(messages).toHaveProperty('language.name')
    }
  })
})
