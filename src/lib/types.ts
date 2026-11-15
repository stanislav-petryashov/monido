/** Net worth totals on a date: assets, liabilities, net worth, all in the snapshot currency. */
export interface NetWorthTotals {
  assets_total: number
  liabilities_total: number
  net_worth: number
}

export interface AssetRow {
  name: string
  value: number
  /** null: no member (or property owner) given */
  member: string | null
  /** Which records the row comes from: an account or a property */
  kind: 'account' | 'realEstate'
}

/** A month's flows; all null — a row of the month has no rate, so its totals are unknown */
export type MonthlyTrendRow =
  | { month: string; income: number; expense: number; /** Income minus expenses */ net: number }
  | { month: string; income: null; expense: null; net: null }
