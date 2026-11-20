// The duplicate groups side by side, each member pointing at the entry it is to merge into (tests/styles/
// duplicateRatchet.test.ts freezes the same classes). A merge PR moves a group onto its canonical class and removes
// its members here. Data only (react-refresh).
import type { ReactNode } from 'react'
import type { DesignEntry } from '../registry'

/** How a member of each kind is drawn: the same text in each class, so the difference shows */
const SAMPLE: Record<string, (cls: string) => ReactNode> = {
  note: cls => <p className={cls}>Rates from the European Central Bank.</p>,
  kpi: cls => <div className={cls}><span>Income</span> <strong className="num">$14,093</strong></div>,
  empty: cls => <p className={cls}>No goals yet.</p>,
  table: cls => <table className={cls}><tbody><tr><td>Savings</td><td className="num">$12,400</td></tr></tbody></table>,
  delta: cls => <span className={`${cls} num`}>+$2,273</span>,
  link: cls => <a className={cls} href="#to-merge">What changed our net worth</a>,
  button: cls => <button type="button" className={cls}>Edit the goal</button>,
  title: cls => <h2 className={cls}>Assets</h2>,
  value: cls => <strong className={`${cls} num`}>$684,196</strong>,
}

/** member class, its kind, the canonical entry, the owner stylesheet */
const MEMBERS: [string, keyof typeof SAMPLE, string, string][] = [
  ['.nw__value', 'value', '.hl__value', 'src/styles/overview.css'],
  ['.acc-months__note', 'note', '.note', 'src/styles/accounts.css'],
  ['.allocation-meter__note', 'note', '.note', 'src/styles/allocation.css'],
  ['.avail-ed__note', 'note', '.note', 'src/styles/availability.css'],
  ['.bridge__note', 'note', '.note', 'src/styles/overview.css'],
  ['.close-bar__note', 'note', '.note', 'src/styles/admin.css'],
  ['.close-note', 'note', '.note', 'src/styles/admin.css'],
  ['.contributions__note', 'note', '.note', 'src/styles/assets.css'],
  ['.gl-form__note', 'note', '.note', 'src/styles/goals.css'],
  ['.ln-eps__note', 'note', '.note', 'src/styles/loans.css'],
  ['.re-form__note', 'note', '.note', 'src/styles/real-estate.css'],
  ['.re-vals__note', 'note', '.note', 'src/styles/real-estate.css'],
  ['.recap__note', 'note', '.note', 'src/styles/finance.css'],
  ['.users-note', 'note', '.note', 'src/styles/admin.css'],
  ['.acc-kpi', 'kpi', 'KpiCell', 'src/styles/accounts.css'],
  ['.cf-kpi', 'kpi', 'KpiCell', 'src/styles/cashflow.css'],
  ['.gl-kpi', 'kpi', 'KpiCell', 'src/styles/goals.css'],
  ['.admin-empty', 'empty', '.empty-note', 'src/styles/admin.css'],
  ['.gl-empty', 'empty', '.empty-note', 'src/styles/goals.css'],
  ['.journal-empty', 'empty', '.empty-note', 'src/pages/admin/journal.css'],
  ['.ln-empty', 'empty', '.empty-note', 'src/styles/loans.css'],
  ['.recap__table', 'table', '.page-table', 'src/styles/finance.css'],
  ['.cf-row__delta', 'delta', '.delta', 'src/styles/cashflow.css'],
  ['.nw__delta', 'delta', '.delta', 'src/styles/overview.css'],
  ['.gl-link', 'button', '.link-button', 'src/styles/goals.css'],
  ['.re-link', 'link', '.link-accent', 'src/styles/real-estate.css'],
  ['.close-problems__link', 'link', '.title-row__link', 'src/styles/admin.css'],
  ['.comb__year-link', 'link', '.title-row__link', 'src/styles/overview.css'],
  ['.overview-section-title', 'title', 'SectionLabel', 'src/styles/overview.css'],
]

export const TO_MERGE_ENTRIES: DesignEntry[] = MEMBERS.map(([name, kind, canonical, owner]) => ({
  name, use: `A duplicate: merge into ${canonical}.`, kind: 'css', owner, duplicateOf: canonical,
  variants: [{ label: name, render: () => SAMPLE[kind](name.slice(1)) }],
}))

/** Canonicals that exist only as the target of a group: the action-link button and the proposed quiet link */
export const CANONICAL_ENTRIES: DesignEntry[] = [
  { name: '.link-button', use: 'An action that reads as a link (a button styled as text); the canonical for link-styled buttons.', kind: 'css', owner: 'src/styles/admin.css', variants: [
    { label: 'default', render: () => <button type="button" className="link-button">Edit the goal</button> },
  ] },
  { name: '.title-row__link', use: 'A quiet underlined link in ink: the proposed canonical of the quiet link group, to move to an owner stylesheet.', kind: 'css', owner: 'src/styles/shell.css', variants: [
    { label: 'default', render: () => <a className="title-row__link" href="#to-merge">2025</a> },
  ] },
]
