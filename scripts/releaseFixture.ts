// Writes tests/fixtures/releases/<release>.sql: a small family in a database made by that release's own schema
// (`git show <tag>:schema.sql`, or the tag's migrations before 0.42.0), dumped as SQL text.
//   npm run fixture:release -- <release> [<git tag>]   (no tag: the working tree's schema.sql)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

const [release, tag] = process.argv.slice(2)
if (!release) throw new Error('usage: npm run fixture:release -- <release> [<git tag>]')
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })
const db = new DatabaseSync(':memory:')

if (!tag) db.exec(readFileSync('schema.sql', 'utf8'))
else if (git('ls-tree', '--name-only', tag, 'schema.sql').trim()) db.exec(git('show', `${tag}:schema.sql`))
else {
  // the migration runner of those releases: the bookkeeping table first, then every file recorded with its checksum
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)')
  for (const file of git('ls-tree', '--name-only', tag, 'migrations/').trim().split('\n')) {
    const text = git('show', `${tag}:${file}`)
    db.exec(text)
    const checksum = createHash('sha256').update(text).digest('hex')
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(basename(file), '2026-01-01T00:00:00.000Z', checksum)
  }
}

const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
function insert(table: string, rows: Record<string, SQLInputValue>[]) {
  for (const row of rows) {
    const columns = Object.keys(row)
    db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row))
  }
}

const months = ['2026-01', '2026-02', '2026-03']
const monthEnd = { '2026-01': '2026-01-31', '2026-02': '2026-02-28', '2026-03': '2026-03-31' } as Record<string, string>
const at = '2026-04-02T10:00:00.000Z'

insert('app_settings', [{ key: 'currency', value: 'USD' }, { key: 'setup_state', value: 'done' }, { key: 'track_flows', value: '1' }])
insert('members', [{ name: 'Robin' }, { name: 'Noa' }])
insert('users', [
  { member: 'Robin', email: 'robin@example.test', can_edit: 1, can_vote: 1, can_manage: 1, created_at: at, updated_at: at },
  { member: 'Noa', telegram_id: '1002', telegram_name: 'noa', can_edit: 0, can_vote: 1, can_manage: 0, created_at: at, updated_at: at },
])
insert('assets', months.flatMap((m, i) => [
  { date: monthEnd[m], class: 'bank', name: 'Checking', value: 10000 + 1000 * i, currency: 'USD', member: 'Robin' },
  { date: monthEnd[m], class: 'broker', name: 'Brokerage', value: [8000, 8200, 8500][i], currency: 'EUR', member: 'Noa' },
]))
insert('assets', [{ date: '2026-01-31', class: 'bank', name: 'Old card', value: 300, currency: 'USD', member: 'Robin' }])
insert(has('account_closings') ? 'account_closings' : 'account_closures', [{ name: 'Old card', member: 'Robin', closed_month: '2026-01' }])
if (has('account_transfers')) {
  insert('account_transfers', [
    { date: '2026-02-01', name: 'Brokerage', member: 'Noa', amount: 200, currency: 'EUR' },
    { date: '2026-03-01', name: 'Brokerage', member: 'Noa', amount: 0, currency: 'EUR' },
  ])
}
insert('fx_rates', months.flatMap((m, i) => [`${m}-01`, monthEnd[m]].map(date => ({ date, currency: 'EUR', per_usd: [0.92, 0.93, 0.91][i], source_date: date }))))
insert('real_estate', [{ name: 'Flat', purchase_date: '2020-05-01', purchase_price: 150000, purchase_currency: 'USD', valuation_year: 2026, value: 180000, currency: 'USD', member: 'Robin' }])
insert('loans', [{ name: 'Mortgage', description: 'Flat', issue_date: '2024-01-15', principal: 120000, rate: 6, term_months: 240, monthly_payment: 859.72, currency: 'USD', member: 'Robin', payment_day: 15, status: 'active', type: 'mortgage', secured_by: 'Flat' }])
insert('loan_payments', months.map(m => ({ date: `${m}-01`, loan_name: 'Mortgage', amount: 859.72, currency: 'USD' })))
insert('loan_early_payments', [{ loan_name: 'Mortgage', payment_date: '2026-02-20', amount: 5000, strategy: 'reduce_term', notes: 'bonus' }])
insert('monthly_cashflow', months.map(m => ({ date: `${m}-01`, bank: 'Checking', member: 'Robin', active_income: 6000, passive_income: 30, expense: 4100, currency: 'USD' })))
insert('spending_categories', [{ id: 2, name: 'Groceries', kind: 'mandatory', flow: 'expense', one_off: 0 }, { id: 3, name: 'Travel', kind: 'optional', flow: 'expense', one_off: 1 }])
insert('category_spending', months.flatMap(m => [
  { date: `${m}-01`, category_id: 1, source: 'Checking', amount: 859.72, currency: 'USD' },
  { date: `${m}-01`, category_id: 2, source: 'Checking', amount: 900, currency: 'USD' },
]))
insert('flow_lines', months.map(m => ({ date: `${m}-01`, bank: 'Checking', member: 'Robin', category_id: 2, amount: 900 })))
insert('closed_months', months.map((m, i) => ({ month: m, closed_at: `2026-0${i + 2}-02T10:00:00.000Z`, closed_by: 'robin@example.test' })))
insert('goals', [{ id: 'vacation', name: 'Vacation', target: 5000, current: 1200, target_date: '2026-12-31', currency: 'EUR' }])
insert('parameters', [{ key: 'expected_return', value: 0.07, description: 'Expected yearly return' }])
insert('change_log', [{ ts: at, actor: 'robin@example.test', source: 'admin', table_name: 'assets', row_id: 1, op: 'insert', after_json: '{"name":"Checking"}' }])
insert('proposals', [{ id: 1, type: 'credit', author_id: 1, status: 'accepted', created_at: at, deadline_at: '2026-04-16T10:00:00.000Z', decided_at: at }])
insert('proposal_versions', [{ id: 1, proposal_id: 1, number: 1, title: 'New car', question: 'Can we take a car loan?', scenario_json: '{}', evaluation_json: '{}', base_currency: 'USD', verdict_json: '{}', voters_json: '[1,2]', created_at: at }])
insert('proposal_votes', [{ version_id: 1, user_id: 2, vote: 'agree', settled: 1, settled_by: 'button', voted_at: at, settled_at: at }])
if (has('user_identities')) {
  insert('user_identities', [{ user_id: 1, issuer: 'https://id.example.test', subject: 'robin', linked_at: at }])
  insert('identity_invites', [{ user_id: 2, hash: 'invite-hash', expires_at: '2026-04-09T10:00:00.000Z' }])
}

// the dump: tables with their rows, then indexes and triggers (so no trigger fires while loading), then the version
const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as { type: string; name: string; sql: string }[]
const quoted = (table: string) => `"${table.replace(/"/g, '""')}"`
const lines = [`-- ${release}: written by scripts/releaseFixture.ts${tag ? ` from ${tag}` : ''}; see README.md`, 'PRAGMA foreign_keys = OFF;', 'BEGIN;']
for (const { name, sql } of objects.filter(o => o.type === 'table')) {
  lines.push(`${sql};`)
  const columns = (db.prepare(`PRAGMA table_info(${quoted(name)})`).all() as { name: string }[]).map(c => quoted(c.name))
  for (const row of db.prepare(`SELECT ${columns.map(c => `quote(${c})`).join(` || ', ' || `)} AS v FROM ${quoted(name)} ORDER BY rowid`).all()) {
    lines.push(`INSERT INTO ${quoted(name)} (${columns.join(', ')}) VALUES (${String(row.v)});`)
  }
}
lines.push('DELETE FROM sqlite_sequence;')
for (const row of db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all()) lines.push(`INSERT INTO sqlite_sequence VALUES ('${String(row.name)}', ${String(row.seq)});`)
for (const { sql } of objects.filter(o => o.type !== 'table')) lines.push(`${sql};`)
lines.push(`PRAGMA user_version = ${String(db.prepare('PRAGMA user_version').get()!.user_version)};`, 'COMMIT;', 'PRAGMA foreign_keys = ON;', '')
writeFileSync(`tests/fixtures/releases/${release}.sql`, lines.join('\n'))
