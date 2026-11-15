/** The ISO 4217 codes the browser knows; an engine without the list gives none, and a typed code still works. */
const CODES: readonly string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []

const MAX_MATCHES = 8

const namers = new Map<string, Intl.DisplayNames>()

/** The currency's name in `language`; the code itself where Intl has no name for it. */
export function currencyName(code: string, language: string): string {
  let namer = namers.get(language)
  if (!namer) {
    namer = new Intl.DisplayNames([language], { type: 'currency' })
    namers.set(language, namer)
  }
  return namer.of(code) ?? code
}

/**
 * The currencies a search finds, for the currency field of Parameters: a code that starts with the query (case-insensitive),
 * or a name in `language` or in English that contains it. The exact code first, then the code prefixes, then the names;
 * at most eight, without the codes in `exclude` (those the family already has). An empty query finds nothing.
 */
export function currencyMatches(query: string, language: string, exclude: readonly string[]): { code: string; name: string }[] {
  const q = query.trim()
  if (!q) return []
  const upper = q.toUpperCase()
  const lower = q.toLocaleLowerCase(language)
  const lowerEn = q.toLocaleLowerCase('en')
  const rank = (code: string): number | null => {
    if (code === upper) return 0
    if (code.startsWith(upper)) return 1
    if (currencyName(code, language).toLocaleLowerCase(language).includes(lower)) return 2
    if (currencyName(code, 'en').toLocaleLowerCase('en').includes(lowerEn)) return 2
    return null
  }
  return CODES
    .filter(code => !exclude.includes(code))
    .map(code => ({ code, rank: rank(code) }))
    .filter((m): m is { code: string; rank: number } => m.rank !== null)
    .sort((a, b) => a.rank - b.rank) // stable: the codes stay alphabetical within a rank
    .slice(0, MAX_MATCHES)
    .map(({ code }) => ({ code, name: currencyName(code, language) }))
}
