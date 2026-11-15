import type { AccountKey } from '../../domain/accounts'
import type { DraftRow } from '../../domain/monthClose'
import type { NumberField } from './useMonthClose'

// The month-close wizard's rows as the screen asks for them: shared by MonthCloseView and its CloseProgress card

type Column = readonly [NumberField, string]
/** The wizard's number columns: [field, locale key of the caption] */
const COLUMNS: readonly Column[] = [
  ['balance', 'data.field.balance'], ['active', 'data.field.active'], ['passive', 'data.field.passive'], ['expense', 'data.field.expense'],
]

/** The columns the wizard asks for: without the cash-flow module the balance only */
export const closeColumns = (flows: boolean): readonly Column[] => (flows ? COLUMNS : COLUMNS.filter(([f]) => f === 'balance'))

/** A row is filled when every asked field holds a number (zero is a value): the progress card and the bar count the same way */
export const rowFilled = (row: DraftRow, columns: readonly Column[]) =>
  columns.every(([field]) => typeof row[field] === 'number' && Number.isFinite(row[field]))

/** The id of a row's first amount field: what a segment of the progress card jumps to */
export const rowInputId = (key: AccountKey) => `close-row-${encodeURIComponent(key)}`

/** A row's name, with its member when another row has the same name */
export const rowLabel = (row: DraftRow, rows: readonly DraftRow[]) =>
  row.member && rows.filter(r => r.name === row.name).length > 1 ? `${row.name} · ${row.member}` : row.name

/** The id of a loan's amount field: what a line of the obstacles card links to */
export const loanInputId = (name: string) => `close-loan-${encodeURIComponent(name)}`
