import { withLanguage, ru } from '../helpers/i18n'
import type { ChangeEntry } from '../../src/domain/api'
import { describeChange, isRevertible, journalActor, journalLine, journalSummary, journalUndoEffect, journalDetails } from '../../src/pages/admin/journal'

const base: ChangeEntry = {
  id: 1, ts: '2031-02-17T08:00:00.000Z', actor: 'owner@example.com', source: 'admin',
  table_name: 'parameters', row_id: 1, op: 'update', before_json: null, after_json: null, reverts_id: null,
}

describe('privacy mode', () => {
  const asset = { ...base, table_name: 'assets' }
  it('masks the amounts of a changed or inserted record, not the other fields', () => {
    expect(describeChange({ ...asset, before_json: '{"name":"Deposit","value":9000}', after_json: '{"name":"Deposit","value":9200}' }, true)).toBe('value: ••• → •••')
    expect(describeChange({ ...asset, op: 'insert', after_json: '{"name":"Deposit","value":9200,"member":null}' }, true)).toBe('name=Deposit, value=•••')
    expect(describeChange({ ...asset, before_json: '{"value":9000}', after_json: '{"value":9000}' }, true)).toBe('no changes')
    expect(journalLine(entry({}) as ChangeEntry, true)).toBe('Accounts · change: value: ••• → •••')
  })
  it('keeps what is not an amount: parameters and other columns', () => {
    expect(describeChange({ ...base, before_json: '{"key":"k","value":1}', after_json: '{"key":"k","value":2}' }, true)).toBe('value: 1 → 2')
    expect(describeChange({ ...asset, before_json: '{"name":"A","value":1}', after_json: '{"name":"B","value":1}' }, true)).toBe('name: A → B')
  })
})

describe('describeChange', () => {
  it('lists changed fields of an update', () => {
    expect(describeChange({ ...base, before_json: '{"key":"k","value":1}', after_json: '{"key":"k","value":2}' })).toBe('value: 1 → 2')
  })
  it('lists the fields of an insert or a delete', () => {
    expect(describeChange({ ...base, op: 'insert', after_json: '{"key":"k","value":1,"description":null}' })).toBe('key=k, value=1')
    expect(describeChange({ ...base, op: 'delete', before_json: '{"key":"k","value":1}' })).toBe('key=k, value=1')
  })
  it('names the change a revert undid', () => {
    expect(describeChange({ ...base, op: 'revert', reverts_id: 4 })).toBe('revert #4')
  })
})

const entry = (over: object) => ({ id: 1, ts: '2031-04-09T08:00:00Z', actor: 'me', source: 'admin', table_name: 'assets', row_id: 8, op: 'update', before_json: '{"value":6400}', after_json: '{"value":6650}', reverts_id: null, ...over })

describe('journalLine', () => {
  it('titles a family settings change', () => {
    const line = journalLine(entry({ table_name: 'app_settings', before_json: '{"key":"language","value":"en-US"}', after_json: '{"key":"language","value":"ru-RU"}' }) as ChangeEntry)
    expect(line.startsWith('Family settings · ')).toBe(true)
    expect(ru('data.journal.table.app_settings')).not.toBe('data.journal.table.app_settings')
  })

  it('names the modules and reminders tables', () => {
    expect(journalLine({ id: 1, ts: 't', actor: 'a', source: 'admin', table_name: 'modules', row_id: 1, op: 'update', before_json: '{"enabled":1}', after_json: '{"enabled":0}', reverts_id: null }))
      .toBe('Modules · change: enabled: 1 → 0')
  })

  it('says where, what kind of change and what changed, in one line', () => {
    expect(journalLine(entry({}))).toBe('Accounts · change: value: 6400 → 6650')
  })
  it('names a revert by the entry it undoes', () => {
    expect(journalLine(entry({ op: 'revert', reverts_id: 19 }))).toBe('Accounts · revert #19')
  })
  it('names the manual rates table', () => {
    expect(journalLine(entry({ table_name: 'fx_manual_rates', op: 'insert', before_json: null, after_json: '{"currency":"ARS"}' }))).toMatch(/^Manual rates · /)
  })
  it('falls back to the raw table name it does not know', () => {
    expect(journalLine(entry({ table_name: 'mystery', op: 'delete', after_json: null }))).toBe('mystery · deletion: value=6400')
  })
})

describe('journalLine in Russian', () => {
  it('uses the Russian names of the table, the operation and the revert', async () => {
    await withLanguage('ru-RU', () => {
      expect(journalLine(entry({}))).toBe(`${ru('data.journal.table.assets')} · ${ru('data.journal.op.update')}: value: 6400 → 6650`)
      expect(journalLine(entry({ op: 'revert', reverts_id: 19 }))).toBe(`${ru('data.journal.table.assets')} · ${ru('data.journal.revertLine', { id: 19 })}`)
      expect(describeChange({ ...base, before_json: '{"a":1}', after_json: '{"a":1}' })).toBe(ru('data.journal.noChanges'))
    })
  })
})

describe('whole-database entries', () => {
  const restore = entry({ table_name: '*', row_id: 0, op: 'restore', before_json: null, after_json: '{"kept":"before-restore-20311019-100000.sqlite"}' }) as ChangeEntry
  const wipe = entry({ table_name: '*', row_id: 0, op: 'wipe', before_json: null, after_json: null }) as ChangeEntry

  it('reads a restore and a wipe as lines about all the data', () => {
    expect(journalLine(restore)).toBe('All data · restore from a file: the previous data is kept as before-restore-20311019-100000.sqlite')
    expect(journalLine(wipe)).toBe('All data · deletion of all data')
  })

  it('reads a test-data load as a line about all the data, with nothing more to say', () => {
    const demoData = entry({ table_name: '*', row_id: 0, op: 'demo_data', before_json: null, after_json: '{"family":"ru-RU"}' }) as ChangeEntry
    expect(journalLine(demoData)).toBe('All data · test data loaded')
    expect(isRevertible(demoData, true)).toBe(false)
    expect(describeChange(demoData)).toBe('')
  })

  it('offers no revert for them', () => {
    expect(isRevertible(restore, true)).toBe(false)
    expect(isRevertible(wipe, true)).toBe(false)
    expect(isRevertible(entry({ op: 'revert' }) as ChangeEntry, true)).toBe(false)
    expect(isRevertible(entry({}) as ChangeEntry, true)).toBe(true)
  })

  it('no Revert for user changes', () => {
    expect(isRevertible(entry({ table_name: 'users', op: 'update' }) as ChangeEntry, true)).toBe(false)
  })

  it('no Revert for the council: proposals, their versions, votes and settings', () => {
    for (const table_name of ['proposals', 'proposal_versions', 'proposal_votes', 'advisor_settings']) {
      expect(isRevertible(entry({ table_name, op: 'update' }) as ChangeEntry, true), table_name).toBe(false)
    }
  })

  it('Revert of a family setting only for a manager', () => {
    const setting = entry({ table_name: 'app_settings', op: 'update' }) as ChangeEntry
    expect(isRevertible(setting, true)).toBe(true)
    expect(isRevertible(setting, false)).toBe(false)
    expect(isRevertible(entry({}) as ChangeEntry, false)).toBe(true)
  })

  it('no Revert for a sign-in setting (an auth_* key), even for a manager', () => {
    const auth = (json: Partial<ChangeEntry>) => ({ ...base, table_name: 'app_settings', op: 'update', ...json }) as ChangeEntry
    expect(isRevertible(auth({ before_json: '{"key":"auth_mode","value":"password"}', after_json: '{"key":"auth_mode","value":"telegram"}' }), true)).toBe(false)
    expect(isRevertible(auth({ op: 'insert', after_json: '{"key":"auth_password","value":"***"}' }), true)).toBe(false)
    expect(isRevertible(auth({ op: 'delete', before_json: '{"key":"auth_bot_token","value":"***"}' }), true)).toBe(false)
    expect(isRevertible(auth({ before_json: '{"key":"language","value":"en-US"}', after_json: '{"key":"language","value":"ru-RU"}' }), true)).toBe(true)
  })

  it('no Revert for a module switch: the server answers module_switch_revert', () => {
    expect(isRevertible(entry({ table_name: 'modules', op: 'update' }) as ChangeEntry, true)).toBe(false)
  })

  it('no Revert for a module setting such as reminder_settings (deleted with its module): the server does not put it back', () => {
    for (const op of ['update', 'delete'] as const) {
      expect(isRevertible(entry({ table_name: 'reminder_settings', op }) as ChangeEntry, true), op).toBe(false)
    }
  })
})

describe('journalActor', () => {
  it('names the person, and says so when the edit came through Claude', async () => {
    expect(journalActor({ ...base, actor: 'Ryan' })).toBe('Ryan')
    expect(journalActor({ ...base, actor: 'Ryan', source: 'mcp' })).toBe('Ryan via Claude')
    expect(await withLanguage('ru-RU', () => journalActor({ ...base, actor: 'Ryan', source: 'mcp' }))).toBe(ru('data.journal.viaClaude', { actor: 'Ryan' }))
  })

  it('says so when the edit came through the Telegram bot, and names the scheduled run', async () => {
    expect(journalActor({ ...base, actor: 'Noa', source: 'bot' })).toBe('Noa via Telegram')
    expect(journalActor({ ...base, actor: 'scheduler', source: 'scheduler' })).toBe('Scheduled run')
    expect(journalActor({ ...base, actor: 'reset-password', source: 'config' })).toBe('Server configuration')
    // the label comes from the source: a member who happens to be called so is named as any other
    expect(journalActor({ ...base, actor: 'scheduler', source: 'admin' })).toBe('scheduler')
    await withLanguage('ru-RU', () => {
      expect(journalActor({ ...base, actor: 'Noa', source: 'bot' })).toBe(ru('data.journal.viaTelegram', { actor: 'Noa' }))
      expect(journalActor({ ...base, actor: 'scheduler', source: 'scheduler' })).toBe(ru('data.journal.scheduler'))
    })
  })
})

describe('the council tables', () => {
  it('have their names in the journal, in both languages', async () => {
    const titles = { proposals: 'Proposals', proposal_versions: 'Proposal versions', proposal_votes: 'Votes', advisor_settings: 'Advisor settings' }
    for (const [table_name, title] of Object.entries(titles)) {
      expect(journalLine(entry({ table_name, op: 'update', before_json: '{"status":"open"}', after_json: '{"status":"accepted"}' }) as ChangeEntry))
        .toBe(`${title} · change: status: open → accepted`)
      expect(ru(`data.journal.table.${table_name}`)).not.toBe(`data.journal.table.${table_name}`)
    }
  })

  it('masks the amounts a proposal version holds in privacy mode', () => {
    const version = entry({ table_name: 'proposal_versions', op: 'insert', before_json: null, after_json: '{"title":"Car","scenario_json":"{\\"amount\\":20000}","evaluation_json":"{}"}' }) as ChangeEntry
    expect(describeChange(version, true)).toBe('title=Car, scenario_json=•••, evaluation_json=•••')
  })
})

describe('human journal and safe details', () => {
  it('names property and year and describes exactly what undoing an added valuation removes', () => {
    const valuation = entry({ table_name: 'real_estate', op: 'insert', before_json: null, after_json: '{"name":"Home","valuation_year":2026,"value":10000000,"currency":"RUB"}' }) as ChangeEntry
    expect(journalSummary(valuation)).toContain('Home')
    expect(journalSummary(valuation)).toContain('2026')
    expect(journalSummary(valuation)).toContain('Valuation')
    expect(journalUndoEffect(valuation)).toContain('Remove this valuation')
    expect(journalUndoEffect(valuation)).not.toContain('2025')
  })
  it('masks every availability amount in the summary and technical detail payload', () => {
    const assessment = entry({ table_name: 'availability_assessments', op: 'insert', before_json: null, after_json: '{"name":"Cash","balance":123456,"reserve":23456,"goals":3456,"commitments":456,"currency":"RUB"}' }) as ChangeEntry
    for (const value of ['123456', '23456', '3456', '456']) {
      expect(journalSummary(assessment, true)).not.toContain(value)
      expect(journalDetails(assessment, true)).not.toContain(value)
    }
    expect(journalDetails(assessment, true)).toContain('•••')
    expect(isRevertible(assessment, true)).toBe(false)
  })
})

it('translates the anonymous family author and keeps cents visible in human amounts', () => {
  expect(journalActor({ ...base, actor: 'family', source: 'admin' })).toBe('Family password')
  expect(journalSummary(entry({ before_json: '{"value":10.1,"currency":"USD"}', after_json: '{"value":10.2,"currency":"USD"}' }))).toContain('10.1 USD → 10.2 USD')
})

it('translates loan amount fields and identifies both sides of a renamed object', () => {
  const renamed = entry({ table_name: 'goals', before_json: '{"name":"Holiday"}', after_json: '{"name":"Trip"}' })
  expect(journalSummary(renamed)).toContain('Name: Holiday → Trip')
  const loan = entry({ table_name: 'loans', before_json: '{"principal":1000,"currency":"USD"}', after_json: '{"principal":1200,"currency":"USD"}' })
  expect(journalSummary(loan)).toContain('Loan amount: 1,000 USD → 1,200 USD')
})

it('uses the recorded currency on each side and the purchase currency for the purchase price', () => {
  expect(journalSummary(entry({ before_json: '{"value":100,"currency":"USD"}', after_json: '{"value":200,"currency":"EUR"}' }))).toContain('Value: 100 USD → 200 EUR')
  expect(journalSummary(entry({ table_name: 'real_estate', before_json: '{"purchase_price":90000,"purchase_currency":"USD"}', after_json: '{"purchase_price":100000,"purchase_currency":"USD"}' }))).toContain('Purchase price: 90,000 USD → 100,000 USD')
})

it('names the language, currency and income and expenses tracking family settings and keeps internal settings neutral', () => {
  const setting = (key: string, before: unknown, after: unknown) => entry({ table_name: 'app_settings', before_json: JSON.stringify({ key, value: before }), after_json: JSON.stringify({ key, value: after }) })
  expect(journalSummary(setting('language', 'en-US', 'ru-RU'))).toContain('Language: en-US → ru-RU')
  expect(journalSummary(setting('currency', 'USD', 'EUR'))).toContain('Currency: USD → EUR')
  expect(journalSummary(setting('track_flows', '1', '0'))).toContain('Track income and expenses: Yes → No')
  expect(journalSummary(setting('auth_epoch', 3, 4))).toBe('Family settings · change · Internal setting updated; see technical details')
})

it.each(['"123456"', '123456', '[123456]', 'null', 'true'])('masks unsupported known-money payload %s in privacy mode', payload => {
  const change = entry({ table_name: 'availability_assessments', op: 'insert', before_json: null, after_json: payload })
  expect(journalDetails(change, true)).not.toContain('123456')
  expect(journalDetails(change, true)).toContain('•••')
  expect(journalSummary(change, true)).not.toContain('123456')
  expect(describeChange(change, true)).not.toContain('123456')
})


it.each(['monthly_cashflow', 'flow_lines', 'category_spending', 'loan_payments'])('identifies recorded accounts, categories and loans in %s summaries and undo', table_name => {
  const change = (bank: string, category_id: number) => entry({ table_name, op: 'insert', before_json: null, after_json: JSON.stringify({ bank, source: bank, loan_name: bank, category_id, date: '2031-06-01', amount: 100 }) })
  expect(journalSummary(change('Bank A', 1))).toContain('Bank A')
  expect(journalUndoEffect(change('Bank B', 2))).toContain('Bank B')
  expect(journalSummary(change('Bank A', 1))).not.toBe(journalSummary(change('Bank B', 1)))
  if (table_name === 'flow_lines' || table_name === 'category_spending') {
    expect(journalSummary(change('Bank A', 1))).not.toBe(journalSummary(change('Bank A', 2)))
    expect(journalSummary(change('Bank A', 1))).toContain('name unavailable')
    expect(journalUndoEffect(change('Bank A', 2))).toContain('Category #2 (name unavailable)')
  }
})
it('uses only recorded category names and translates category metadata changes', () => {
  const change = entry({ table_name: 'spending_categories', before_json: '{"name":"Food","kind":"optional","flow":"expense","one_off":0}', after_json: '{"name":"Food","kind":"mandatory","flow":"active","one_off":1}' })
  expect(journalSummary(change)).toContain('Optional → Mandatory')
  expect(journalSummary(change)).toContain('Expenses → Active')
  expect(journalSummary(change)).toContain('No → Yes')
  expect(journalUndoEffect(change)).toContain('Optional → Mandatory')
  expect(journalSummary(entry({ table_name: 'flow_lines', op: 'insert', before_json: null, after_json: '{"category_id":4,"category_name":"Recorded food","amount":5}' }))).toContain('Recorded food')
})
it('keeps added valuations focused on property, year and value without empty notes or purchase metadata', () => {
  const change = entry({ table_name: 'real_estate', op: 'insert', before_json: null, after_json: '{"name":"Home","valuation_year":2031,"value":120000,"currency":"USD","purchase_price":100000,"purchase_currency":"USD","purchase_date":"2020-01-01","notes":""}' })
  expect(journalSummary(change)).toContain('Home · 2031')
  expect(journalSummary(change)).toContain('Valuation: 120,000 USD')
  expect(journalSummary(change)).not.toMatch(/Purchase|Notes|Currency:/)
  expect(journalDetails(change)).toContain('purchase_price')
})

it('translates recorded category metadata and unavailable labels in Russian', async () => {
  await withLanguage('ru-RU', () => {
    const change = entry({ table_name: 'spending_categories', before_json: '{"name":"Food","kind":"optional","flow":"expense","one_off":0}', after_json: '{"name":"Food","kind":"mandatory","flow":"active","one_off":1}' })
    expect(journalSummary(change)).toContain(`${ru('modules.cashflow.spending.kind.optional')} → ${ru('modules.cashflow.spending.kind.mandatory')}`)
    expect(journalSummary(change)).not.toMatch(/data\.|modules\./)
    expect(journalUndoEffect(entry({ table_name: 'flow_lines', op: 'insert', before_json: null, after_json: '{"bank":"Bank","category_id":7,"amount":100}' }))).toContain(ru('data.journal.human.categoryUnavailable', { id: 7 }))
  })
})


it('keeps compact log amounts in their own currency and masks both sides', () => {
  const change = { ...base, table_name: 'assets', before_json: '{"name":"Savings","value":100,"currency":"USD"}', after_json: '{"name":"Savings","value":200,"currency":"EUR"}' }
  expect(journalSummary(change, false, true)).toBe('Savings · Value: 100 USD → 200 EUR; Currency: USD → EUR')
  expect(journalSummary(change, true, true)).toBe('Savings · Value: ••• → •••; Currency: USD → EUR')
})
