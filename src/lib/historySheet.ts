// Reads a pasted or uploaded sheet of month-end balances into what a history import sends (src/domain/historyImport.ts).
// Two shapes: wide — a row per month, a column per account; long — a row per balance: month, account, balance and,
// optionally, the currency. Nothing leaves the browser until the person checks the import.

export type DecimalMark = ',' | '.'
export interface ParsedSheet {
  shape: 'wide' | 'long'
  /** The accounts as the sheet names them: the wide sheet's headers, the long sheet's account names in order of first use */
  accounts: string[]
  /** The long sheet's currency per account; null — the sheet has none for it */
  currencies: (string | null)[]
  /** Per month, the balances in `accounts` order; null — a blank cell */
  months: { month: string; values: (number | null)[] }[]
}
export type SheetProblem =
  | { code: 'empty' }
  | { code: 'no_columns' }
  | { code: 'bad_date'; row: number; text: string }
  | { code: 'bad_number'; row: number; text: string }
  | { code: 'duplicate'; row: number; month: string; account: string }
  | { code: 'currency_varies'; account: string }
export interface SheetResult {
  sheet: ParsedSheet | null
  problems: SheetProblem[]
  /** The decimal mark the numbers used: found in them, or the one given; 'ambiguous' — only groups of three digits, ask */
  decimal: DecimalMark | 'ambiguous'
}

const BLANK = new Set(['', '-', '–', '—'])
const CURRENCY_RE = /^[A-Z]{3}$/

/** Rows of cells: quoted cells may hold the delimiter, a doubled quote is a quote */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell.trim() === '') quoted = true
    else if (ch === delimiter) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  row.push(cell.trim()); rows.push(row)
  return rows.filter(r => r.some(c => c !== ''))
}

/** A tab first (a paste from a spreadsheet), then the one that splits every row into the same number of cells, more than one */
function detectDelimiter(text: string): string {
  for (const d of ['\t', ';', ',']) {
    const rows = splitRows(text, d)
    if (rows.length && rows[0].length > 1 && rows.every(r => r.length === rows[0].length)) return d
  }
  return text.includes('\t') ? '\t' : text.includes(';') ? ';' : ','
}

/**
 * A month as YYYY-MM from a date or a month: 2024-01, 2024-01-31, 2024/01, 31.01.2024, 01.2024, 01/2024, and a/b/2024
 * read day-first or month-first as `dayFirst` says. Null — not a date.
 */
function monthOfText(text: string, dayFirst: boolean): string | null {
  const ym = (y: string, m: string) => {
    const n = Number(m)
    return n >= 1 && n <= 12 && y.length === 4 ? `${y}-${String(n).padStart(2, '0')}` : null
  }
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[ T].*)?$/.exec(text)
  if (m) return ym(m[1], m[2])
  m = /^(\d{1,2})[./-](\d{4})$/.exec(text)
  if (m) return ym(m[2], m[1])
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?:[ T].*)?$/.exec(text)
  if (m) return ym(m[4], m[2] === '.' || dayFirst ? m[3] : m[1])
  return null
}

/** a/b/YYYY is day-first when some first part is over 12, month-first when some second part is; else day-first (the month-end day is over 12 almost always) */
function dayFirstOf(cells: string[]): boolean {
  const pairs = cells.flatMap(c => {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(c)
    return m ? [[Number(m[1]), Number(m[2])]] : []
  })
  if (pairs.some(([a]) => a > 12)) return true
  if (pairs.some(([, b]) => b > 12)) return false
  return true
}

/** The number's characters only: spaces, currency signs and apostrophe groups gone; (x) is −x */
function cleanNumber(text: string): string | null {
  let s = text.replace(/[\s\u00a0\u202f'’]/g, '').replace(/[$€£¥₽₸₴₺₹]/g, '').replace(/^[A-Z]{3}|[A-Z]{3}$/g, '')
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-') || s.startsWith('−')
  s = s.replace(/^[(\-−]|\)$/g, '')
  return /^\d[\d.,]*$/.test(s) ? (negative ? '-' : '') + s : null
}

/** The decimal mark the cells show: the later of two marks in a cell; a mark not followed by exactly three digits; else ambiguous */
function detectDecimal(cells: string[]): DecimalMark | 'ambiguous' | null {
  let found: DecimalMark | null = null
  let grouped = false
  for (const c of cells) {
    const s = c.replace(/^-/, '')
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
    if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? ',' : '.'
    const mark = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null
    if (!mark) continue
    const parts = s.split(mark)
    if (parts.length > 2) { found ??= mark === ',' ? '.' : ','; continue }
    if (parts[1].length !== 3) found ??= mark
    else grouped = true
  }
  return found ?? (grouped ? 'ambiguous' : null)
}

function toNumber(clean: string, decimal: DecimalMark): number {
  const group = decimal === ',' ? '.' : ','
  return Number(clean.split(group).join('').replace(decimal, '.'))
}

/**
 * Parses the sheet. The shape follows the cells: a sheet whose second column holds text (an account name) under a first
 * column of dates is long; one whose cells after the first are numbers or blank is wide. `decimal` settles an
 * ambiguous decimal mark (`1,234` alone): never guessed, since a wrong guess changes the amount a thousandfold.
 */
export function parseHistorySheet(text: string, decimal?: DecimalMark): SheetResult {
  const rows = splitRows(text.replace(/^\uFEFF/, ''), detectDelimiter(text))
  if (rows.length < 2) return { sheet: null, problems: [{ code: 'empty' }], decimal: '.' }
  const [header, ...data] = rows
  if (header.length < 2) return { sheet: null, problems: [{ code: 'no_columns' }], decimal: '.' }
  const dayFirst = dayFirstOf(data.map(r => r[0] ?? ''))
  const isNumberish = (c: string) => BLANK.has(c) || cleanNumber(c) !== null
  const long = header.length >= 3 && header.length <= 4 && data.every(r => !isNumberish(r[1] ?? ''))
  const valueCells = long ? data.map(r => r[2] ?? '') : data.flatMap(r => r.slice(1))
  const found = detectDecimal(valueCells.flatMap(c => cleanNumber(c) ?? []))
  const mark: DecimalMark | 'ambiguous' = decimal ?? found ?? '.'
  const problems: SheetProblem[] = []
  const value = (cell: string, row: number): number | null => {
    if (BLANK.has(cell)) return null
    const clean = cleanNumber(cell)
    if (clean === null) { problems.push({ code: 'bad_number', row, text: cell }); return null }
    return mark === 'ambiguous' ? null : toNumber(clean, mark)
  }
  const monthAt = (cell: string, row: number) => {
    const m = monthOfText(cell, dayFirst)
    if (!m) problems.push({ code: 'bad_date', row, text: cell })
    return m
  }

  if (!long) {
    const accounts = header.slice(1)
    const months = data.flatMap((r, i) => {
      const month = monthAt(r[0] ?? '', i + 2)
      const values = accounts.map((_, j) => value(r[j + 1] ?? '', i + 2))
      return month ? [{ month, values }] : []
    })
    return { sheet: { shape: 'wide', accounts, currencies: accounts.map(() => null), months }, problems, decimal: mark }
  }

  const accounts: string[] = [], currencies: (string | null)[] = []
  const byMonth = new Map<string, (number | null)[]>()
  data.forEach((r, i) => {
    const month = monthAt(r[0] ?? '', i + 2)
    const name = r[1] ?? ''
    const amount = value(r[2] ?? '', i + 2)
    const currency = CURRENCY_RE.test((r[3] ?? '').toUpperCase()) ? (r[3] ?? '').toUpperCase() : null
    let j = accounts.indexOf(name)
    if (j < 0) { accounts.push(name); currencies.push(currency); j = accounts.length - 1 }
    else if (currency && currencies[j] && currencies[j] !== currency && !problems.some(p => p.code === 'currency_varies' && p.account === name)) problems.push({ code: 'currency_varies', account: name })
    else if (currency) currencies[j] ??= currency
    if (!month) return
    const values = byMonth.get(month) ?? []
    if (values[j] !== undefined && values[j] !== null) problems.push({ code: 'duplicate', row: i + 2, month, account: name })
    values[j] = amount
    byMonth.set(month, values)
  })
  const months = [...byMonth].map(([month, values]) => ({ month, values: accounts.map((_, j) => values[j] ?? null) }))
  return { sheet: { shape: 'long', accounts, currencies, months }, problems, decimal: mark }
}
