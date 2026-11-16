/**
 * Locale keys whose value in a language is the same as in English on purpose (a brand, a code, a word the language
 * keeps), by language. tests/i18n/locales.test.ts fails on any other value copied from English.
 */
export const SAME_AS_ENGLISH: Record<string, readonly string[]> = {
  // Monido, Telegram, @BotFather, 'v{{value}}' and the '1 USD = …' rate formulas
  'ru-RU': ['app.title', 'common.versionShort', 'nav.rate', 'users.signIn.options.telegram', 'users.signIn.switch.flow.botFather', 'users.columns.telegram', 'data.params.rateValue', 'data.params.ratePrefix', 'data.params.rateInverse'],
}
