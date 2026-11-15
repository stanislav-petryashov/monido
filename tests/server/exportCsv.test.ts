import { describe, expect, it } from 'vitest'
import { crc32 } from 'node:zlib'
import { createApp } from '../../src/server/app'
import { exportCsv } from '../../src/server/exportCsv'
import { DATA_TABLES } from '../../src/server/rows'
import { zipStore } from '../../src/server/zip'
import { createTestDb, testConfig } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../helpers/session'

const NOW = new Date('2031-10-19T10:00:00Z')

interface Entry { name: string; data: Uint8Array; crc: number; method: number }

/** Reads a zip by its local headers and checks the central directory agrees. */
function readZip(zip: Uint8Array): Entry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const entries: Entry[] = []
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true)
    const crc = view.getUint32(at + 14, true)
    const size = view.getUint32(at + 18, true)
    expect(view.getUint32(at + 22, true)).toBe(size)
    const nameLength = view.getUint16(at + 26, true)
    const extraLength = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLength))
    const start = at + 30 + nameLength + extraLength
    entries.push({ name, method, crc, data: zip.subarray(start, start + size) })
    at = start + size
  }
  // the central directory follows the last entry, and the end record counts the entries and points at it
  expect(view.getUint32(at, true)).toBe(0x02014b50)
  const end = zip.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  expect(view.getUint16(end + 10, true)).toBe(entries.length)
  expect(view.getUint32(end + 16, true)).toBe(at)
  return entries
}

const text = (data: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(data)

describe('zipStore', () => {
  it('stores the files readable, with their names and zlib CRCs', () => {
    const files = [
      { name: 'a.csv', data: new TextEncoder().encode('one,two\r\n') },
      { name: 'notes-é.txt', data: new Uint8Array() },
      { name: 'b.bin', data: Uint8Array.from({ length: 1000 }, (_, i) => i % 251) },
    ]
    const entries = readZip(zipStore(files))
    expect(entries.map(e => e.name)).toEqual(files.map(f => f.name))
    entries.forEach((e, i) => {
      expect(e.method).toBe(0)
      expect(e.crc).toBe(crc32(files[i].data))
      expect([...e.data]).toEqual([...files[i].data])
    })
  })
})

describe('exportCsv', () => {
  it('zips one CSV per family table with a BOM, a header, quoting and empty nulls', async () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO goals (id, name, target, current, target_date, emoji, currency) VALUES ('g1', 'Car, new', 20000.5, 0, '2032-01-01', NULL, 'USD')`)
    db.sqlite.exec(`INSERT INTO parameters (key, value, description) VALUES ('note', 3, 'He said "hi"
next line')`)
    db.sqlite.exec(`INSERT INTO closed_months (month, closed_at, closed_by) VALUES ('2031-09', '2031-10-01T00:00:00Z', 'owner')`)

    const res = await exportCsv(db, NOW)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="monido-2031-10-19-csv.zip"')
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const entries = readZip(new Uint8Array(await res.arrayBuffer()))
    expect(entries.map(e => e.name).sort()).toEqual([...DATA_TABLES, 'closed_months', 'availability_assessments'].map(t => `${t}.csv`).sort())
    expect(entries.map(e => e.name)).toContain('flow_lines.csv')
    for (const e of entries) {
      expect([...e.data.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      expect(e.crc).toBe(crc32(e.data))
    }
    const file = (name: string) => text(entries.find(e => e.name === name)!.data).slice(1)

    const goals = file('goals.csv').split('\r\n')
    const header = goals[0].split(',')
    expect(header).toEqual(expect.arrayContaining(['id', 'name', 'target', 'current', 'emoji', 'currency']))
    const row = Object.fromEntries(header.map((h, i) => [h, goals[1].match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map(c => c.replace(/,$/, ''))[i]]))
    expect(row).toMatchObject({ id: 'g1', name: '"Car, new"', target: '20000.5', current: '0', emoji: '', currency: 'USD' })

    expect(file('parameters.csv')).toContain('"He said ""hi""\nnext line"')
    expect(file('closed_months.csv').split('\r\n')[1]).toBe('2031-09,2031-10-01T00:00:00Z,owner')
    // an empty table still has its header
    expect(file('loans.csv').split('\r\n')).toHaveLength(2)
    expect(file('loans.csv').endsWith('\r\n')).toBe(true)
  })

  it('prefixes text that a spreadsheet would run as a formula with an apostrophe, numbers stay as stored', async () => {
    const db = createTestDb()
    const add = db.sqlite.prepare('INSERT INTO goals (id, name, target, current, target_date, emoji, currency) VALUES (?, ?, ?, ?, ?, ?, ?)')
    add.run('g1', '=HYPERLINK("http://x","y")', -12.5, 0, '2032-01-01', '+1', 'USD')
    add.run('g2', '-2+3', 10, -3, '2032-01-01', '@SUM(A1)', 'USD')
    add.run('g3', '\tTab', 1, 0, '2032-01-01', '\rCR', 'USD')
    add.run('g4', 'Plain - text = fine', 1, 0, '2032-01-01', null, 'USD')

    const entries = readZip(new Uint8Array(await (await exportCsv(db, NOW)).arrayBuffer()))
    const lines = text(entries.find(e => e.name === 'goals.csv')!.data).slice(1).split('\r\n')
    const header = lines[0].split(',')
    const cell = (row: string, column: string) => row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map(c => c.replace(/,$/, ''))[header.indexOf(column)]
    const row = (id: string) => lines.find(l => l.startsWith(`${id},`))!
    expect(cell(row('g1'), 'name')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(cell(row('g1'), 'target')).toBe('-12.5')
    expect(cell(row('g1'), 'emoji')).toBe("'+1")
    expect(cell(row('g2'), 'name')).toBe("'-2+3")
    expect(cell(row('g2'), 'current')).toBe('-3')
    expect(cell(row('g2'), 'emoji')).toBe("'@SUM(A1)")
    expect(cell(row('g3'), 'name')).toBe("'\tTab")
    expect(text(entries.find(e => e.name === 'goals.csv')!.data)).toContain(`"'\rCR"`)
    expect(cell(row('g4'), 'name')).toBe('Plain - text = fine')
  })

  it('is served at GET /api/export/csv to a signed-in user', async () => {
    const config = testConfig({ password: FAMILY_PASSWORD })
    const auth = authFor(config)
    const app = createApp({ db: createTestDb(), config, auth })
    const headers = { Cookie: await familyCookie(auth) }
    expect((await app.request('/api/export/csv')).status).toBe(401)
    const res = await app.request('/api/export/csv', { headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="monido-\d{4}-\d{2}-\d{2}-csv\.zip"$/)
    expect((await app.request('/api/export/csv', { method: 'POST', headers })).status).toBe(405)
  })
})

it('the user guide names the file the export actually saves', async () => {
  const { readFileSync } = await import('node:fs')
  const guide = readFileSync(new URL('../../docs/user-guide.md', import.meta.url), 'utf8')
  expect(guide).toContain('`monido-YYYY-MM-DD-csv.zip`')
  expect(guide).not.toContain('family-finance-YYYY-MM-DD-csv.zip')
})
