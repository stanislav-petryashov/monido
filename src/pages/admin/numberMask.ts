/** The group and decimal separators of `locale`, read from Intl ("1 250,5" in ru-RU, "1,250.5" in en-US). */
export function numberSymbols(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  return {
    group: parts.find(p => p.type === 'group')?.value ?? '',
    decimal: parts.find(p => p.type === 'decimal')?.value ?? '.',
  }
}

/** How a number field masks its text: the decimals it keeps, whether a minus is allowed, whether "12,345" means a thousand. */
export interface MaskOptions {
  decimals: number
  signed: boolean
  guessThousands: boolean
}

/**
 * The canonical text of what the user typed or pasted: digits, an optional leading "-" (a pasted dash or minus of any kind) and at most one ".".
 * A trailing "." and a lone "-" are kept (the number is still being typed); leading zeros are dropped.
 * Typed: the first "." or "," is the decimal. Pasted: a repeated separator is grouping, and when both appear the
 * last one is the decimal. With `guessThousands` and two decimals, a separator followed by exactly three digits after a
 * 1-3 digit non-zero whole part is a thousands separator. Extra decimals are cut when typed and rounded half away
 * from zero when pasted.
 */
export function maskNumber(typed: string, opts: MaskOptions, pasted: boolean): string {
  const negative = opts.signed && /^\s*[-−–‒﹣－]/.test(typed)
  const text = typed.replace(/[^\d.,]/g, '')
  let whole = text
  let fraction: string | null = null
  const decimalAt = decimalIndex(text, pasted)
  if (decimalAt >= 0) {
    whole = text.slice(0, decimalAt)
    fraction = text.slice(decimalAt + 1).replace(/\D/g, '')
  }
  whole = whole.replace(/\D/g, '')
  if (fraction !== null && opts.guessThousands && opts.decimals === 2 && fraction.length === 3 && whole.length >= 1 && whole.length <= 3 && /[1-9]/.test(whole)) {
    whole += fraction
    fraction = null
  }
  whole = whole.replace(/^0+(?=\d)/, '')
  if (fraction !== null) {
    if (pasted && fraction.length > opts.decimals) [whole, fraction] = roundDigits(whole, fraction, opts.decimals)
    fraction = fraction.slice(0, opts.decimals)
    if (opts.decimals === 0) fraction = null
    else if (pasted) fraction = fraction.replace(/0+$/, '')
  }
  if (fraction === '' && pasted) fraction = null
  let out = whole
  if (fraction !== null) out = `${whole === '' ? '0' : whole}.${fraction}`
  return negative ? `-${out}` : out
}

/** `whole.fraction` rounded half away from zero to `decimals` digits, on the digit strings (no float error). */
function roundDigits(whole: string, fraction: string, decimals: number): [string, string] {
  const kept = (whole || '0') + fraction.slice(0, decimals)
  const digits = fraction[decimals] >= '5' ? (BigInt(kept) + 1n).toString().padStart(kept.length, '0') : kept
  return [digits.slice(0, digits.length - decimals), digits.slice(digits.length - decimals)]
}

/** The index of the decimal separator in digits-and-separators `text`, or -1 when there is none. */
function decimalIndex(text: string, pasted: boolean): number {
  if (!pasted) return text.search(/[.,]/)
  const dots = text.split('.').length - 1
  const commas = text.split(',').length - 1
  if (dots > 0 && commas > 0) return Math.max(text.lastIndexOf('.'), text.lastIndexOf(','))
  if (dots > 1 || commas > 1) return -1
  return text.search(/[.,]/)
}

/** The canonical text as shown in the field: grouped, the decimal in the locale's symbol, the sign as a real minus (U+2212). */
export function showNumber(canonical: string, locale: string): string {
  const { group, decimal } = numberSymbols(locale)
  const negative = canonical.startsWith('-')
  const [whole, fraction] = (negative ? canonical.slice(1) : canonical).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, group)
  return `${negative ? '−' : ''}${grouped}${fraction === undefined ? '' : decimal + fraction}`
}

/**
 * How many digits and decimal separators stand before the caret: the position that survives re-grouping.
 * With `locale`, only that language's decimal symbol counts (its group symbol may be "." or ","); without it both do.
 */
export function significantBefore(text: string, caret: number, locale?: string): number {
  const decimal = locale === undefined ? null : numberSymbols(locale).decimal
  return countSignificant(text.slice(0, caret), decimal)
}

/** The caret position after the `count`-th digit or decimal separator of `display`; 0 lands after a leading minus. */
export function caretAt(display: string, count: number, locale: string): number {
  const { decimal } = numberSymbols(locale)
  let seen = 0
  const start = display.startsWith('−') ? 1 : 0
  if (count <= 0) return start
  for (let i = start; i < display.length; i++) {
    seen += countSignificant(display[i], decimal)
    if (seen >= count) return i + 1
  }
  return display.length
}

function countSignificant(text: string, decimal: string | null): number {
  let n = 0
  for (const ch of text) if (/\d/.test(ch) || (decimal === null ? ch === '.' || ch === ',' : ch === decimal)) n++
  return n
}
