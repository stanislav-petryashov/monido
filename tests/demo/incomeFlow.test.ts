import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFamily, familyCurrency } from '../../src/demo/family'
import { cashflowPeriodView } from '../../src/domain/cashflowPeriod'
import { incomeFlow, type FlowNode } from '../../src/domain/incomeFlow'
import { ASSET_PERIODS } from '../../src/domain/types'
import { LANGUAGES } from '../../src/i18n/languages'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { openDatabase } from '../../src/server/db'
import { initializeSchema } from '../../src/server/schema'
import { getSnapshot } from '../../src/server/snapshot'
import { SCHEMA_FILE } from '../helpers/db'

const TODAY = '2026-10-21'
const noFetch = (() => { throw new Error('no rate request expected') }) as unknown as typeof fetch
const cents = (nodes: FlowNode[]) => Math.round(nodes.reduce((a, n) => a + n.amount, 0) * 100)

async function snapshotOf(key: (typeof LANGUAGES)[number]) {
  const dir = mkdtempSync(join(tmpdir(), 'income-flow-'))
  const db = openDatabase(join(dir, 'finance.sqlite'))
  try {
    initializeSchema(db, SCHEMA_FILE)
    const family = buildFamily({ today: TODAY, family: key })
    writeFamily(db.sqlite, family)
    return await getSnapshot(db, { now: new Date(`${TODAY}T12:00:00Z`), fetchImpl: noFetch, currency: familyCurrency(family) })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.each(LANGUAGES)('where the income went, the %s family', key => {
  it('every period kind and both sides balance to the cent, every node and child at zero or above', async () => {
    const snapshot = await snapshotOf(key)
    const categorised = { spending: snapshot.spending.months, income: snapshot.income.months }
    for (const kind of ASSET_PERIODS) {
      const view = cashflowPeriodView(snapshot, kind, null)!
      for (const side of ['source', 'person'] as const) {
        const flow = incomeFlow(view, snapshot.flowExtras ?? [], categorised, side)
        if ('problem' in flow) throw new Error(`${kind} ${side}: ${flow.problem}`)
        expect(cents(flow.left), `${kind} ${side}`).toBe(cents(flow.right))
        expect(cents(flow.left), `${kind} ${side}`).toBe(Math.round(flow.total * 100))
        for (const n of [...flow.left, ...flow.right]) {
          expect(n.amount, n.key).toBeGreaterThan(0)
          if (n.children) expect(cents(n.children), n.key).toBe(Math.round(n.amount * 100))
        }
      }
    }
  }, 30_000)
})
