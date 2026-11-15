import { describe, expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buildTemplate, resetTelegramForDemo } from '../../../src/server/demo/template'
import { SCHEMA_FILE, createTestDb } from '../../helpers/db'
import { withTempDirs } from '../../helpers/tmp'

// the writer leaves a linked chat and custom council days behind, as a database with Telegram set up would: only the reset clears them
vi.mock('../../../src/server/demo/writeFamily', async importOriginal => {
  const original = await importOriginal<typeof import('../../../src/server/demo/writeFamily')>()
  return {
    ...original,
    writeFamily: (db: DatabaseSync, family: Parameters<typeof original.writeFamily>[1]) => {
      original.writeFamily(db, family)
      db.exec("UPDATE reminder_settings SET enabled = 1, chat_id = '42'; UPDATE advisor_settings SET decide_days = 7, remind_days = NULL")
    },
  }
})

const tempDir = withTempDirs('demo-template-')

/** The closed months of a template file, read without the server's database wrapper. */
function closedMonths(file: string): { n: number; last: string } {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return db.prepare('SELECT COUNT(*) AS n, MAX(month) AS last FROM closed_months').get() as { n: number; last: string }
  } finally {
    db.close()
  }
}

describe('buildTemplate', () => {
  it('writes the family of the given day into dir/template.sqlite, and a rebuild replaces it', () => {
    const dir = tempDir()
    const first = buildTemplate({ dir, schemaFile: SCHEMA_FILE, today: '2026-10-21' })
    expect(first).toBe(join(dir, 'template.sqlite'))
    expect(closedMonths(first)).toEqual({ n: 36, last: '2026-08' })
    const second = buildTemplate({ dir, schemaFile: SCHEMA_FILE, today: '2027-01-15' })
    expect(second).toBe(first)
    expect(closedMonths(second)).toEqual({ n: 36, last: '2026-11' })
  })

  it('is one self-contained file: no temporary file, journal or WAL is left beside it', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'template.tmp'), 'a half-written template from a crash')
    buildTemplate({ dir, schemaFile: SCHEMA_FILE, today: '2026-10-21' })
    for (const leftover of ['template.tmp', 'template.tmp-wal', 'template.tmp-shm', 'template.sqlite-wal']) {
      expect(existsSync(join(dir, leftover)), leftover).toBe(false)
    }
  })

  it('creates the directory when it is missing', () => {
    const dir = join(tempDir(), 'nested', 'demo')
    expect(existsSync(buildTemplate({ dir, schemaFile: SCHEMA_FILE, today: '2026-10-21' }))).toBe(true)
  })
})

describe('demo reset', () => {
  it('unlinks the reminder chat and resets the council days in a fresh template', () => {
    const file = buildTemplate({ dir: tempDir(), schemaFile: SCHEMA_FILE, today: '2031-10-19' })
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      expect(db.prepare('SELECT enabled, chat_id FROM reminder_settings').get()).toEqual({ enabled: 0, chat_id: null })
      expect(db.prepare('SELECT decide_days, remind_days FROM advisor_settings').get()).toEqual({ decide_days: 14, remind_days: 3 })
    } finally {
      db.close()
    }
  })

  it('resetTelegramForDemo drops a linked chat and puts the council days back', () => {
    const db = createTestDb()
    db.sqlite.exec("UPDATE reminder_settings SET enabled = 1, chat_id = '42', chat_title = 'Family chat', pairing_hash = 'h'; UPDATE advisor_settings SET decide_days = 7, remind_days = NULL")
    resetTelegramForDemo(db.sqlite)
    expect(db.sqlite.prepare('SELECT enabled, chat_id, chat_title, pairing_hash FROM reminder_settings').get())
      .toEqual({ enabled: 0, chat_id: null, chat_title: null, pairing_hash: null })
    expect(db.sqlite.prepare('SELECT decide_days, remind_days FROM advisor_settings').get()).toEqual({ decide_days: 14, remind_days: 3 })
  })
})
