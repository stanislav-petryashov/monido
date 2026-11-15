import { advisorHarness } from './harness'

describe('advisorHarness telegram mode', () => {
  it('callAs reaches a tool as each of two distinct editing users', async () => {
    const { db, callAs } = advisorHarness({ telegram: true })
    const ids = (db.sqlite.prepare('SELECT id FROM users WHERE can_edit = 1 ORDER BY id LIMIT 2').all() as { id: number }[]).map(r => r.id)
    expect(ids).toHaveLength(2)
    for (const id of ids) {
      const res = await callAs(id, 'list_spending_categories')
      expect(res.status).toBe(200)
      expect((await res.json() as { result: { categories: unknown[] } }).result.categories.length).toBeGreaterThan(0)
    }
  })
})
