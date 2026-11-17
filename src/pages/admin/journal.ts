import { isDateFormat } from '../../domain/dateFormat'
import { fmtNum, fmtDayNumeric, fmtMonthYear } from '../../lib/formatters'
import type { ChangeEntry } from '../../domain/api'
import { t } from '../../i18n/client'
import { PRIVACY_MASK } from '../../lib/privacy'
import { isAuthSettingEntry, isRevertibleTable } from '../../domain/journal'

const parse = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null
  try {
    const value: unknown = JSON.parse(s)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

/** The money columns of the journalled record tables: in privacy mode their values are drawn as PRIVACY_MASK (parameters and family settings hold no amounts). */
const MONEY_COLUMNS: Record<string, readonly string[]> = {
  assets: ['value'],
  availability_assessments: ['balance', 'reserve', 'goals', 'commitments'],
  monthly_cashflow: ['active_income', 'passive_income', 'expense'],
  goals: ['target', 'current'],
  real_estate: ['purchase_price', 'value'],
  loans: ['principal', 'monthly_payment'],
  loan_early_payments: ['amount', 'new_payment', 'principal_credit'],
  loan_payments: ['amount'],
  category_spending: ['amount'],
  flow_lines: ['amount'],
  manual_mandatory_spending: ['amount'],
  // a proposal's scenario and its evaluation are JSON full of amounts: masked whole
  proposal_versions: ['scenario_json', 'evaluation_json'],
}

/**
 * One-line summary of a journal entry for the admin "Journal" tab. With `mask` the amounts of the record tables are hidden:
 * a changed amount is still listed, as "value: ••• → •••".
 */
export function describeChange(e: ChangeEntry, mask = false): string {
  const shown = (k: string, v: unknown) => (mask && MONEY_COLUMNS[e.table_name]?.includes(k) && show(v) !== '—' ? PRIVACY_MASK : show(v))
  if (e.op === 'revert') return t('data.journal.revertLine', { id: e.reverts_id })
  // a restore replaced every table: the line names the copy of the data it replaced; a wipe and a test-data load have nothing more to say
  if (e.op === 'restore') {
    const kept = parse(e.after_json)?.kept
    return typeof kept === 'string' ? t('data.journal.keptAs', { kept }) : ''
  }
  if (e.op === 'wipe' || e.op === 'demo_data') return ''
  // a history import or its removal: the months it spans
  if (e.op === 'history_import' || e.op === 'history_remove') {
    const span = parse(e.after_json)
    return typeof span?.first === 'string' && typeof span.last === 'string' ? t('data.journal.historySpan', { first: span.first, last: span.last }) : ''
  }
  const before = parse(e.before_json)
  const after = parse(e.after_json)
  if (before && after) {
    const changed = Object.keys(after).filter(k => show(before[k]) !== show(after[k]))
    return changed.length ? changed.map(k => `${k}: ${shown(k, before[k])} → ${shown(k, after[k])}`).join(', ') : t('data.journal.noChanges')
  }
  const row = after ?? before
  return row ? Object.entries(row).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}=${shown(k, v)}`).join(', ') : ''
}

/** Locale keys of table and operation names; a table or operation not listed is shown by its raw name. */
const TABLE_TITLE: Record<string, string> = {
  availability_assessments: 'data.journal.table.availability_assessments',
  assets: 'data.journal.table.assets', monthly_cashflow: 'data.journal.table.monthly_cashflow', loans: 'data.journal.table.loans',
  loan_early_payments: 'data.journal.table.loan_early_payments', loan_payments: 'data.journal.table.loan_payments',
  account_transfers: 'data.journal.table.account_transfers',
  spending_categories: 'data.journal.table.spending_categories', category_spending: 'data.journal.table.category_spending',
  flow_lines: 'data.journal.table.flow_lines',
  manual_mandatory_spending: 'data.journal.table.manual_mandatory_spending', real_estate: 'data.journal.table.real_estate',
  goals: 'data.journal.table.goals', parameters: 'data.journal.table.parameters', currencies: 'data.journal.table.currencies',
  members: 'data.journal.table.members', modules: 'data.journal.table.modules', reminder_settings: 'data.journal.table.reminder_settings',
  fx_manual_rates: 'data.journal.table.fx_manual_rates', app_settings: 'data.journal.table.app_settings',
  users: 'data.journal.table.users', proposals: 'data.journal.table.proposals',
  proposal_versions: 'data.journal.table.proposal_versions', proposal_votes: 'data.journal.table.proposal_votes',
  advisor_settings: 'data.journal.table.advisor_settings', '*': 'data.journal.table.all',
}
const OP_TITLE: Record<string, string> = {
  insert: 'data.journal.op.insert', update: 'data.journal.op.update', delete: 'data.journal.op.delete',
  restore: 'data.journal.op.restore', wipe: 'data.journal.op.wipe', demo_data: 'data.journal.op.demo_data',
  history_import: 'data.journal.op.history_import', history_remove: 'data.journal.op.history_remove',
}

/** Operations that replaced whole tables or wrote a whole history: the server refuses to revert them (`not_revertible`). */
const WHOLE_DATABASE_OPS = new Set(['restore', 'wipe', 'demo_data', 'history_import', 'history_remove'])

/**
 * Whether the journal offers "Revert" for an entry: not for a revert, a restore, a wipe, a sign-in setting
 * (isAuthSettingEntry) or a table the server never puts back (isRevertibleTable: a user, the advisor's council, an old
 * module switch, a module's settings), and a family setting (language, currency, income and expenses tracking) only to
 * someone who manages settings.
 */
export const isRevertible = (e: ChangeEntry, canManage: boolean) =>
  e.op !== 'revert' && !WHOLE_DATABASE_OPS.has(e.op) && !isAuthSettingEntry(e)
  && isRevertibleTable(e.table_name) && (canManage || e.table_name !== 'app_settings')

/**
 * Who made the change, as the "Who" column shows it: an edit through Claude's connector or the Telegram bot says so
 * ("Masha via Claude", "Masha via Telegram"); the hourly run (source `scheduler`) is "Scheduled run", whatever its name.
 */
export function journalActor(e: ChangeEntry): string {
  if (e.source === 'scheduler') return t('data.journal.scheduler')
  if (e.source === 'config') return t('data.journal.configActor')
  if (e.source === 'mcp') return t('data.journal.viaClaude', { actor: e.actor })
  if (e.source === 'bot') return t('data.journal.viaTelegram', { actor: e.actor })
  if (e.source === 'admin' && ['family', 'demo'].includes(e.actor)) return t(`data.journal.human.actor.${e.actor}`)
  return e.actor
}

/** The object label shared by journal lines and the object filter. */
export const journalTableName = (table: string): string => TABLE_TITLE[table] ? t(TABLE_TITLE[table]) : table

/** A whole journal line: where, what kind of edit and what changed — "Accounts · change: value: 9000 → 9200". */
export function journalLine(e: ChangeEntry, mask = false): string {
  const where = journalTableName(e.table_name)
  if (e.op === 'revert') return `${where} · ${describeChange(e, mask)}`
  const op = OP_TITLE[e.op] ? t(OP_TITLE[e.op]) : e.op
  const what = describeChange(e, mask)
  return what ? `${where} · ${op}: ${what}` : `${where} · ${op}`
}

/** Technical details retain original column names, with the same masking as the readable summary. */
export function journalDetails(e: ChangeEntry, mask = false): string {
  const safe = (json: string | null) => {
    const row = parse(json)
    if (!row) return mask && MONEY_COLUMNS[e.table_name] && json ? PRIVACY_MASK : json
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, mask && MONEY_COLUMNS[e.table_name]?.includes(key) && value !== null ? PRIVACY_MASK : value]))
  }
  return JSON.stringify({ table: e.table_name, row: e.row_id, before: safe(e.before_json), after: safe(e.after_json) }, null, 2)
}

const HUMAN_FIELDS: Record<string, string> = {
  name: 'data.field.name', member: 'data.field.owner', date: 'data.field.date', month: 'data.field.month',
  currency: 'common.currency', amount: 'data.field.amount', balance: 'data.field.balance',
  active_income: 'data.field.active', passive_income: 'data.field.passive', expense: 'data.field.expense',
  value: 'data.journal.human.value', valuation_year: 'modules.real_estate.field.year', notes: 'modules.real_estate.field.notes',
  purchase_date: 'modules.real_estate.field.purchase_date', purchase_price: 'modules.real_estate.field.purchase_price',
  purchase_currency: 'common.currency', target: 'data.journal.human.target', current: 'data.journal.human.current',
  reserve: 'data.journal.human.reserve', goals: 'data.journal.table.goals', commitments: 'data.journal.human.commitments',
  principal: 'data.loans.field.principal', monthly_payment: 'data.loans.field.monthly_payment',
  new_payment: 'data.loans.ep.newPayment', principal_credit: 'data.loans.ep.credited',
  rate: 'data.loans.field.rate', term_months: 'data.loans.field.term_months',
  issue_date: 'data.loans.field.issue_date', payment_day: 'data.loans.field.payment_day', secured_by: 'data.loans.field.secured_by',
  available: 'data.journal.human.available', enabled: 'data.journal.human.enabled',
  bank: 'data.journal.human.account', source: 'data.journal.human.source', loan_name: 'data.journal.human.loan',
  category_id: 'data.journal.human.category', kind: 'data.journal.human.kind', flow: 'data.journal.human.flow', one_off: 'modules.cashflow.flows.categories.oneOffLabel',
}

/** Recognizable entity, date/year and translated changed fields; raw payload stays in the disclosure. */
export function journalSummary(e: ChangeEntry, mask = false, compact = false): string {
  if (!['insert', 'update', 'delete'].includes(e.op)) return journalLine(e, mask)
  const before = parse(e.before_json)
  const after = parse(e.after_json)
  const row = after ?? before ?? {}
  if (e.table_name === 'app_settings') {
    const label = row.key === 'date_format' ? 'data.params.dateFormat' : row.key === 'language' ? 'data.params.language' : row.key === 'currency' ? 'common.currency' : row.key === 'track_flows' ? 'data.params.trackFlows' : null
    // the tracking switch is stored as '1' / '0': it reads as yes / no
    const value = (v: unknown) => (row.key === 'date_format' && isDateFormat(v) ? { dmy: 'DD.MM.YYYY', mdy: 'MM.DD.YYYY', ymd: 'YYYY.MM.DD' }[v] : row.key === 'track_flows' ? t(v === '0' ? 'data.journal.human.no' : 'data.journal.human.yes') : show(v))
    const change = label ? `${t(label)}: ${before && after ? `${value(before.value)} → ` : ''}${value(row.value)}` : t('data.journal.human.internalSetting')
    return compact ? change : `${journalTableName(e.table_name)} · ${t(OP_TITLE[e.op])} · ${change}`
  }
  const display = (key: string, value: unknown, source = row) => {
    if (mask && MONEY_COLUMNS[e.table_name]?.includes(key) && value != null) return PRIVACY_MASK
    if (MONEY_COLUMNS[e.table_name]?.includes(key) && typeof value === 'number') {
      const currency = key === 'purchase_price' ? source.purchase_currency : source.currency
      return [fmtNum(value, 2), typeof currency === 'string' ? currency : ''].filter(Boolean).join(' ')
    }
    if ((key === 'date' || key.endsWith('_date')) && typeof value === 'string') return fmtDayNumeric(value)
    if (key === 'month' && typeof value === 'string') return fmtMonthYear(value)
    if (key === 'kind' && ['mandatory', 'optional', 'loan_payment'].includes(String(value))) return t(`modules.cashflow.spending.kind.${value}`)
    if (key === 'flow' && ['expense', 'active', 'passive'].includes(String(value))) return t(value === 'expense' ? 'modules.cashflow.flows.direction.expense' : `modules.cashflow.flows.kind.${value}`)
    if (key === 'category_id') return typeof source.category_name === 'string' && source.category_name ? source.category_name : t('data.journal.human.categoryUnavailable', { id: show(value) })
    if (['available', 'enabled', 'one_off'].includes(key)) return t(value ? 'data.journal.human.yes' : 'data.journal.human.no')
    return show(value)
  }
  const recordedName = ['monthly_cashflow', 'flow_lines'].includes(e.table_name) ? row.bank : e.table_name === 'category_spending' ? row.source : ['loan_payments', 'loan_early_payments'].includes(e.table_name) ? row.loan_name : row.name
  const category = ['flow_lines', 'category_spending'].includes(e.table_name) && row.category_id != null ? display('category_id', row.category_id) : null
  const identity = [recordedName, category, row.member, row.valuation_year, row.month ? display('month', row.month) : row.date ? display('date', row.date) : null].filter(v => v != null && v !== '').join(' · ')
  const keys = Object.keys(row).filter(k => HUMAN_FIELDS[k] && (before && after ? show(before[k]) !== show(after[k]) : row[k] != null && row[k] !== '' && !['name', 'bank', 'source', 'loan_name', 'category_id', 'member', 'valuation_year', 'month', 'date', ...(e.table_name === 'real_estate' ? ['purchase_date', 'purchase_price', 'purchase_currency', 'currency'] : [])].includes(k)))
  const changes = keys.map(k => `${t(k === 'value' && e.table_name === 'real_estate' ? 'data.journal.human.valuation' : HUMAN_FIELDS[k])}: ${before && after ? `${display(k, before[k], before)} → ` : ''}${display(k, row[k], row)}`).join('; ')
  return (compact ? [identity || journalTableName(e.table_name), changes] : [journalTableName(e.table_name), identity, t(OP_TITLE[e.op]), changes || t('data.journal.human.detailsBelow')]).filter(Boolean).join(' · ')
}

/** The actual row-level effect only: an inserted valuation is removed, never an invented prior valuation. */
export function journalUndoEffect(e: ChangeEntry, mask = false): string {
  const effect = e.op === 'insert' && e.table_name === 'real_estate' ? 'removeValuation' : e.op === 'insert' ? 'remove' : e.op === 'delete' ? 'restore' : 'previous'
  return `${journalSummary(e, mask)}. ${t(`data.journal.human.undo.${effect}`)}`
}
