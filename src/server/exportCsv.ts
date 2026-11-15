// The family's data as CSV files in one zip: the "Export to CSV" button of Settings → Data.
import { isoDate } from '../domain/dates'
import type { Database } from './db'
import { attachment } from './http'
import { DATA_TABLES, tableColumns } from './rows'
import { zipStore } from './zip'

/** The tables exported: every Data-section table and the list of closed months. */
const CSV_TABLES = [...DATA_TABLES, 'closed_months', 'availability_assessments'] as const

const BOM = '\uFEFF'

/** A text cell a spreadsheet would run as a formula (CSV injection): its first character is one of these. */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV field: null is empty, a number as stored; text that starts like a formula gets a leading apostrophe;
 * quoted with doubled quotes when it holds a comma, a quote or a line break.
 */
function field(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const line = (values: unknown[]) => `${values.map(field).join(',')}\r\n`

/** A table as CSV text: UTF-8 BOM, a header row of its columns, the rows in rowid order. */
async function tableCsv(db: Database, table: string): Promise<string> {
  const columns = (await tableColumns(db, table)).map(c => c.name)
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  return BOM + line(columns) + results.map(row => line(columns.map(c => row[c]))).join('')
}

/** monido-YYYY-MM-DD-csv.zip with one <table>.csv per exported table. */
export async function exportCsv(db: Database, now = new Date()): Promise<Response> {
  const encoder = new TextEncoder()
  const files = await Promise.all(CSV_TABLES.map(async table => ({ name: `${table}.csv`, data: encoder.encode(await tableCsv(db, table)) })))
  const zip = zipStore(files)
  return attachment(zip, { type: 'application/zip', length: zip.byteLength, filename: `monido-${isoDate(now)}-csv.zip` })
}
