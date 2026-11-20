import { moduleHasEntries } from '../../../src/modules/monthEntries'
import { createTestDb } from '../../helpers/db'

describe('moduleHasEntries', () => {
  it('sees a month with category lines or category spending, not an empty one', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory');
      INSERT INTO flow_lines (date, bank, member, category_id, amount) SELECT '2031-07-01', 'Bank', 'Robin', id, 400 FROM spending_categories WHERE name = 'Food';
      INSERT INTO category_spending (date, category_id, source, amount, currency) SELECT '2031-08-01', id, 'manual', 120, 'USD' FROM spending_categories WHERE name = 'Food';
    `)
    expect(await moduleHasEntries('2031-07', { db })).toBe(true)
    expect(await moduleHasEntries('2031-08', { db })).toBe(true)
    expect(await moduleHasEntries('2031-09', { db })).toBe(false)
  })
})
