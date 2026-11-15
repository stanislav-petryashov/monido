import { expect, it } from 'vitest'
import ru from '../../src/locales/ru-RU.json'

/** `errors.http` is a status line ("HTTP {{status}}"): the one Russian error with no words to translate. */
const LANGUAGE_NEUTRAL = new Set(['http'])

it('every Russian errors.* text has Cyrillic, apart from placeholders and the HTTP status line', () => {
  const untranslated = Object.entries(ru.errors)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .filter(([key, text]) => !LANGUAGE_NEUTRAL.has(key) && /[A-Za-z]{4}/.test(text.replace(/\{\{[^}]*\}\}/g, '')) && !/\p{Script=Cyrillic}/u.test(text))
    .map(([key]) => key)
  expect(untranslated).toEqual([])
})
