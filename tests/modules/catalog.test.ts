import { MODULES, moduleMeta, tableOwner } from '../../src/modules/catalog'
import { MODULE_KEYS } from '../../src/modules/types'
import { DATA_TABLES } from '../../src/server/rows'

/** A proposal's versions, votes and Telegram messages */
const COUNCIL_PARTS = ['proposal_votes', 'proposal_messages', 'proposal_versions']

describe('module catalog', () => {
  it('lists every key once, in the order of MODULE_KEYS', () => {
    expect(MODULES.map(m => m.key)).toEqual([...MODULE_KEYS])
  })

  it('owns only data tables (plus the settings rows and the advisor council), each table by at most one module', () => {
    const owned = MODULES.flatMap(m => m.tables)
    expect(new Set(owned).size).toBe(owned.length)
    for (const t of owned) expect([...DATA_TABLES, 'reminder_settings', 'advisor_settings', ...COUNCIL_PARTS, 'proposals']).toContain(t)
  })

  it('the advisor and reminders are absent in the demo; every other module is everywhere', () => {
    expect(MODULES.filter(m => m.notInDemo).map(m => m.key)).toEqual(['advisor', 'reminders'])
    expect(moduleMeta('loans').notInDemo).toBeUndefined()
  })

  it('knows who owns a table', () => {
    expect(tableOwner('loan_early_payments')?.key).toBe('loans')
    expect(tableOwner('assets')).toBeNull()
    expect(tableOwner('modules')).toBeNull()
  })
})
