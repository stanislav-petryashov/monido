// The CSS primitives: classes with no component of their own. Their sample markup is written here; the classes are
// the app's. Data only (react-refresh).
import type { DesignEntry } from '../registry'

const T = 'src/styles/tokens.css'
const C = 'src/styles/controls.css'

export const CSS_ENTRIES: DesignEntry[] = [
  { name: '.btn', use: 'Every button; one .btn--primary per screen, .btn--ghost or .btn--quiet for the rest, .btn--danger-solid only to confirm a deletion.', kind: 'css', owner: T, variants: [
    { label: 'default', render: () => <button type="button" className="btn">Save draft</button> },
    { label: '--primary', render: () => <button type="button" className="btn btn--primary">Close March</button> },
    { label: '--ghost', render: () => <button type="button" className="btn btn--ghost">Cancel</button> },
    { label: '--quiet', render: () => <button type="button" className="btn btn--quiet">Earlier</button> },
    { label: '--danger-solid', render: () => <button type="button" className="btn btn--danger-solid">Delete</button> },
    { label: 'disabled', render: () => <button type="button" className="btn btn--primary" disabled>Close March</button> },
  ] },
  { name: '.admin-input', use: 'A text or amount field (inside Field, src/pages/admin/ui); --num for amounts.', kind: 'css', owner: C, variants: [
    { label: 'text', render: () => <input className="admin-input" aria-label="Name" defaultValue="Savings account" /> },
    { label: 'amount', render: () => <input className="admin-input admin-input--num" aria-label="Balance" defaultValue="12 400" /> },
    { label: 'invalid', render: () => <input className="admin-input" aria-label="Balance" aria-invalid="true" defaultValue="12," /> },
  ] },
  { name: '.admin-select', use: 'The native select inside .select (the Select component, src/pages/admin/ui); not a menu.', kind: 'css', owner: C, variants: [
    { label: 'default', render: () => <span className="select"><select className="admin-select" aria-label="Currency" defaultValue="USD"><option>USD</option><option>EUR</option></select></span> },
  ] },
  { name: '.select', use: 'The wrapper that draws the chevron of .admin-select; always around it.', kind: 'css', owner: C, variants: [] },
  { name: '.input-unit', use: 'A field with its unit after the value (%, months), inside Field; not a currency (CurrencyCombobox).', kind: 'css', owner: C, variants: [
    { label: 'percent', render: () => <span className="input-unit"><input className="admin-input admin-input--num" aria-label="Inflation" defaultValue="6" /><span className="input-unit__suffix" aria-hidden="true">%</span></span> },
  ] },
  { name: '.note', use: 'Secondary text, two roles: .note is a caption (a fact under a value, the period, the source); add .note--help for text to read (a screen intro, what a form does, what to do next), .note--error for a problem; no page-specific note class.', kind: 'css', owner: T, variants: [
    { label: 'caption', render: () => <p className="note">Rates from the European Central Bank.</p> },
    { label: '--help', render: () => <p className="note note--help">Check each balance against the bank app, then close the month: the dashboard shows closed months only.</p> },
    { label: '--help --error', render: () => <p className="note note--help note--error">The bot token was rejected by Telegram.</p> },
  ] },
  { name: '.link-accent', use: 'A link in text, on Link; the canonical link look: no page-specific link class.', kind: 'css', owner: T, variants: [
    { label: 'default', render: () => <a className="link-accent" href="#links">Enter spending by category</a> },
  ] },
  { name: '.section-label', use: 'The class of SectionLabel; use the component.', kind: 'css', owner: T, variants: [] },
  { name: '.empty', use: 'An empty state, one class: the base inside a table, a list or a panel; .empty--tile alone in a card (one line, dashed frame); .empty--block a section\'s first screen with .empty__title, text and .empty__acts; no page-specific empty class.', kind: 'css', owner: T, variants: [
    { label: 'base', render: () => <p className="empty">No early payments yet.</p> },
    { label: '--tile', render: () => <p className="empty empty--tile">Enter account balances in Close month</p> },
    { label: '--block', render: () => <section className="card empty empty--block"><h2 className="empty__title">No goals yet</h2><p>A goal is an amount by a date.</p><div className="empty__acts"><button type="button" className="btn btn--primary">Goal</button></div></section> },
  ] },
  { name: '.page-table', use: 'A reading table on a dashboard page, a goal or a record; the one reading table (entry tables use .admin-table): a page adds layout hooks beside it, never its own table look.', kind: 'css', owner: T, variants: [
    { label: 'default', render: () => <table className="page-table"><thead><tr><th>Account</th><th className="num">Balance</th></tr></thead>
      <tbody><tr><td className="name">Savings</td><td className="num">$12,400</td></tr><tr><td className="name">Checking</td><td className="num">$3,180</td></tr></tbody></table> },
  ] },
  { name: '.delta', use: 'A signed change in ink; the canonical delta: no page-specific delta class; never coloured by sign.', kind: 'css', owner: T, variants: [
    { label: 'default', render: () => <span className="delta num">+$2,273</span> },
  ] },
  { name: '.hl__value', use: 'The one large figure of a page (weight 400); not a KPI value (.kpi__value).', kind: 'css', owner: T, variants: [
    { label: 'with label and note', render: () => <div><span className="hl__label">Net worth</span><strong className="hl__value num">$684,196</strong><p className="note">September 2026</p></div> },
  ] },
  { name: '.chip', use: 'The class of Chip; use the component.', kind: 'css', owner: T, variants: [] },
]
